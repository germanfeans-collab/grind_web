-- ============================================================
--  GRIND GYM — Migración v6
--  Ejecutar en: Supabase Dashboard → SQL Editor
--  (después de v5)
--
--  Agrega el email de Auth al listado administrativo de usuarios.
--  La función sigue validando que quien consulta sea administrador.
-- ============================================================

drop function if exists public.get_all_profiles();

create function public.get_all_profiles()
returns table(
  id          uuid,
  name        text,
  ci          text,
  email       text,
  role        text,
  plan        text,
  active      boolean,
  priority    boolean,
  one_on_one  boolean,
  pase_libre  boolean,
  plan_start  date,
  created_at  timestamptz,
  updated_at  timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.ci,
    u.email::text,
    p.role,
    p.plan,
    p.active,
    p.priority,
    p.one_on_one,
    p.pase_libre,
    p.plan_start,
    p.created_at,
    p.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where (select public.is_admin()) = true
  order by p.created_at;
$$;

revoke all on function public.get_all_profiles() from public, anon;
grant execute on function public.get_all_profiles() to authenticated;

comment on function public.get_all_profiles() is
  'Solo admin. Devuelve perfiles con su email de auth.users.';
