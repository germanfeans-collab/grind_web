// ============================================================
//  GRIND GYM — Edge Function: admin-create-user
//  Desplegar en: Supabase Dashboard → Edge Functions → Create a new function
//  Nombre de la función: admin-create-user
//  Pegar este código completo en el editor y hacer Deploy.
//
//  Es la ÚNICA pieza que usa la service_role key (SUPABASE_SERVICE_ROLE_KEY),
//  y corre en el servidor de Supabase — nunca llega al navegador.
//  Supabase inyecta automáticamente SUPABASE_URL, SUPABASE_ANON_KEY y
//  SUPABASE_SERVICE_ROLE_KEY a toda Edge Function: no hay que configurar
//  nada manualmente.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cliente con el JWT de quien llama, para verificar identidad y rol.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: "Sesión inválida." }, 401);

    const { data: profile, error: profileErr } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileErr || profile?.role !== "admin") {
      return json({ error: "Solo un admin puede crear usuarios." }, 403);
    }

    const body = await req.json();
    const { email, password, name, ci, plan, priority, oneOnOne, paseLibre } = body ?? {};

    if (!email || !password || !name || !ci) {
      return json({ error: "Faltan datos: email, password, name y ci son obligatorios." }, 400);
    }
    if (String(password).length < 6) {
      return json({ error: "Contraseña mínimo 6 caracteres." }, 400);
    }

    // Cliente con service_role — SOLO existe en este entorno server-side.
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: String(password),
      email_confirm: true,
      user_metadata: { name, role: "member", plan: plan || "Mensual" },
    });

    if (createErr) return json({ error: createErr.message }, 400);

    // El trigger on_auth_user_created ya creó la fila en profiles
    // (name/role/plan/active/priority por defecto). La completamos:
    const { error: updateErr } = await adminClient
      .from("profiles")
      .update({
        ci,
        plan:       plan || "Mensual",
        priority:   !!priority,
        one_on_one: !!oneOnOne,
        pase_libre: !!paseLibre,
      })
      .eq("id", created.user.id);

    if (updateErr) return json({ error: updateErr.message }, 400);

    return json({ ok: true, id: created.user.id }, 200);

  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
