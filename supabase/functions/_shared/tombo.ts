// Prumo Finanças — "Depois do Tombo": produtos, gateways de Pix, segredos e segurança comum às funções tombo-*.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const PRINCIPAL = "https://www.glamhouse.site";
const ORIGENS = new Set([
  PRINCIPAL,
  "https://glamhouse.site",
  "https://depois-do-tombo.vercel.app",
  ...(Deno.env.get("TOMBO_ORIGENS_EXTRA") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

export const origemPermitida = (req: Request) => ORIGENS.has(req.headers.get("origin") ?? "");

export function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENS.has(o) ? o : PRINCIPAL,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const SEG = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), ...SEG, "Content-Type": "application/json; charset=utf-8" } });
}

export const ipDe = (req: Request) =>
  (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "desconhecido").trim().slice(0, 64);

let _db: ReturnType<typeof createClient> | null = null;
export const db = () =>
  _db ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// Limite de requisições (contador já existente no banco). true = pode seguir.
export async function permitir(chave: string, limite: number, segundos: number) {
  const { data, error } = await db().rpc("farma_permitir", { p_chave: `tombo:${chave}`, p_limite: limite, p_segundos: segundos });
  return error ? true : Boolean(data);
}

export function iguais(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function sha256(texto: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Configurações e segredos na tabela tombo_seguranca (sem acesso público). Cache de 60 s.
const _seg = new Map<string, { v: string; ate: number }>();
export async function segredo(chave: string): Promise<string> {
  const env = Deno.env.get("TOMBO_" + chave.toUpperCase());
  if (env) return env;
  const c = _seg.get(chave);
  if (c && c.ate > Date.now()) return c.v;
  const { data } = await db().from("tombo_seguranca").select("valor").eq("chave", chave).maybeSingle();
  const v = data?.valor ?? "";
  _seg.set(chave, { v, ate: Date.now() + 60_000 });
  return v;
}
export const webhookSecret = () => segredo("webhook_secret");
export function esquecerSegredos() { _seg.clear(); _prod = null; }

// Produtos e preços (definidos no painel; o navegador nunca define o valor cobrado). Cache de 30 s.
export type Produto = { id: string; nome: string; descricao: string; preco: number; ativo: boolean; principal: boolean; ordem: number };
let _prod: { em: number; lista: Produto[] } | null = null;
export async function produtos(): Promise<Produto[]> {
  if (_prod && Date.now() - _prod.em < 30_000) return _prod.lista;
  const { data, error } = await db().from("tombo_produtos").select("id,nome,descricao,preco,ativo,principal,ordem").order("ordem");
  if (error || !data?.length) throw new Error("Produtos indisponíveis");
  const lista = data.map((p: any) => ({ ...p, preco: Number(p.preco) })) as Produto[];
  _prod = { em: Date.now(), lista };
  return lista;
}

// ================= Gateways de Pix =================
export type Gateway = "syncpay" | "mercadopago";
export const GATEWAYS: Gateway[] = ["syncpay", "mercadopago"];
export async function gatewayAtivo(): Promise<Gateway> {
  return (await segredo("gateway")) === "mercadopago" ? "mercadopago" : "syncpay";
}

async function lerJson(r: Response) { return await r.json().catch(() => ({})); }

// --- SyncPay ---
const SYNC = "https://api.syncpayments.com.br";
async function credSync() {
  let id = await segredo("syncpay_client_id"), secret = await segredo("syncpay_client_secret");
  if (!id || !secret) {
    const { data } = await db().from("dg_config").select("chave,valor").in("chave", ["syncpay_client_id", "syncpay_client_secret"]);
    const m = Object.fromEntries((data ?? []).map((r: any) => [r.chave, r.valor]));
    id = id || m.syncpay_client_id; secret = secret || m.syncpay_client_secret;
  }
  if (!id || !secret) throw new Error("Credenciais da SyncPay não configuradas");
  return { id, secret };
}
const _tok = new Map<string, { token: string; exp: number }>();
async function tokenSync(): Promise<string> {
  const c = await credSync();
  const k = await sha256(c.id + ":" + c.secret);
  const t = _tok.get(k);
  if (t && t.exp > Date.now() + 60_000) return t.token;
  const r = await fetch(`${SYNC}/api/partner/v1/auth-token`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: c.id, client_secret: c.secret }), signal: AbortSignal.timeout(15_000),
  });
  const j = await lerJson(r);
  if (!r.ok || !j.access_token) throw new Error(`SyncPay recusou as credenciais (${r.status})`);
  _tok.set(k, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}
async function syncFetch(path: string, init: RequestInit = {}) {
  const token = await tokenSync();
  const r = await fetch(`${SYNC}${path}`, {
    ...init, headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: r.ok, status: r.status, body: await lerJson(r) };
}
function statusSync(s?: string) {
  switch ((s ?? "").toLowerCase()) {
    case "completed": case "paid": case "paid_out": case "approved": return "pago";
    case "failed": return "falhou";
    case "refunded": case "med": return "estornado";
    default: return "aguardando";
  }
}

// --- Mercado Pago ---
const MP = "https://api.mercadopago.com";
async function tokenMP() {
  const t = await segredo("mp_access_token");
  if (!t) throw new Error("Access Token do Mercado Pago não configurado");
  return t;
}
function statusMP(s?: string) {
  switch ((s ?? "").toLowerCase()) {
    case "approved": return "pago";
    case "rejected": return "falhou";
    case "cancelled": return "expirado";
    case "refunded": case "charged_back": return "estornado";
    default: return "aguardando";
  }
}
function vencimentoBrasilia(horas: number) {
  const d = new Date(Date.now() + horas * 3600e3 - 3 * 3600e3); // horário de Brasília (UTC-3)
  return d.toISOString().replace("Z", "-03:00");
}

export type NovaCobranca = { total: number; descricao: string; pedidoId: string; email: string; nome: string; webhook: string };

export async function criarCobranca(gw: Gateway, o: NovaCobranca): Promise<{ pix_code: string; identifier: string }> {
  if (gw === "mercadopago") {
    const r = await fetch(`${MP}/v1/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenMP()}`, "Content-Type": "application/json", "X-Idempotency-Key": o.pedidoId },
      body: JSON.stringify({
        transaction_amount: o.total, description: o.descricao, payment_method_id: "pix",
        payer: { email: o.email, first_name: o.nome.split(" ")[0] }, external_reference: o.pedidoId,
        notification_url: o.webhook, date_of_expiration: vencimentoBrasilia(24),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await lerJson(r);
    const code = j?.point_of_interaction?.transaction_data?.qr_code;
    if (!r.ok || !code || !j.id) throw new Error(`Mercado Pago ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return { pix_code: String(code), identifier: String(j.id) };
  }
  const r = await syncFetch("/api/partner/v1/cash-in", {
    method: "POST", body: JSON.stringify({ amount: o.total, description: o.descricao, webhook_url: o.webhook }),
  });
  if (!r.ok || !r.body?.pix_code || !r.body?.identifier) throw new Error(`SyncPay ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return { pix_code: String(r.body.pix_code), identifier: String(r.body.identifier) };
}

export async function consultarCobranca(gw: string, identifier: string): Promise<{ ok: boolean; status: string; valor: number | null }> {
  if (gw === "mercadopago") {
    const r = await fetch(`${MP}/v1/payments/${encodeURIComponent(identifier)}`, {
      headers: { Authorization: `Bearer ${await tokenMP()}` }, signal: AbortSignal.timeout(20_000),
    });
    const j = await lerJson(r);
    return { ok: r.ok, status: statusMP(j?.status), valor: j?.transaction_amount != null ? Number(j.transaction_amount) : null };
  }
  const t = await syncFetch(`/api/partner/v1/transaction/${encodeURIComponent(identifier)}`);
  return { ok: t.ok, status: statusSync(t.body?.data?.status), valor: t.body?.data?.amount != null ? Number(t.body.data.amount) : null };
}

// Confere se as credenciais do gateway funcionam (usado pelo painel antes de trocar).
export async function testarGateway(gw: Gateway): Promise<{ ok: boolean; detalhe: string }> {
  try {
    if (gw === "mercadopago") {
      const r = await fetch(`${MP}/users/me`, { headers: { Authorization: `Bearer ${await tokenMP()}` }, signal: AbortSignal.timeout(15_000) });
      const j = await lerJson(r);
      if (!r.ok) return { ok: false, detalhe: `O Mercado Pago recusou o token (${r.status}).` };
      return { ok: true, detalhe: `Conectado à conta ${j.nickname ?? j.email ?? j.id}.` };
    }
    await tokenSync();
    return { ok: true, detalhe: "Credenciais da SyncPay aceitas." };
  } catch (e) {
    return { ok: false, detalhe: String((e as Error).message ?? e) };
  }
}

// Pede à função tombo-arquivos que envie o e-mail com os PDFs (idempotente do lado de lá).
export async function dispararEntrega(pedidoId: string) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/tombo-arquivos/entregar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-interno": await segredo("interno_secret") },
      body: JSON.stringify({ pedido: pedidoId }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch { /* o cron tenta de novo */ }
}

// Consulta a cobrança no gateway do pedido (fonte da verdade), grava e dispara a entrega.
export async function sincronizar(pedidoId: string) {
  const sb = db();
  const { data: p } = await sb.from("tombo_pedidos").select("id,status,total,identifier,gateway").eq("id", pedidoId).maybeSingle();
  if (!p || !p.identifier || p.status === "pago" || p.status === "estornado") return p;
  const t = await consultarCobranca(p.gateway ?? "syncpay", p.identifier);
  if (!t.ok) return p;
  let status = t.status;
  if (status === "pago" && t.valor != null && Math.abs(t.valor - Number(p.total)) > 0.009) status = "falhou"; // valor pago ≠ pedido
  if (status === p.status) return p;
  const patch: Record<string, unknown> = { status, atualizado_em: new Date().toISOString() };
  if (status === "pago") patch.pago_em = new Date().toISOString();
  // só muda se ninguém mudou antes (evita corrida entre webhook, página e cron)
  const { data } = await sb.from("tombo_pedidos").update(patch).eq("id", p.id).eq("status", p.status).select("id,status,total,identifier").maybeSingle();
  if (data?.status === "pago") await dispararEntrega(p.id);
  return data ?? p;
}

// Carrega o pedido e confere o token de acesso (comparação em tempo constante).
export async function pedidoComToken(id: string, t: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{64}$/i.test(t)) return null;
  const { data } = await db().from("tombo_pedidos").select("id,codigo,nome,email,itens,total,status,token,criado_em").eq("id", id).maybeSingle();
  if (!data || !iguais(String(data.token), t)) return null;
  return data;
}
