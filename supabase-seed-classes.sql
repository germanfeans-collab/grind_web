-- ============================================================
--  GRIND GYM — Seed de horario real (35 clases)
--  Ejecutar en: Supabase Dashboard → SQL Editor
--
--  Reemplaza lo que haya hoy en `classes` por el horario real
--  y correcto (el mismo que estaba armado en demo.html).
--  Si ya había reservas contra clases viejas, se borran en
--  cascada (FK on delete cascade) — es un reset del horario.
-- ============================================================

delete from public.classes;

insert into public.classes (actividad, dia, horario, duracion, capacidad, estado, descripcion) values
  ('Performance', 'Lunes', '07:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking', 'Lunes', '08:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds', 'Lunes', '09:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Performance', 'Lunes', '17:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking', 'Lunes', '18:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds', 'Lunes', '19:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Striking', 'Lunes', '20:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('Performance', 'Martes', '07:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('12 Rounds', 'Martes', '08:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Striking', 'Martes', '09:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('Performance', 'Martes', '17:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('MMA', 'Martes', '18:00', 60, 20, 'active', 'Golpes, clinch y suelo integrados.'),
  ('Striking', 'Martes', '19:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds', 'Martes', '20:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Performance', 'Miércoles', '07:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking', 'Miércoles', '08:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds', 'Miércoles', '09:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Performance', 'Miércoles', '17:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking', 'Miércoles', '18:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds', 'Miércoles', '19:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Striking', 'Miércoles', '20:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('Performance', 'Jueves', '07:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('12 Rounds', 'Jueves', '08:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Striking', 'Jueves', '09:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('Performance', 'Jueves', '17:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('MMA', 'Jueves', '18:00', 60, 20, 'active', 'Golpes, clinch y suelo integrados.'),
  ('Striking', 'Jueves', '19:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds', 'Jueves', '20:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Performance', 'Viernes', '07:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking', 'Viernes', '08:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds', 'Viernes', '09:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Performance', 'Viernes', '17:00', 45, 20, 'active', 'Fuerza y acondicionamiento físico.'),
  ('Striking', 'Viernes', '18:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.'),
  ('12 Rounds', 'Viernes', '19:00', 45, 20, 'active', 'Circuito de combate por estaciones.'),
  ('Striking', 'Viernes', '20:00', 60, 20, 'active', 'Boxeo, kickboxing y muay thai.');
