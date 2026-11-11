-- ============================================================
--  GRIND GYM — Reset completo
--  Ejecutar en: Supabase Dashboard → SQL Editor
--
--  Borra TODO lo relacionado a este proyecto (tablas, vistas,
--  funciones, trigger) para poder arrancar de cero, limpio.
--  No toca auth.users (esa tabla es de Supabase) ni borra
--  usuarios ya creados en Authentication — solo el trigger.
-- ============================================================

drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.handle_new_user();
drop function if exists public.is_admin();
drop function if exists public.get_all_profiles();
drop function if exists public.admin_update_user(uuid, text, boolean, boolean);
drop function if exists public.admin_update_user(uuid, text, text, text, boolean, boolean, boolean, boolean);
drop function if exists public.admin_delete_user(uuid);
drop function if exists public.create_booking(bigint, date, text, text);
drop function if exists public.set_attendance_status(bigint, text);
drop function if exists public.get_discipline_leaderboard();

drop view if exists public.class_occupancy;

drop table if exists public.bookings cascade;
drop table if exists public.classes cascade;
drop table if exists public.profiles cascade;
