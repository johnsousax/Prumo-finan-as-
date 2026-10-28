// Prova social com vendas REAIS — Prumo Finanças.
// Os números vêm do banco (pedidos pagos). Se as vendas ainda estão abaixo do mínimo configurado,
// nada de contador aparece: só o selo de pagamento seguro na tela do Pix.
(function () {
  "use strict";
  var API = "https://vpldivsicywvnvyczkhz.supabase.co/functions/v1/tombo-prova";
  var calmo = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fmt = function (n) { return Math.round(n).toLocaleString("pt-BR"); };
  var dados = null, contadores = [];

  function el(tag, cls, filhos) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    (filhos || []).forEach(function (f) { e.appendChild(typeof f === "string" ? document.createTextNode(f) : f); });
    return e;
  }
  function dot() { return el("span", "pv-dot"); }
  // Texto que concorda com o número (1 leitor / 2 leitores)
  var plurais = [];
  function pl(chave, um, varios) { var s = el("span", "", [varios]); plurais.push({ chave: chave, el: s, um: um, varios: varios }); return s; }
  function concordar() {
    plurais.forEach(function (p) { p.el.textContent = Number(dados[p.chave]) === 1 ? p.um : p.varios; });
    if (blocoDia) blocoDia.hidden = !(Number(dados.dia) > 0);
  }
  var blocoDia = null;

  // Número que conta de onde estava até o valor novo, com desaceleração.
  function contador(chave) {
    var b = el("b"); b.textContent = "0";
    var c = { chave: chave, el: b, atual: 0 };
    contadores.push(c);
    return b;
  }
  function animar(c, alvo) {
    var de = c.atual, t0 = null, dur = calmo ? 0 : Math.min(1800, 600 + Math.abs(alvo - de) * 4);
    c.atual = alvo;
    if (!dur) { c.el.textContent = fmt(alvo); return; }
    function passo(t) {
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      c.el.textContent = fmt(de + (alvo - de) * e);
      if (p < 1) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
  }
  function animarTodos() {
    contadores.forEach(function (c) {
      var v = Number(dados[c.chave]) || 0;
      if (c.chave === "outros") v = Math.max(0, (Number(dados.agora) || 0) - 1);
      if (c.visivel && v !== c.atual) animar(c, v);
    });
  }
  // Só começa a contar quando o número aparece na tela.
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      contadores.forEach(function (c) { if (c.el === e.target) c.visivel = true; });
      io.unobserve(e.target);
      if (dados) animarTodos();
    });
  }, { threshold: 0.6 }) : null;
  function observar(b) {
    if (io) io.observe(b);
    else contadores.forEach(function (c) { if (c.el === b) c.visivel = true; });
  }

  // 1. Selo ao vivo no topo, embaixo do botão principal
  function montarTopo() {
    var nota = document.querySelector(".hero .note");
    if (!nota) return;
    var total = contador("total"), dia = contador("dia");
    blocoDia = el("span", "", [el("span", "pv-sep", ["·"]), " ", dia, " no site nas últimas 24h"]);
    var bar = el("div", "pv-live", [dot(), el("span", "", [total, pl("total", " leitor já garantiu o guia", " leitores já garantiram o guia")]), blocoDia]);
    bar.setAttribute("role", "status");
    nota.parentNode.insertBefore(bar, nota.nextSibling);
    observar(total); observar(dia);
    setTimeout(function () { bar.classList.add("on"); }, 60);
  }

  // 2. Faixa em cima do checkout
  var faixaAgora = null;
  function montarCheckout() {
    var form = document.getElementById("ck-form");
    if (!form) return;
    var total = contador("total"), agora = contador("agora");
    faixaAgora = el("span", "pv-now", [dot(), el("span", "", [agora, " finalizando o pedido agora"])]);
    var faixa = el("div", "pv-strip", [el("span", "", [total, pl("total", " compra confirmada", " compras confirmadas")]), faixaAgora]);
    form.parentNode.insertBefore(faixa, form);
    observar(total); observar(agora);
  }

  // 3. Na tela do Pix
  var blocoPix = null, outrosLinha = null, stack = null, pessoasTxt = null;
  function montarPix() {
    var cod = document.querySelector("#pix .pix-cod");
    if (!cod) return;
    var seguro = el("p", "pv-seguro");
    seguro.innerHTML = '<svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M7 0 1 2.4v4.8C1 11 3.6 14.4 7 16c3.4-1.6 6-5 6-8.8V2.4z" fill="#0E8A63"/><path d="m4.2 8 2 2 3.6-3.8" stroke="#fff" stroke-width="1.6" fill="none"/></svg>';
    seguro.appendChild(document.createTextNode("Pagamento seguro · os arquivos chegam no seu e-mail logo após a confirmação"));
    cod.parentNode.insertBefore(seguro, cod.nextSibling);

    if (!dados || !dados.mostrar) return;
    var total = contador("total"), outros = contador("outros");
    stack = el("div", "pv-stack");
    pessoasTxt = el("span", "", [" pessoas estão pagando agora"]);
    outrosLinha = el("div", "pv-sub", [dot(), el("span", "", ["Você e mais ", outros, pessoasTxt])]);
    blocoPix = el("div", "pv-pix", [
      el("div", "pv-row", [stack, el("p", "", ["Você está entrando para um grupo de ", total, pl("total", " leitor que já garantiu", " leitores que já garantiram"), " o Depois do Tombo."])]),
      outrosLinha
    ]);
    seguro.parentNode.insertBefore(blocoPix, seguro.nextSibling);
    observar(total); observar(outros);
    preencherStack();
  }
  function preencherStack() {
    if (!stack || !dados) return;
    stack.textContent = "";
    var rec = (dados.recentes || []).slice(0, 4);
    rec.forEach(function (r, i) { var a = el("span", "pv-av", [r.i]); a.style.animationDelay = (i * 90) + "ms"; stack.appendChild(a); });
    var resto = (Number(dados.total) || 0) - rec.length;
    if (resto > 0) { var m = el("span", "pv-av mais", ["+" + (resto > 999 ? Math.floor(resto / 1000) + "k" : resto)]); m.style.animationDelay = (rec.length * 90) + "ms"; stack.appendChild(m); }
  }

  // 4. Avisos de compras recentes (cada aviso é uma compra paga de verdade)
  var toast = null, fila = [], posicao = 0, toastTimer = null;
  function textoQuando(m) {
    if (m < 2) return "agora há pouco";
    if (m < 60) return "há " + m + " min";
    var h = Math.floor(m / 60); return "há " + h + (h > 1 ? " horas" : " hora");
  }
  function mostrarToast() {
    if (!fila.length || document.hidden) return agendar(8000);
    var foco = document.activeElement;
    if (foco && foco.closest && foco.closest("#ck-form")) return agendar(6000); // não atrapalha quem está preenchendo
    var r = fila[posicao++ % fila.length];
    if (posicao > fila.length * 2) return; // passa no máximo duas vezes pela lista
    toast.textContent = "";
    var extra = r.n > 1 ? " + " + (r.n - 1) + (r.n > 2 ? " complementos" : " complemento") : "";
    toast.appendChild(el("span", "pv-av", [r.i]));
    var tx = el("div", "", [el("strong", "", [r.i + ". garantiu o Depois do Tombo" + extra])]);
    tx.appendChild(el("small", "", [textoQuando(r.m), " · ", el("i", "", ["✓ compra confirmada"])]));
    toast.appendChild(tx);
    toast.classList.add("on");
    setTimeout(function () { toast.classList.remove("on"); }, 5200);
    agendar(14000);
  }
  function agendar(ms) { clearTimeout(toastTimer); toastTimer = setTimeout(mostrarToast, ms); }
  function montarToast() {
    toast = el("div", "pv-toast"); toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  // Prévia para o dono testar: ?previa=1 mostra números SIMULADOS, com um selo bem visível dizendo isso.
  var PREVIA = /[?&]previa=1(&|$)/.test(location.search);
  var DEMO = { mostrar: true, total: 1284, dia: 37, agora: 4, recentes: [{ i: "M", n: 3, m: 2 }, { i: "R", n: 1, m: 7 }, { i: "A", n: 2, m: 15 }, { i: "J", n: 1, m: 31 }, { i: "C", n: 4, m: 58 }] };
  function seloPrevia() {
    var s = el("div", "pv-previa", [el("b", "", ["PRÉVIA"]), " Números simulados só para você testar o visual. Visitantes nunca veem isto — o site real mostra só vendas reais."]);
    document.body.appendChild(s);
  }

  // Busca e atualiza a cada 45 s
  var montado = false;
  function buscar(primeira) {
    var pedido = PREVIA ? Promise.resolve(DEMO)
      : (primeira && window.prumo) ? window.prumo
      : fetch(API, { credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; });
    pedido
      .then(function (d) {
        if (!d) return;
        dados = d;
        if (!montado) {
          montado = true;
          if (d.mostrar) { montarTopo(); montarCheckout(); montarToast(); }
          montarPix();
          vigiarPix();
        }
        if (!d.mostrar) return;
        if (faixaAgora) faixaAgora.hidden = (Number(d.agora) || 0) < 2;
        if (outrosLinha) outrosLinha.hidden = (Number(d.agora) || 0) < 2;
        if (pessoasTxt) pessoasTxt.textContent = (Number(d.agora) === 2 ? " pessoa está" : " pessoas estão") + " pagando agora";
        if (toast) {
          var antes = fila.length;
          fila = (d.recentes || []).filter(function (r) { return r.m <= 24 * 60; });
          if (!antes && fila.length) agendar(7000);
        }
        preencherStack();
        concordar();
        animarTodos();
      })
      .catch(function () {});
  }
  // Quando a tela do Pix aparece, os números dela começam a contar.
  function vigiarPix() {
    var pix = document.getElementById("pix");
    if (!pix || !("MutationObserver" in window)) return;
    new MutationObserver(function () { if (!pix.hidden) { preencherStack(); animarTodos(); } }).observe(pix, { attributes: true, attributeFilter: ["hidden"] });
  }

  if (PREVIA) seloPrevia();
  buscar(true);
  if (!PREVIA) setInterval(function () { if (!document.hidden) buscar(); }, 45000);
})();
