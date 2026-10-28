// tombo-chat — assistente conversacional real da Prumo Finanças.
// A chave da OpenAI fica somente no ambiente do servidor (OPENAI_API_KEY).
import { cors, ipDe, json, origemPermitida, permitir } from "../_shared/tombo.ts";

const SYSTEM = `Você é o assistente virtual da Prumo Finanças, responsável por explicar o produto educacional "Depois do Tombo", conceitos gerais de educação financeira e como usar o guia.
Responda sempre em português brasileiro, com clareza, cordialidade e objetividade.
Não afirme ter acesso a dados bancários, carteira, pedidos ou informações pessoais do visitante.
Não invente preços, vendas, depoimentos, resultados ou características do produto. Se não souber, diga isso e oriente a pessoa a usar o contato oficial de suporte disponível no site.
O conteúdo é educacional e não é recomendação individual de investimento. Não diga ao usuário qual ativo específico comprar ou vender, não prometa rentabilidade e não apresente previsões como certezas. Pode explicar conceitos gerais, riscos, diversificação, reserva de emergência e perguntas que a pessoa pode considerar.
Não peça senha, código Pix, dados completos de cartão, documentos ou informações financeiras sensíveis.
Mantenha respostas curtas, úteis e respeitosas. Se a pergunta estiver fora do escopo, explique brevemente o limite.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { erro: "Método não permitido." }, 405);
  if (!origemPermitida(req)) return json(req, { erro: "Origem não autorizada." }, 403);
  if (!(await permitir(`chat:${ipDe(req)}`, 12, 600))) return json(req, { erro: "Você enviou muitas mensagens. Aguarde um pouco e tente novamente." }, 429);

  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) return json(req, { erro: "O assistente ainda não foi ativado. Tente novamente mais tarde ou fale com o suporte." }, 503);

  const body = await req.json().catch(() => null);
  const input = Array.isArray(body?.messages) ? body.messages : [];
  if (!input.length || input.length > 12) return json(req, { erro: "Envie uma conversa com até 12 mensagens." }, 400);

  const messages = input.map((m: any) => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    content: String(m?.content ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, 1800),
  })).filter((m: any) => m.content);
  if (!messages.length || messages[messages.length - 1].role !== "user") return json(req, { erro: "Envie uma mensagem válida." }, 400);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: SYSTEM }, ...messages],
        temperature: 0.4,
        max_tokens: 450,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("tombo-chat OpenAI error:", response.status, JSON.stringify(result).slice(0, 300));
      return json(req, { erro: "Não consegui responder agora. Tente novamente em instantes." }, 502);
    }
    const answer = String(result?.choices?.[0]?.message?.content ?? "").trim();
    if (!answer) return json(req, { erro: "Não consegui formular uma resposta. Tente de novo." }, 502);
    return json(req, { resposta: answer });
  } catch (e) {
    console.error("tombo-chat request failed:", String((e as Error)?.message ?? e));
    return json(req, { erro: "O assistente está temporariamente indisponível. Tente novamente." }, 502);
  }
});
