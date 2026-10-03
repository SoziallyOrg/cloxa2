-- Pilot requests (ADR 009): a company asks for a pilot on the public website and
-- the operator activates it by hand (`pnpm ops`). Public self-signup stays off.
--
-- * private.pilot_requests holds the request. RLS is on and no API role has any
--   privilege: it is read and changed only through the service_role RPCs below.
-- * rpc_submit_pilot_request stores a request and limits abuse in one
--   transaction: 3 per email and 10 per client IP per 24 hours (hashes only, in
--   private.auth_attempts like the login limiter). A limited call is not stored
--   and looks exactly like a stored one. service_role only: the server action
--   checks Turnstile and the honeypot first, so nobody can skip those by calling
--   the database directly with the public key.
-- * rpc_admin_activate_pilot_request creates the organization (through
--   private.create_organization, audited) and marks the request activated, in one
--   transaction. The operator CLI invites the owner's login before it.
-- * Requests are deleted after 12 months by private.run_retention().

-- Belgian VAT / enterprise number: BE, a 0 or 1, then 9 digits; the last two are
-- 97 minus the first eight digits modulo 97.
create function private.is_valid_be_vat(p_vat text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_vat ~ '^BE[01][0-9]{9}$' then
      97 - (pg_catalog.substr(p_vat, 3, 8)::bigint % 97) = pg_catalog.substr(p_vat, 11, 2)::integer
    else false
  end;
$$;

comment on function private.is_valid_be_vat(text) is
  'Belgian VAT number in the form BE0123456749, including the mod-97 check.';

revoke all on function private.is_valid_be_vat(text) from public, anon, authenticated, service_role;

create table private.pilot_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  status text not null default 'open',
  handled_at timestamptz,
  -- Set on activation. The organization outlives the request record.
  organization_id uuid references public.organizations (id) on delete set null,
  company_name text not null,
  vat_number text not null,
  contact_name text not null,
  email text not null,
  phone text,
  employee_range text not null,
  sector text not null,
  message text,
  consented_at timestamptz not null default clock_timestamp(),
  constraint pilot_requests_status_check check (status in ('open', 'activated', 'rejected')),
  constraint pilot_requests_handled_check check ((status = 'open') = (handled_at is null)),
  constraint pilot_requests_company_check check (pg_catalog.char_length(pg_catalog.btrim(company_name)) between 1 and 200),
  constraint pilot_requests_vat_check check (private.is_valid_be_vat(vat_number)),
  constraint pilot_requests_contact_check check (pg_catalog.char_length(pg_catalog.btrim(contact_name)) between 1 and 200),
  constraint pilot_requests_email_check check (
    pg_catalog.char_length(email) between 3 and 254
    and email = pg_catalog.lower(pg_catalog.btrim(email))
    and email like '%_@_%'
  ),
  constraint pilot_requests_phone_check check (phone is null or pg_catalog.char_length(phone) between 1 and 40),
  constraint pilot_requests_range_check check (employee_range in ('1-9', '10-49', '50-249', '250+')),
  constraint pilot_requests_sector_check check (
    sector in ('horeca', 'bouw', 'schoonmaak', 'handel', 'zorg', 'industrie', 'diensten', 'interim', 'andere')
  ),
  constraint pilot_requests_message_check check (message is null or pg_catalog.char_length(message) between 1 and 1000)
);

comment on table private.pilot_requests is
  'Pilot requests from the public website (personal data of a contact person). service_role RPCs only; deleted after 12 months.';

create index pilot_requests_created_at_idx on private.pilot_requests (created_at);
create index pilot_requests_open_idx on private.pilot_requests (created_at) where status = 'open';

alter table private.pilot_requests enable row level security;
revoke all on table private.pilot_requests from public, anon, authenticated, service_role;

-- The limiter table learns two kinds (24-hour windows: its purge is 24 hours).
alter table private.auth_attempts drop constraint auth_attempts_kind_check;
alter table private.auth_attempts add constraint auth_attempts_kind_check check (
  kind in (
    'otp_request',
    'otp_request_email',
    'otp_verify',
    'otp_verify_ip',
    'link_verify',
    'link_verify_global',
    'totp_verify',
    -- Pilot requests: keyed on the email hash and on the IP hash.
    'pilot_request_email',
    'pilot_request_ip'
  )
);

-- Submit ------------------------------------------------------------------------------------

create function private.submit_pilot_request(
  p_company_name text,
  p_vat_number text,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_employee_range text,
  p_sector text,
  p_message text,
  p_consent boolean,
  p_email_hash bytea,
  p_ip_hash bytea
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  if p_consent is not true
    or p_email_hash is null or pg_catalog.octet_length(p_email_hash) <> 32
    or (p_ip_hash is not null and pg_catalog.octet_length(p_ip_hash) <> 32)
    or p_company_name is null or pg_catalog.char_length(pg_catalog.btrim(p_company_name)) not between 1 and 200
    or not coalesce(private.is_valid_be_vat(p_vat_number), false)
    or p_contact_name is null or pg_catalog.char_length(pg_catalog.btrim(p_contact_name)) not between 1 and 200
    or v_email is null or pg_catalog.char_length(v_email) not between 3 and 254 or v_email not like '%_@_%'
    or (p_phone is not null and pg_catalog.char_length(p_phone) not between 1 and 40)
    or p_employee_range is null or p_sector is null
    or (p_message is not null and pg_catalog.char_length(p_message) not between 1 and 1000)
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  -- Serialize per key so parallel calls cannot all slip under a limit. Fixed
  -- order: email, then IP.
  perform pg_catalog.pg_advisory_xact_lock(1010, pg_catalog.hashtext(pg_catalog.encode(p_email_hash, 'hex')));
  if p_ip_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(1011, pg_catalog.hashtext(pg_catalog.encode(p_ip_hash, 'hex')));
  end if;

  delete from private.auth_attempts as expired
  where expired.created_at < v_now - interval '24 hours';

  if private.auth_window_retry_after(p_email_hash, 'pilot_request_email', 3, interval '24 hours', v_now) > 0
    or (
      p_ip_hash is not null
      and private.auth_window_retry_after(p_ip_hash, 'pilot_request_ip', 10, interval '24 hours', v_now) > 0
    )
  then
    return false;
  end if;

  insert into private.auth_attempts (key_hash, kind) values (p_email_hash, 'pilot_request_email');
  if p_ip_hash is not null then
    insert into private.auth_attempts (key_hash, kind) values (p_ip_hash, 'pilot_request_ip');
  end if;

  insert into private.pilot_requests (
    company_name, vat_number, contact_name, email, phone, employee_range, sector, message
  )
  values (
    pg_catalog.btrim(p_company_name), p_vat_number, pg_catalog.btrim(p_contact_name), v_email,
    nullif(pg_catalog.btrim(p_phone), ''), p_employee_range, p_sector,
    nullif(pg_catalog.btrim(p_message), '')
  );
  return true;
exception
  -- An unknown range or sector: the same code as any other bad input.
  when check_violation then
    raise exception using errcode = '22023', message = 'invalid_input';
end;
$$;

comment on function private.submit_pilot_request(text, text, text, text, text, text, text, text, boolean, bytea, bytea) is
  'Stores a pilot request unless the caller is over 3 per email / 10 per IP per 24 hours. Returns whether it was stored.';

create function public.rpc_submit_pilot_request(
  p_company_name text,
  p_vat_number text,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_employee_range text,
  p_sector text,
  p_message text,
  p_consent boolean,
  p_email_hash bytea,
  p_ip_hash bytea
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select private.submit_pilot_request(
    p_company_name, p_vat_number, p_contact_name, p_email, p_phone,
    p_employee_range, p_sector, p_message, p_consent, p_email_hash, p_ip_hash
  );
$$;

comment on function public.rpc_submit_pilot_request(text, text, text, text, text, text, text, text, boolean, bytea, bytea) is
  'service_role only (after Turnstile and the honeypot): store a pilot request. False when rate limited; callers show the same answer.';

-- Operator: list, activate, reject ------------------------------------------------------------

create function public.rpc_admin_list_pilot_requests(p_id uuid default null)
returns table (
  id uuid,
  created_at timestamptz,
  status text,
  company_name text,
  vat_number text,
  contact_name text,
  email text,
  phone text,
  employee_range text,
  sector text,
  message text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.created_at, r.status, r.company_name, r.vat_number, r.contact_name,
    r.email, r.phone, r.employee_range, r.sector, r.message
  from private.pilot_requests as r
  where case when p_id is null then r.status = 'open' else r.id = p_id end
  order by r.created_at, r.id;
$$;

comment on function public.rpc_admin_list_pilot_requests(uuid) is
  'service_role only: the open pilot requests, or the one with this id (any status).';

create function private.activate_pilot_request(
  p_request_id uuid,
  p_owner_user_id uuid,
  p_site_name text default null
)
returns table (organization_id uuid, site_id uuid, membership_id uuid, employee_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request private.pilot_requests%rowtype;
  v_created record;
begin
  select * into v_request
  from private.pilot_requests as r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'request_not_found';
  end if;
  if v_request.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'request_not_open';
  end if;

  select * into v_created
  from private.create_organization(v_request.company_name, p_owner_user_id, v_request.contact_name);

  if nullif(pg_catalog.btrim(p_site_name), '') is not null then
    update public.sites as s
    set name = pg_catalog.btrim(p_site_name)
    where s.id = v_created.site_id;
  end if;

  update private.pilot_requests as r
  set status = 'activated', handled_at = pg_catalog.clock_timestamp(), organization_id = v_created.organization_id
  where r.id = p_request_id;

  return query select v_created.organization_id, v_created.site_id, v_created.membership_id, v_created.employee_id;
end;
$$;

comment on function private.activate_pilot_request(uuid, uuid, text) is
  'Creates the organization for an open pilot request (owner = the invited login) and marks it activated. Audited by create_organization.';

create function public.rpc_admin_activate_pilot_request(
  p_request_id uuid,
  p_owner_user_id uuid,
  p_site_name text default null
)
returns table (organization_id uuid, site_id uuid, membership_id uuid, employee_id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.activate_pilot_request(p_request_id, p_owner_user_id, p_site_name);
$$;

comment on function public.rpc_admin_activate_pilot_request(uuid, uuid, text) is
  'service_role only: create the organization, first site and owner for an open pilot request.';

create function public.rpc_admin_reject_pilot_request(p_request_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  update private.pilot_requests as r
  set status = 'rejected', handled_at = pg_catalog.clock_timestamp()
  where r.id = p_request_id and r.status = 'open';
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;

comment on function public.rpc_admin_reject_pilot_request(uuid) is
  'service_role only: mark an open pilot request rejected. False when it is not open.';

-- Retention: 12 months ----------------------------------------------------------------------------

create function private.purge_pilot_requests()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from private.pilot_requests as r
  where r.created_at < pg_catalog.clock_timestamp() - interval '12 months';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function private.purge_pilot_requests() is
  'Deletes pilot requests older than 12 months (personal data of a contact person).';

create or replace function private.run_retention()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_employee record;
  v_cutoff date;
  v_anonymised integer;
  v_exports integer;
  v_total_anonymised integer := 0;
  v_total_exports integer := 0;
  v_failed integer := 0;
  v_requests integer;
begin
  -- Not tenant data, so it runs first and no organization can hold it up.
  v_requests := private.purge_pilot_requests();

  for v_org in
    select organization.id
    from public.organizations as organization
    order by organization.id
  loop
    -- One organization's failure is rolled back on its own and never stops the others.
    begin
      v_cutoff := (private.org_today(v_org.id)
        - pg_catalog.make_interval(years => private.retention_years(v_org.id)))::date;
      v_anonymised := 0;

      for v_employee in
        select employee.id
        from public.employees as employee
        where employee.organization_id = v_org.id
          and employee.anonymised_at is null
          and not employee.active
          and employee.left_at < v_cutoff
        order by employee.id
      loop
        if private.anonymise_employee(v_employee.id, v_cutoff) then
          v_anonymised := v_anonymised + 1;
        end if;
      end loop;

      v_exports := private.purge_org_exports(v_org.id, v_cutoff);

      if v_anonymised > 0 or v_exports > 0 then
        perform private.write_audit(
          v_org.id,
          'organization.retention_applied',
          'organization',
          v_org.id,
          pg_catalog.jsonb_build_object(
            'employees_anonymised', v_anonymised,
            'exports_purged', v_exports,
            'cutoff', v_cutoff
          )
        );
      end if;

      v_total_anonymised := v_total_anonymised + v_anonymised;
      v_total_exports := v_total_exports + v_exports;
    exception when others then
      v_failed := v_failed + 1;
      -- The SQLSTATE only: messages can quote row values.
      raise warning 'run_retention: organization % failed (SQLSTATE %)', v_org.id, sqlstate;
      begin
        perform private.write_audit(
          v_org.id,
          'organization.retention_failed',
          'organization',
          v_org.id,
          pg_catalog.jsonb_build_object('errors', 1)
        );
      exception when others then
        raise warning 'run_retention: could not audit the failure for organization %', v_org.id;
      end;
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'employees_anonymised', v_total_anonymised,
    'exports_purged', v_total_exports,
    'pilot_requests_purged', v_requests,
    'organizations_failed', v_failed
  );
end;
$$;

-- Grants ------------------------------------------------------------------------------------------

revoke all on function private.submit_pilot_request(text, text, text, text, text, text, text, text, boolean, bytea, bytea)
  from public, anon, authenticated, service_role;
revoke all on function private.activate_pilot_request(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.purge_pilot_requests() from public, anon, authenticated, service_role;
revoke all on function public.rpc_submit_pilot_request(text, text, text, text, text, text, text, text, boolean, bytea, bytea)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_admin_list_pilot_requests(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_admin_activate_pilot_request(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_admin_reject_pilot_request(uuid) from public, anon, authenticated, service_role;

grant execute on function public.rpc_submit_pilot_request(text, text, text, text, text, text, text, text, boolean, bytea, bytea)
  to service_role;
grant execute on function public.rpc_admin_list_pilot_requests(uuid) to service_role;
grant execute on function public.rpc_admin_activate_pilot_request(uuid, uuid, text) to service_role;
grant execute on function public.rpc_admin_reject_pilot_request(uuid) to service_role;
