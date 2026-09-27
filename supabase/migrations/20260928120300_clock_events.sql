-- Append-only, per-organization hash-chained clock events and the live clock
-- RPCs (docs/architecture.md, "Time facts").
--
-- Shifts are derived from effective events (not superseded by any other
-- event). The live RPC validates each transition against the caller's current
-- effective state under a per-employee advisory lock; server time is
-- authoritative and client time is only stored as client_captured_at.

create function private.is_valid_geo(p_geo jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_geo is null then true
    when jsonb_typeof(p_geo) <> 'object' then false
    when jsonb_typeof(p_geo -> 'lat') is distinct from 'number' then false
    when jsonb_typeof(p_geo -> 'lng') is distinct from 'number' then false
    when p_geo ? 'accuracy_m' and jsonb_typeof(p_geo -> 'accuracy_m') <> 'number' then false
    when exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_geo) as geo_key (name)
      where geo_key.name not in ('lat', 'lng', 'accuracy_m')
    ) then false
    else (p_geo -> 'lat')::numeric between -90 and 90
      and (p_geo -> 'lng')::numeric between -180 and 180
      and coalesce((p_geo -> 'accuracy_m')::numeric, 0) >= 0
  end;
$$;

create table public.clock_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  site_id uuid not null,
  employee_id uuid not null,
  type text not null,
  -- The time the fact refers to: server_at for live clocking, the approved
  -- time for corrections.
  occurred_at timestamptz not null,
  -- Insert time, always stamped by the append trigger.
  server_at timestamptz not null default clock_timestamp(),
  client_captured_at timestamptz,
  source text not null,
  device_id uuid,
  -- At most one point ({lat, lng, accuracy_m?}), only if the org allows it.
  geo jsonb,
  supersedes_event_id uuid,
  correction_id uuid,
  -- Kiosk events (Phase 3) for workers without a login: actor still to be decided.
  actor_user_id uuid not null,
  idempotency_key uuid not null,
  prev_hash bytea not null,
  hash bytea not null,
  constraint clock_events_organization_id_id_key unique (organization_id, id),
  -- Scoped per employee: a key chosen by one device can never collide with,
  -- or replay, another employee's event.
  constraint clock_events_idempotency_key unique (organization_id, employee_id, idempotency_key),
  constraint clock_events_chain_link_key unique (organization_id, prev_hash),
  constraint clock_events_site_fkey
    foreign key (organization_id, site_id)
    references public.sites (organization_id, id) on delete restrict,
  constraint clock_events_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint clock_events_supersedes_fkey
    foreign key (organization_id, supersedes_event_id)
    references public.clock_events (organization_id, id) on delete restrict,
  constraint clock_events_type_check
    check (type in ('clock_in', 'clock_out', 'break_start', 'break_end', 'void')),
  constraint clock_events_source_check
    check (source in ('app', 'kiosk', 'mobile', 'correction')),
  -- A void only ever supersedes; it never stands on its own.
  constraint clock_events_void_supersedes_check
    check (type <> 'void' or supersedes_event_id is not null),
  -- Only corrections may supersede events or reference a correction.
  constraint clock_events_correction_links_check
    check (source = 'correction' or (supersedes_event_id is null and correction_id is null)),
  constraint clock_events_geo_check check (private.is_valid_geo(geo)),
  constraint clock_events_prev_hash_check check (octet_length(prev_hash) = 32),
  constraint clock_events_hash_check check (octet_length(hash) = 32)
);

comment on table public.clock_events is
  'Append-only, per-organization hash-chained clock facts. Corrections append superseding events.';

create index clock_events_employee_occurred_at_idx
  on public.clock_events (organization_id, employee_id, occurred_at);
create index clock_events_site_occurred_at_idx
  on public.clock_events (organization_id, site_id, occurred_at);
-- An event is superseded at most once; later changes supersede the superseding
-- event. Also serves the "is this event effective" anti-join.
create unique index clock_events_supersedes_event_id_key
  on public.clock_events (supersedes_event_id)
  where supersedes_event_id is not null;
create index clock_events_correction_id_idx
  on public.clock_events (correction_id)
  where correction_id is not null;

-- Canonical bytes (UTF-8 of this text), per docs/architecture.md:
-- id|org|site|employee|type|occurred_at_us|server_at_us|client_captured_at_us|
-- source|supersedes_event_id|correction_id|actor_user_id|device_id|geo.
-- Nulls become ''; geo uses jsonb's deterministic text form.
-- WARNING: concat_ws silently SKIPS null arguments, which would shift every
-- later field. Every nullable column must be wrapped in coalesce(..., '').
create function private.clock_event_canonical(p_row public.clock_events)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.concat_ws(
    '|',
    p_row.id::text,
    p_row.organization_id::text,
    p_row.site_id::text,
    p_row.employee_id::text,
    p_row.type,
    private.epoch_us(p_row.occurred_at),
    private.epoch_us(p_row.server_at),
    coalesce(private.epoch_us(p_row.client_captured_at), ''),
    p_row.source,
    coalesce(p_row.supersedes_event_id::text, ''),
    coalesce(p_row.correction_id::text, ''),
    coalesce(p_row.actor_user_id::text, ''),
    coalesce(p_row.device_id::text, ''),
    coalesce(p_row.geo::text, '')
  );
$$;

create function private.clock_events_append()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.prev_hash := private.chain_lock_head(new.organization_id, 'clock_events');
  -- Stamped after the chain lock so server_at order matches chain order.
  new.server_at := pg_catalog.clock_timestamp();
  if new.source <> 'correction' then
    new.occurred_at := new.server_at;
  end if;
  new.hash := private.chain_hash(new.prev_hash, private.clock_event_canonical(new));
  perform private.chain_set_head(new.organization_id, 'clock_events', new.id, new.hash);
  return new;
end;
$$;

create trigger clock_events_append
before insert on public.clock_events
for each row execute function private.clock_events_append();

create trigger clock_events_reject_update_delete
before update or delete on public.clock_events
for each row execute function private.reject_mutation();

create trigger clock_events_reject_truncate
before truncate on public.clock_events
for each statement execute function private.reject_mutation();

-- Same algorithm as private.verify_audit_chain.
create function private.verify_clock_chain(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.clock_events;
  v_prev bytea := private.chain_genesis();
  v_visited bigint := 0;
  v_total bigint;
  v_head private.hash_chain_heads;
  v_orphan uuid;
begin
  loop
    select event.*
    into v_row
    from public.clock_events as event
    where event.organization_id = p_organization_id
      and event.prev_hash = v_prev;

    exit when not found;

    if v_row.hash is distinct from private.chain_hash(v_row.prev_hash, private.clock_event_canonical(v_row)) then
      return v_row.id;
    end if;

    v_prev := v_row.hash;
    v_visited := v_visited + 1;
  end loop;

  select pg_catalog.count(*)
  into v_total
  from public.clock_events as event
  where event.organization_id = p_organization_id;

  if v_visited <> v_total then
    select event.id
    into v_orphan
    from public.clock_events as event
    where event.organization_id = p_organization_id
      and not exists (
        select 1
        from public.clock_events as predecessor
        where predecessor.organization_id = p_organization_id
          and predecessor.hash = event.prev_hash
      )
      and event.prev_hash <> private.chain_genesis()
    order by event.server_at, event.id
    limit 1;

    if v_orphan is not null then
      return v_orphan;
    end if;

    select event.id
    into v_orphan
    from public.clock_events as event
    where event.organization_id = p_organization_id
    order by event.server_at, event.id
    limit 1;

    return v_orphan;
  end if;

  select head.*
  into v_head
  from private.hash_chain_heads as head
  where head.organization_id = p_organization_id
    and head.chain = 'clock_events';

  if found and (v_head.head_hash <> v_prev or v_head.length <> v_total) then
    return v_head.head_id;
  end if;

  return null;
end;
$$;

-- Effective-state derivation ---------------------------------------------------

-- Latest effective, non-void event of an employee. Valid transitions are
-- enforced on every append, so the state after this event is the current state.
create function private.last_effective_event(p_organization_id uuid, p_employee_id uuid)
returns public.clock_events
language sql
stable
set search_path = ''
as $$
  select event.*
  from public.clock_events as event
  where event.organization_id = p_organization_id
    and event.employee_id = p_employee_id
    and event.type <> 'void'
    and not exists (
      select 1
      from public.clock_events as superseding
      where superseding.supersedes_event_id = event.id
    )
  order by event.occurred_at desc, event.server_at desc, event.id desc
  limit 1;
$$;

create function private.clock_state_after(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'clock_in' then 'working'
    when 'break_end' then 'working'
    when 'break_start' then 'on_break'
    else 'off'
  end;
$$;

-- Live clock implementation ------------------------------------------------------

create function private.clock(
  p_type text,
  p_idempotency_key uuid,
  p_site_id uuid,
  p_client_captured_at timestamptz default null
)
returns public.clock_events
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_employee_id uuid;
  v_existing public.clock_events;
  v_last public.clock_events;
  v_state text;
  v_event public.clock_events;
  v_now timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- void and correction events are appended only by correction approval.
  if p_type is null or p_type not in ('clock_in', 'clock_out', 'break_start', 'break_end') then
    raise exception using errcode = '22023', message = 'invalid_clock_type';
  end if;

  if p_idempotency_key is null or p_site_id is null then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  -- The offline queue may hold an event for up to 3 days; allow 5 minutes of
  -- device clock skew into the future. Rejects +/-infinity too.
  if p_client_captured_at is not null and (
    p_client_captured_at < pg_catalog.now() - interval '72 hours'
    or p_client_captured_at > pg_catalog.now() + interval '5 minutes'
  ) then
    raise exception using errcode = '22023', message = 'client_time_out_of_range';
  end if;

  -- The site decides the organization; the employee row is always the
  -- caller's own. Unknown sites and foreign orgs look identical.
  select site.organization_id
  into v_organization_id
  from public.sites as site
  where site.id = p_site_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select employee.id
  into v_employee_id
  from public.employees as employee
  join public.memberships as membership
    on membership.organization_id = employee.organization_id
   and membership.user_id = employee.user_id
  where employee.organization_id = v_organization_id
    and employee.user_id = v_user_id
    and employee.active
    and membership.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1003, pg_catalog.hashtext(v_employee_id::text));

  -- Idempotent replay: checked under the employee lock, so a concurrent retry
  -- waits for the first attempt and then returns its event.
  select event.*
  into v_existing
  from public.clock_events as event
  where event.organization_id = v_organization_id
    and event.employee_id = v_employee_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.type <> p_type or v_existing.site_id <> p_site_id then
      raise exception using errcode = '22023', message = 'idempotency_key_reused';
    end if;
    return v_existing;
  end if;

  if not exists (
    select 1
    from public.site_assignments as assignment
    join public.sites as site
      on site.organization_id = assignment.organization_id
     and site.id = assignment.site_id
    where assignment.organization_id = v_organization_id
      and assignment.site_id = p_site_id
      and assignment.employee_id = v_employee_id
      and site.active
  ) then
    raise exception using errcode = '42501', message = 'site_not_assigned';
  end if;

  v_last := private.last_effective_event(v_organization_id, v_employee_id);
  v_state := private.clock_state_after(v_last.type);

  if not (
    (p_type = 'clock_in' and v_state = 'off')
    or (p_type in ('clock_out', 'break_start') and v_state = 'working')
    or (p_type = 'break_end' and v_state = 'on_break')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'invalid_transition',
      detail = pg_catalog.format('state=%s type=%s', v_state, p_type);
  end if;

  -- The append trigger re-stamps both with the post-lock clock_timestamp().
  v_now := pg_catalog.clock_timestamp();

  insert into public.clock_events (
    organization_id,
    site_id,
    employee_id,
    type,
    occurred_at,
    server_at,
    client_captured_at,
    source,
    actor_user_id,
    idempotency_key
  )
  values (
    v_organization_id,
    p_site_id,
    v_employee_id,
    p_type,
    v_now,
    v_now,
    p_client_captured_at,
    'app',
    v_user_id,
    p_idempotency_key
  )
  returning * into v_event;

  perform private.write_audit(
    v_organization_id,
    'clock_event.recorded',
    'clock_event',
    v_event.id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_employee_id,
      'site_id', p_site_id,
      'type', p_type,
      'source', 'app'
    )
  );

  return v_event;
end;
$$;

create function private.my_status()
returns table (
  organization_id uuid,
  employee_id uuid,
  state text,
  last_event_id uuid,
  last_event_type text,
  last_event_site_id uuid,
  last_event_occurred_at timestamptz,
  open_shift_started_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    employee.organization_id,
    employee.id,
    private.clock_state_after(last_event.type),
    last_event.id,
    last_event.type,
    last_event.site_id,
    last_event.occurred_at,
    case
      when private.clock_state_after(last_event.type) <> 'off' then (
        select pg_catalog.max(clock_in.occurred_at)
        from public.clock_events as clock_in
        where clock_in.organization_id = employee.organization_id
          and clock_in.employee_id = employee.id
          and clock_in.type = 'clock_in'
          and not exists (
            select 1
            from public.clock_events as superseding
            where superseding.supersedes_event_id = clock_in.id
          )
      )
    end
  from public.employees as employee
  join public.memberships as membership
    on membership.organization_id = employee.organization_id
   and membership.user_id = employee.user_id
  left join lateral private.last_effective_event(employee.organization_id, employee.id) as last_event
    on true
  where employee.user_id = (select auth.uid())
    and employee.active
    and membership.status = 'active'
  order by employee.organization_id;
$$;

-- Public wrappers: the only functions granted to authenticated. SECURITY
-- DEFINER so the private implementations stay un-granted.

create function public.rpc_clock(
  p_type text,
  p_idempotency_key uuid,
  p_site_id uuid,
  p_client_captured_at timestamptz default null
)
returns public.clock_events
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.clock(p_type, p_idempotency_key, p_site_id, p_client_captured_at);
$$;

comment on function public.rpc_clock(text, uuid, uuid, timestamptz) is
  'Record a live clock_in/clock_out/break_start/break_end for the caller at an assigned site. Idempotent per key.';

create function public.rpc_my_status()
returns table (
  organization_id uuid,
  employee_id uuid,
  state text,
  last_event_id uuid,
  last_event_type text,
  last_event_site_id uuid,
  last_event_occurred_at timestamptz,
  open_shift_started_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.my_status();
$$;

comment on function public.rpc_my_status() is
  'Current clock state, last effective event and open shift start of the caller, per organization.';

-- Integrity check on demand: owners only, with fresh MFA. Audited like every
-- RPC; the audit row is written after both chains were verified.
create function private.verify_chains(p_org uuid)
returns table (clock_broken_event_id uuid, audit_broken_row_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
  v_clock uuid;
  v_audit uuid;
begin
  v_membership := private.require_privileged(p_org);
  if v_membership.role is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_clock := private.verify_clock_chain(p_org);
  v_audit := private.verify_audit_chain(p_org);

  perform private.write_audit(
    p_org,
    'integrity.chains_verified',
    'organization',
    p_org,
    pg_catalog.jsonb_build_object('clock_chain_ok', v_clock is null, 'audit_chain_ok', v_audit is null)
  );

  return query select v_clock, v_audit;
end;
$$;

create function public.rpc_verify_chains(p_org uuid)
returns table (clock_broken_event_id uuid, audit_broken_row_id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.verify_chains(p_org);
$$;

comment on function public.rpc_verify_chains(uuid) is
  'Owner-only (fresh MFA): verify both hash chains of the organization. Null means intact.';

alter table public.clock_events enable row level security;

revoke all on table public.clock_events from public, anon, authenticated, service_role;
grant select on table public.clock_events to authenticated, service_role;

create policy clock_events_select_visible
on public.clock_events
for select
to authenticated
using (private.can_see_employee(employee_id));

revoke all on function private.is_valid_geo(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.clock_event_canonical(public.clock_events)
  from public, anon, authenticated, service_role;
revoke all on function private.clock_events_append() from public, anon, authenticated, service_role;
revoke all on function private.verify_clock_chain(uuid) from public, anon, authenticated, service_role;
revoke all on function private.verify_chains(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_verify_chains(uuid) from public, anon, authenticated, service_role;
revoke all on function private.last_effective_event(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.clock_state_after(text) from public, anon, authenticated, service_role;
revoke all on function private.clock(text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.my_status() from public, anon, authenticated, service_role;
revoke all on function public.rpc_clock(text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_my_status() from public, anon, authenticated, service_role;

grant execute on function public.rpc_clock(text, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.rpc_my_status() to authenticated;
grant execute on function public.rpc_verify_chains(uuid) to authenticated;
grant execute on function private.verify_clock_chain(uuid) to service_role;
