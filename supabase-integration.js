/**
 * GRIND GYM — Supabase Integration Layer  v2  (Supabase Auth nativo)
 * ─────────────────────────────────────────────────────────────────
 * Reemplaza las funciones de localStorage de demo.html.
 * Expone todas las operaciones como window._sb.
 *
 * MODELO DE SEGURIDAD:
 *   - La anon key es SEGURA de exponer en el frontend cuando RLS está activado.
 *   - NUNCA usar la service_role key en el frontend.
 *   - Las contraseñas las maneja exclusivamente Supabase Auth (bcrypt + JWT).
 *   - Los datos sensibles se protegen con RLS basado en auth.uid().
 *   - Las operaciones privilegiadas corren en funciones RPC con SECURITY DEFINER.
 *
 * Prerequisito: cargar el CDN de supabase-js v2 ANTES de este script.
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 */

(function () {
  // ══════════════════════════════════════════════════════════════
  //  CONFIGURACIÓN — pegar las keys de tu proyecto Supabase
  //  Settings → API → Project URL y anon public key
  // ══════════════════════════════════════════════════════════════
  const SUPABASE_URL      = 'https://wksfenpjhvxdzncgxyja.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_u6Crj5-nz-9pt10NMR5LHw_kdFGnyvE';  // anon/public — segura para el frontend con RLS

  // ── Cliente Supabase ──────────────────────────────────────────
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,     // renueva el JWT antes de que expire
      persistSession:   true,     // guarda la sesión en localStorage del browser
      detectSessionInUrl: true,   // necesario para magic links (futuro)
    },
  });

  // ══════════════════════════════════════════════════════════════
  //  ESTADO INTERNO
  // ══════════════════════════════════════════════════════════════
  let _currentUserId   = null;   // uuid del usuario autenticado
  let _currentUserRole = null;   // 'admin' | 'member'

  // ══════════════════════════════════════════════════════════════
  //  HELPERS INTERNOS
  // ══════════════════════════════════════════════════════════════

  /**
   * Devuelve el rango lunes–viernes de la semana en curso (UTC-3 Montevideo).
   * Si hoy es fin de semana, devuelve la semana siguiente.
   */
  function _currentWeekRange() {
    const now    = new Date();
    const utcMs  = now.getTime() + now.getTimezoneOffset() * 60_000;
    const mvd    = new Date(utcMs - 3 * 3_600_000);   // hora Montevideo (UTC-3)

    const dayIdx = mvd.getDay();                        // 0=Dom … 6=Sáb
    const diffToMonday = dayIdx === 0 ? 1 : dayIdx === 6 ? 2 : -(dayIdx - 1);

    const monday = new Date(mvd);
    monday.setDate(mvd.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    return { monday: fmt(monday), friday: fmt(friday) };
  }

  /**
   * Formatea un timestamp ISO como string legible en hora Montevideo.
   * Ej: '2026-08-04T18:30:00Z' → 'Hoy 15:30' | 'Ayer 22:14' | '04/08 18:30'
   */
  function _formatReservedAt(isoString) {
    if (!isoString) return '';
    const now    = new Date();
    const utcMs  = now.getTime() + now.getTimezoneOffset() * 60_000;
    const mvdNow = new Date(utcMs - 3 * 3_600_000);

    const dt    = new Date(isoString);
    const utcDt = dt.getTime() + dt.getTimezoneOffset() * 60_000;
    const mvdDt = new Date(utcDt - 3 * 3_600_000);

    const todayStr     = mvdNow.toDateString();
    const yesterdayStr = new Date(mvdNow.getTime() - 86_400_000).toDateString();
    const dtStr        = mvdDt.toDateString();

    const hhmm = `${String(mvdDt.getHours()).padStart(2, '0')}:${String(mvdDt.getMinutes()).padStart(2, '0')}`;

    if (dtStr === todayStr)     return `Hoy ${hhmm}`;
    if (dtStr === yesterdayStr) return `Ayer ${hhmm}`;
    return `${String(mvdDt.getDate()).padStart(2, '0')}/${String(mvdDt.getMonth() + 1).padStart(2, '0')} ${hhmm}`;
  }

  /**
   * Mapea una fila de bookings al formato esperado por demo.html.
   */
  function _mapBooking(row) {
    return {
      id:         row.id,
      classId:    row.class_id,
      userId:     row.user_id,       // uuid string o null
      name:       row.member_name,
      plan:       row.member_plan || '',
      classDate:  row.class_date,
      status:     row.status,
      reservedAt: _formatReservedAt(row.reserved_at),
      createdAt:  row.created_at,
    };
  }

  /**
   * Mapea una fila de classes (o class_occupancy) al formato de demo.html.
   * El campo `reservas` puede venir de la vista o calcularse externamente.
   */
  function _mapClass(row, reservasOverride) {
    return {
      id:        row.id,
      actividad: row.actividad,
      dia:       row.dia,
      horario:   row.horario,
      duracion:  row.duracion,
      capacidad: row.capacidad,
      reservas:  reservasOverride !== undefined ? Number(reservasOverride) : Number(row.reservas ?? 0),
      estado:    row.estado,
      desc:      row.descripcion || '',
    };
  }

  /**
   * Mapea una fila de profiles al formato de demo.html.
   * Compatible con el array `users` que usa demo.html.
   * NOTA: sin campo `pass` — las contraseñas no existen en profiles.
   */
  function _mapProfile(row) {
    return {
      id:        row.id,           // uuid string
      name:      row.name,
      ci:        row.ci || '',
      email:     row.email || '',  // el email está en auth.users, puede no estar en profiles
      role:      row.role,
      plan:      row.plan,
      active:    row.active,
      priority:  row.priority,
      oneOnOne:  row.one_on_one  || false,
      paseLibre: row.pase_libre  || false,
      planStart: row.plan_start || null,
    };
  }

  /**
   * Carga datos adicionales del usuario autenticado (email desde session).
   * Combina el profile de profiles con el email de auth.users (session).
   */
  function _mergeProfileWithSession(profile, session) {
    if (!profile) return null;
    return {
      ..._mapProfile(profile),
      email: session?.user?.email || '',
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  CARGA DE DATOS SEGÚN ROL
  // ══════════════════════════════════════════════════════════════

  /**
   * Carga todos los datos para el usuario autenticado.
   *
   * Admin:  get_all_profiles (RPC) + todas las clases + bookings de la semana
   * Member: su propio profile + todas las clases + solo sus bookings
   *
   * Retorna: { users, classes, bookings }  en formato compatible con demo.html
   */
  async function _loadData(session, profile) {
    const isAdmin = profile?.role === 'admin';
    const { monday, friday } = _currentWeekRange();

    try {
      let usersPromise, classesPromise, bookingsPromise;

      if (isAdmin) {
        // Admin: obtener todos los perfiles vía RPC (seguro, verificado en SQL)
        usersPromise = supabase.rpc('get_all_profiles');
      } else {
        // Member: solo su propio perfil (ya lo tenemos, no necesitamos query extra)
        usersPromise = Promise.resolve({ data: [profile], error: null });
      }

      // Clases: todos los usuarios pueden ver el horario (policy pública)
      classesPromise = supabase
        .from('class_occupancy')
        .select('*')
        .eq('estado', 'active')
        .order('dia')
        .order('horario');

      if (isAdmin) {
        // Admin: todos los bookings de la semana
        bookingsPromise = supabase
          .from('bookings')
          .select('*')
          .gte('class_date', monday)
          .lte('class_date', friday)
          .order('reserved_at', { ascending: false });
      } else {
        // Member: solo sus propios bookings (RLS refuerza esto en el servidor)
        bookingsPromise = supabase
          .from('bookings')
          .select('*')
          .eq('user_id', session.user.id)
          .gte('class_date', monday)
          .lte('class_date', friday)
          .order('reserved_at', { ascending: false });
      }

      const [usersRes, classesRes, bookingsRes] = await Promise.all([
        usersPromise,
        classesPromise,
        bookingsPromise,
      ]);

      if (usersRes.error)    console.error('[_sb] users error:',    usersRes.error);
      if (classesRes.error)  console.error('[_sb] classes error:',  classesRes.error);
      if (bookingsRes.error) console.error('[_sb] bookings error:', bookingsRes.error);

      const bookings = (bookingsRes.data || []).map(_mapBooking);

      // Calcular reservas por classId desde bookings cargados
      // (sobreescribe el valor de class_occupancy para sincronía exacta)
      const reservasPorClass = {};
      for (const b of bookings) {
        if (b.status !== 'absent') {
          reservasPorClass[b.classId] = (reservasPorClass[b.classId] || 0) + 1;
        }
      }

      const classes = (classesRes.data || []).map((row) =>
        _mapClass(row, reservasPorClass[row.id] ?? row.reservas ?? 0)
      );

      // Para admin: enriquecer perfiles con email de auth.users si está disponible
      // (get_all_profiles devuelve profiles sin email; el email vive en auth.users)
      // En la vista de socios, el admin puede ver el email si lo necesita desde el
      // Dashboard de Supabase o agregando un join en la función RPC.
      const rawUsers = usersRes.data || [];
      const users = isAdmin
        ? rawUsers.map(_mapProfile)
        : [_mergeProfileWithSession(profile, session)].filter(Boolean);

      return { users, classes, bookings };

    } catch (err) {
      console.error('[_sb] loadData error inesperado:', err);
      return { users: [], classes: [], bookings: [] };
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  API PÚBLICA — window._sb
  // ══════════════════════════════════════════════════════════════
  const _sb = {};

  /**
   * _sb.init()
   * Inicializa la sesión y carga todos los datos al arrancar la app.
   *
   * Sustituye a: loadState() en demo.html
   *
   * Retorna:
   *   Si hay sesión activa:  { session, user, users, classes, bookings }
   *     - user:     perfil del usuario actual (formato demo.html)
   *     - users:    array de perfiles (admin: todos; member: solo el suyo)
   *     - classes:  array con campo `reservas` computado
   *     - bookings: reservas de la semana (admin: todas; member: solo las suyas)
   *   Si no hay sesión:       { session: null }
   *
   * Uso en demo.html:
   *   const result = await _sb.init();
   *   if (result.session) {
   *     currentUser = result.user;
   *     users       = result.users;
   *     classes     = result.classes;
   *     bookings    = result.bookings;
   *   }
   */
  _sb.init = async function () {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error('[_sb.init] getSession error:', error);
        return { session: null };
      }

      if (!session) {
        return { session: null };
      }

      // Cargar el perfil del usuario autenticado
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profileError) {
        console.error('[_sb.init] profile error:', profileError);
        // Si no hay perfil (raro), devolver sesión sin datos
        return { session, user: null };
      }

      // Actualizar estado interno
      _currentUserId   = session.user.id;
      _currentUserRole = profile.role;

      const user = _mergeProfileWithSession(profile, session);
      const { users, classes, bookings } = await _loadData(session, profile);

      return { session, user, users, classes, bookings };

    } catch (err) {
      console.error('[_sb.init] error inesperado:', err);
      return { session: null };
    }
  };

  /**
   * _sb.login(email, password)
   * Autentica al usuario con Supabase Auth (bcrypt automático, JWT).
   *
   * Sustituye a: users.find(u => u.email===email && u.pass===pass) en doLogin()
   *
   * Retorna: objeto user (formato demo) o null si credenciales inválidas / inactivo.
   * Lanza: string de error legible para mostrar en la UI.
   */
  _sb.login = async function (email, password) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email:    email.trim().toLowerCase(),
        password: password,
      });

      if (error) {
        // Supabase devuelve 'Invalid login credentials' para email/pass incorrectos
        if (error.message?.toLowerCase().includes('invalid')) {
          throw 'Email o contraseña incorrectos.';
        }
        throw error.message || 'Error al iniciar sesión.';
      }

      if (!data.session || !data.user) {
        throw 'No se pudo iniciar sesión.';
      }

      // Cargar el perfil del usuario
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError || !profile) {
        throw 'No se encontró el perfil del usuario. Contactá al administrador.';
      }

      // Verificar que la cuenta esté activa
      if (!profile.active) {
        // Cerrar la sesión recién abierta para no dejar al usuario "logueado pero bloqueado"
        await supabase.auth.signOut();
        throw 'Tu cuenta está desactivada. Contactá al administrador.';
      }

      // Actualizar estado interno
      _currentUserId   = data.user.id;
      _currentUserRole = profile.role;

      return _mergeProfileWithSession(profile, data.session);

    } catch (err) {
      if (typeof err === 'string') throw err;
      console.error('[_sb.login] error inesperado:', err);
      throw 'Error inesperado al iniciar sesión. Intentá de nuevo.';
    }
  };

  /**
   * _sb.logout()
   * Cierra la sesión y limpia el estado interno.
   *
   * Sustituye a: currentUser = null; renderLogin(); en doLogout()
   */
  _sb.logout = async function () {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error('[_sb.logout] error:', error);
    } catch (err) {
      console.error('[_sb.logout] error inesperado:', err);
    } finally {
      _currentUserId   = null;
      _currentUserRole = null;
    }
  };

  /**
   * _sb.createBooking({ classId, classDate, memberName, memberPlan })
   * Crea una reserva verificando cupo y doble reserva atómicamente (RPC).
   *
   * Sustituye a: bookings.push({ ... }); saveState(); en triggerBooking()
   *
   * Retorna: objeto booking (formato demo) o lanza un string de error.
   */
  _sb.createBooking = async function ({ classId, classDate, memberName, memberPlan }) {
    try {
      const { data, error } = await supabase.rpc('create_booking', {
        p_class_id:    classId,
        p_class_date:  classDate,
        p_member_name: memberName,
        p_member_plan: memberPlan || null,
      });

      if (error) {
        // Los mensajes de error vienen de la función RPC y son legibles
        const msg = error.message || error.details || 'Error al crear la reserva.';
        throw msg;
      }

      return data ? _mapBooking(data) : null;

    } catch (err) {
      if (typeof err === 'string') throw err;
      console.error('[_sb.createBooking] error inesperado:', err);
      throw 'Error inesperado al reservar. Intentá de nuevo.';
    }
  };

  /**
   * _sb.cancelBooking(bookingId)
   * Cancela (elimina) la reserva propia del usuario autenticado.
   * RLS en el servidor verifica que user_id = auth.uid() y status = 'reserved'.
   *
   * Sustituye a: bookings = bookings.filter(b => b.id !== id); saveState();
   *
   * Retorna: true si se canceló, false en caso de error.
   */
  _sb.cancelBooking = async function (bookingId) {
    try {
      // El RLS permite DELETE solo si user_id = auth.uid() y status = 'reserved'
      // No hace falta verificar acá: el servidor lo rechaza si no cumple.
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', bookingId)
        .eq('user_id', _currentUserId);   // defensa extra en el cliente

      if (error) {
        console.error('[_sb.cancelBooking] error:', error);
        return false;
      }
      return true;

    } catch (err) {
      console.error('[_sb.cancelBooking] error inesperado:', err);
      return false;
    }
  };

  /**
   * _sb.setAttendanceStatus(bookingId, status)
   * Marca una reserva como present / absent / reserved.
   * Solo admin (verificado en la función RPC set_attendance_status).
   *
   * Sustituye a: b.status = s; saveState(); en setStatus()
   *
   * Retorna: true si se actualizó, false en caso de error.
   */
  _sb.setAttendanceStatus = async function (bookingId, status) {
    try {
      const { error } = await supabase.rpc('set_attendance_status', {
        booking_id: bookingId,
        new_status:  status,
      });

      if (error) {
        console.error('[_sb.setAttendanceStatus] error:', error);
        return false;
      }
      return true;

    } catch (err) {
      console.error('[_sb.setAttendanceStatus] error inesperado:', err);
      return false;
    }
  };

  /**
   * _sb.adminAddAttendance({ classId, classDate, userId })
   * Registra la asistencia de un socio que vino SIN haber reservado antes
   * (walk-in). Si ya tenía una reserva para esa clase/fecha, la marca
   * presente en vez de duplicarla. Solo admin (RPC admin_add_attendance).
   *
   * Retorna: objeto booking (formato demo) o lanza un string de error.
   */
  _sb.adminAddAttendance = async function ({ classId, classDate, userId }) {
    try {
      const { data, error } = await supabase.rpc('admin_add_attendance', {
        p_class_id:   classId,
        p_class_date: classDate,
        p_user_id:    userId,
      });
      if (error) throw error.message || 'Error al registrar la asistencia.';
      return data ? _mapBooking(data) : null;
    } catch (err) {
      if (typeof err === 'string') throw err;
      console.error('[_sb.adminAddAttendance] error inesperado:', err);
      throw 'Error inesperado al registrar la asistencia.';
    }
  };

  /**
   * _sb.saveClass(classData)
   * Crea o actualiza una clase (upsert).
   * Si classData.id existe → UPDATE; si no → INSERT.
   * Solo admin puede hacerlo (RLS lo verifica en el servidor).
   *
   * Sustituye a: la lógica saveClass() del panel admin
   *
   * Retorna: objeto clase (formato demo) o null en caso de error.
   */
  _sb.saveClass = async function (classData) {
    try {
      const row = {
        actividad:   classData.actividad,
        dia:         classData.dia,
        horario:     classData.horario,
        duracion:    Number(classData.duracion)  || 60,
        capacidad:   Number(classData.capacidad) || 20,
        estado:      classData.estado            || 'active',
        descripcion: classData.desc || classData.descripcion || null,
      };

      let query;
      if (classData.id) {
        query = supabase
          .from('classes')
          .update(row)
          .eq('id', classData.id)
          .select()
          .single();
      } else {
        query = supabase
          .from('classes')
          .insert(row)
          .select()
          .single();
      }

      const { data, error } = await query;
      if (error) {
        console.error('[_sb.saveClass] error:', error);
        return null;
      }
      return data ? _mapClass(data) : null;

    } catch (err) {
      console.error('[_sb.saveClass] error inesperado:', err);
      return null;
    }
  };

  /**
   * _sb.deleteClass(classId)
   * Elimina una clase y sus bookings (CASCADE en la FK).
   * Solo admin (RLS).
   *
   * Retorna: true si se eliminó, false en caso de error.
   */
  _sb.deleteClass = async function (classId) {
    try {
      const { error } = await supabase
        .from('classes')
        .delete()
        .eq('id', classId);

      if (error) {
        console.error('[_sb.deleteClass] error:', error);
        return false;
      }
      return true;

    } catch (err) {
      console.error('[_sb.deleteClass] error inesperado:', err);
      return false;
    }
  };

  /**
   * _sb.adminCreateUser({ email, password, name, ci, plan, priority, oneOnOne, paseLibre })
   * Crea un usuario nuevo (auth.users + profile) vía la Edge Function
   * "clever-service" (Edge Function, nombre real desplegado en Supabase —
   * el código fuente es supabase-function-admin-create-user.ts) — es la
   * única pieza que usa la service_role key,
   * y corre en el servidor, nunca en el navegador.
   *
   * Sustituye a: users.push({...}) en saveUser() del panel admin (caso creación)
   *
   * Retorna: { id } si se creó. Lanza un string de error si falla.
   */
  _sb.adminCreateUser = async function (payload) {
    try {
      const { data, error } = await supabase.functions.invoke('clever-service', {
        body: payload,
      });
      if (error) {
        // El body del error (si vino del propio function) suele tener más detalle
        const detail = data?.error || error.message || 'Error al crear el usuario.';
        throw detail;
      }
      if (data?.error) throw data.error;
      return data;
    } catch (err) {
      if (typeof err === 'string') throw err;
      console.error('[_sb.adminCreateUser] error inesperado:', err);
      throw 'Error inesperado al crear el usuario.';
    }
  };

  /**
   * _sb.adminUpdateEmail({ userId, email })
   * Cambia el email de un socio existente. Corre vía la Edge Function
   * "clever-service" (misma que crea usuarios), con la service_role key
   * del lado del servidor.
   *
   * Retorna: true si se actualizó. Lanza un string de error si falla.
   */
  _sb.adminUpdateEmail = async function ({ userId, email }) {
    try {
      const { data, error } = await supabase.functions.invoke('clever-service', {
        body: { action: 'update_email', userId, email },
      });
      if (error) {
        const detail = data?.error || error.message || 'Error al actualizar el email.';
        throw detail;
      }
      if (data?.error) throw data.error;
      return true;
    } catch (err) {
      if (typeof err === 'string') throw err;
      console.error('[_sb.adminUpdateEmail] error inesperado:', err);
      throw 'Error inesperado al actualizar el email.';
    }
  };

  /**
   * _sb.adminUpdateUser({ userId, name, ci, plan, priority, active, oneOnOne, paseLibre })
   * Actualiza name, ci, plan, priority, active y las etiquetas 1:1 / Pase Libre de un socio.
   * Solo admin (verificado en la función RPC admin_update_user).
   *
   * Sustituye a: saveUser() con esos campos en el panel admin
   *
   * Retorna: true si se actualizó, false en caso de error.
   * Lanza: string de error si el RPC lo rechaza.
   */
  _sb.adminUpdateUser = async function ({ userId, name, ci, plan, priority, active, oneOnOne, paseLibre }) {
    try {
      const { error } = await supabase.rpc('admin_update_user', {
        target_id:      userId,
        new_name:       name,
        new_ci:         ci,
        new_plan:       plan,
        new_priority:   priority,
        new_active:     active,
        new_one_on_one: oneOnOne,
        new_pase_libre: paseLibre,
      });

      if (error) {
        const msg = error.message || 'Error al actualizar el usuario.';
        throw msg;
      }
      return true;

    } catch (err) {
      if (typeof err === 'string') throw err;
      console.error('[_sb.adminUpdateUser] error inesperado:', err);
      throw 'Error inesperado al actualizar el usuario.';
    }
  };

  /**
   * _sb.adminDeleteUser(userId)
   * Elimina un usuario de auth.users (cascade → profiles, bookings→null).
   * Solo admin (verificado en la función RPC admin_delete_user).
   *
   * Retorna: true si se eliminó, false en caso de error.
   * Lanza: string de error si el RPC lo rechaza.
   */
  _sb.adminDeleteUser = async function (userId) {
    try {
      const { error } = await supabase.rpc('admin_delete_user', {
        target_id: userId,
      });

      if (error) {
        const msg = error.message || 'Error al eliminar el usuario.';
        throw msg;
      }
      return true;

    } catch (err) {
      if (typeof err === 'string') throw err;
      console.error('[_sb.adminDeleteUser] error inesperado:', err);
      throw 'Error inesperado al eliminar el usuario.';
    }
  };

  /**
   * _sb.loadLeaderboard()
   * Ranking público por disciplina (top asistencias), vía RPC get_discipline_leaderboard.
   * No requiere sesión — usable en la sección MVPs del sitio público.
   *
   * Retorna: array de { actividad, display, count }.
   */
  _sb.loadLeaderboard = async function () {
    try {
      const { data, error } = await supabase.rpc('get_discipline_leaderboard');
      if (error) {
        console.error('[_sb.loadLeaderboard] error:', error);
        return [];
      }
      return (data || []).map((row) => ({
        actividad: row.actividad,
        display:   row.display_name,
        count:     Number(row.cnt),
      }));
    } catch (err) {
      console.error('[_sb.loadLeaderboard] error inesperado:', err);
      return [];
    }
  };

  /**
   * _sb.loadBookingsForDate(dateIso)
   * Carga las reservas de UNA fecha específica, sin límite hacia atrás
   * (para poder pasar lista de cualquier clase pasada, no solo esta semana).
   * Admin ve todas (RLS bookings_select_admin); un member vería solo las suyas.
   *
   * Retorna: array de bookings (formato demo).
   */
  _sb.loadBookingsForDate = async function (dateIso) {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('class_date', dateIso)
        .order('reserved_at', { ascending: false });

      if (error) {
        console.error('[_sb.loadBookingsForDate] error:', error);
        return [];
      }
      return (data || []).map(_mapBooking);
    } catch (err) {
      console.error('[_sb.loadBookingsForDate] error inesperado:', err);
      return [];
    }
  };

  /**
   * _sb.loadBookingsForWeek(mondayIso, fridayIso)
   * Carga las reservas de una semana arbitraria (para el Dashboard general,
   * navegable libremente hacia atrás, no solo la semana actual).
   * Admin ve todas (RLS bookings_select_admin).
   *
   * Retorna: array de bookings (formato demo).
   */
  _sb.loadBookingsForWeek = async function (mondayIso, fridayIso) {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .gte('class_date', mondayIso)
        .lte('class_date', fridayIso)
        .order('reserved_at', { ascending: false });

      if (error) {
        console.error('[_sb.loadBookingsForWeek] error:', error);
        return [];
      }
      return (data || []).map(_mapBooking);
    } catch (err) {
      console.error('[_sb.loadBookingsForWeek] error inesperado:', err);
      return [];
    }
  };

  /**
   * _sb.loadPublicClasses()
   * Carga el horario público (sin necesidad de sesión). Usar para visitantes
   * anónimos que todavía no iniciaron sesión.
   *
   * Retorna: array de clases (formato demo, con `reservas` desde class_occupancy).
   */
  _sb.loadPublicClasses = async function () {
    try {
      const { data, error } = await supabase
        .from('class_occupancy')
        .select('*')
        .eq('estado', 'active')
        .order('dia')
        .order('horario');

      if (error) {
        console.error('[_sb.loadPublicClasses] error:', error);
        return [];
      }
      return (data || []).map((row) => _mapClass(row));

    } catch (err) {
      console.error('[_sb.loadPublicClasses] error inesperado:', err);
      return [];
    }
  };

  /**
   * _sb.loadData()
   * Recarga todos los datos del usuario actual (útil tras mutaciones).
   *
   * Retorna: { users, classes, bookings } o null si no hay sesión.
   */
  _sb.loadData = async function () {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (!profile) return null;
      return await _loadData(session, profile);

    } catch (err) {
      console.error('[_sb.loadData] error inesperado:', err);
      return null;
    }
  };

  /**
   * _sb.onAuthStateChange(callback)
   * Suscribe al cambio de estado de autenticación (login / logout / token refresh).
   * Útil para reaccionar automáticamente cuando el JWT expira y se renueva.
   *
   * callback(event, session) donde event puede ser:
   *   'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED'
   *
   * Retorna: objeto subscription con método .unsubscribe()
   *
   * Uso:
   *   const { data: sub } = _sb.onAuthStateChange(async (event, session) => {
   *     if (event === 'SIGNED_OUT') { renderLogin(); }
   *   });
   *   // Para desuscribir: sub.subscription.unsubscribe();
   */
  _sb.onAuthStateChange = function (callback) {
    return supabase.auth.onAuthStateChange(callback);
  };

  // ── Exponer en window ────────────────────────────────────────
  window._sb = _sb;

})();


/* ══════════════════════════════════════════════════════════════
   SETUP — instrucciones paso a paso para activar Supabase
   ══════════════════════════════════════════════════════════════

   PASO 1 — Crear el proyecto en Supabase
   ───────────────────────────────────────
   - Ir a https://supabase.com → "New project"
   - Nombre: grind-mvd  |  Región: South America (São Paulo)
   - Guardar la contraseña de la DB en un lugar seguro.

   PASO 2 — Ejecutar el schema SQL
   ────────────────────────────────
   - En el Dashboard del proyecto → SQL Editor
   - Pegar y ejecutar supabase-schema.sql completo.
   - Verificar en Table Editor que existen: profiles, classes, bookings
     y la vista class_occupancy.

   PASO 3 — Crear los usuarios en Supabase Auth
   ─────────────────────────────────────────────
   - Authentication → Users → "Add user" → "Create new user"
   - Crear los usuarios reales con sus emails y contraseñas seguras:

       Nacho (admin):   nacho@grind.uy  /  contraseña segura
       Laza  (admin):   laza@grind.uy   /  contraseña segura
       Socio demo:      socio@grind.uy  /  contraseña segura

   - Al crear cada usuario el trigger crea automáticamente su fila en profiles.

   PASO 4 — Promover a Nacho y Laza como admins
   ──────────────────────────────────────────────
   - Table Editor → profiles
   - Buscar la fila de nacho@grind.uy → editar: role = 'admin', plan = '—'
   - Repetir para laza@grind.uy
   - Los admins pueden gestionar el resto desde el panel de la app.

   PASO 5 — Copiar las keys del proyecto
   ──────────────────────────────────────
   - Settings → API
   - Copiar "Project URL"  → reemplazar SUPABASE_URL arriba
   - Copiar "anon public"  → reemplazar SUPABASE_ANON_KEY arriba
   - NUNCA copiar la "service_role" key en este archivo.

   PASO 6 — Integrar en demo.html
   ────────────────────────────────
   - Agregar antes del </body>:
       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
       <script src="supabase-integration.js"></script>

   - Actualizar el Content-Security-Policy en demo.html.
     En el meta CSP, agregar a connect-src:
       https://YOUR_PROJECT.supabase.co

   PASO 7 — Reemplazar loadState() y doLogin() en demo.html
   ──────────────────────────────────────────────────────────
   Arranque (reemplazar loadState()):
     const result = await _sb.init();
     if (result.session) {
       currentUser = result.user;
       users       = result.users;
       classes     = result.classes;
       bookings    = result.bookings;
       renderApp();
     } else {
       renderLogin();
     }

   Login (reemplazar users.find()):
     try {
       const user = await _sb.login(emailInput, passInput);
       currentUser = user;
       // recargar datos con el rol del usuario
       const data  = await _sb.loadData();
       users       = data.users;
       classes     = data.classes;
       bookings    = data.bookings;
       renderApp();
     } catch (errMsg) {
       showLoginError(errMsg);
     }

   Logout (reemplazar lógica de logout):
     await _sb.logout();
     renderLogin();

   PASO 8 — Reemplazar saveState() con las funciones _sb.*
   ─────────────────────────────────────────────────────────
     triggerBooking()       → await _sb.createBooking({ classId, classDate, memberName, memberPlan })
     cancelBooking()        → await _sb.cancelBooking(bookingId)
     setStatus()            → await _sb.setAttendanceStatus(bookingId, status)
     saveClass()  (admin)   → await _sb.saveClass(classData)
     deleteClass() (admin)  → await _sb.deleteClass(classId)
     adminUpdate() (admin)  → await _sb.adminUpdateUser({ userId, plan, priority, active })
     deleteUser()  (admin)  → await _sb.adminDeleteUser(userId)

   NOTAS DE SEGURIDAD:
   ─────────────────────
   - La anon key es pública: el frontend la puede exponer. La seguridad
     la provee RLS (Row Level Security) en el servidor de Supabase.
   - Las contraseñas son manejadas 100% por Supabase Auth (bcrypt).
     Nunca llegan a tus tablas personalizadas.
   - Los emails de los usuarios están en auth.users (gestionados por Supabase).
     La tabla profiles no tiene email para evitar duplicación; el email viene
     del objeto session.user.email al hacer login.
   - Las funciones RPC con SECURITY DEFINER verifican is_admin() antes de
     ejecutar cualquier operación privilegiada. Un member no puede invocarlas
     exitosamente aunque llame al RPC directamente.

══════════════════════════════════════════════════════════════ */
