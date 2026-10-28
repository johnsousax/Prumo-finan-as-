// Configuração pública do site (definida no painel): preços, order bumps ativos, dados da empresa,
// contato de suporte, Meta Pixel e contagem de visitas. Usado por todas as páginas públicas.
// Na página de acesso o Pixel NÃO é carregado (o link ali é pessoal e não deve ir para terceiros).
(function () {
  "use strict";
  var API = "https://vpldivsicywvnvyczkhz.supabase.co/functions/v1/tombo-prova";
  var eu = document.currentScript;
  var comPixel = eu && eu.hasAttribute("data-pixel");
  var contaVisita = eu && eu.hasAttribute("data-visita");
  var fmt = function (v) { return Number(v).toFixed(2).replace(".", ","); };

  window.prumo = fetch(API, { credentials: "omit" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });

  window.prumo.then(function (d) {
    if (!d || !d.cfg) return;
    var cfg = d.cfg, prods = {};
    (cfg.produtos || []).forEach(function (p) { prods[p.id] = p; });
    var principal = (cfg.produtos || []).filter(function (p) { return p.principal; })[0];

    // Preços em todo o texto da página
    document.querySelectorAll("[data-preco]").forEach(function (el) {
      var p = prods[el.getAttribute("data-preco")];
      if (p) el.textContent = fmt(p.preco);
    });
    // Order bumps: nome, descrição, preço e se aparecem
    document.querySelectorAll('input[name="bump"]').forEach(function (inp) {
      var p = prods[inp.value], label = inp.closest("label");
      if (!label) return;
      if (!p || !p.ativo) { inp.checked = false; inp.disabled = true; label.hidden = true; return; }
      inp.setAttribute("data-preco", p.preco);
      var b = label.querySelector(".bt b"), s = label.querySelector(".bt small"), v = label.querySelector(".bp");
      if (b) b.textContent = p.nome;
      if (s) s.textContent = p.descricao;
      if (v) v.textContent = "+ R$ " + fmt(p.preco);
    });
    if (principal) {
      window.PRUMO_BASE = principal.preco;
      document.dispatchEvent(new CustomEvent("prumo:precos", { detail: { base: principal.preco } }));
    }

    // Rodapé: empresa e suporte (exigência do Código de Defesa do Consumidor no comércio eletrônico)
    var e = cfg.empresa || {}, partes = [];
    if (e.nome) partes.push(e.nome);
    if (e.doc) partes.push((e.doc.length > 14 ? "CNPJ " : "CPF ") + e.doc);
    if (e.endereco) partes.push(e.endereco);
    if (cfg.suporte) partes.push("Suporte: " + cfg.suporte);
    document.querySelectorAll("[data-empresa]").forEach(function (el) {
      if (!partes.length) return;
      el.textContent = partes.join(" · ");
      el.hidden = false;
    });

    if (comPixel && /^\d{8,20}$/.test(cfg.pixel || "")) pixel(cfg.pixel, principal);
  });

  function pixel(id, principal) {
    if (window.fbq) return;
    var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
    var t = document.createElement("script");
    t.async = true; t.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(t);
    window.fbq("init", id);
    window.fbq("track", "PageView");
    // ViewContent quando a oferta aparece na tela (uma vez)
    var oferta = document.getElementById("oferta");
    if (oferta && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return;
        io.disconnect();
        window.fbq("track", "ViewContent", { content_ids: [principal ? principal.id : "ebook"], content_type: "product", value: principal ? principal.preco : 0, currency: "BRL" });
      }, { threshold: 0.3 });
      io.observe(oferta);
    }
  }

  // Uma visita por sessão, com a origem da campanha (utm_source) ou o site que trouxe a pessoa
  if (contaVisita) {
    try {
      if (!sessionStorage.getItem("pt_vis") && !/[?&]previa=1/.test(location.search)) {
        sessionStorage.setItem("pt_vis", "1");
        var q = new URLSearchParams(location.search), origem = q.get("utm_source") || "";
        if (!origem && document.referrer) {
          try { var h = new URL(document.referrer).hostname.replace(/^(www|l|lm|m)\./, ""); if (h !== location.hostname) origem = h; } catch (e1) {}
        }
        fetch(API + "/visita", { method: "POST", credentials: "omit", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origem: origem || "direto" }) }).catch(function () {});
      }
    } catch (e2) {}
  }
})();
