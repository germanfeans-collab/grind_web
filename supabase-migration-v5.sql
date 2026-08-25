-- ============================================================
--  GRIND GYM — Migración v5
--  Ejecutar en: Supabase Dashboard → SQL Editor
--  (después de v4)
--
--  Permite al admin registrar asistencia de un socio que vino
--  SIN haber reservado antes ("pasar lista" con walk-ins).
--  Si el socio ya tenía una reserva para esa clase/fecha, la
--  marca presente en vez de duplicarla.
-- ============================================================

create or replace function public.admin_add_attendance(
  p_class_id   bigint,
  p_class_date date,
  p_user_id    uuid
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking  public.bookings;
  v_existing public.bookings;
  v_name     text;
  v_plan     text;
begin
  if not (select public.is_admin()) then
    raise exception 'Unauthorized: solo un admin puede registrar asistencia manual.';
  end if;

  select name, plan into v_name, v_plan from public.profiles where id = p_user_id;
  if v_name is null then
    raise exception 'Socio no encontrado.';
  end if;

  select * into v_existing from public.bookings
    where class_id = p_class_id and class_date = p_class_date and user_id = p_user_id;

  if found then
    update public.bookings set status = 'present'
      where id = v_existing.id
      returning * into v_booking;
  else
    insert into public.bookings(class_id, user_id, member_name, member_plan, class_date, status)
    values (p_class_id, p_user_id, v_name, v_plan, p_class_date, 'present')
    returning * into v_booking;
  end if;

  return v_booking;
end;
$$;

comment on function public.admin_add_attendance(bigint, date, uuid) is
  'Solo admin. Registra (o marca presente) la asistencia de un socio a una clase, aunque no haya reservado antes.';
