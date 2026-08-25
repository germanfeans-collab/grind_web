-- ============================================================
--  GRIND GYM — Migración v3
--  Ejecutar en: Supabase Dashboard → SQL Editor
--  (después de haber corrido supabase-schema.sql)
--
--  Agrega los campos que faltaban en profiles (CI, etiquetas
--  "1:1" y "Pase Libre") y extiende admin_update_user() para
--  poder editarlos desde el panel admin.
-- ============================================================

alter table public.profiles
  add column if not exists ci         text,
  add column if not exists one_on_one boolean not null default false,
  add column if not exists pase_libre boolean not null default false;

comment on column public.profiles.ci         is 'Cédula de identidad del socio.';
comment on column public.profiles.one_on_one is 'Etiqueta: socio con seguimiento 1:1.';
comment on column public.profiles.pase_libre  is 'Etiqueta: socio que ingresa vía Pase Libre.';

-- Reemplaza la función anterior (firma distinta → hay que dropearla primero)
drop function if exists public.admin_update_user(uuid, text, boolean, boolean);

create or replace function public.admin_update_user(
  target_id      uuid,
  new_name       text,
  new_ci         text,
  new_plan       text,
  new_priority   boolean,
  new_active     boolean,
  new_one_on_one boolean,
  new_pase_libre boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Unauthorized: solo un admin puede actualizar usuarios.';
  end if;

  if new_plan not in ('Flex','Mensual','Semestral','Anual','—') then
    raise exception 'Plan inválido: %', new_plan;
  end if;

  update public.profiles
  set
    name       = new_name,
    ci         = new_ci,
    plan       = new_plan,
    priority   = new_priority,
    active     = new_active,
    one_on_one = new_one_on_one,
    pase_libre = new_pase_libre,
    updated_at = now()
  where id = target_id;

  if not found then
    raise exception 'Usuario no encontrado: %', target_id;
  end if;
end;
$$;

comment on function public.admin_update_user(uuid, text, text, text, boolean, boolean, boolean, boolean) is
  'Solo admin. Actualiza name, ci, plan, priority, active, one_on_one y pase_libre de un perfil de socio.';


-- ── Leaderboard público por disciplina ───────────────────────
-- Devuelve ranking agregado (nombre + conteo) sin exponer perfiles completos.
-- Es intencionalmente público: cualquier visitante (incluso sin sesión) puede
-- llamarlo, ya que la sección "MVPs" es contenido de marketing en el sitio público.
create or replace function public.get_discipline_leaderboard()
returns table(actividad text, display_name text, cnt bigint)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.actividad,
    trim(split_part(p.name, ' ', 1) || ' ' || left(split_part(p.name, ' ', 2), 1) || '.') as display_name,
    count(*) as cnt
  from public.bookings b
  join public.classes  c on c.id = b.class_id
  join public.profiles p on p.id = b.user_id
  where b.status = 'present'
  group by c.actividad, p.id, p.name
  order by c.actividad, cnt desc;
$$;

grant execute on function public.get_discipline_leaderboard() to anon, authenticated;

comment on function public.get_discipline_leaderboard() is
  'Público. Ranking agregado de asistencias por disciplina (nombre + conteo, sin exponer el resto del perfil).';
