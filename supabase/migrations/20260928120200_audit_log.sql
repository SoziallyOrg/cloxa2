-- Append-only, per-organization hash-chained audit log, plus the shared
-- hash-chain machinery reused by clock_events.
--
-- hash = sha256(prev_hash || canonical_bytes(row)); the first row of an org
-- chains from 32 zero bytes. Appends take pg_advisory_xact_lock on the org, so
-- each org chain is linear; unique (organization_id, prev_hash) makes a fork
-- impossible even if that lock were ever bypassed.

-- Shared chain primitives --------------------------------------------------

create function private.chain_genesis()
returns bytea
language sql
immutable
set search_path = ''
as $$
  select '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea;
$$;

-- Timestamps enter canonical bytes as integer epoch microseconds, so the
-- encoding is independent of session TimeZone and DateStyle.
create function private.epoch_us(p_ts timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select ((extract(epoch from p_ts) * 1000000)::bigint)::text;
$$;

create function private.chain_hash(p_prev_hash bytea, p_canonical text)
returns bytea
language sql
stable
set search_path = ''
as $$
  select extensions.digest(p_prev_hash || pg_catalog.convert_to(p_canonical, 'UTF8'), 'sha256');
$$;

-- Current head of every chain, so an append finds its predecessor in O(1)
-- without relying on timestamp ordering. Not authoritative: verification walks
-- the rows themselves and only uses the head to detect a removed tail.
create table private.hash_chain_heads (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  chain text not null,
  head_id uuid not null,
  head_hash bytea not null,
  length bigint not null,
  primary key (organization_id, chain),
  constraint hash_chain_heads_chain_check check (chain in ('audit_log', 'clock_events')),
  constraint hash_chain_heads_head_hash_check check (octet_length(head_hash) = 32),
  constraint hash_chain_heads_length_check check (length > 0)
);

alter table private.hash_chain_heads enable row level security;
revoke all on table private.hash_chain_heads from public, anon, authenticated, service_role;

-- Advisory lock namespaces (first int4 key). Lock order inside one
-- transaction is always: employee (1003) -> clock chain (1002) -> audit
-- chain (1001).
--   1001 audit_log chain, per org
--   1002 clock_events chain, per org
--   1003 live clocking, per employee

-- Takes the chain lock and returns the predecessor hash. Caller must then
-- call private.chain_set_head in the same transaction.
create function private.chain_lock_head(p_organization_id uuid, p_chain text)
returns bytea
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_head bytea;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    case p_chain when 'audit_log' then 1001 when 'clock_events' then 1002 end,
    pg_catalog.hashtext(p_organization_id::text)
  );

  select head.head_hash
  into v_head
  from private.hash_chain_heads as head
  where head.organization_id = p_organization_id
    and head.chain = p_chain;

  return coalesce(v_head, private.chain_genesis());
end;
$$;

create function private.chain_set_head(
  p_organization_id uuid,
  p_chain text,
  p_head_id uuid,
  p_head_hash bytea
)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into private.hash_chain_heads (organization_id, chain, head_id, head_hash, length)
  values (p_organization_id, p_chain, p_head_id, p_head_hash, 1)
  on conflict (organization_id, chain) do update
    set head_id = excluded.head_id,
        head_hash = excluded.head_hash,
        length = private.hash_chain_heads.length + 1;
$$;

create function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = pg_catalog.format('%s is append-only', tg_table_name);
end;
$$;

-- audit_log ----------------------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Null only for system actions (service role, bootstrap).
  actor_user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  -- IDs and enumerated values only: no free-text reasons, no PII.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  prev_hash bytea not null,
  hash bytea not null,
  constraint audit_log_action_check
    check (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' and char_length(action) <= 100),
  constraint audit_log_entity_check
    check (entity ~ '^[a-z][a-z_]*$' and char_length(entity) <= 64),
  constraint audit_log_metadata_check
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  constraint audit_log_prev_hash_check check (octet_length(prev_hash) = 32),
  constraint audit_log_hash_check check (octet_length(hash) = 32),
  constraint audit_log_chain_link_key unique (organization_id, prev_hash)
);

comment on table public.audit_log is
  'Append-only, per-organization hash-chained audit trail. One row per mutation RPC.';

create index audit_log_organization_created_at_idx
  on public.audit_log (organization_id, created_at desc);

-- Canonical bytes (UTF-8 of this text): id|org|actor|action|entity|entity_id|
-- metadata|created_at_us. Nulls become ''. metadata uses jsonb's own text form,
-- which is deterministic (keys sorted, whitespace normalized).
-- WARNING: concat_ws silently SKIPS null arguments, which would shift every
-- later field. Every nullable column must be wrapped in coalesce(..., '').
create function private.audit_log_canonical(p_row public.audit_log)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.concat_ws(
    '|',
    p_row.id::text,
    p_row.organization_id::text,
    coalesce(p_row.actor_user_id::text, ''),
    p_row.action,
    p_row.entity,
    coalesce(p_row.entity_id::text, ''),
    coalesce(p_row.metadata::text, ''),
    coalesce(private.epoch_us(p_row.created_at), '')
  );
$$;

create function private.audit_log_append()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.prev_hash := private.chain_lock_head(new.organization_id, 'audit_log');
  -- Stamped after the lock so created_at order matches chain order.
  new.created_at := pg_catalog.clock_timestamp();
  new.hash := private.chain_hash(new.prev_hash, private.audit_log_canonical(new));
  perform private.chain_set_head(new.organization_id, 'audit_log', new.id, new.hash);
  return new;
end;
$$;

create trigger audit_log_append
before insert on public.audit_log
for each row execute function private.audit_log_append();

create trigger audit_log_reject_update_delete
before update or delete on public.audit_log
for each row execute function private.reject_mutation();

-- TRUNCATE bypasses row triggers and RLS.
create trigger audit_log_reject_truncate
before truncate on public.audit_log
for each statement execute function private.reject_mutation();

create function private.write_audit(
  p_organization_id uuid,
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_log (organization_id, actor_user_id, action, entity, entity_id, metadata)
  values (
    p_organization_id,
    (select auth.uid()),
    p_action,
    p_entity,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Returns the id of the first row that breaks the chain, or null when the
-- whole chain verifies. Walks links from genesis rather than trusting any
-- timestamp order. When the tail was removed, returns the recorded head id,
-- which then no longer exists in the table.
create function private.verify_audit_chain(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.audit_log;
  v_prev bytea := private.chain_genesis();
  v_visited bigint := 0;
  v_total bigint;
  v_head private.hash_chain_heads;
  v_orphan uuid;
begin
  loop
    select log.*
    into v_row
    from public.audit_log as log
    where log.organization_id = p_organization_id
      and log.prev_hash = v_prev;

    exit when not found;

    if v_row.hash is distinct from private.chain_hash(v_row.prev_hash, private.audit_log_canonical(v_row)) then
      return v_row.id;
    end if;

    v_prev := v_row.hash;
    v_visited := v_visited + 1;
  end loop;

  select pg_catalog.count(*)
  into v_total
  from public.audit_log as log
  where log.organization_id = p_organization_id;

  if v_visited <> v_total then
    select log.id
    into v_orphan
    from public.audit_log as log
    where log.organization_id = p_organization_id
      and not exists (
        select 1
        from public.audit_log as predecessor
        where predecessor.organization_id = p_organization_id
          and predecessor.hash = log.prev_hash
      )
      and log.prev_hash <> private.chain_genesis()
    order by log.created_at, log.id
    limit 1;

    if v_orphan is not null then
      return v_orphan;
    end if;

    select log.id
    into v_orphan
    from public.audit_log as log
    where log.organization_id = p_organization_id
    order by log.created_at, log.id
    limit 1;

    return v_orphan;
  end if;

  select head.*
  into v_head
  from private.hash_chain_heads as head
  where head.organization_id = p_organization_id
    and head.chain = 'audit_log';

  if found and (v_head.head_hash <> v_prev or v_head.length <> v_total) then
    return v_head.head_id;
  end if;

  return null;
end;
$$;

alter table public.audit_log enable row level security;

revoke all on table public.audit_log from public, anon, authenticated, service_role;
grant select on table public.audit_log to authenticated, service_role;

create policy audit_log_select_privileged
on public.audit_log
for select
to authenticated
using (private.is_privileged(organization_id));

revoke all on function private.chain_genesis() from public, anon, authenticated, service_role;
revoke all on function private.epoch_us(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.chain_hash(bytea, text) from public, anon, authenticated, service_role;
revoke all on function private.chain_lock_head(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.chain_set_head(uuid, text, uuid, bytea)
  from public, anon, authenticated, service_role;
revoke all on function private.reject_mutation() from public, anon, authenticated, service_role;
revoke all on function private.audit_log_canonical(public.audit_log)
  from public, anon, authenticated, service_role;
revoke all on function private.audit_log_append() from public, anon, authenticated, service_role;
revoke all on function private.write_audit(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.verify_audit_chain(uuid) from public, anon, authenticated, service_role;

-- Server-side integrity checks (e.g. a scheduled job) run as service_role.
grant execute on function private.verify_audit_chain(uuid) to service_role;
