-- Depois do Tombo / Prumo Finanças — estrutura do banco (Supabase / Postgres)
-- Rode no SQL Editor de um projeto Supabase NOVO. Não contém nenhuma senha ou chave.
-- Extensões necessárias: pg_net (chamadas HTTP do banco) e pg_cron (tarefa a cada 2 minutos).
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------- Tabelas ----------
create table if not exists public.tombo_seguranca (
  chave text primary key,
  valor text not null
);

create table if not exists public.tombo_produtos (
  id text primary key,
  nome text not null check (length(nome) between 2 and 120),
  descricao text not null default '' check (length(descricao) <= 300),
  preco numeric(10,2) not null check (preco between 1 and 10000),
  ativo boolean not null default true,
  principal boolean not null default false,
  ordem integer not null default 0,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.tombo_pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  codigo text,
  nome text not null,
  email text not null,
  whatsapp text,
  itens jsonb not null,
  total numeric(10,2) not null check (total > 0),
  status text not null default 'criando' check (status in ('criando','aguardando','pago','falhou','estornado','expirado')),
  identifier text unique,
  pix_code text,
  token text not null,
  ip text,
  utm jsonb,
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  pago_em timestamptz,
  email_status text not null default 'pendente' check (email_status in ('pendente','enviando','enviado','falhou')),
  email_enviado_em timestamptz,
  email_tentativas integer not null default 0,
  email_erro text,
  resend_id text,
  gateway text not null default 'syncpay',
  ua text,
  fbp text,
  fbc text,
  capi_status text,
  capi_erro text,
  teste boolean not null default false
);

create table if not exists public.tombo_conteudos (
  id text primary key,
  titulo text not null,
  ordem integer not null default 0,
  html text not null,
  atualizado_em timestamptz not null default now(),
  pdf_blocos jsonb,
  capa jsonb,
  anexo_b64 text,
  anexo_nome text,
  anexo_tipo text
);

create table if not exists public.tombo_visitas (
  dia date not null,
  origem text not null,
  visitas integer not null default 0,
  primary key (dia, origem)
);

create table if not exists public.tombo_admin_sessoes (
  token_hash text primary key,
  expira timestamptz not null,
  ip text,
  criado_em timestamptz not null default now()
);

create table if not exists public.farma_limites (
  chave text primary key,
  janela timestamptz not null default now(),
  total integer not null default 0
);

-- RLS ligado e SEM políticas: só as funções do servidor (service role) acessam os dados.
alter table public.tombo_seguranca enable row level security;
alter table public.tombo_produtos enable row level security;
alter table public.tombo_pedidos enable row level security;
alter table public.tombo_conteudos enable row level security;
alter table public.tombo_visitas enable row level security;
alter table public.tombo_admin_sessoes enable row level security;
alter table public.farma_limites enable row level security;

-- ---------- Funções ----------
create or replace function public.farma_permitir(p_chave text, p_limite integer, p_segundos integer)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_total int;
begin
  insert into farma_limites as l (chave, janela, total)
  values (p_chave, now(), 1)
  on conflict (chave) do update
    set total  = case when l.janela < now() - make_interval(secs => p_segundos) then 1 else l.total + 1 end,
        janela = case when l.janela < now() - make_interval(secs => p_segundos) then now() else l.janela end
  returning total into v_total;
  return v_total <= p_limite;
end $$;

create or replace function public.tombo_visita(p_origem text)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.tombo_visitas (dia, origem, visitas)
  values ((now() at time zone 'America/Sao_Paulo')::date, coalesce(nullif(left(lower(btrim(p_origem)), 40), ''), 'direto'), 1)
  on conflict (dia, origem) do update set visitas = tombo_visitas.visitas + 1;
$$;

create or replace function public.tombo_prova()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'total',  (select count(*) from public.tombo_pedidos where status = 'pago' and not teste),
    'dia',    (select count(*) from public.tombo_pedidos where status = 'pago' and not teste and pago_em > now() - interval '24 hours'),
    'agora',  (select count(*) from public.tombo_pedidos where status = 'aguardando' and not teste and criado_em > now() - interval '15 minutes'),
    'recentes', coalesce((
      select jsonb_agg(r) from (
        select upper(left(btrim(nome), 1)) as i, jsonb_array_length(itens) as n,
               greatest(0, floor(extract(epoch from now() - pago_em) / 60))::int as m
        from public.tombo_pedidos
        where status = 'pago' and not teste and pago_em > now() - interval '48 hours'
        order by pago_em desc limit 8) r), '[]'::jsonb),
    'minimo', coalesce((select nullif(valor, '')::int from public.tombo_seguranca where chave = 'prova_minimo'), 10)
  );
$$;

create or replace function public.tombo_clientes(p_busca text, p_limite integer, p_offset integer)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(c), '[]'::jsonb) from (
    select lower(email) as email,
           (array_agg(nome order by criado_em desc))[1] as nome,
           (array_agg(whatsapp order by criado_em desc) filter (where whatsapp is not null))[1] as whatsapp,
           count(*) as pedidos,
           count(*) filter (where status = 'pago') as pagos,
           coalesce(sum(total) filter (where status = 'pago'), 0) as total_gasto,
           max(criado_em) as ultimo,
           (array_agg(status order by criado_em desc))[1] as ultimo_status,
           count(*) over () as total_linhas
    from public.tombo_pedidos
    where not teste and status <> 'criando'
      and (coalesce(p_busca, '') = '' or email ilike '%' || p_busca || '%' or nome ilike '%' || p_busca || '%'
           or (regexp_replace(p_busca, '\D', '', 'g') <> '' and coalesce(whatsapp, '') like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'))
    group by lower(email)
    order by max(criado_em) desc
    limit greatest(1, least(p_limite, 500)) offset greatest(0, p_offset)
  ) c;
$$;

create or replace function public.tombo_painel(p_de date, p_ate date)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with p as (
    select *, (criado_em at time zone 'America/Sao_Paulo')::date as dia_c,
              coalesce(nullif(lower(utm->>'utm_source'), ''), 'direto') as origem
    from public.tombo_pedidos
    where not teste and status <> 'criando'
      and (criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  ),
  v as (select * from public.tombo_visitas where dia between p_de and p_ate),
  dias as (select d::date as dia from generate_series(p_de, p_ate, interval '1 day') d)
  select jsonb_build_object(
    'visitas', (select coalesce(sum(visitas), 0) from v),
    'pix_gerados', (select count(*) from p where identifier is not null),
    'pagos', (select count(*) from p where status = 'pago'),
    'faturamento', (select coalesce(sum(total), 0) from p where status = 'pago'),
    'aguardando', (select count(*) from p where status = 'aguardando'),
    'expirados', (select count(*) from p where status = 'expirado'),
    'falhas', (select count(*) from p where status = 'falhou'),
    'estornados', (select count(*) from p where status = 'estornado'),
    'emails_enviados', (select count(*) from p where status = 'pago' and email_status = 'enviado'),
    'emails_falhos', (select count(*) from p where status = 'pago' and email_status <> 'enviado'),
    'compradores', (select count(distinct lower(email)) from p where status = 'pago'),
    'por_dia', (select jsonb_agg(jsonb_build_object(
        'dia', d.dia,
        'visitas', (select coalesce(sum(visitas), 0) from v where v.dia = d.dia),
        'pix', (select count(*) from p where p.dia_c = d.dia and identifier is not null),
        'pagos', (select count(*) from p where p.dia_c = d.dia and status = 'pago'),
        'faturamento', (select coalesce(sum(total), 0) from p where p.dia_c = d.dia and status = 'pago')
      ) order by d.dia) from dias d),
    'por_origem', coalesce((select jsonb_agg(o order by o.faturamento desc, o.visitas desc) from (
        select coalesce(a.origem, b.origem) as origem, coalesce(b.visitas, 0) as visitas,
               coalesce(a.pix, 0) as pix, coalesce(a.pagos, 0) as pagos, coalesce(a.faturamento, 0) as faturamento
        from (select origem, count(*) filter (where identifier is not null) as pix,
                     count(*) filter (where status = 'pago') as pagos,
                     coalesce(sum(total) filter (where status = 'pago'), 0) as faturamento
              from p group by origem) a
        full join (select origem, sum(visitas) as visitas from v group by origem) b on a.origem = b.origem
      ) o), '[]'::jsonb),
    'por_campanha', coalesce((select jsonb_agg(c order by c.faturamento desc) from (
        select coalesce(nullif(utm->>'utm_campaign', ''), '(sem campanha)') as campanha,
               count(*) filter (where identifier is not null) as pix,
               count(*) filter (where status = 'pago') as pagos,
               coalesce(sum(total) filter (where status = 'pago'), 0) as faturamento
        from p group by 1 limit 30) c), '[]'::jsonb),
    'produtos', coalesce((select jsonb_agg(x order by x.ordem) from (
        select pr.id, pr.nome, pr.ordem,
               (select count(*) from p where p.status = 'pago' and p.itens @> jsonb_build_array(jsonb_build_object('id', pr.id))) as vendas,
               (select coalesce(sum((it->>'preco')::numeric), 0) from p, jsonb_array_elements(p.itens) it
                 where p.status = 'pago' and it->>'id' = pr.id) as receita
        from public.tombo_produtos pr) x), '[]'::jsonb)
  );
$$;

-- ATENÇÃO: troque SEU_PROJETO pelo ID do seu projeto Supabase nas 3 funções abaixo.
create or replace function public.tombo_chamar_cron()
returns bigint language plpgsql security definer set search_path to 'public', 'extensions', 'net' as $$
declare v_seg text; v_id bigint;
begin
  select valor into v_seg from public.tombo_seguranca where chave = 'interno_secret';
  if v_seg is null then return null; end if;
  select net.http_post(
    url := 'https://SEU_PROJETO.supabase.co/functions/v1/tombo-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron', v_seg),
    body := '{}'::jsonb, timeout_milliseconds := 60000) into v_id;
  return v_id;
end $$;

create or replace function public.tombo_reenviar(p_pedido uuid)
returns bigint language plpgsql security definer set search_path to 'public', 'extensions', 'net' as $$
declare v_seg text; v_id bigint;
begin
  select valor into v_seg from public.tombo_seguranca where chave = 'interno_secret';
  select net.http_post(
    url := 'https://SEU_PROJETO.supabase.co/functions/v1/tombo-arquivos/entregar',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-interno', v_seg),
    body := jsonb_build_object('pedido', p_pedido), timeout_milliseconds := 60000) into v_id;
  return v_id;
end $$;

create or replace function public.tombo_ao_pagar()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions', 'net' as $$
declare v_seg text;
begin
  if new.status = 'pago' and old.status is distinct from 'pago' and not new.teste then
    select valor into v_seg from public.tombo_seguranca where chave = 'interno_secret';
    perform net.http_post(
      url := 'https://SEU_PROJETO.supabase.co/functions/v1/tombo-admin/compra',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-interno', v_seg),
      body := jsonb_build_object('pedido', new.id), timeout_milliseconds := 30000);
  end if;
  return new;
end $$;

create or replace trigger tombo_ao_pagar after update of status on public.tombo_pedidos
  for each row execute function public.tombo_ao_pagar();

-- Tarefa a cada 2 minutos: confere Pix pendentes e reenvia e-mails que falharam.
select cron.schedule('tombo-cron', '*/2 * * * *', 'select public.tombo_chamar_cron();');

-- ---------- Produtos iniciais (preços editáveis depois no painel) ----------
insert into public.tombo_produtos (id, nome, descricao, preco, ativo, principal, ordem) values
  ('ebook',    'Depois do Tombo — e-book + Método PRUMO', 'Guia completo pós-eleição com o Método PRUMO e plano de 30 dias.', 29.90, true, true, 0),
  ('planilha', 'Planilha Mapa de Aportes', 'Calcula sua reserva, os aportes do mês e o preço médio. Com versão Excel.', 9.90, true, false, 1),
  ('tesouro',  'Guia Tesouro Direto na Prática', 'Seu primeiro investimento no Tesouro, passo a passo, com custos e impostos.', 7.90, true, false, 2),
  ('dolar',    'Guia Dólar sem Susto', 'Como ter uma parte em dólar pela própria B3, sem comprar no pico.', 7.90, true, false, 3)
on conflict (id) do nothing;

-- ---------- Chaves e configurações (preencha os valores; NUNCA coloque no GitHub) ----------
-- insert into public.tombo_seguranca (chave, valor) values
--   ('site_url', 'https://www.seudominio.com'),
--   ('interno_secret', '<texto aleatório longo>'),
--   ('webhook_secret', '<texto aleatório longo>'),
--   ('resend_api_key', 're_...'),
--   ('remetente', 'Prumo Finanças <entrega@seudominio.com>'),
--   ('syncpay_client_id', '...'), ('syncpay_client_secret', '...'),
--   ('gateway', 'syncpay'),
--   ('prova_minimo', '1');
-- A senha do painel (admin_hash) é criada pelo próprio painel; veja o README.
