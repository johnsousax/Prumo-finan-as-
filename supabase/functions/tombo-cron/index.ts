// tombo-cron — chamado pelo pg_cron a cada 2 minutos (header x-cron).
// Garante que nenhuma venda fique sem entrega, mesmo se o webhook falhar ou o cliente fechar a página.
import { db, dispararEntrega, iguais, json, segredo, sincronizar } from "../_shared/tombo.ts";

const iso = (ms: number) => new Date(ms).toISOString();

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(req, { ok: false }, 405);
  if (!iguais(req.headers.get("x-cron") ?? "", await segredo("interno_secret"))) return json(req, { ok: false }, 401);
  const sb = db(), agora = Date.now(), r: Record<string, number> = {};

  // 1. Pix em aberto das últimas 3 horas: consulta a SyncPay (fonte da verdade)
  const { data: abertos } = await sb.from("tombo_pedidos").select("id").eq("status", "aguardando")
    .gte("criado_em", iso(agora - 3 * 3600e3)).lt("criado_em", iso(agora - 60e3)).order("criado_em", { ascending: false }).limit(25);
  r.consultados = 0;
  for (const p of abertos ?? []) { await sincronizar(p.id).catch(() => null); r.consultados++; }

  // 2. Pix não pago em 24 horas vira "expirado"
  const { data: exp } = await sb.from("tombo_pedidos").update({ status: "expirado", atualizado_em: iso(agora) })
    .eq("status", "aguardando").lt("criado_em", iso(agora - 24 * 3600e3)).select("id");
  r.expirados = exp?.length ?? 0;

  // 3. Envio travado há mais de 10 minutos volta para a fila
  await sb.from("tombo_pedidos").update({ email_status: "falhou", email_erro: "envio interrompido" })
    .eq("email_status", "enviando").lt("atualizado_em", iso(agora - 10 * 60e3));

  // 4. Pagos sem e-mail entregue: tenta de novo (até 5 vezes por pedido)
  const { data: pend } = await sb.from("tombo_pedidos").select("id").eq("status", "pago")
    .in("email_status", ["pendente", "falhou"]).lt("email_tentativas", 5).limit(10);
  r.reenvios = 0;
  for (const p of pend ?? []) { await dispararEntrega(p.id); r.reenvios++; }

  return json(req, { ok: true, ...r });
});
