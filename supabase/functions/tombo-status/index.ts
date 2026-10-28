// GET /functions/v1/tombo-status?id=&t= — situação do pagamento (o navegador consulta a cada poucos segundos).
import { cors, ipDe, json, pedidoComToken, permitir, sincronizar } from "../_shared/tombo.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "GET") return json(req, { erro: "Método não permitido." }, 405);
  if (!(await permitir(`st-ip:${ipDe(req)}`, 240, 600))) return json(req, { erro: "Muitas tentativas." }, 429);
  const u = new URL(req.url);
  const p = await pedidoComToken(u.searchParams.get("id") ?? "", u.searchParams.get("t") ?? "");
  if (!p) return json(req, { erro: "Pedido não encontrado." }, 404);

  let status = p.status;
  // Se o aviso da SyncPay atrasar, consulta a transação direto (no máximo a cada 10 s por pedido).
  if (status === "aguardando" && Date.now() - new Date(p.criado_em).getTime() > 10_000 && (await permitir(`st:${p.id}`, 1, 10))) {
    const s = await sincronizar(p.id).catch(() => null);
    if (s?.status) status = s.status;
  }
  return json(req, { status, codigo: p.codigo, total: p.total });
});
