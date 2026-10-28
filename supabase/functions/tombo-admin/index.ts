// tombo-admin — painel de administração do Depois do Tombo.
//  POST /         { acao, ... } + Authorization: Bearer <sessão>   (login não precisa de sessão)
//  POST /compra   (header x-interno, chamado pelo banco quando um pedido é pago) → API de Conversões do Meta
import {
  cors, db, esquecerSegredos, GATEWAYS, iguais, ipDe, json, origemPermitida, permitir, produtos, segredo, sha256, testarGateway,
  type Gateway,
} from "../_shared/tombo.ts";

const SESSAO_H = 12;
const STATUS = new Set(["aguardando", "pago", "expirado", "falhou", "estornado"]);
const hex = (u8: Uint8Array) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const brl = (v: number) => "R$ " + Number(v).toFixed(2).replace(".", ",");

// ---------- senha (PBKDF2-SHA256) ----------
async function pbkdf2(senha: string, salt: Uint8Array, iter: number) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256)));
}
async function senhaConfere(senha: string) {
  const [alg, it, salt, h] = (await segredo("admin_hash")).split("$");
  if (alg !== "pbkdf2" || !salt || !h) return false;
  return iguais(await pbkdf2(senha, unhex(salt), Number(it)), h);
}
async function novoHash(senha: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$100000$${hex(salt)}$${await pbkdf2(senha, salt, 100000)}`;
}

// ---------- sessão ----------
async function sessaoValida(req: Request) {
  const t = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  const { data } = await db().from("tombo_admin_sessoes").select("token_hash,expira").eq("token_hash", await sha256(t)).maybeSingle();
  if (!data || new Date(data.expira).getTime() < Date.now()) return null;
  return data.token_hash as string;
}

async function gravar(chave: string, valor: string) {
  const { error } = await db().from("tombo_seguranca").upsert({ chave, valor }, { onConflict: "chave" });
  if (error) throw new Error("Falha ao salvar " + chave);
}

// ---------- API de Conversões do Meta ----------
async function enviarConversao(pedidoId: string, testeCodigo?: string) {
  const pixel = await segredo("meta_pixel_id"), token = await segredo("meta_capi_token");
  if (!/^\d{8,20}$/.test(pixel) || !token) return { ok: false, detalhe: "Pixel ou token da API de Conversões não configurados." };
  const sb = db();
  let p: any;
  if (testeCodigo) {
    p = { id: "teste", codigo: "TESTE-" + Date.now(), email: "teste@exemplo.com", nome: "Teste", whatsapp: null, total: 29.9, itens: [{ id: "ebook" }], ip: null, ua: "Mozilla/5.0", fbp: null, fbc: null, pago_em: new Date().toISOString() };
  } else {
    const { data } = await sb.from("tombo_pedidos").update({ capi_status: "enviando" })
      .eq("id", pedidoId).eq("status", "pago").is("capi_status", null)
      .select("id,codigo,email,nome,whatsapp,total,itens,ip,ua,fbp,fbc,pago_em").maybeSingle();
    if (!data) return { ok: true, detalhe: "nada a enviar" };
    p = data;
  }
  const tel = String(p.whatsapp ?? "").replace(/\D/g, "");
  const user: Record<string, unknown> = {
    em: [await sha256(String(p.email).trim().toLowerCase())],
    fn: [await sha256(String(p.nome).trim().split(" ")[0].toLowerCase())],
    external_id: [await sha256(String(p.email).trim().toLowerCase())],
    country: [await sha256("br")],
  };
  if (tel) user.ph = [await sha256(tel.length <= 11 ? "55" + tel : tel)];
  if (p.ip && p.ip !== "desconhecido") user.client_ip_address = p.ip;
  if (p.ua) user.client_user_agent = p.ua;
  if (p.fbp) user.fbp = p.fbp;
  if (p.fbc) user.fbc = p.fbc;
  const site = (await segredo("site_url")) || "https://www.glamhouse.site";
  const corpo: Record<string, unknown> = {
    data: [{
      event_name: "Purchase", event_time: Math.floor(new Date(p.pago_em ?? Date.now()).getTime() / 1000),
      event_id: `compra-${p.codigo}`, action_source: "website", event_source_url: site + "/", user_data: user,
      custom_data: { currency: "BRL", value: Number(p.total), content_ids: (p.itens ?? []).map((i: any) => i.id), content_type: "product", num_items: (p.itens ?? []).length, order_id: p.codigo },
    }],
    access_token: token,
  };
  if (testeCodigo) corpo.test_event_code = testeCodigo;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pixel}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => ({}));
    const ok = r.ok && Number(j.events_received) >= 1;
    if (!testeCodigo) await sb.from("tombo_pedidos").update({ capi_status: ok ? "enviado" : "erro", capi_erro: ok ? null : JSON.stringify(j).slice(0, 400) }).eq("id", p.id);
    return { ok, detalhe: ok ? "Evento recebido pelo Meta." : `O Meta respondeu: ${j?.error?.message ?? r.status}` };
  } catch (e) {
    if (!testeCodigo) await sb.from("tombo_pedidos").update({ capi_status: "erro", capi_erro: String(e).slice(0, 400) }).eq("id", p.id);
    return { ok: false, detalhe: "Não foi possível falar com o Meta agora." };
  }
}

// ---------- e-mail com o link de acesso (reenvio manual) ----------
async function reenviarAcesso(id: string) {
  const { data: p } = await db().from("tombo_pedidos").select("id,codigo,nome,email,token,status").eq("id", id).maybeSingle();
  if (!p || p.status !== "pago") return { ok: false, detalhe: "Só dá para reenviar o acesso de pedidos pagos." };
  if (!(await permitir(`reenvio:${id}`, 3, 3600))) return { ok: false, detalhe: "Limite de 3 reenvios por hora para este pedido." };
  const site = (await segredo("site_url")) || "https://www.glamhouse.site";
  const link = `${site}/acesso.html?id=${p.id}&t=${p.token}`;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const primeiro = String(p.nome).split(" ")[0];
  const suporte = await segredo("suporte_contato");
  const html = `<div style="font:15px/1.6 Arial,sans-serif;color:#0F1B2D;max-width:520px">
<p style="font:bold 12px Arial;letter-spacing:2px;color:#0E8A63">PRUMO FINANÇAS</p>
<h2 style="font:bold 22px Georgia,serif">Olá, ${esc(primeiro)}! Aqui está o seu acesso.</h2>
<p>Pedido <b>${esc(p.codigo)}</b>. Pelo botão abaixo você lê online e baixa todos os seus arquivos.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#0E8A63;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Acessar minha área</a></p>
<p style="color:#6B7480;font-size:13px">Guarde este e-mail: o link é o seu acesso pessoal.${suporte ? " Dúvidas: " + esc(suporte) : ""}</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${await segredo("resend_api_key")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: await segredo("remetente"), to: [p.email], subject: "Seu acesso ao Depois do Tombo", html, text: `Olá, ${primeiro}! Seu acesso: ${link}`, tags: [{ name: "tipo", value: "reenvio" }] }),
    signal: AbortSignal.timeout(20_000),
  });
  return r.ok ? { ok: true, detalhe: `Link enviado para ${p.email}.` } : { ok: false, detalhe: `O Resend recusou o envio (${r.status}).` };
}

// ---------- listas ----------
function filtroStatus(f: string) {
  switch (f) {
    case "pagos": return ["pago"];
    case "abandonados": return ["aguardando", "expirado"];
    case "aguardando": return ["aguardando"];
    case "expirados": return ["expirado"];
    case "falhas": return ["falhou"];
    case "estornados": return ["estornado"];
    default: return [...STATUS];
  }
}
async function listarPedidos(filtro: string, busca: string, pagina: number, limite = 50) {
  let q = db().from("tombo_pedidos")
    .select("id,codigo,nome,email,whatsapp,itens,total,status,email_status,gateway,utm,criado_em,pago_em,capi_status", { count: "exact" })
    .eq("teste", false).in("status", filtroStatus(filtro)).order("criado_em", { ascending: false })
    .range(pagina * limite, pagina * limite + limite - 1);
  const b = busca.replace(/[^\p{L}\p{N}@._+\- ]/gu, "").trim().slice(0, 60);
  if (b) q = q.or(`nome.ilike.*${b}*,email.ilike.*${b}*,codigo.ilike.*${b}*,whatsapp.ilike.*${b.replace(/\D/g, "") || "~"}*`);
  const { data, count, error } = await q;
  if (error) throw new Error("Falha ao listar pedidos");
  return { pedidos: data ?? [], total: count ?? 0 };
}
function csv(linhas: (string | number | null)[][]) {
  const cel = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas maliciosas no Excel
    return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + linhas.map((l) => l.map(cel).join(";")).join("\n");
}
const dataBR = (iso: string | null) => iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";

// ---------- configuração ----------
async function lerConfig() {
  const mascara = (v: string) => v ? v.slice(0, 4) + "•••" + v.slice(-4) : "";
  const g = (await segredo("gateway")) === "mercadopago" ? "mercadopago" : "syncpay";
  const sid = await segredo("syncpay_client_id");
  const { data: dg } = await db().from("dg_config").select("chave").in("chave", ["syncpay_client_id", "syncpay_client_secret"]);
  return {
    gateway: g,
    syncpay: { client_id: mascara(sid), proprio: Boolean(sid && (await segredo("syncpay_client_secret"))), compartilhado: (dg ?? []).length === 2 },
    mercadopago: { token: mascara(await segredo("mp_access_token")) },
    meta: { pixel_id: await segredo("meta_pixel_id"), capi: Boolean(await segredo("meta_capi_token")), teste: await segredo("meta_test_code") },
    suporte: await segredo("suporte_contato"),
    empresa: { nome: await segredo("empresa_nome"), doc: await segredo("empresa_doc"), endereco: await segredo("empresa_endereco") },
    prova_minimo: Number(await segredo("prova_minimo")) || 10,
    produtos: await produtos(),
    site: (await segredo("site_url")) || "https://www.glamhouse.site",
    webhook: `${Deno.env.get("SUPABASE_URL")}/functions/v1/tombo-webhook?k=••••`,
  };
}

async function salvarConfig(c: any) {
  const erros: string[] = [];
  const set: [string, string][] = [];
  if (c.meta) {
    const px = String(c.meta.pixel_id ?? "").replace(/\D/g, "");
    if (c.meta.pixel_id !== undefined) { if (px && !/^\d{8,20}$/.test(px)) erros.push("ID do Pixel inválido (só números)."); else set.push(["meta_pixel_id", px]); }
    if (c.meta.capi_token) { const t = String(c.meta.capi_token).trim(); if (!/^[\w-]{40,600}$/.test(t)) erros.push("Token da API de Conversões inválido."); else set.push(["meta_capi_token", t]); }
    if (c.meta.remover_capi) set.push(["meta_capi_token", ""]);
    if (c.meta.teste !== undefined) { const t = String(c.meta.teste).trim(); if (t && !/^TEST\w{2,30}$/.test(t)) erros.push("Código de teste deve começar com TEST."); else set.push(["meta_test_code", t]); }
  }
  if (c.suporte !== undefined) set.push(["suporte_contato", txt(c.suporte, 120)]);
  if (c.empresa) {
    if (c.empresa.nome !== undefined) set.push(["empresa_nome", txt(c.empresa.nome, 120)]);
    if (c.empresa.doc !== undefined) {
      const d = String(c.empresa.doc).replace(/\D/g, "");
      if (d && d.length !== 11 && d.length !== 14) erros.push("CPF deve ter 11 dígitos e CNPJ 14.");
      else set.push(["empresa_doc", d ? (d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")) : ""]);
    }
    if (c.empresa.endereco !== undefined) set.push(["empresa_endereco", txt(c.empresa.endereco, 200)]);
  }
  if (c.prova_minimo !== undefined) {
    const n = Math.round(Number(c.prova_minimo));
    if (!(n >= 1 && n <= 100000)) erros.push("Mínimo da prova social deve ser entre 1 e 100000."); else set.push(["prova_minimo", String(n)]);
  }
  if (c.syncpay) {
    if (c.syncpay.client_id && c.syncpay.client_secret) {
      set.push(["syncpay_client_id", txt(c.syncpay.client_id, 200)], ["syncpay_client_secret", String(c.syncpay.client_secret).trim().slice(0, 300)]);
    } else if (c.syncpay.client_id || c.syncpay.client_secret) erros.push("Preencha o Client ID e o Client Secret da SyncPay juntos.");
    if (c.syncpay.usar_compartilhado) set.push(["syncpay_client_id", ""], ["syncpay_client_secret", ""]);
  }
  if (c.mercadopago?.token) {
    const t = String(c.mercadopago.token).trim();
    if (!/^(APP_USR|TEST)-[\w-]{20,200}$/.test(t)) erros.push("Access Token do Mercado Pago inválido (começa com APP_USR-)."); else set.push(["mp_access_token", t]);
  }
  if (erros.length) return { ok: false, erros };
  for (const [k, v] of set) await gravar(k, v);
  esquecerSegredos();

  if (c.gateway !== undefined) {
    const gw = String(c.gateway) as Gateway;
    if (!GATEWAYS.includes(gw)) return { ok: false, erros: ["Gateway desconhecido."] };
    const teste = await testarGateway(gw);
    if (!teste.ok) return { ok: false, erros: [`Não troquei o gateway: ${teste.detalhe}`] };
    await gravar("gateway", gw);
    esquecerSegredos();
  }
  return { ok: true };
}

async function salvarProdutos(lista: any[]) {
  if (!Array.isArray(lista) || !lista.length) return { ok: false, erros: ["Nada para salvar."] };
  const atuais = await produtos();
  const erros: string[] = [];
  const updates: any[] = [];
  for (const it of lista.slice(0, 20)) {
    const atual = atuais.find((p) => p.id === it?.id);
    if (!atual) { erros.push(`Produto ${txt(it?.id, 20)} não existe.`); continue; }
    const preco = Math.round(Number(String(it.preco).replace(",", ".")) * 100) / 100;
    const nome = txt(it.nome, 120), descricao = txt(it.descricao, 300);
    if (!(preco >= 1 && preco <= 10000)) erros.push(`${atual.nome}: preço deve ficar entre R$ 1,00 e R$ 10.000,00.`);
    if (nome.length < 2) erros.push(`${atual.nome}: nome muito curto.`);
    const ativo = atual.principal ? true : Boolean(it.ativo);
    updates.push({ id: atual.id, nome, descricao, preco, ativo, atualizado_em: new Date().toISOString() });
  }
  if (erros.length) return { ok: false, erros };
  for (const u of updates) {
    const { error } = await db().from("tombo_produtos").update(u).eq("id", u.id);
    if (error) return { ok: false, erros: ["Falha ao salvar " + u.id] };
  }
  esquecerSegredos();
  return { ok: true };
}

// ---------- roteamento ----------
Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { erro: "Método não permitido." }, 405);

  if (u.pathname.endsWith("/compra")) {
    if (!iguais(req.headers.get("x-interno") ?? "", await segredo("interno_secret"))) return json(req, { ok: false }, 401);
    const b = await req.json().catch(() => ({}));
    if (!/^[0-9a-f-]{36}$/i.test(String(b?.pedido ?? ""))) return json(req, { ok: false }, 400);
    return json(req, await enviarConversao(b.pedido));
  }

  if (!origemPermitida(req)) return json(req, { erro: "Origem não autorizada." }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > 20_000) return json(req, { erro: "Requisição grande demais." }, 413);
  const ip = ipDe(req);
  const b = await req.json().catch(() => ({}));
  const acao = String(b?.acao ?? "");

  if (acao === "entrar") {
    if (!(await permitir(`adm-login:${ip}`, 8, 900))) return json(req, { erro: "Muitas tentativas. Espere 15 minutos." }, 429);
    const senha = String(b?.senha ?? "");
    if (!senha || senha.length > 200 || !(await senhaConfere(senha))) return json(req, { erro: "Senha incorreta." }, 401);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const expira = new Date(Date.now() + SESSAO_H * 3600e3).toISOString();
    await db().from("tombo_admin_sessoes").delete().lt("expira", new Date().toISOString());
    await db().from("tombo_admin_sessoes").insert({ token_hash: await sha256(token), expira, ip });
    return json(req, { token, expira });
  }

  if (!(await permitir(`adm:${ip}`, 400, 600))) return json(req, { erro: "Muitas requisições. Espere um pouco." }, 429);
  const sessao = await sessaoValida(req);
  if (!sessao) return json(req, { erro: "Sessão expirada. Entre de novo." }, 401);

  try {
    switch (acao) {
      case "sair":
        await db().from("tombo_admin_sessoes").delete().eq("token_hash", sessao);
        return json(req, { ok: true });

      case "painel": {
        const re = /^\d{4}-\d{2}-\d{2}$/;
        const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
        const ate = re.test(b.ate) ? b.ate : hoje;
        let de = re.test(b.de) ? b.de : new Date(Date.parse(ate) - 13 * 864e5).toISOString().slice(0, 10);
        if ((Date.parse(ate) - Date.parse(de)) / 864e5 > 366) de = new Date(Date.parse(ate) - 366 * 864e5).toISOString().slice(0, 10);
        if (de > ate) de = ate;
        const { data, error } = await db().rpc("tombo_painel", { p_de: de, p_ate: ate });
        if (error) throw new Error("Falha nas métricas");
        return json(req, { de, ate, ...data });
      }

      case "pedidos":
        return json(req, await listarPedidos(String(b.filtro ?? "todos"), String(b.busca ?? ""), Math.max(0, Math.min(1000, Number(b.pagina) || 0))));

      case "clientes": {
        const pagina = Math.max(0, Math.min(1000, Number(b.pagina) || 0));
        const busca = String(b.busca ?? "").replace(/[%_\\]/g, "").trim().slice(0, 60);
        const { data, error } = await db().rpc("tombo_clientes", { p_busca: busca, p_limite: 50, p_offset: pagina * 50 });
        if (error) throw new Error("Falha ao listar clientes");
        return json(req, { clientes: data ?? [], total: data?.[0]?.total_linhas ?? 0 });
      }

      case "exportar": {
        if (b.tipo === "clientes") {
          const { data } = await db().rpc("tombo_clientes", { p_busca: "", p_limite: 500, p_offset: 0 });
          const linhas: any[][] = [["Nome", "E-mail", "WhatsApp", "Pedidos", "Pedidos pagos", "Total gasto", "Último pedido", "Status do último"]];
          for (const c of data ?? []) linhas.push([c.nome, c.email, c.whatsapp, c.pedidos, c.pagos, Number(c.total_gasto).toFixed(2).replace(".", ","), dataBR(c.ultimo), c.ultimo_status]);
          return json(req, { nome: "clientes-depois-do-tombo.csv", csv: csv(linhas) });
        }
        const linhas: any[][] = [["Pedido", "Data", "Nome", "E-mail", "WhatsApp", "Itens", "Total", "Status", "E-mail de entrega", "Pago em", "Origem", "Campanha", "Gateway"]];
        for (let pg = 0; pg < 20; pg++) {
          const { pedidos } = await listarPedidos(String(b.filtro ?? "todos"), "", pg, 500);
          for (const p of pedidos as any[]) {
            linhas.push([p.codigo, dataBR(p.criado_em), p.nome, p.email, p.whatsapp, (p.itens ?? []).map((i: any) => i.nome).join(" + "),
              Number(p.total).toFixed(2).replace(".", ","), p.status, p.email_status, dataBR(p.pago_em), p.utm?.utm_source ?? "", p.utm?.utm_campaign ?? "", p.gateway]);
          }
          if (pedidos.length < 500) break;
        }
        return json(req, { nome: `pedidos-${String(b.filtro ?? "todos")}.csv`, csv: csv(linhas) });
      }

      case "link_acesso": {
        const { data: p } = await db().from("tombo_pedidos").select("id,token,status").eq("id", String(b.id ?? "")).maybeSingle();
        if (!p) return json(req, { erro: "Pedido não encontrado." }, 404);
        const site = (await segredo("site_url")) || "https://www.glamhouse.site";
        return json(req, { link: `${site}/acesso.html?id=${p.id}&t=${p.token}`, pago: p.status === "pago" });
      }

      case "reenviar_acesso":
        if (!/^[0-9a-f-]{36}$/i.test(String(b.id ?? ""))) return json(req, { erro: "Pedido inválido." }, 400);
        return json(req, await reenviarAcesso(b.id));

      case "config":
        return json(req, await lerConfig());

      case "salvar": {
        const r = await salvarConfig(b.config ?? {});
        return json(req, r.ok ? { ok: true, config: await lerConfig() } : r, r.ok ? 200 : 422);
      }

      case "salvar_produtos": {
        const r = await salvarProdutos(b.produtos);
        return json(req, r.ok ? { ok: true, config: await lerConfig() } : r, r.ok ? 200 : 422);
      }

      case "testar_gateway": {
        const gw = String(b.gateway ?? "") as Gateway;
        if (!GATEWAYS.includes(gw)) return json(req, { erro: "Gateway desconhecido." }, 400);
        return json(req, await testarGateway(gw));
      }

      case "testar_meta": {
        const codigo = await segredo("meta_test_code");
        if (!codigo) return json(req, { ok: false, detalhe: "Cole o código de teste (TEST...) da aba Testar eventos do Gerenciador de Eventos e salve antes." });
        return json(req, await enviarConversao("teste", codigo));
      }

      case "senha": {
        if (!(await senhaConfere(String(b.atual ?? "")))) return json(req, { erro: "A senha atual não confere." }, 401);
        const nova = String(b.nova ?? "");
        if (nova.length < 10 || nova.length > 200 || !/[a-zA-Z]/.test(nova) || !/\d/.test(nova)) return json(req, { erro: "A nova senha precisa de pelo menos 10 caracteres, com letras e números." }, 422);
        await gravar("admin_hash", await novoHash(nova));
        esquecerSegredos();
        await db().from("tombo_admin_sessoes").delete().neq("token_hash", sessao);
        return json(req, { ok: true });
      }

      default:
        return json(req, { erro: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    return json(req, { erro: "Algo deu errado: " + String((e as Error).message ?? e).slice(0, 200) }, 500);
  }
});
