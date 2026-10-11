-- ============================================================
--  GRIND GYM — Migración v4
--  Ejecutar en: Supabase Dashboard → SQL Editor
--  (después de v3)
--
--  FIX: "profiles_select_admin" y "profiles_update_own" hacían
--  una subconsulta a public.profiles DESDE una policy definida
--  sobre la propia tabla profiles → Postgres detecta recursión
--  infinita y devuelve error 500 en cualquier SELECT/UPDATE.
--
--  Se reemplazan por versiones que usan is_admin() (función
--  SECURITY DEFINER, que no re-dispara RLS) en vez de consultar
--  la tabla directamente.
-- ============================================================

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
  on public.profiles for select
  using ( public.is_admin() );

-- Helper para leer los valores actuales (role/active) del propio perfil
-- sin re-disparar RLS sobre profiles (evita la misma recursión).
create or replace function public.my_locked_fields()
returns table(role text, active boolean)
language sql
security definer
stable
set search_path = public
as $$
  select role, active from public.profiles where id = auth.uid();
$$;

comment on function public.my_locked_fields() is
  'Helper interno (security definer) para políticas RLS: evita recursión al leer el propio role/active.';

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using ( auth.uid() = id )
  with check (
    auth.uid() = id and
    role   = (select role   from public.my_locked_fields()) and
    active = (select active from public.my_locked_fields())
  );
