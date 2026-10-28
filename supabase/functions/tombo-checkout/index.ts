// POST /functions/v1/tombo-checkout — cria o pedido com preços do banco e gera o Pix no gateway escolhido no painel.
import { criarCobranca, cors, db, gatewayAtivo, ipDe, json, origemPermitida, permitir, produtos, webhookSecret } from "../_shared/tombo.ts";

const limpa = (s: unknown, max: number) => String(s ?? "").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FBX = /^fb\.\d\.\d{10,13}\.[\w.-]{1,400}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { erro: "Método não permitido." }, 405);
  if (!origemPermitida(req)) return json(req, { erro: "Origem não autorizada." }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > 8_000) return json(req, { erro: "Pedido grande demais." }, 413);

  const ip = ipDe(req);
  if (!(await permitir(`ip:${ip}`, 8, 600))) return json(req, { erro: "Muitas tentativas. Aguarde alguns minutos." }, 429);

  let b: any;
  try { b = JSON.parse(await req.text()); } catch { return json(req, { erro: "Pedido inválido." }, 400); }
  if (b?.empresa) return json(req, { erro: "Pedido inválido." }, 400); // armadilha para robôs

  const nome = limpa(b?.nome, 80);
  const email = limpa(b?.email, 120).toLowerCase();
  const whatsapp = String(b?.whatsapp ?? "").replace(/\D/g, "").slice(0, 13);
  if (nome.length < 2) return json(req, { erro: "Informe seu nome." }, 422);
  if (!EMAIL.test(email)) return json(req, { erro: "Informe um e-mail válido." }, 422);
  if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 13)) return json(req, { erro: "WhatsApp inválido. Use DDD + número." }, 422);
  if (!(await permitir(`em:${email}`, 5, 600))) return json(req, { erro: "Muitas tentativas. Aguarde alguns minutos." }, 429);

  let catalogo;
  try { catalogo = await produtos(); } catch { return json(req, { erro: "Loja indisponível no momento. Tente de novo em instantes." }, 503); }
  const principal = catalogo.find((p) => p.principal && p.ativo);
  if (!principal) return json(req, { erro: "Produto indisponível no momento." }, 503);
  const pedidos = Array.isArray(b?.bumps) ? b.bumps.map(String).slice(0, 10) : [];
  const ids = [principal.id, ...pedidos].filter((id, i, a) => a.indexOf(id) === i);
  const itens: { id: string; nome: string; preco: number }[] = [];
  for (const id of ids) {
    const p = catalogo.find((x) => x.id === id);
    if (!p || !p.ativo) return json(req, { erro: "Um item do pedido mudou. Atualize a página." }, 422);
    itens.push({ id: p.id, nome: p.nome, preco: p.preco });
  }
  const total = Math.round(itens.reduce((s, i) => s + i.preco * 100, 0)) / 100;

  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"]) {
    const v = limpa(b?.utm?.[k], 200);
    if (v) utm[k] = v;
  }
  const fbp = FBX.test(String(b?.px?.fbp ?? "")) ? String(b.px.fbp) : null;
  let fbc = FBX.test(String(b?.px?.fbc ?? "")) ? String(b.px.fbc) : null;
  if (!fbc && utm.fbclid) fbc = `fb.1.${Date.now()}.${utm.fbclid}`;

  const gateway = await gatewayAtivo();
  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  const sb = db();
  const { data: pedido, error } = await sb.from("tombo_pedidos")
    .insert({
      nome, email, whatsapp: whatsapp || null, itens, total, status: "criando", token, ip, gateway,
      utm: Object.keys(utm).length ? utm : null, ua: limpa(req.headers.get("user-agent"), 300) || null, fbp, fbc,
    })
    .select("id,numero").single();
  if (error || !pedido) return json(req, { erro: "Não foi possível registrar o pedido. Tente de novo." }, 500);

  const codigo = `PT-${String(pedido.numero).padStart(5, "0")}`;
  const hook = `${Deno.env.get("SUPABASE_URL")}/functions/v1/tombo-webhook?k=${await webhookSecret()}`;

  let c;
  try {
    c = await criarCobranca(gateway, { total, descricao: `Depois do Tombo ${codigo}`, pedidoId: pedido.id, email, nome, webhook: hook });
  } catch (e) {
    await sb.from("tombo_pedidos").update({ codigo, status: "falhou", erro: String(e).slice(0, 500) }).eq("id", pedido.id);
    return json(req, { erro: "O Pix está indisponível agora. Tente de novo em instantes." }, 502);
  }

  await sb.from("tombo_pedidos").update({ codigo, status: "aguardando", identifier: c.identifier, pix_code: c.pix_code, atualizado_em: new Date().toISOString() }).eq("id", pedido.id);
  return json(req, { id: pedido.id, t: token, codigo, pix_code: c.pix_code, total, itens });
});
