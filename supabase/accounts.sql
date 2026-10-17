-- Accounts for a shared copy of Countdown (several friends on one site).
-- Each account owns its own vault, so data stays separate. A name + password unlocks the
-- vault's private key; creating an account needs the site's invite code.
-- Errors are returned as {"error": "..."} rather than raised, so failed-login counts are kept.

create table if not exists public.cd_invites (
  site text primary key,
  code_hash text not null,           -- bcrypt of the upper-cased invite code
  max_accounts int not null default 30
);

create table if not exists public.cd_accounts (
  site text not null,
  name text not null,                -- lower-case login name
  display text not null,             -- as typed
  pw_hash text not null,             -- bcrypt
  secret text not null,              -- the vault's private key, handed back after a good login
  vault text not null references public.cd_vaults(id) on delete cascade,
  fails int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (site, name)
);
create unique index if not exists cd_accounts_vault on public.cd_accounts (vault);

alter table public.cd_invites enable row level security;
alter table public.cd_accounts enable row level security;
revoke all on public.cd_invites from anon, authenticated;
revoke all on public.cd_accounts from anon, authenticated;

create or replace function public.cd_signup(p_site text, p_invite text, p_name text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  inv public.cd_invites%rowtype;
  n text := lower(trim(coalesce(p_name, '')));
  s text; v text; cnt int;
begin
  select * into inv from public.cd_invites where site = p_site;
  if not found or crypt(upper(trim(coalesce(p_invite, ''))), inv.code_hash) <> inv.code_hash then
    perform pg_sleep(0.3);
    return jsonb_build_object('error', 'bad_invite');
  end if;
  if n !~ '^[a-z0-9_.-]{3,20}$' then return jsonb_build_object('error', 'bad_name'); end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then return jsonb_build_object('error', 'bad_password'); end if;
  select count(*) into cnt from public.cd_accounts where site = p_site;
  if cnt >= inv.max_accounts then return jsonb_build_object('error', 'full'); end if;
  if exists (select 1 from public.cd_accounts where site = p_site and name = n) then return jsonb_build_object('error', 'name_taken'); end if;
  s := translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_');
  v := public.cd_vault_id(s);
  insert into public.cd_vaults (id, label) values (v, 'account ' || n || ' (' || p_site || ')');
  insert into public.cd_accounts (site, name, display, pw_hash, secret, vault)
    values (p_site, n, trim(p_name), crypt(p_password, gen_salt('bf', 8)), s, v);
  return jsonb_build_object('secret', s, 'name', trim(p_name));
end $$;

create or replace function public.cd_login(p_site text, p_name text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.cd_accounts%rowtype;
  n text := lower(trim(coalesce(p_name, '')));
begin
  select * into a from public.cd_accounts where site = p_site and name = n;
  if not found then
    perform pg_sleep(0.3);
    return jsonb_build_object('error', 'bad_login');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('error', 'locked', 'minutes', ceil(extract(epoch from (a.locked_until - now())) / 60));
  end if;
  if crypt(coalesce(p_password, ''), a.pw_hash) = a.pw_hash then
    update public.cd_accounts set fails = 0, locked_until = null where site = a.site and name = a.name;
    return jsonb_build_object('secret', a.secret, 'name', a.display);
  end if;
  -- 8 wrong passwords in a row lock the account for 15 minutes
  update public.cd_accounts
     set fails = case when a.fails + 1 >= 8 then 0 else a.fails + 1 end,
         locked_until = case when a.fails + 1 >= 8 then now() + interval '15 minutes' else null end
   where site = a.site and name = a.name;
  return jsonb_build_object('error', 'bad_login');
end $$;

-- Give an existing private-link tracker a name and password.
create or replace function public.cd_attach(p_site text, p_secret text, p_name text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v text := public.cd_vault_id(coalesce(p_secret, ''));
  n text := lower(trim(coalesce(p_name, '')));
begin
  -- only trackers made for this site can be given a login
  if length(coalesce(p_secret, '')) < 24
     or not exists (select 1 from public.cd_vaults where id = v and label like '%(' || p_site || ')') then
    return jsonb_build_object('error', 'unknown_vault');
  end if;
  if exists (select 1 from public.cd_accounts where vault = v) then return jsonb_build_object('error', 'has_account'); end if;
  if n !~ '^[a-z0-9_.-]{3,20}$' then return jsonb_build_object('error', 'bad_name'); end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then return jsonb_build_object('error', 'bad_password'); end if;
  if exists (select 1 from public.cd_accounts where site = p_site and name = n) then return jsonb_build_object('error', 'name_taken'); end if;
  insert into public.cd_accounts (site, name, display, pw_hash, secret, vault)
    values (p_site, n, trim(p_name), crypt(p_password, gen_salt('bf', 8)), p_secret, v);
  return jsonb_build_object('name', trim(p_name));
end $$;

-- Anyone holding the private key can set a new password for the account that owns it.
create or replace function public.cd_set_password(p_site text, p_secret text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then return jsonb_build_object('error', 'bad_password'); end if;
  update public.cd_accounts set pw_hash = crypt(p_password, gen_salt('bf', 8)), fails = 0, locked_until = null
   where site = p_site and vault = public.cd_vault_id(coalesce(p_secret, ''));
  if not found then return jsonb_build_object('error', 'no_account'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cd_whoami(p_site text, p_secret text)
returns jsonb language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('name', (select display from public.cd_accounts
    where site = p_site and vault = public.cd_vault_id(coalesce(p_secret, ''))))
$$;

revoke all on function public.cd_signup(text, text, text, text) from public;
revoke all on function public.cd_login(text, text, text) from public;
revoke all on function public.cd_attach(text, text, text, text) from public;
revoke all on function public.cd_set_password(text, text, text) from public;
revoke all on function public.cd_whoami(text, text) from public;
grant execute on function public.cd_signup(text, text, text, text) to anon, authenticated;
grant execute on function public.cd_login(text, text, text) to anon, authenticated;
grant execute on function public.cd_attach(text, text, text, text) to anon, authenticated;
grant execute on function public.cd_set_password(text, text, text) to anon, authenticated;
grant execute on function public.cd_whoami(text, text) to anon, authenticated;
