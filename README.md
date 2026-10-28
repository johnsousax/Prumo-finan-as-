# Depois do Tombo · Prumo Finanças

Código completo da oferta: página de vendas, área de acesso do comprador, painel de administração e as funções do servidor (Pix, entrega por e-mail, Pixel/API de Conversões, métricas).

> **Conteúdo pago fora do repositório.** O texto do e-book e dos bônus (o produto vendido) **não** está aqui: `supabase/functions/_shared/conteudo.ts` é só um modelo vazio. A versão completa continua publicada no Supabase, e o site e as entregas funcionam normalmente. Nunca faça commit do conteúdo completo neste repositório público.

## O que tem aqui

```
site/                      → o site (HTML, CSS e JS puros, sem build)
  index.html               → página de vendas + checkout Pix
  acesso.html / acesso.js  → área do comprador (link pessoal enviado por e-mail)
  admin.html/.css/.js      → painel (métricas, pedidos, clientes, preços, gateway, Pixel)
  config.js                → aplica preços, Pixel e dados da empresa vindos do painel
  checkout.js              → gera o Pix e acompanha o pagamento
  prova.js / prova.css     → contador e avisos de compras REAIS (lidos do banco)
  privacidade.html         → política de privacidade (LGPD) e termos
  chart.svg                → gráfico do Ibovespa
  vercel.json              → cabeçalhos de segurança (CSP etc.) para a Vercel

supabase/
  schema.sql               → tabelas, funções, gatilho e tarefa agendada
  config.toml              → configuração das funções
  functions/tombo-*/       → as 8 funções do servidor (Deno)
  functions/_shared/       → código comum (gateways, PDFs, e-mail)

scripts/gerar-senha-painel.mjs → gera a senha do painel para um projeto novo
```

Nenhuma senha ou chave está nos arquivos. Elas ficam só na tabela `tombo_seguranca` do Supabase (Resend, SyncPay, Mercado Pago, Meta, senha do painel).

## Como o site funciona hoje

- **Site:** hospedado na Vercel, domínio `www.glamhouse.site`.
- **Servidor e banco:** Supabase, projeto `vpldivsicywvnvyczkhz` ("Fluxo zero"). As funções já estão publicadas lá.
- O site é estático e conversa com o Supabase. Você pode trocar a hospedagem do site sem mexer no servidor.

## Opção A (recomendada): GitHub + Vercel

Mantém o domínio, os cabeçalhos de segurança e publica sozinho a cada alteração no GitHub.

1. O código já está no GitHub (este repositório).
2. Na Vercel, abra o projeto **depois-do-tombo** → *Settings → Git* → conecte o repositório.
3. Em *Settings → Build and Deployment*, coloque **Root Directory = `site`** e Framework = **Other** (sem comando de build).
4. Pronto: cada alteração enviada ao GitHub vira uma nova versão do site.

## Opção B: GitHub Pages

1. Renomeie a pasta `site` para `docs`.
2. No repositório: *Settings → Pages → Deploy from a branch → main / docs*.
3. **Domínio:** em *Custom domain*, coloque `www.glamhouse.site` e aponte o DNS (CNAME `www` → `SEU-USUARIO.github.io`).
4. **Se for usar o endereço `SEU-USUARIO.github.io`**, o checkout e o painel serão bloqueados por segurança até você liberar esse endereço. No Supabase, vá em *Edge Functions → Secrets* e crie `TOMBO_ORIGENS_EXTRA` = `https://SEU-USUARIO.github.io`.
5. Os cabeçalhos do `vercel.json` (CSP, HSTS, anti-iframe) **não valem no GitHub Pages**. O site funciona, mas com menos proteção. Por isso a Opção A é melhor.

## Alterar as funções do servidor

Com a [CLI do Supabase](https://supabase.com/docs/guides/cli) instalada:

```bash
supabase login
supabase functions deploy --project-ref vpldivsicywvnvyczkhz
```

## Montar tudo do zero em outro projeto Supabase

1. Crie o projeto e rode `supabase/schema.sql` no SQL Editor, trocando `SEU_PROJETO` pelo ID do novo projeto.
2. Preencha as chaves na tabela `tombo_seguranca` (modelo comentado no fim do `schema.sql`).
3. Crie a senha do painel: `node scripts/gerar-senha-painel.mjs "SuaSenhaForte123"` e rode o SQL que aparecer.
4. Publique as funções: `supabase functions deploy --project-ref NOVO_ID`.
5. Carregue o conteúdo dos materiais na tabela `tombo_conteudos` e cole os blocos completos em `conteudo.ts` antes de publicar a `tombo-arquivos`, sem fazer commit deles.
6. No site, troque `vpldivsicywvnvyczkhz` pelo novo ID em: `config.js`, `checkout.js`, `prova.js`, `acesso.js`, `admin.js` e `vercel.json`.
7. Em `supabase/functions/_shared/tombo.ts`, ajuste os domínios permitidos (`PRINCIPAL` e `ORIGENS`).
8. O aviso de pagamento (webhook) é configurado sozinho em cada Pix, com uma chave secreta; não precisa cadastrar nada no gateway.
