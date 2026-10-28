// tombo-arquivos
//  GET  ?id=&t=&f=ebook|tesouro|dolar|planilha  → baixa o arquivo (só pedido pago e item comprado). PDF com marca d'água do comprador.
//  POST /entregar  (header x-interno)            → envia o e-mail de entrega pelo Resend, uma única vez por pedido.
import { db, iguais, json, pedidoComToken, permitir, segredo } from "../_shared/tombo.ts";
import { gerarPDF } from "../_shared/pdf.ts";
import { PDFS } from "../_shared/conteudo.ts";
import { montarEmail } from "../_shared/email.ts";

const EDICAO = "Edição de 28 de outubro de 2026";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function b64(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string) {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

type Pedido = { id: string; codigo: string; nome: string; email: string; itens: { id: string; nome: string }[]; total: number };

async function arquivo(p: Pedido, f: string): Promise<{ nome: string; tipo: string; bytes: Uint8Array } | null> {
  if (PDFS[f]) {
    const c = PDFS[f];
    const bytes = await gerarPDF(c.blocos, { kicker: c.kicker, titulo: c.titulo, sub: c.sub, edicao: EDICAO, comprador: p.nome, email: p.email, pedido: p.codigo });
    return { nome: `${c.arquivo}-Prumo.pdf`, tipo: "application/pdf", bytes };
  }
  if (f === "planilha") {
    const { data } = await db().from("tombo_conteudos").select("anexo_b64,anexo_nome").eq("id", "planilha").maybeSingle();
    if (!data?.anexo_b64) return null;
    return { nome: data.anexo_nome ?? "Mapa-de-Aportes-Prumo.xlsx", tipo: XLSX, bytes: unb64(data.anexo_b64) };
  }
  return null;
}

async function entregar(pedidoId: string) {
  const sb = db();
  // trava: só um envio por vez e no máximo 5 tentativas
  const { data: atual } = await sb.from("tombo_pedidos").select("email_tentativas").eq("id", pedidoId).maybeSingle();
  if (!atual) return { ok: false, motivo: "pedido inexistente" };
  const { data: p } = await sb.from("tombo_pedidos")
    .update({ email_status: "enviando", email_tentativas: (atual.email_tentativas ?? 0) + 1, atualizado_em: new Date().toISOString() })
    .eq("id", pedidoId).eq("status", "pago").in("email_status", ["pendente", "falhou"]).lt("email_tentativas", 5)
    .select("id,codigo,nome,email,itens,total,token").maybeSingle();
  if (!p) return { ok: true, motivo: "nada a enviar" };

  try {
    const site = (await segredo("site_url")) || "https://www.glamhouse.site";
    const anexos = [];
    for (const it of p.itens as { id: string }[]) {
      const a = await arquivo(p as Pedido, it.id);
      if (a) anexos.push(a);
    }
    const m = montarEmail({
      nome: p.nome, codigo: p.codigo, total: Number(p.total), site, suporte: await segredo("suporte_contato"),
      link: `${site}/acesso.html?id=${p.id}&t=${p.token}`,
      itens: p.itens as { nome: string }[], anexos: anexos.map((a) => a.nome),
    });
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${await segredo("resend_api_key")}`, "Content-Type": "application/json", "Idempotency-Key": `tombo-entrega-${p.id}` },
      body: JSON.stringify({
        from: await segredo("remetente"), to: [p.email], subject: m.subject, html: m.html, text: m.text,
        attachments: anexos.map((a) => ({ filename: a.nome, content: b64(a.bytes), content_type: a.tipo })),
        tags: [{ name: "produto", value: "depois-do-tombo" }, { name: "tipo", value: "entrega" }],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(`Resend ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    await sb.from("tombo_pedidos").update({ email_status: "enviado", email_enviado_em: new Date().toISOString(), resend_id: j.id, email_erro: null }).eq("id", p.id);
    return { ok: true, enviado: true };
  } catch (e) {
    await sb.from("tombo_pedidos").update({ email_status: "falhou", email_erro: String(e).slice(0, 500) }).eq("id", p.id);
    return { ok: false, motivo: "falha no envio" };
  }
}

Deno.serve(async (req) => {
  const u = new URL(req.url);

  if (req.method === "POST" && u.pathname.endsWith("/entregar")) {
    if (!iguais(req.headers.get("x-interno") ?? "", await segredo("interno_secret"))) return json(req, { ok: false }, 401);
    const b = await req.json().catch(() => ({}));
    if (!/^[0-9a-f-]{36}$/i.test(String(b?.pedido ?? ""))) return json(req, { ok: false }, 400);
    return json(req, await entregar(b.pedido));
  }

  if (req.method !== "GET") return json(req, { erro: "Método não permitido." }, 405);
  const f = u.searchParams.get("f") ?? "";
  const p = await pedidoComToken(u.searchParams.get("id") ?? "", u.searchParams.get("t") ?? "");
  if (!p) return json(req, { erro: "Link inválido." }, 404);
  if (p.status !== "pago") return json(req, { erro: "Pagamento ainda não confirmado." }, 402);
  if (!(p.itens as { id: string }[]).some((i) => i.id === f)) return json(req, { erro: "Este material não faz parte do seu pedido." }, 403);
  if (!(await permitir(`dl:${p.id}`, 40, 3600))) return json(req, { erro: "Muitos downloads em pouco tempo. Tente mais tarde." }, 429);
  const a = await arquivo(p as Pedido, f);
  if (!a) return json(req, { erro: "Arquivo indisponível." }, 404);
  return new Response(a.bytes, {
    headers: {
      "Content-Type": a.tipo, "Content-Disposition": `attachment; filename="${a.nome}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    },
  });
});
