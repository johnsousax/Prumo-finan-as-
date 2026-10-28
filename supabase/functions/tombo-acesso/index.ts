// GET /functions/v1/tombo-acesso?id=&t= — entrega o conteúdo comprado, só para pedidos pagos.
import { cors, db, ipDe, json, pedidoComToken, permitir, sincronizar } from "../_shared/tombo.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "GET") return json(req, { erro: "Método não permitido." }, 405);
  if (!(await permitir(`ac-ip:${ipDe(req)}`, 120, 600))) return json(req, { erro: "Muitas tentativas. Aguarde alguns minutos." }, 429);
  const u = new URL(req.url);
  const p = await pedidoComToken(u.searchParams.get("id") ?? "", u.searchParams.get("t") ?? "");
  if (!p) return json(req, { erro: "Link de acesso inválido." }, 404);

  let status = p.status;
  if (status === "aguardando" && (await permitir(`ac:${p.id}`, 1, 10))) {
    const s = await sincronizar(p.id).catch(() => null);
    if (s?.status) status = s.status;
  }
  if (status !== "pago") return json(req, { status, codigo: p.codigo, erro: "Pagamento ainda não confirmado." }, 402);

  const ids = (p.itens as { id: string }[]).map((i) => i.id);
  const { data } = await db().from("tombo_conteudos").select("id,titulo,html").in("id", ids).order("ordem");
  return json(req, { status, codigo: p.codigo, nome: String(p.nome).split(" ")[0], itens: data ?? [] });
});
