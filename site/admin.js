// Painel de administração — Depois do Tombo / Prumo Finanças.
// Todo dado vindo do banco (nomes e e-mails digitados por clientes) é escapado antes de ir para a tela.
(function () {
  "use strict";
  var API = "https://vpldivsicywvnvyczkhz.supabase.co/functions/v1/tombo-admin";
  var SITE = location.origin;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var brl = function (v) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); };
  var num = function (v) { return Number(v || 0).toLocaleString("pt-BR"); };
  var pct = function (a, b) { return b > 0 ? (a / b * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "—"; };
  var dataHora = function (iso) { return iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""; };
  var hojeBR = function (diasAtras) { return new Date(Date.now() - 3 * 3600e3 - (diasAtras || 0) * 864e5).toISOString().slice(0, 10); };
  var STATUS = { pago: "Pago", aguardando: "Aguardando Pix", expirado: "Pix expirado", falhou: "Falhou", estornado: "Estornado" };

  var token = null;
  try { token = sessionStorage.getItem("pt_admin"); } catch (e) {}
  var config = null;

  // ---------------- utilidades ----------------
  function aviso(txt, erro) {
    var a = $("#aviso");
    a.textContent = txt; a.className = "aviso on" + (erro ? " erro" : "");
    clearTimeout(aviso.t); aviso.t = setTimeout(function () { a.className = "aviso"; }, 3200);
  }
  function msg(id, txt, ok) { var m = $("#" + id); if (!m) return; m.textContent = txt; m.className = "msg " + (ok ? "ok" : "erro"); }
  function ocupado(btn, sim) { if (!btn) return; btn.disabled = sim; }

  function api(acao, dados) {
    var corpo = Object.assign({ acao: acao }, dados || {});
    return fetch(API, {
      method: "POST", credentials: "omit", cache: "no-store",
      headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
      body: JSON.stringify(corpo)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && acao !== "entrar" && acao !== "senha") { sair(true); throw new Error(j.erro || "Sessão expirada."); }
        if (!r.ok) { var e = new Error(j.erro || (j.erros && j.erros.join(" ")) || "Erro " + r.status); e.dados = j; throw e; }
        return j;
      });
    });
  }

  function baixar(nome, texto) {
    var url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
    var a = document.createElement("a"); a.href = url; a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  function copiar(txt) {
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { aviso("Copiado."); }, function () { prompt("Copie:", txt); });
  }

  // ---------------- login ----------------
  function mostrarLogin() { $("#app").hidden = true; $("#login").hidden = false; setTimeout(function () { var i = $("#login-form [name=senha]"); if (i) i.focus(); }, 30); }
  function sair(expirou) {
    if (token && !expirou) api("sair").catch(function () {});
    token = null; try { sessionStorage.removeItem("pt_admin"); } catch (e) {}
    config = null; mostrarLogin();
    if (expirou) $("#login-erro").textContent = "Sua sessão terminou. Entre de novo.";
  }
  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = this.querySelector("button"), senha = this.senha.value;
    $("#login-erro").textContent = ""; ocupado(btn, true);
    api("entrar", { senha: senha }).then(function (j) {
      token = j.token; try { sessionStorage.setItem("pt_admin", token); } catch (e2) {}
      e.target.reset(); iniciar();
    }).catch(function (err) { $("#login-erro").textContent = err.message; })
      .finally(function () { ocupado(btn, false); });
  });
  $("#sair").addEventListener("click", function () { sair(false); });

  // ---------------- abas ----------------
  var carregadas = {};
  function abrir(aba) {
    if (!document.querySelector('[data-painel="' + aba + '"]')) aba = "geral";
    $$("[data-painel]").forEach(function (s) { s.hidden = s.getAttribute("data-painel") !== aba; });
    $$("#abas button").forEach(function (b) { if (b.dataset.aba === aba) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    if (location.hash !== "#" + aba) history.replaceState(null, "", "#" + aba);
    window.scrollTo(0, 0);
    if (aba === "geral") carregarGeral();
    if (aba === "pedidos") carregarPedidos();
    if (aba === "clientes") carregarClientes();
    if (["oferta", "pagamento", "pixel", "config"].indexOf(aba) >= 0 && !carregadas.config) carregarConfig();
  }
  $("#abas").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) abrir(b.dataset.aba); });

  function iniciar() {
    $("#login").hidden = true; $("#app").hidden = false;
    carregadas = {};
    abrir((location.hash || "#geral").slice(1));
  }

  // ---------------- visão geral ----------------
  var periodo = { de: hojeBR(13), ate: hojeBR(0) };
  $("#presets").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    $$("#presets button").forEach(function (x) { x.classList.toggle("on", x === b); });
    var d = Number(b.dataset.dias);
    periodo = { de: hojeBR(d - 1), ate: hojeBR(0) };
    carregarGeral();
  });
  $("#aplicar").addEventListener("click", function () {
    if (!$("#de").value || !$("#ate").value) return aviso("Escolha as duas datas.", true);
    $$("#presets button").forEach(function (x) { x.classList.remove("on"); });
    periodo = { de: $("#de").value, ate: $("#ate").value };
    carregarGeral();
  });

  function carregarGeral() {
    $("#de").value = periodo.de; $("#ate").value = periodo.ate;
    $("#kpis").innerHTML = '<p class="esqueleto">Carregando…</p>';
    api("painel", periodo).then(function (d) {
      var f = function (s) { return s.split("-").reverse().join("/"); };
      $("#periodo-txt").textContent = d.de === d.ate ? "Dia " + f(d.de) : f(d.de) + " a " + f(d.ate);
      var ticket = d.pagos ? d.faturamento / d.pagos : 0;
      var abandonos = Number(d.aguardando) + Number(d.expirados);
      var kpis = [
        ["Faturamento", brl(d.faturamento), num(d.pagos) + " vendas pagas", true],
        ["Ticket médio", d.pagos ? brl(ticket) : "—", "por venda"],
        ["Visitas na página", num(d.visitas), "contadas 1 vez por sessão"],
        ["Pix gerados", num(d.pix_gerados), pct(d.pix_gerados, d.visitas) + " das visitas"],
        ["Conversão do Pix", pct(d.pagos, d.pix_gerados), "pagos ÷ Pix gerados"],
        ["Não pagaram o Pix", num(abandonos), num(d.aguardando) + " aguardando · " + num(d.expirados) + " expirados"],
        ["Compradores", num(d.compradores), "e-mails únicos"],
        ["Entregas por e-mail", num(d.emails_enviados), Number(d.emails_falhos) ? num(d.emails_falhos) + (Number(d.emails_falhos) === 1 ? " pendente ou com falha" : " pendentes ou com falha") : "nenhuma falha"]
      ];
      $("#kpis").innerHTML = kpis.map(function (k) {
        return '<div class="kpi' + (k[3] ? " destaque" : "") + '"><span>' + esc(k[0]) + "</span><b>" + esc(k[1]) + "</b><small>" + esc(k[2]) + "</small></div>";
      }).join("");
      grafico(d.por_dia || []);
      $("#graf-total").textContent = brl(d.faturamento) + " no período";
      funil(d);
      tabelaProdutos(d.produtos || [], d.pagos);
      $("#t-origem").innerHTML = tabela(["Origem", "Visitas", "Pix", "Pagos", "Faturamento"], (d.por_origem || []).map(function (o) {
        return [esc(o.origem), num(o.visitas), num(o.pix), num(o.pagos), brl(o.faturamento)];
      }), [1, 2, 3, 4]);
      $("#t-campanha").innerHTML = tabela(["Campanha", "Pix", "Pagos", "Conversão", "Faturamento"], (d.por_campanha || []).map(function (c) {
        return [esc(c.campanha), num(c.pix), num(c.pagos), pct(c.pagos, c.pix), brl(c.faturamento)];
      }), [1, 2, 3, 4]);
    }).catch(function (e) { $("#kpis").innerHTML = '<p class="erro">' + esc(e.message) + "</p>"; });
  }

  function tabela(cab, linhas, numericas) {
    numericas = numericas || [];
    if (!linhas.length) return '<p class="vazio-t">Nada no período.</p>';
    return '<div class="tabela-wrap"><table><thead><tr>' + cab.map(function (c, i) { return '<th' + (numericas.indexOf(i) >= 0 ? ' class="num"' : "") + ">" + esc(c) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + linhas.map(function (l) {
        return "<tr>" + l.map(function (v, i) { return "<td" + (numericas.indexOf(i) >= 0 ? ' class="num"' : "") + ">" + v + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  function tabelaProdutos(lista, pagos) {
    $("#t-produtos").innerHTML = tabela(["Produto", "Vendas", "Adesão", "Receita"], lista.map(function (p, i) {
      return [esc(p.nome) + (i === 0 ? ' <span class="mini-txt">principal</span>' : ""), num(p.vendas), i === 0 ? "—" : pct(p.vendas, pagos), brl(p.receita)];
    }), [1, 2, 3]);
  }

  function funil(d) {
    var etapas = [["Visitas", Number(d.visitas)], ["Geraram o Pix", Number(d.pix_gerados)], ["Pagaram", Number(d.pagos)]];
    var max = Math.max(1, etapas[0][1], etapas[1][1]);
    $("#funil").innerHTML = etapas.map(function (e, i) {
      var taxa = i ? '<div class="taxa">' + pct(e[1], etapas[i - 1][1]) + " da etapa anterior</div>" : "";
      return '<div class="etapa"><div class="rot"><span>' + esc(e[0]) + "</span><span>" + num(e[1]) + '</span></div><div class="trilho"><div class="enche" style="width:0"></div></div>' + taxa + "</div>";
    }).join("");
    requestAnimationFrame(function () {
      $$("#funil .enche").forEach(function (el, i) { el.style.width = Math.max(etapas[i][1] ? 2 : 0, etapas[i][1] / max * 100) + "%"; });
    });
  }

  // gráfico de barras (faturamento por dia), SVG puro com dica ao passar o mouse
  function grafico(dias) {
    var box = $("#grafico"); box.innerHTML = "";
    var total = dias.reduce(function (s, d) { return s + Number(d.faturamento); }, 0);
    var W = box.clientWidth || 640, H = 240, M = { t: 10, r: 8, b: 26, l: 58 };
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Faturamento por dia: total " + brl(total));
    var max = Math.max.apply(null, dias.map(function (d) { return Number(d.faturamento); }).concat([0]));
    var passo = max <= 0 ? 50 : Math.pow(10, Math.floor(Math.log10(max / 4)));
    [1, 2, 2.5, 5, 10].some(function (m) { if (max / (passo * m) <= 4) { passo *= m; return true; } return false; });
    var topo = Math.max(passo * 4, passo * Math.ceil(max / passo));
    var iw = W - M.l - M.r, ih = H - M.t - M.b, n = Math.max(1, dias.length), cw = iw / n;
    var y = function (v) { return M.t + ih - (v / topo) * ih; };
    function el(tag, at) { var e = document.createElementNS(ns, tag); for (var k in at) e.setAttribute(k, at[k]); return e; }
    for (var g = 0; g <= topo + 1e-9; g += passo) {
      svg.appendChild(el("line", { x1: M.l, x2: W - M.r, y1: y(g), y2: y(g), stroke: g === 0 ? "#C9C2B3" : "#EFEAE0", "stroke-width": 1 }));
      var t = el("text", { x: M.l - 8, y: y(g) + 4, "text-anchor": "end", "font-size": 11, fill: "#6B7480" });
      t.textContent = g >= 1000 ? "R$ " + (g / 1000).toLocaleString("pt-BR") + " mil" : "R$ " + g.toLocaleString("pt-BR"); svg.appendChild(t);
    }
    var cada = Math.ceil(n / Math.max(1, Math.floor(iw / 56)));
    dias.forEach(function (d, i) {
      var x = M.l + i * cw, v = Number(d.faturamento), bw = Math.max(2, Math.min(40, cw - 4)), bx = x + (cw - bw) / 2;
      if (v > 0) {
        var by = y(v), bh = M.t + ih - by, r = Math.min(4, bw / 2, bh);
        svg.appendChild(el("path", { d: "M" + bx + "," + (M.t + ih) + "V" + (by + r) + "Q" + bx + "," + by + " " + (bx + r) + "," + by + "H" + (bx + bw - r) + "Q" + (bx + bw) + "," + by + " " + (bx + bw) + "," + (by + r) + "V" + (M.t + ih) + "Z", fill: "#0E8A63" }));
      }
      if (i % cada === 0 || i === n - 1) {
        var lab = el("text", { x: x + cw / 2, y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "#6B7480" });
        lab.textContent = d.dia.slice(8, 10) + "/" + d.dia.slice(5, 7); svg.appendChild(lab);
      }
      var alvo = el("rect", { x: x, y: M.t, width: cw, height: ih, fill: "transparent" });
      alvo.addEventListener("mousemove", function (ev) { dica(ev, d); });
      alvo.addEventListener("mouseleave", function () { $("#dica").hidden = true; });
      svg.appendChild(alvo);
    });
    box.appendChild(svg);
    if (!total) { var v = document.createElement("div"); v.className = "vazio"; v.textContent = "Nenhuma venda paga no período ainda."; box.appendChild(v); }
  }
  function dica(ev, d) {
    var t = $("#dica");
    t.innerHTML = "<b>" + esc(d.dia.split("-").reverse().join("/")) + "</b>" +
      '<div class="lin"><span>Faturamento</span><span>' + esc(brl(d.faturamento)) + "</span></div>" +
      '<div class="lin"><span>Vendas</span><span>' + esc(num(d.pagos)) + "</span></div>" +
      '<div class="lin"><span>Pix gerados</span><span>' + esc(num(d.pix)) + "</span></div>" +
      '<div class="lin"><span>Visitas</span><span>' + esc(num(d.visitas)) + "</span></div>";
    t.hidden = false;
    var x = ev.clientX + 14, yy = ev.clientY + 14;
    if (x + t.offsetWidth > innerWidth - 8) x = ev.clientX - t.offsetWidth - 14;
    if (yy + t.offsetHeight > innerHeight - 8) yy = ev.clientY - t.offsetHeight - 14;
    t.style.left = x + "px"; t.style.top = yy + "px";
  }
  var redim; window.addEventListener("resize", function () { clearTimeout(redim); redim = setTimeout(function () { if (!$('[data-painel="geral"]').hidden) carregarGeral(); }, 300); });

  // ---------------- pedidos ----------------
  var ped = { filtro: "todos", busca: "", pagina: 0, total: 0, lista: [] };
  $("#filtros").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    $$("#filtros button").forEach(function (x) { x.classList.toggle("on", x === b); });
    ped.filtro = b.dataset.f; ped.pagina = 0; carregarPedidos();
  });
  var tBusca;
  $("#busca-pedidos").addEventListener("input", function () { clearTimeout(tBusca); var v = this.value; tBusca = setTimeout(function () { ped.busca = v; ped.pagina = 0; carregarPedidos(); }, 350); });

  function whatsLink(p) {
    var tel = String(p.whatsapp || "").replace(/\D/g, ""); if (!tel) return "";
    if (tel.length <= 11) tel = "55" + tel;
    var primeiro = String(p.nome || "").split(" ")[0];
    var texto = p.status === "pago"
      ? "Oi, " + primeiro + "! Aqui é da Prumo Finanças. Obrigado pela compra do Depois do Tombo (pedido " + p.codigo + "). Conseguiu acessar seus arquivos?"
      : "Oi, " + primeiro + "! Aqui é da Prumo Finanças. Vi que você gerou o Pix do Depois do Tombo (pedido " + p.codigo + ", " + brl(p.total) + ") e ele não foi pago. Ficou alguma dúvida? Posso te ajudar a finalizar.";
    return "https://wa.me/" + tel + "?text=" + encodeURIComponent(texto);
  }

  function carregarPedidos() {
    $("#t-pedidos").innerHTML = '<p class="vazio-t">Carregando…</p>';
    api("pedidos", { filtro: ped.filtro, busca: ped.busca, pagina: ped.pagina }).then(function (d) {
      ped.total = d.total; ped.lista = d.pedidos;
      if (!d.pedidos.length) { $("#t-pedidos").innerHTML = '<p class="vazio-t">Nenhum pedido aqui ainda.</p>'; paginar("#pag-pedidos", ped, carregarPedidos); return; }
      $("#t-pedidos").innerHTML = '<div class="tabela-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th class="num">Total</th><th>Status</th><th>Origem</th><th></th></tr></thead><tbody>' +
        d.pedidos.map(function (p) {
          var itens = (p.itens || []).map(function (i) { return esc(i.nome); }).join("<br>");
          var entrega = p.status === "pago" ? '<span class="linha2">E-mail: ' + esc({ enviado: "entregue ✓", pendente: "na fila", enviando: "enviando", falhou: "falhou — o sistema tenta de novo" }[p.email_status] || p.email_status) + "</span>" : "";
          var wa = whatsLink(p);
          var acoes = (wa ? '<a class="btn mini ghost" target="_blank" rel="noopener noreferrer" href="' + esc(wa) + '">' + (p.status === "pago" ? "WhatsApp" : "Recuperar no WhatsApp") + "</a>" : "") +
            (p.status === "pago" ? '<button class="btn mini ghost" data-acao="link" data-id="' + esc(p.id) + '">Copiar acesso</button><button class="btn mini ghost" data-acao="reenviar" data-id="' + esc(p.id) + '">Reenviar acesso</button>' :
              '<a class="btn mini ghost" href="mailto:' + esc(p.email) + '">E-mail</a>');
          return '<tr><td class="cod"><b>' + esc(p.codigo) + '</b><span class="linha2">' + esc(dataHora(p.criado_em)) + "</span></td>" +
            "<td>" + esc(p.nome) + '<span class="linha2">' + esc(p.email) + "</span>" + (p.whatsapp ? '<span class="linha2">' + esc(p.whatsapp) + "</span>" : "") + "</td>" +
            '<td class="mini-txt">' + itens + "</td>" +
            '<td class="num"><b>' + esc(brl(p.total)) + "</b></td>" +
            '<td><span class="selo ' + esc(p.status) + '">' + esc(STATUS[p.status] || p.status) + "</span>" + entrega + (p.pago_em ? '<span class="linha2">pago ' + esc(dataHora(p.pago_em)) + "</span>" : "") + "</td>" +
            '<td class="mini-txt">' + esc((p.utm && p.utm.utm_source) || "direto") + (p.utm && p.utm.utm_campaign ? "<br>" + esc(p.utm.utm_campaign) : "") + "</td>" +
            '<td class="acoes-td">' + acoes + "</td></tr>";
        }).join("") + "</tbody></table></div>";
      paginar("#pag-pedidos", ped, carregarPedidos);
    }).catch(function (e) { $("#t-pedidos").innerHTML = '<p class="vazio-t erro">' + esc(e.message) + "</p>"; });
  }
  $("#t-pedidos").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-acao]"); if (!b) return;
    var id = b.dataset.id; ocupado(b, true);
    if (b.dataset.acao === "link") api("link_acesso", { id: id }).then(function (j) { copiar(j.link); }).catch(function (er) { aviso(er.message, true); }).finally(function () { ocupado(b, false); });
    if (b.dataset.acao === "reenviar") api("reenviar_acesso", { id: id }).then(function (j) { aviso(j.detalhe, !j.ok); }).catch(function (er) { aviso(er.message, true); }).finally(function () { ocupado(b, false); });
  });
  $("#exp-pedidos").addEventListener("click", function () {
    var b = this; ocupado(b, true);
    api("exportar", { tipo: "pedidos", filtro: ped.filtro }).then(function (j) { baixar(j.nome, j.csv); }).catch(function (e) { aviso(e.message, true); }).finally(function () { ocupado(b, false); });
  });

  function paginar(sel, estado, recarregar) {
    var box = $(sel), paginas = Math.max(1, Math.ceil(estado.total / 50));
    box.innerHTML = estado.total ? "<span>" + num(estado.total) + " no total · página " + (estado.pagina + 1) + " de " + paginas + "</span>" +
      '<button class="btn mini ghost" data-p="-1"' + (estado.pagina ? "" : " disabled") + '>Anterior</button><button class="btn mini ghost" data-p="1"' + (estado.pagina + 1 < paginas ? "" : " disabled") + ">Próxima</button>" : "";
    box.onclick = function (e) { var b = e.target.closest("button[data-p]"); if (!b || b.disabled) return; estado.pagina += Number(b.dataset.p); recarregar(); };
  }

  // ---------------- clientes ----------------
  var cli = { busca: "", pagina: 0, total: 0 };
  var tCli;
  $("#busca-clientes").addEventListener("input", function () { clearTimeout(tCli); var v = this.value; tCli = setTimeout(function () { cli.busca = v; cli.pagina = 0; carregarClientes(); }, 350); });
  function carregarClientes() {
    $("#t-clientes").innerHTML = '<p class="vazio-t">Carregando…</p>';
    api("clientes", { busca: cli.busca, pagina: cli.pagina }).then(function (d) {
      cli.total = Number(d.total) || 0;
      if (!d.clientes.length) { $("#t-clientes").innerHTML = '<p class="vazio-t">Nenhum cliente ainda.</p>'; paginar("#pag-clientes", cli, carregarClientes); return; }
      $("#t-clientes").innerHTML = '<div class="tabela-wrap"><table><thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Pedidos</th><th class="num">Pagos</th><th class="num">Total gasto</th><th>Último pedido</th></tr></thead><tbody>' +
        d.clientes.map(function (c) {
          return "<tr><td>" + esc(c.nome) + '<span class="linha2">' + esc(c.email) + "</span></td><td>" + esc(c.whatsapp || "—") + '</td><td class="num">' + num(c.pedidos) + '</td><td class="num">' + num(c.pagos) +
            '</td><td class="num"><b>' + esc(brl(c.total_gasto)) + "</b></td><td>" + esc(dataHora(c.ultimo)) + ' <span class="selo ' + esc(c.ultimo_status) + '">' + esc(STATUS[c.ultimo_status] || c.ultimo_status) + "</span></td></tr>";
        }).join("") + "</tbody></table></div>";
      paginar("#pag-clientes", cli, carregarClientes);
    }).catch(function (e) { $("#t-clientes").innerHTML = '<p class="vazio-t erro">' + esc(e.message) + "</p>"; });
  }
  $("#exp-clientes").addEventListener("click", function () {
    var b = this; ocupado(b, true);
    api("exportar", { tipo: "clientes" }).then(function (j) { baixar(j.nome, j.csv); }).catch(function (e) { aviso(e.message, true); }).finally(function () { ocupado(b, false); });
  });

  // ---------------- configuração (oferta, pagamento, pixel, geral) ----------------
  function carregarConfig() {
    return api("config").then(function (c) { config = c; carregadas.config = true; preencher(); }).catch(function (e) { aviso(e.message, true); });
  }
  function preencher() {
    var c = config;
    // produtos
    $("#produtos").innerHTML = c.produtos.map(function (p) {
      return '<div class="produto' + (p.ativo ? "" : " off") + '" data-id="' + esc(p.id) + '">' +
        '<div class="cab"><span class="tag">' + (p.principal ? "Produto principal" : "Order bump") + '</span><label class="chave"><input type="checkbox" data-c="ativo"' + (p.ativo ? " checked" : "") + (p.principal ? " disabled" : "") + "> Ativo</label></div>" +
        '<label class="campo">Nome<input data-c="nome" maxlength="120" value="' + esc(p.nome) + '"></label>' +
        '<label class="campo">Descrição no checkout<textarea data-c="descricao" maxlength="300">' + esc(p.descricao) + "</textarea></label>" +
        '<label class="campo">Preço<span class="preco-in"><span>R$</span><input data-c="preco" inputmode="decimal" value="' + esc(Number(p.preco).toFixed(2).replace(".", ",")) + '"></span></label></div>';
    }).join("");
    $("#prova-minimo").value = c.prova_minimo;
    // pagamento
    var r = document.querySelector('input[name=gw][value="' + c.gateway + '"]'); if (r) r.checked = true;
    $("#gw-sync-info").textContent = (c.gateway === "syncpay" ? "Ativo agora · " : "") + (c.syncpay.proprio ? "credenciais próprias " + c.syncpay.client_id : c.syncpay.compartilhado ? "usando as credenciais já cadastradas no banco" : "sem credenciais");
    $("#gw-mp-info").textContent = (c.gateway === "mercadopago" ? "Ativo agora · " : "") + (c.mercadopago.token ? "token " + c.mercadopago.token : "sem token configurado");
    $("#sync-id").value = ""; $("#sync-secret").value = ""; $("#mp-token").value = "";
    // pixel
    $("#px-id").value = c.meta.pixel_id || "";
    $("#px-teste").value = c.meta.teste || "";
    $("#px-token").value = "";
    $("#capi-estado").textContent = c.meta.capi ? "· configurado" : "· não configurado";
    $("#remover-capi").hidden = !c.meta.capi;
    $("#link-ads").textContent = c.site + "/?utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";
    // geral
    $("#cfg-suporte").value = c.suporte || "";
    $("#cfg-nome").value = c.empresa.nome || "";
    $("#cfg-doc").value = c.empresa.doc || "";
    $("#cfg-end").value = c.empresa.endereco || "";
  }

  $("#produtos").addEventListener("change", function (e) {
    if (e.target.dataset.c === "ativo") e.target.closest(".produto").classList.toggle("off", !e.target.checked);
  });
  $("#salvar-produtos").addEventListener("click", function () {
    var b = this, lista = $$("#produtos .produto").map(function (el) {
      var v = function (k) { return el.querySelector('[data-c="' + k + '"]'); };
      return { id: el.dataset.id, nome: v("nome").value, descricao: v("descricao").value, preco: v("preco").value, ativo: v("ativo").checked };
    });
    ocupado(b, true); msg("msg-produtos", "");
    api("salvar_produtos", { produtos: lista }).then(function (j) { config = j.config; preencher(); msg("msg-produtos", "Salvo. O site e o Pix já usam os novos valores.", true); })
      .catch(function (e) { msg("msg-produtos", e.message, false); }).finally(function () { ocupado(b, false); });
  });

  function salvar(parcial, botao, msgId, okTxt) {
    ocupado(botao, true); msg(msgId, "");
    return api("salvar", { config: parcial }).then(function (j) { config = j.config; preencher(); msg(msgId, okTxt, true); })
      .catch(function (e) { msg(msgId, e.message, false); }).finally(function () { ocupado(botao, false); });
  }
  $("#salvar-prova").addEventListener("click", function () { salvar({ prova_minimo: $("#prova-minimo").value }, this, "msg-prova", "Salvo."); });

  $("#salvar-pagamento").addEventListener("click", function () {
    var gw = (document.querySelector("input[name=gw]:checked") || {}).value;
    var p = { gateway: gw };
    if ($("#sync-id").value || $("#sync-secret").value) p.syncpay = { client_id: $("#sync-id").value, client_secret: $("#sync-secret").value };
    if ($("#mp-token").value) p.mercadopago = { token: $("#mp-token").value };
    salvar(p, this, "msg-pagamento", "Gateway testado e ativo. Os próximos Pix já saem por ele.");
  });
  $$("[data-testar]").forEach(function (b) {
    b.addEventListener("click", function () {
      var gw = b.dataset.testar, pendente = {};
      if (gw === "syncpay" && ($("#sync-id").value || $("#sync-secret").value)) pendente.syncpay = { client_id: $("#sync-id").value, client_secret: $("#sync-secret").value };
      if (gw === "mercadopago" && $("#mp-token").value) pendente.mercadopago = { token: $("#mp-token").value };
      ocupado(b, true);
      var antes = Object.keys(pendente).length ? api("salvar", { config: pendente }).then(function (j) { config = j.config; }) : Promise.resolve();
      antes.then(function () { return api("testar_gateway", { gateway: gw }); })
        .then(function (j) { msg("msg-pagamento", j.detalhe, j.ok); if (config) preencher(); })
        .catch(function (e) { msg("msg-pagamento", e.message, false); }).finally(function () { ocupado(b, false); });
    });
  });

  $("#salvar-pixel").addEventListener("click", function () {
    var p = { meta: { pixel_id: $("#px-id").value.trim(), teste: $("#px-teste").value.trim() } };
    if ($("#px-token").value.trim()) p.meta.capi_token = $("#px-token").value.trim();
    salvar(p, this, "msg-pixel", "Salvo. O Pixel entra no site em até 1 minuto.");
  });
  $("#remover-capi").addEventListener("click", function () {
    if (!confirm("Remover o token da API de Conversões? As compras deixam de ser enviadas pelo servidor.")) return;
    salvar({ meta: { remover_capi: true } }, this, "msg-pixel", "Token removido.");
  });
  $("#testar-pixel").addEventListener("click", function () {
    var b = this; ocupado(b, true); msg("msg-pixel", "");
    api("testar_meta").then(function (j) { msg("msg-pixel", j.detalhe + (j.ok ? " Confira na aba Testar eventos." : ""), j.ok); })
      .catch(function (e) { msg("msg-pixel", e.message, false); }).finally(function () { ocupado(b, false); });
  });
  $$("[data-copiar]").forEach(function (b) { b.addEventListener("click", function () { copiar($("#" + b.dataset.copiar).textContent); }); });

  $("#salvar-config").addEventListener("click", function () {
    salvar({ suporte: $("#cfg-suporte").value, empresa: { nome: $("#cfg-nome").value, doc: $("#cfg-doc").value, endereco: $("#cfg-end").value } }, this, "msg-config", "Salvo. Já aparece no site e nos e-mails.");
  });
  $("#trocar-senha").addEventListener("click", function () {
    var b = this; ocupado(b, true); msg("msg-senha", "");
    api("senha", { atual: $("#senha-atual").value, nova: $("#senha-nova").value }).then(function () {
      $("#senha-atual").value = ""; $("#senha-nova").value = "";
      msg("msg-senha", "Senha trocada. Outras sessões abertas foram encerradas.", true);
    }).catch(function (e) { msg("msg-senha", e.message, false); }).finally(function () { ocupado(b, false); });
  });

  // ---------------- início ----------------
  if (token) iniciar(); else mostrarLogin();
})();
