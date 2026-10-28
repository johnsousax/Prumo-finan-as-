// POST /functions/v1/tombo-webhook?k=<segredo> — aviso do gateway (SyncPay ou Mercado Pago).
// Não confia no conteúdo: só usa o identificador para reconsultar a cobrança no gateway.
import { db, iguais, json, sincronizar, webhookSecret } from "../_shared/tombo.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(req, { ok: false }, 405);
  const u = new URL(req.url);
  if (!iguais(u.searchParams.get("k") ?? "", await webhookSecret())) return json(req, { ok: false }, 401);

  const body = await req.json().catch(() => ({}));
  const d = body?.data ?? body;
  const identifier = String(d?.identifier ?? d?.id ?? d?.reference_id ?? body?.identifier ?? u.searchParams.get("data.id") ?? u.searchParams.get("id") ?? "");
  if (!/^[\w-]{4,64}$/.test(identifier)) return json(req, { ok: true });

  const tarefa = (async () => {
    const { data: p } = await db().from("tombo_pedidos").select("id").eq("identifier", identifier).maybeSingle();
    if (p) await sincronizar(p.id);
  })().catch(() => null);
  // @ts-ignore EdgeRuntime existe no Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(tarefa); else await tarefa;
  return json(req, { ok: true });
});
