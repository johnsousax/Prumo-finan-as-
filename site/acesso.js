// Área de acesso do comprador — Prumo Finanças.
// Lê o conteúdo liberado e oferece os arquivos com marca d'água (gerados no servidor, só para pedido pago).
(function () {
  "use strict";
  var API = "https://vpldivsicywvnvyczkhz.supabase.co/functions/v1";
  var ARQUIVOS = {
    ebook: "Baixar e-book em PDF",
    tesouro: "Baixar guia em PDF",
    dolar: "Baixar guia em PDF",
    planilha: "Baixar planilha (.xlsx)"
  };
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var salvo = null; try { salvo = JSON.parse(localStorage.getItem("pt_acesso")); } catch (e) {}
  var id = q.get("id") || (salvo && salvo.id), t = q.get("t") || (salvo && salvo.t);
  var estado = $("estado");

  // Mensagens montadas com textContent (nada vindo da URL vira HTML).
  function msg(titulo, texto, retry) {
    estado.hidden = false;
    estado.textContent = "";
    var h = document.createElement("h2"); h.textContent = titulo; estado.appendChild(h);
    var p = document.createElement("p"); p.textContent = texto; estado.appendChild(p);
    if (retry) { var s = document.createElement("p"); s.className = "small"; s.textContent = "Atualizando automaticamente…"; estado.appendChild(s); }
  }

  var valido = /^[0-9a-f-]{36}$/i.test(id || "") && /^[0-9a-f]{64}$/i.test(t || "");
  if (!valido) { msg("Link incompleto", "Abra o link de acesso exatamente como você recebeu no e-mail de confirmação."); $("sub").textContent = ""; return; }
  if (!q.get("id")) history.replaceState(null, "", "acesso.html?id=" + encodeURIComponent(id) + "&t=" + encodeURIComponent(t));

  function urlArquivo(f) {
    return API + "/tombo-arquivos?id=" + encodeURIComponent(id) + "&t=" + encodeURIComponent(t) + "&f=" + encodeURIComponent(f);
  }

  var tentativas = 0;
  function carregar() {
    fetch(API + "/tombo-acesso?id=" + encodeURIComponent(id) + "&t=" + encodeURIComponent(t), { credentials: "omit", cache: "no-store" })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        if (res.s === 200) return render(res.j);
        if (res.s === 402) {
          $("sub").textContent = "Pedido " + (res.j.codigo || "");
          if (++tentativas < 60) { msg("Aguardando a confirmação do Pix", "Assim que o banco confirmar o pagamento, seu conteúdo aparece aqui e chega no seu e-mail.", true); setTimeout(carregar, 5000); }
          else msg("Ainda não recebemos a confirmação", "Se você já pagou, atualize esta página em alguns minutos.");
          return;
        }
        if (res.s === 429) { msg("Muitas tentativas", "Aguarde alguns minutos e atualize a página."); return; }
        msg("Link de acesso inválido", "Confira se você abriu o link completo que recebeu no e-mail de confirmação.");
        $("sub").textContent = "";
      })
      .catch(function () { msg("Sem conexão", "Verifique sua internet. Tentando de novo…", true); setTimeout(carregar, 6000); });
  }

  function render(d) {
    try { localStorage.setItem("pt_acesso", JSON.stringify({ id: id, t: t })); } catch (e) {}
    $("hello").textContent = "Olá, " + d.nome + "!";
    $("sub").textContent = "Pedido " + d.codigo + " · " + d.itens.length + (d.itens.length > 1 ? " materiais liberados" : " material liberado");
    estado.remove();
    var main = $("main"), tabs = $("tabs");

    var bar = document.createElement("div"); bar.className = "bar";
    var tip = document.createElement("span"); tip.className = "tip";
    tip.textContent = "Os arquivos também foram enviados para o seu e-mail. Guarde este link: ele é o seu acesso.";
    var dl = document.createElement("a"); dl.className = "btn"; dl.id = "baixar"; dl.rel = "nofollow";
    bar.appendChild(tip); bar.appendChild(dl);
    main.appendChild(bar);

    function selecionar(item) {
      dl.href = urlArquivo(item);
      dl.textContent = ARQUIVOS[item] || "Baixar";
      dl.hidden = !ARQUIVOS[item];
    }

    d.itens.forEach(function (it, i) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "tab"); b.textContent = it.titulo; b.dataset.id = it.id;
      b.setAttribute("aria-selected", i === 0 ? "true" : "false");
      tabs.appendChild(b);
      var p = document.createElement("article");
      p.className = "panel"; p.id = "p-" + it.id; p.hidden = i !== 0;
      p.innerHTML = it.html; // conteúdo nosso, vindo do servidor; scripts bloqueados pela CSP
      p.querySelectorAll("table").forEach(function (tb) { var w = document.createElement("div"); w.className = "tbl"; tb.parentNode.insertBefore(w, tb); w.appendChild(tb); });
      main.appendChild(p);
    });
    if (d.itens[0]) selecionar(d.itens[0].id);

    tabs.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      tabs.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
      main.querySelectorAll(".panel").forEach(function (p) { p.hidden = p.id !== "p-" + b.dataset.id; });
      selecionar(b.dataset.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // checklists marcáveis (guardados só neste navegador)
    var marcados = {}; try { marcados = JSON.parse(localStorage.getItem("pt_check")) || {}; } catch (e) {}
    main.querySelectorAll(".check li").forEach(function (li, i) {
      var k = "c" + i; if (marcados[k]) li.classList.add("ok");
      li.addEventListener("click", function () { li.classList.toggle("ok"); marcados[k] = li.classList.contains("ok"); try { localStorage.setItem("pt_check", JSON.stringify(marcados)); } catch (e) {} });
    });
    if ($("planilha")) planilha();
  }

  function planilha() {
    var v = function (k) { var n = parseFloat(String($("pl-" + k).value).replace(",", ".")); return isFinite(n) && n >= 0 ? n : 0; };
    var brl = function (n) { return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); };
    var precos = $("pl-precos");
    var padrao = [100, 88, 82, 90, 95, 104];
    for (var i = 1; i <= 12; i++) {
      var l = document.createElement("label");
      l.appendChild(document.createTextNode("Mês " + i));
      var inp = document.createElement("input");
      inp.type = "number"; inp.inputMode = "decimal"; inp.min = "0"; inp.step = "0.01"; inp.dataset.mes = i; inp.value = padrao[i - 1] || "";
      l.appendChild(inp);
      precos.appendChild(l);
    }
    function linha(el, partes) { // partes: [texto, negrito?, aviso?]
      el.textContent = "";
      partes.forEach(function (p) {
        if (p === "\n") { el.appendChild(document.createElement("br")); return; }
        var n = document.createElement(p[1] ? "b" : p[2] ? "span" : "span");
        if (p[2]) n.className = "warn";
        n.textContent = p[0]; el.appendChild(n);
      });
    }
    function calc() {
      var ideal = v("custo") * v("meses"), falta = Math.max(0, ideal - v("tenho"));
      linha($("pl-out-reserva"), [["Reserva ideal: "], [brl(ideal), 1], "\n"].concat(falta > 0 ? [["Falta: "], [brl(falta), 1], [" — complete antes de investir em bolsa."]] : [["Reserva completa. ✓"]]));
      var soma = v("rf") + v("bolsa") + v("ext"), parc = Math.max(1, Math.round(v("parcelas")));
      var bolsaMes = v("valor") * v("bolsa") / 100 / parc, extMes = v("valor") * v("ext") / 100 / parc;
      var aviso = Math.abs(soma - 100) > 0.01 ? [["Os percentuais somam " + soma + "%. Ajuste para 100%.", 0, 1], "\n"] : [];
      linha($("pl-out-plano"), aviso.concat([["Renda fixa (total): "], [brl(v("valor") * v("rf") / 100), 1], "\n", ["Bolsa: "], [brl(bolsaMes), 1], [" por mês, durante " + parc + " meses"], "\n", ["Exterior: "], [brl(extMes), 1], [" por mês, durante " + parc + " meses"]]));
      var inv = 0, cotas = 0, ultimo = 0;
      precos.querySelectorAll("input").forEach(function (x) { var p = parseFloat(x.value); if (p > 0 && bolsaMes > 0) { inv += bolsaMes; cotas += bolsaMes / p; ultimo = p; } });
      linha($("pl-out-pm"), cotas > 0
        ? [["Investido: "], [brl(inv), 1], [" · Cotas: "], [cotas.toFixed(2).replace(".", ","), 1], "\n", ["Preço médio: "], [brl(inv / cotas), 1], [" · Valor hoje (último preço): "], [brl(cotas * ultimo), 1]]
        : [["Preencha os preços e o plano para ver o preço médio."]]);
    }
    $("planilha").addEventListener("input", calc);
    calc();
    // O botão da planilha baixa a versão Excel pronta, gerada no servidor.
    var bt = $("pl-baixar");
    if (bt) bt.addEventListener("click", function () { location.href = urlArquivo("planilha"); });
  }

  carregar();
})();
