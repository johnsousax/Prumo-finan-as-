(function () {
  var API = "https://vpldivsicywvnvyczkhz.supabase.co/functions/v1";
  var BASE = window.PRUMO_BASE || 29.90; // preço do produto principal vem do painel (config.js)
  var $ = function (id) { return document.getElementById(id); };
  var form = $("ck-form"), pix = $("pix"), btn = $("ck-btn"), erro = $("ck-erro");
  var brl = function (v) { return "R$ " + v.toFixed(2).replace(".", ","); };
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // UTM da campanha (guardada para atribuir a venda)
  var params = new URLSearchParams(location.search), utm = store.get("pt_utm") || {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"].forEach(function (k) { if (params.get(k)) utm[k] = params.get(k); });
  store.set("pt_utm", utm);

  function atualizarTotal() {
    var t = BASE;
    form.querySelectorAll('input[name="bump"]:checked').forEach(function (c) { t += parseFloat(c.dataset.preco); });
    $("ck-total").textContent = brl(Math.round(t * 100) / 100);
  }
  form.addEventListener("change", atualizarTotal);
  document.addEventListener("prumo:precos", function (e) { BASE = Number(e.detail.base) || BASE; atualizarTotal(); });
  function cookie(n) { var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : ""; }

  var wa = form.elements.whatsapp;
  wa.addEventListener("input", function () {
    var d = wa.value.replace(/\D/g, "").slice(0, 11), o = d;
    if (d.length > 2) o = "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length > 7) o = "(" + d.slice(0, 2) + ") " + d.slice(2, d.length - 4) + "-" + d.slice(-4);
    wa.value = o;
  });

  var timer = null, pedido = null;

  function mostrarPix(p, rolar) {
    pedido = p;
    form.hidden = true; pix.hidden = false;
    $("pix-codigo").textContent = p.codigo;
    $("pix-total").textContent = brl(Number(p.total));
    $("pix-code").value = p.pix_code;
    var qr = $("pix-qr"); qr.innerHTML = "";
    if (window.QRCode) new QRCode(qr, { text: p.pix_code, width: 420, height: 420, correctLevel: QRCode.CorrectLevel.M });
    else qr.hidden = true;
    if (rolar !== false) pix.scrollIntoView({ behavior: "smooth", block: "start" });
    consultar();
  }

  function acesso(p) { return "acesso.html?id=" + encodeURIComponent(p.id) + "&t=" + encodeURIComponent(p.t); }

  function consultar() {
    clearTimeout(timer);
    if (!pedido) return;
    if (Date.now() - pedido.criado > 60 * 60 * 1000) {
      setStatus("err", "Este Pix expirou. Gere um novo pedido.");
      store.del("pt_pedido"); return;
    }
    fetch(API + "/tombo-status?id=" + encodeURIComponent(pedido.id) + "&t=" + encodeURIComponent(pedido.t))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.status === "pago") {
          setStatus("ok", "Pagamento confirmado! Liberando seu acesso…");
          store.set("pt_acesso", { id: pedido.id, t: pedido.t });
          store.del("pt_pedido");
          // eventID igual ao da API de Conversões: o Meta conta a compra uma vez só
          if (window.fbq) try { fbq("track", "Purchase", { value: Number(pedido.total), currency: "BRL", content_type: "product" }, { eventID: "compra-" + pedido.codigo }); } catch (e) {}
          setTimeout(function () { location.href = acesso(pedido); }, 900);
        } else if (j.status === "falhou" || j.status === "estornado") {
          setStatus("err", "Não conseguimos confirmar este pagamento. Fale com o suporte informando o pedido " + pedido.codigo + ".");
        } else {
          timer = setTimeout(consultar, 4000);
        }
      })
      .catch(function () { timer = setTimeout(consultar, 6000); });
  }

  function setStatus(tipo, txt) {
    var s = $("pix-status");
    s.className = "pix-status" + (tipo ? " " + tipo : "");
    s.textContent = "";
    var d = document.createElement("span"); d.className = "dot"; s.appendChild(d);
    s.appendChild(document.createTextNode(txt));
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    erro.textContent = "";
    var f = form.elements;
    var dados = {
      nome: f.nome.value.trim(),
      email: f.email.value.trim(),
      whatsapp: f.whatsapp.value,
      empresa: f.empresa.value,
      bumps: Array.prototype.map.call(form.querySelectorAll('input[name="bump"]:checked'), function (c) { return c.value; }),
      utm: utm,
      px: { fbp: cookie("_fbp"), fbc: cookie("_fbc") }
    };
    if (dados.nome.length < 2) { erro.textContent = "Informe seu nome."; f.nome.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dados.email)) { erro.textContent = "Informe um e-mail válido — é por ele que você identifica a compra."; f.email.focus(); return; }
    btn.disabled = true; btn.textContent = "Gerando seu Pix…";
    if (window.fbq) try { fbq("track", "InitiateCheckout", { value: Number($("ck-total").textContent.replace(/[^\d,]/g, "").replace(",", ".")) || BASE, currency: "BRL", num_items: 1 + dados.bumps.length }); } catch (e2) {}
    fetch(API + "/tombo-checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.pix_code) throw new Error(res.j.erro || "Não foi possível gerar o Pix. Tente de novo.");
        var p = { id: res.j.id, t: res.j.t, codigo: res.j.codigo, pix_code: res.j.pix_code, total: res.j.total, criado: Date.now() };
        store.set("pt_pedido", p);
        mostrarPix(p);
      })
      .catch(function (err) { erro.textContent = err.message || "Falha de conexão. Tente de novo."; })
      .finally(function () { btn.disabled = false; btn.textContent = "Gerar Pix e receber agora"; });
  });

  $("pix-copiar").addEventListener("click", function () {
    var code = $("pix-code"), b = this;
    var ok = function () { b.textContent = "Código copiado!"; setTimeout(function () { b.textContent = "Copiar código Pix"; }, 2500); };
    if (navigator.clipboard) navigator.clipboard.writeText(code.value).then(ok, function () { code.select(); document.execCommand("copy"); ok(); });
    else { code.select(); document.execCommand("copy"); ok(); }
  });

  $("pix-novo").addEventListener("click", function () {
    clearTimeout(timer); pedido = null; store.del("pt_pedido");
    pix.hidden = true; form.hidden = false;
  });

  // Retoma um Pix em aberto (ex.: a pessoa saiu para pagar e voltou)
  var aberto = store.get("pt_pedido");
  if (aberto && aberto.id && Date.now() - aberto.criado < 60 * 60 * 1000) mostrarPix(aberto, false);
  atualizarTotal();

  // Esconde o botão fixo do celular enquanto o checkout está na tela
  var sticky = document.querySelector(".sticky"), oferta = $("oferta");
  if (sticky && oferta && "IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { sticky.classList.toggle("off", es[0].isIntersecting); }, { threshold: 0.05 }).observe(oferta);
  }
})();
