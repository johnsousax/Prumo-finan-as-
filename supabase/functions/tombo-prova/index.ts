// tombo-prova — dados públicos do site.
//  GET          → prova social com vendas REAIS + configuração pública (preços, Pixel, suporte, empresa).
//  POST /visita → conta uma visita (sem dado pessoal; só o dia e a origem da campanha).
import { cors, db, ipDe, json, origemPermitida, permitir, produtos, segredo } from "../_shared/tombo.ts";

let cache: { em: number; dados: Record<string, unknown> } | null = null;

async function montar() {
  const { data, error } = await db().rpc("tombo_prova");
  const d = (error || !data ? { total: 0, dia: 0, agora: 0, minimo: 10, recentes: [] } : data) as
    { total: number; dia: number; agora: number; minimo: number; recentes: { i: string; n: number; m: number }[] };
  // Vendas históricas informadas pelo proprietário, realizadas via WhatsApp.
  // As novas vendas do site vêm do RPC tombo_prova e são somadas a esse total.
  const vendasWhatsAppHistoricas = 1284;
  const mostrar = true;
  const lista = await produtos().catch(() => []);
  const cfg = {
    pixel: /^\d{8,20}$/.test(await segredo("meta_pixel_id")) ? await segredo("meta_pixel_id") : "",
    suporte: await segredo("suporte_contato"),
    empresa: { nome: await segredo("empresa_nome"), doc: await segredo("empresa_doc"), endereco: await segredo("empresa_endereco") },
    produtos: lista.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, ativo: p.ativo, principal: p.principal })),
  };
  return { mostrar, total: vendasWhatsAppHistoricas + d.total, dia: d.dia, agora: d.agora, recentes: (d.recentes ?? []).filter((r) => /^[A-ZÀ-Ý]$/.test(r.i)), cfg };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const u = new URL(req.url);

  if (req.method === "POST" && u.pathname.endsWith("/visita")) {
    if (!origemPermitida(req)) return json(req, { ok: false }, 403);
    if (!(await permitir(`vis:${ipDe(req)}`, 20, 1800))) return json(req, { ok: true });
    const b = await req.json().catch(() => ({}));
    const origem = String(b?.origem ?? "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40) || "direto";
    await db().rpc("tombo_visita", { p_origem: origem });
    return json(req, { ok: true });
  }

  if (req.method !== "GET") return json(req, { erro: "Método não permitido." }, 405);
  if (!(await permitir(`pv-ip:${ipDe(req)}`, 120, 600))) return json(req, { mostrar: false }, 429);
  if (!cache || Date.now() - cache.em > 20_000) cache = { em: Date.now(), dados: await montar() };
  return new Response(JSON.stringify(cache.dados), {
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=20", "X-Content-Type-Options": "nosniff" },
  });
});
