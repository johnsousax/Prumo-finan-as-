(function () {
  "use strict";
  var API = "https://vpldivsicywvnvyczkhz.supabase.co/functions/v1/tombo-chat";
  var toggle = document.getElementById("prumo-chat-toggle");
  var panel = document.getElementById("prumo-chat-panel");
  var close = document.getElementById("prumo-chat-close");
  var form = document.getElementById("prumo-chat-form");
  var input = document.getElementById("prumo-chat-input");
  var log = document.getElementById("prumo-chat-log");
  var send = document.getElementById("prumo-chat-send");
  if (!toggle || !panel || !form || !input || !log) return;

  var messages = [];
  var busy = false;
  function showPanel(show) {
    panel.hidden = !show;
    toggle.setAttribute("aria-expanded", show ? "true" : "false");
    if (show) input.focus();
  }
  function bubble(text, who) {
    var item = document.createElement("div");
    item.className = "prumo-chat-message " + who;
    item.textContent = text;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }
  toggle.addEventListener("click", function () { showPanel(panel.hidden); });
  close.addEventListener("click", function () { showPanel(false); });
  bubble("Olá! Sou o assistente virtual da Prumo Finanças. Posso explicar o guia e tirar dúvidas gerais de educação financeira. Como posso ajudar?", "assistant");

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    bubble(text, "user");
    messages.push({ role: "user", content: text });
    if (messages.length > 12) messages = messages.slice(-12);
    busy = true;
    send.disabled = true;
    send.textContent = "…";
    var pending = bubble("Escrevendo…", "assistant pending");
    try {
      var response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages }),
        credentials: "omit"
      });
      var result = await response.json().catch(function () { return {}; });
      if (!response.ok || !result.resposta) throw new Error(result.erro || "Não foi possível responder agora.");
      pending.textContent = result.resposta;
      pending.classList.remove("pending");
      messages.push({ role: "assistant", content: result.resposta });
      if (messages.length > 12) messages = messages.slice(-12);
    } catch (error) {
      pending.textContent = error.message || "O assistente está indisponível no momento. Tente novamente.";
      pending.classList.add("error");
    } finally {
      busy = false;
      send.disabled = false;
      send.textContent = "Enviar";
      input.focus();
    }
  });
})();
