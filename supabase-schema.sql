-- ============================================================
--  GRIND GYM — Supabase Schema v2  (Supabase Auth nativo)
--  Ejecutar en: Supabase Dashboard → SQL Editor
--
--  MODELO DE SEGURIDAD:
--  ─ Las contraseñas NUNCA se almacenan en tablas propias.
--  ─ Supabase Auth maneja bcrypt, JWT y refresh tokens.
--  ─ Los perfiles viven en public.profiles (FK → auth.users.id).
--  ─ RLS usa auth.uid() para todas las decisiones de acceso.
--  ─ Las operaciones privilegiadas corren en funciones RPC
--    con SECURITY DEFINER que verifican el rol internamente.
-- ============================================================


-- ── 1. EXTENSIONES ───────────────────────────────────────────
create extension if not exists "uuid-ossp";


-- ── 2. TABLA: profiles ───────────────────────────────────────
-- Vinculada 1-a-1 con auth.users. NO contiene contraseña.
create table if not exists public.profiles (
  id          uuid         primary key references auth.users(id) on delete cascade,
  name        text         not null,
  role        text         not null  default 'member'   check (role  in ('admin','member')),
  plan        text         not null  default 'Mensual'  check (plan  in ('Flex','Mensual','Semestral','Anual','—')),
  active      boolean      not null  default true,
  priority    boolean      not null  default false,
  plan_start  date,
  created_at  timestamptz  not null  default now(),
  updated_at  timestamptz  not null  default now()
);

comment on table  public.profiles             is 'Perfil de cada socio/admin vinculado a auth.users. Sin contraseñas.';
comment on column public.profiles.id          is 'UUID de auth.users — misma identidad, sin duplicados.';
comment on column public.profiles.role        is 'Rol del usuario: admin (dueños) | member (socio).';
comment on column public.profiles.plan        is 'Plan de membresía activo del socio.';
comment on column public.profiles.priority    is 'Socio con acceso prioritario (reserva anticipada).';
comment on column public.profiles.plan_start  is 'Fecha de inicio del plan vigente.';


-- ── 3. TRIGGER: crear perfil automáticamente al registrar usuario ─
-- Se dispara después de INSERT en auth.users (Supabase Auth).
-- Crea una fila en profiles con role='member' por defecto.
-- Para promover a admin: actualizar manualmente en Table Editor.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role, plan, active, priority)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'member'),
    coalesce(new.raw_user_meta_data->>'plan', 'Mensual'),
    true,
    false
  )
  on conflict (id) do nothing;   -- idempotente: no falla si ya existe
  return new;
end;
$$;

-- Eliminar el trigger si ya existe para evitar duplicados al re-ejecutar
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 4. TABLA: classes ────────────────────────────────────────
create table if not exists public.classes (
  id          bigserial    primary key,
  actividad   text         not null  check (actividad in ('Striking','MMA','12 Rounds','Performance')),
  dia         text         not null  check (dia in ('Lunes','Martes','Miércoles','Jueves','Viernes')),
  horario     text         not null,                          -- formato 'HH:MM'
  duracion    int          not null  default 60,              -- minutos
  capacidad   int          not null  default 20,
  estado      text         not null  default 'active'  check (estado in ('active','cancelled')),
  descripcion text,
  created_at  timestamptz  not null  default now()
);

comment on table  public.classes             is 'Plantilla de clases recurrentes (horario semanal del gimnasio).';
comment on column public.classes.horario     is 'Hora de inicio en formato HH:MM, ej: 07:00.';
comment on column public.classes.duracion    is 'Duración de la clase en minutos.';
comment on column public.classes.capacidad   is 'Cupo máximo de la clase.';
comment on column public.classes.descripcion is 'Descripción breve mostrada en el horario público.';


-- ── 5. TABLA: bookings ───────────────────────────────────────
-- user_id es uuid (FK a auth.users.id), nullable para socios walk-in.
create table if not exists public.bookings (
  id           bigserial    primary key,
  class_id     bigint       references public.classes(id)  on delete cascade,
  user_id      uuid         references auth.users(id)      on delete set null,  -- null = walk-in
  member_name  text         not null,   -- denormalizado para historial ante borrado de usuario
  member_plan  text,
  class_date   date         not null,   -- fecha concreta del turno (distingue semanas)
  status       text         not null  default 'reserved'  check (status in ('reserved','present','absent')),
  reserved_at  timestamptz  not null  default now(),
  created_at   timestamptz  not null  default now()
);

comment on table  public.bookings              is 'Reservas de socios a clases en fechas concretas.';
comment on column public.bookings.user_id      is 'UUID de auth.users. NULL si el socio no tiene cuenta.';
comment on column public.bookings.member_name  is 'Nombre denormalizado: sobrevive al borrado del usuario.';
comment on column public.bookings.class_date   is 'Fecha exacta YYYY-MM-DD. Distingue instancias semanales de la misma clase.';
comment on column public.bookings.status       is 'Estado: reserved | present | absent.';

-- Índices para consultas frecuentes
create index if not exists idx_bookings_class_date  on public.bookings(class_id, class_date);
create index if not exists idx_bookings_user_id     on public.bookings(user_id);
create index if not exists idx_bookings_status      on public.bookings(status);


-- ── 6. VISTA: class_occupancy ────────────────────────────────
-- Cada clase con el conteo de reservas activas en los próximos 7 días.
create or replace view public.class_occupancy as
select
  c.id,
  c.actividad,
  c.dia,
  c.horario,
  c.duracion,
  c.capacidad,
  c.estado,
  c.descripcion,
  c.created_at,
  coalesce(
    (
      select count(*)
      from   public.bookings b
      where  b.class_id   = c.id
        and  b.class_date between current_date and current_date + interval '6 days'
        and  b.status    != 'absent'
    ), 0
  ) as reservas
from public.classes c;

comment on view public.class_occupancy is
  'Vista de clases con reservas activas (reserved | present) en los próximos 7 días.';


-- ── 7. ROW LEVEL SECURITY ─────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.classes  enable row level security;
alter table public.bookings enable row level security;

-- ────────────────────────────────────────────────────────────
--  POLÍTICAS: profiles
-- ────────────────────────────────────────────────────────────

-- Un usuario puede leer su propio perfil
create policy "profiles_select_own"
  on public.profiles for select
  using ( auth.uid() = id );

-- Un admin puede leer todos los perfiles
-- (usa subquery para evitar recursión; la función is_admin() aún no existe aquí,
--  por eso usamos una subquery directa que es equivalente y más eficiente)
create policy "profiles_select_admin"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Un usuario puede actualizar su propio perfil (excepto role y active)
-- La restricción sobre role/active se refuerza en la función RPC admin_update_user.
-- Para evitar que el usuario se promueva a admin vía UPDATE directo,
-- los campos sensibles solo se actualizan vía RPC con SECURITY DEFINER.
create policy "profiles_update_own"
  on public.profiles for update
  using ( auth.uid() = id )
  with check (
    -- El usuario no puede cambiar su propio role ni active
    -- (solo admin puede hacerlo vía admin_update_user RPC)
    role   = (select role  from public.profiles where id = auth.uid()) and
    active = (select active from public.profiles where id = auth.uid())
  );

-- Solo admin puede insertar perfiles directamente (el trigger usa SECURITY DEFINER)
-- Los usuarios normales no necesitan INSERT directo (el trigger lo maneja)
create policy "profiles_insert_admin"
  on public.profiles for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Solo admin puede eliminar perfiles (vía RPC admin_delete_user)
create policy "profiles_delete_admin"
  on public.profiles for delete
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ────────────────────────────────────────────────────────────
--  POLÍTICAS: classes
-- ────────────────────────────────────────────────────────────

-- El horario es público — cualquiera puede ver las clases (incluso sin sesión)
create policy "classes_select_public"
  on public.classes for select
  using (true);

-- Solo admin puede crear/modificar/borrar clases
create policy "classes_insert_admin"
  on public.classes for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "classes_update_admin"
  on public.classes for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "classes_delete_admin"
  on public.classes for delete
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ────────────────────────────────────────────────────────────
--  POLÍTICAS: bookings
-- ────────────────────────────────────────────────────────────

-- Admin ve todas las reservas; member ve solo las suyas
create policy "bookings_select_admin"
  on public.bookings for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "bookings_select_own"
  on public.bookings for select
  using ( user_id = auth.uid() );

-- Un usuario autenticado puede crear reservas solo con su propio user_id.
-- La validación de cupo se hace en la función create_booking (atómica).
create policy "bookings_insert_own"
  on public.bookings for insert
  with check ( user_id = auth.uid() );

-- Admin puede borrar cualquier reserva
create policy "bookings_delete_admin"
  on public.bookings for delete
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Member solo puede cancelar su propia reserva si todavía está en 'reserved'
create policy "bookings_delete_own_reserved"
  on public.bookings for delete
  using (
    user_id = auth.uid()
    and status = 'reserved'
  );

-- Solo admin puede cambiar el status (present / absent / reserved)
create policy "bookings_update_admin"
  on public.bookings for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );


-- ── 8. FUNCIONES RPC (SECURITY DEFINER) ─────────────────────
--
-- Corren con privilegios del owner de la función (normalmente postgres),
-- pero TODAS verifican el rol del caller vía auth.uid() antes de actuar.
-- Esto permite operaciones que RLS no puede hacer directamente
-- (p.ej. tocar auth.users o ejecutar lógica transaccional).

-- ─ 8.1 is_admin() ────────────────────────────────────────────
-- Helper booleano reutilizado por el resto de funciones RPC.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

comment on function public.is_admin() is
  'Devuelve true si el usuario autenticado tiene role=admin en profiles.';


-- ─ 8.2 get_all_profiles() ────────────────────────────────────
-- Devuelve todos los perfiles al admin (no expone pass, no existe).
create or replace function public.get_all_profiles()
returns setof public.profiles
language sql
security definer
stable
set search_path = public
as $$
  select * from public.profiles
  where (select public.is_admin()) = true
  order by created_at;
$$;

comment on function public.get_all_profiles() is
  'Solo admin. Devuelve todos los perfiles de profiles.';


-- ─ 8.3 admin_update_user() ───────────────────────────────────
-- Permite al admin cambiar plan, priority y active de un socio.
-- Es la ÚNICA vía para modificar campos que el RLS prohíbe en UPDATE propio.
create or replace function public.admin_update_user(
  target_id   uuid,
  new_plan     text,
  new_priority boolean,
  new_active   boolean
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

  -- Validar plan
  if new_plan not in ('Flex','Mensual','Semestral','Anual','—') then
    raise exception 'Plan inválido: %', new_plan;
  end if;

  update public.profiles
  set
    plan       = new_plan,
    priority   = new_priority,
    active     = new_active,
    updated_at = now()
  where id = target_id;

  if not found then
    raise exception 'Usuario no encontrado: %', target_id;
  end if;
end;
$$;

comment on function public.admin_update_user(uuid, text, boolean, boolean) is
  'Solo admin. Actualiza plan, priority y active de un perfil de socio.';


-- ─ 8.4 admin_delete_user() ───────────────────────────────────
-- Elimina el perfil y el usuario de auth.users (cascade ya borra bookings user_id→null).
-- Requiere la extensión supabase_admin (disponible en Supabase hosted).
create or replace function public.admin_delete_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Unauthorized: solo un admin puede eliminar usuarios.';
  end if;

  -- Evitar que admin se borre a sí mismo
  if target_id = auth.uid() then
    raise exception 'No podés eliminar tu propio usuario.';
  end if;

  -- Borrar de auth.users (el CASCADE borra el profile automáticamente)
  delete from auth.users where id = target_id;

  if not found then
    raise exception 'Usuario no encontrado: %', target_id;
  end if;
end;
$$;

comment on function public.admin_delete_user(uuid) is
  'Solo admin. Borra el usuario de auth.users (cascade → profiles) y pone user_id=null en bookings.';


-- ─ 8.5 create_booking() ──────────────────────────────────────
-- Verifica cupo disponible y ausencia de doble reserva de forma atómica.
-- El usuario solo puede reservar con su propio auth.uid().
create or replace function public.create_booking(
  p_class_id    bigint,
  p_class_date  date,
  p_member_name text,
  p_member_plan text
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap     int;
  v_count   int;
  v_booking public.bookings;
begin
  -- Usuario debe estar autenticado
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para reservar.';
  end if;

  -- Verificar que la clase existe y está activa
  select capacidad into v_cap
  from public.classes
  where id = p_class_id and estado = 'active';

  if not found then
    raise exception 'Clase no encontrada o inactiva.';
  end if;

  -- Contar reservas activas (excluye absent)
  select count(*) into v_count
  from public.bookings
  where class_id  = p_class_id
    and class_date = p_class_date
    and status    != 'absent';

  if v_count >= v_cap then
    raise exception 'Clase completa (% / % lugares ocupados).', v_count, v_cap;
  end if;

  -- Evitar doble reserva del mismo usuario en la misma clase y fecha
  if exists (
    select 1 from public.bookings
    where class_id  = p_class_id
      and class_date = p_class_date
      and user_id   = auth.uid()
  ) then
    raise exception 'Ya tenés un lugar reservado en esta clase.';
  end if;

  -- Insertar la reserva
  insert into public.bookings(class_id, user_id, member_name, member_plan, class_date, status)
  values (p_class_id, auth.uid(), p_member_name, p_member_plan, p_class_date, 'reserved')
  returning * into v_booking;

  return v_booking;
end;
$$;

comment on function public.create_booking(bigint, date, text, text) is
  'Crea una reserva verificando cupo disponible y doble reserva de forma atómica.';


-- ─ 8.6 set_attendance_status() ───────────────────────────────
-- Solo admin puede marcar present / absent / reserved.
create or replace function public.set_attendance_status(
  booking_id  bigint,
  new_status  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Unauthorized: solo un admin puede cambiar el estado de asistencia.';
  end if;

  if new_status not in ('reserved','present','absent') then
    raise exception 'Estado inválido: %. Usar reserved | present | absent.', new_status;
  end if;

  update public.bookings
  set status = new_status
  where id = booking_id;

  if not found then
    raise exception 'Reserva no encontrada: %', booking_id;
  end if;
end;
$$;

comment on function public.set_attendance_status(bigint, text) is
  'Solo admin. Actualiza el estado de asistencia de una reserva.';


-- ── 9. SEED DATA — Clases (28, horario real GRIND) ───────────
-- Solo insertar si la tabla está vacía para que sea idempotente.
insert into public.classes (actividad, dia, horario, duracion, capacidad, estado, descripcion)
select * from (values
  -- LUNES (L-M-V: mañana 07:00-08:00 / tarde 17:00-20:00)
  ('Striking',    'Lunes',     '07:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('Performance', 'Lunes',     '08:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking',    'Lunes',     '17:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds',   'Lunes',     '18:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Performance', 'Lunes',     '19:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking',    'Lunes',     '20:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  -- MARTES (M-J: mañana 08:00 / tarde 17:00-20:00)
  ('Performance', 'Martes',    '08:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking',    'Martes',    '17:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds',   'Martes',    '18:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Performance', 'Martes',    '19:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('12 Rounds',   'Martes',    '20:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  -- MIÉRCOLES
  ('Striking',    'Miércoles', '07:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('Performance', 'Miércoles', '08:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking',    'Miércoles', '17:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds',   'Miércoles', '18:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Performance', 'Miércoles', '19:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking',    'Miércoles', '20:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  -- JUEVES
  ('Performance', 'Jueves',    '08:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('12 Rounds',   'Jueves',    '17:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Striking',    'Jueves',    '18:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('Performance', 'Jueves',    '19:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('12 Rounds',   'Jueves',    '20:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  -- VIERNES
  ('Striking',    'Viernes',   '07:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('Performance', 'Viernes',   '08:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking',    'Viernes',   '17:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds',   'Viernes',   '18:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Performance', 'Viernes',   '19:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking',    'Viernes',   '20:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.')
) as v(actividad, dia, horario, duracion, capacidad, estado, descripcion)
where not exists (select 1 from public.classes limit 1);


-- ══════════════════════════════════════════════════════════════
--  INSTRUCCIONES PARA CREAR LOS USUARIOS INICIALES
--  (ejecutar DESPUÉS de correr este schema)
-- ══════════════════════════════════════════════════════════════
--
--  Supabase NO permite crear usuarios con rol/plan en auth.users directamente
--  desde el SQL Editor sin la service_role key. El camino correcto es:
--
--  PASO A — Crear los usuarios en el Dashboard de Supabase:
--    1. Ir a Authentication → Users → "Add user" → "Create new user"
--    2. Crear los 3 usuarios con sus emails y contraseñas:
--
--       Nacho (admin):
--         Email:    nacho@grind.uy
--         Password: (elegir contraseña segura)
--
--       Laza (admin):
--         Email:    laza@grind.uy
--         Password: (elegir contraseña segura)
--
--       Socio demo:
--         Email:    socio@grind.uy
--         Password: (elegir contraseña segura)
--
--    Al crear cada usuario, el trigger on_auth_user_created crea
--    automáticamente su fila en public.profiles con role='member'.
--
--  PASO B — Promover a Nacho y Laza como admins:
--    1. Ir a Table Editor → profiles
--    2. Buscar la fila de nacho@grind.uy → editar:
--         role       = 'admin'
--         plan       = '—'
--         plan_start = (dejar null)
--    3. Repetir para laza@grind.uy
--
--  PASO C (opcional) — Actualizar el socio demo:
--    1. Buscar socio@grind.uy en profiles → editar:
--         name       = 'Sofía Martínez'   (o el nombre real)
--         plan       = 'Anual'
--         priority   = true
--         plan_start = 2026-02-01
--
--  IMPORTANTE: Nunca usar la service_role key en el frontend.
--  Las contraseñas las maneja Supabase Auth (bcrypt automático).
-- ══════════════════════════════════════════════════════════════
