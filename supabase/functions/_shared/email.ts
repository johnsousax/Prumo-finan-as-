// Modelo do e-mail de entrega (HTML compatível com clientes de e-mail + texto puro).
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const brl = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");

export type DadosEmail = {
  nome: string; codigo: string; total: number; link: string; site: string; suporte: string;
  itens: { nome: string }[]; anexos: string[];
};

export function montarEmail(d: DadosEmail) {
  const primeiro = d.nome.split(" ")[0] || "tudo bem";
  const lista = d.itens.map((i) => `<tr><td style="padding:6px 0;font:15px/1.5 Arial,sans-serif;color:#0F1B2D">&#10003;&nbsp; ${esc(i.nome)}</td></tr>`).join("");
  const anexos = d.anexos.length
    ? `<p style="margin:0 0 6px;font:14px/1.6 Arial,sans-serif;color:#3B4757">Também anexamos os arquivos neste e-mail:</p><p style="margin:0 0 18px;font:13px/1.6 Arial,sans-serif;color:#6B7480">${d.anexos.map(esc).join("<br>")}</p>`
    : "";
  const suporte = d.suporte
    ? `Dúvidas ou quer usar a garantia de 7 dias? Fale com a gente: <b>${esc(d.suporte)}</b>.`
    : "Você tem 7 dias de garantia incondicional.";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seu acesso ao Depois do Tombo</title></head>
<body style="margin:0;padding:0;background:#F1ECE1">
<div style="display:none;max-height:0;overflow:hidden">Pagamento confirmado. Seu guia e seus materiais estão liberados.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1ECE1;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0F1B2D;padding:22px 28px;font:bold 12px Arial,sans-serif;letter-spacing:3px;color:#FBF9F4"><span style="color:#B8901F">&#9660;</span>&nbsp; PRUMO FINANÇAS</td></tr>
<tr><td style="padding:30px 28px 8px">
<p style="margin:0 0 6px;font:bold 12px Arial,sans-serif;letter-spacing:2px;color:#0E8A63">PAGAMENTO CONFIRMADO</p>
<h1 style="margin:0 0 14px;font:bold 26px/1.2 Georgia,serif;color:#0F1B2D">Olá, ${esc(primeiro)}! Seu acesso está liberado.</h1>
<p style="margin:0 0 18px;font:15px/1.6 Arial,sans-serif;color:#3B4757">Pedido <b>${esc(d.codigo)}</b> · ${brl(d.total)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px">${lista}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="background:#0E8A63;border-radius:12px">
<a href="${esc(d.link)}" style="display:inline-block;padding:15px 26px;font:bold 16px Arial,sans-serif;color:#ffffff;text-decoration:none">Acessar minha área</a></td></tr></table>
${anexos}
<p style="margin:0 0 8px;font:14px/1.6 Arial,sans-serif;color:#3B4757"><b>Guarde este e-mail.</b> O botão acima é o seu acesso pessoal: por ele você lê online e baixa os materiais quando quiser.</p>
<p style="margin:0 0 26px;font:14px/1.6 Arial,sans-serif;color:#3B4757">${suporte}</p>
<p style="margin:0 0 6px;font:14px/1.6 Arial,sans-serif;color:#3B4757">Comece pelo capítulo 5, o Método PRUMO, se quiser ir direto ao que fazer.</p>
</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #E2DCCF;font:11px/1.6 Arial,sans-serif;color:#8A94A3">
Conteúdo educacional — não é recomendação de investimento. Os arquivos são de uso pessoal e trazem o seu nome e e-mail; a redistribuição é proibida.<br>
Você recebeu este e-mail porque fez uma compra em ${esc(d.site.replace(/^https?:\/\//, ""))}.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Olá, ${primeiro}! Seu acesso está liberado.`,
    ``,
    `Pedido ${d.codigo} · ${brl(d.total)}`,
    ...d.itens.map((i) => `- ${i.nome}`),
    ``,
    `Acesse sua área: ${d.link}`,
    d.anexos.length ? `\nArquivos anexados: ${d.anexos.join(", ")}` : "",
    ``,
    `Guarde este e-mail: o link acima é o seu acesso pessoal.`,
    d.suporte ? `Dúvidas ou garantia de 7 dias: ${d.suporte}` : `Você tem 7 dias de garantia incondicional.`,
    ``,
    `Prumo Finanças — conteúdo educacional, não é recomendação de investimento.`,
  ].join("\n");
  return { html, text, subject: "Seu acesso ao Depois do Tombo está liberado" };
}
