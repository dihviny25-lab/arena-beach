// Suíte de regressão do app "Comandas do Bar" (Arena Araçá).
// Roda contra o site publicado (ou local via FILE_URL) e o banco Supabase real.
// Uso: node tests/regressao.js
//
// Convenção: todo dado de teste usa o prefixo "_regressao_" — o script limpa
// esse prefixo no banco antes E depois de rodar, então é seguro rodar quantas
// vezes quiser sem acumular lixo.

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SITE_URL = process.env.SITE_URL || 'https://arena-araca.vercel.app/';
const SUPABASE_URL = 'https://ijtsuwwtwfqoyvlohezt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqdHN1d3d0d2Zxb3l2bG9oZXp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNzEzMzEsImV4cCI6MjA5ODY0NzMzMX0.3qgZII0PaGRluObRP0MM8WyZ-EsXwq5cwvCMlu6Gxw0';

const ADMIN_USER = 'Arena Araçá';
const ADMIN_PASS = '102030';
const CAIXA_USER = 'Caixa Araçá';
const CAIXA_PASS = 'Mikasa10';

const PREFIXO = '_regressao_';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const resultados = [];
function ok(nome, condicao, detalhe){
  resultados.push({ nome, passou: !!condicao, detalhe: detalhe || '' });
  console.log(`${condicao ? '✅' : '❌'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
}

async function limparDadosDeTeste(){
  const { data: clientesTeste } = await sb.from('clientes').select('id').ilike('nome', `${PREFIXO}%`);
  const idsClientes = (clientesTeste || []).map(c => c.id);
  if(idsClientes.length){
    await sb.from('comandas').delete().in('cliente_id', idsClientes);
  }
  await sb.from('comandas').delete().ilike('nome', `${PREFIXO}%`);
  await sb.from('clientes').delete().ilike('nome', `${PREFIXO}%`);
  await sb.from('produtos').delete().ilike('nome', `${PREFIXO}%`);
}

async function login(page, usuario, senha){
  await page.goto(SITE_URL);
  await page.waitForSelector('#login-usuario', { timeout: 20000 });
  await page.fill('#login-usuario', usuario);
  await page.fill('#login-senha', senha);
  await page.click('text=Entrar');
  await page.waitForSelector('#nav-tabs button', { timeout: 20000 });
  await page.waitForTimeout(1000);
}

async function testeLoginEPapeis(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));

  await login(page, ADMIN_USER, ADMIN_PASS);
  const abasAdmin = await page.$$eval('#nav-tabs button', els => els.map(e => e.textContent.trim()));
  ok('Admin vê todas as abas', abasAdmin.includes('Histórico') && abasAdmin.includes('Admin'), abasAdmin.join(', '));
  const badge = await page.textContent('#role-badge');
  ok('Badge mostra papel admin', badge.includes('admin'), badge);
  await page.click('button[data-tab="estoque"]');
  await page.waitForTimeout(500);
  ok('Admin vê formulário de cadastro no Estoque', await page.isVisible('#prod-nome'));
  await page.close();

  const page2 = await browser.newPage();
  page2.on('pageerror', e => erros.push(e.message));
  await login(page2, CAIXA_USER, CAIXA_PASS);
  const abasCaixa = await page2.$$eval('#nav-tabs button', els => els.map(e => e.textContent.trim()));
  ok('Caixa NÃO vê Histórico nem Admin', !abasCaixa.includes('Histórico') && !abasCaixa.includes('Admin'), abasCaixa.join(', '));
  await page2.click('button[data-tab="estoque"]');
  await page2.waitForTimeout(500);
  const temFormCadastro = await page2.isVisible('#prod-nome').catch(() => false);
  ok('Caixa NÃO vê formulário de cadastro no Estoque', !temFormCadastro);
  await page2.close();

  ok('Sem erros de JS durante login/navegação', erros.length === 0, erros.join(' | '));
}

async function testeBuscaClienteEAcumuloFiado(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, ADMIN_USER, ADMIN_PASS);

  await page.click('button[data-tab="clientes"]');
  await page.waitForTimeout(500);
  await page.fill('#cli-nome', `${PREFIXO}cliente`);
  await page.fill('#cli-whatsapp', '11988887777');
  await page.click('button:has-text("Add")');
  await page.waitForFunction((prefixo) => clientes.some(c => c.nome === prefixo + 'cliente'), PREFIXO, { timeout: 15000 });
  await page.waitForTimeout(1500);

  await page.click('button[data-tab="abertas"]');
  await page.waitForTimeout(1000);
  await page.fill('#novo-nome', `${PREFIXO}cli`);
  await page.waitForTimeout(1000);
  const sugestao = await page.textContent('#clientes-sugestoes');
  ok('Busca de cliente mostra sugestão', sugestao.includes(`${PREFIXO}cliente`), sugestao.slice(0,80));

  if(sugestao.includes(`${PREFIXO}cliente`)){
    await page.click('#clientes-sugestoes .item-row');
    await page.waitForTimeout(300);
    const celular = await page.inputValue('#novo-celular');
    ok('Selecionar sugestão preenche o celular', celular === '11988887777', celular);
  }

  await page.click('text=Abrir');
  await page.waitForTimeout(1500);

  await sb.rpc; // no-op guard (evita lint de variável não usada)
  const { data: comandasCliente } = await sb.from('comandas').select('id,status,cliente_id,itens:itens(*)')
    .eq('cliente_id', (await sb.from('clientes').select('id').eq('nome', `${PREFIXO}cliente`).single()).data.id);
  ok('Criou exatamente 1 comanda pro cliente', (comandasCliente || []).length === 1, `encontradas: ${(comandasCliente||[]).length}`);

  if(comandasCliente && comandasCliente.length === 1){
    const comandaId = comandasCliente[0].id;
    await page.click(`.card.paper-card:has-text("${PREFIXO}cliente")`);
    await page.waitForTimeout(500);
    await page.fill('#item-desc', 'Item regressão 1');
    await page.fill('#item-valor', '10');
    await page.click('button[onclick^="onAddItem"]');
    await page.waitForTimeout(1200);
    await page.click('button:has-text("Fechar como Fiado")');
    await page.waitForTimeout(2500);

    await page.click('button[data-tab="abertas"]');
    await page.waitForTimeout(1500);
    await page.fill('#novo-nome', `${PREFIXO}cli`);
    await page.waitForTimeout(1500);
    const sugg2 = await page.textContent('#clientes-sugestoes');
    if(sugg2.includes(`${PREFIXO}cliente`)){
      await page.click('#clientes-sugestoes .item-row');
      await page.waitForTimeout(300);
      await page.click('text=Abrir');
      await page.waitForTimeout(1500);
    }

    const { data: comandasDepois } = await sb.from('comandas').select('id,status').eq('cliente_id', comandasCliente[0].cliente_id);
    ok('Reabrir pro mesmo cliente NÃO duplica (continua com 1 comanda)', (comandasDepois || []).length === 1, `encontradas: ${(comandasDepois||[]).length}`);
  }

  ok('Sem erros de JS no fluxo de comanda/fiado', erros.length === 0, erros.join(' | '));
  await page.close();
}

async function testeConcorrenciaAbrirComanda(){
  const { data: cli } = await sb.from('clientes').select('id').eq('nome', `${PREFIXO}cliente`).single();
  if(!cli){ ok('Teste de concorrência (pré-condição)', false, 'cliente de teste não encontrado'); return; }
  // Marca como fiado de novo pra testar reabrir concorrente (se não estiver)
  const [r1, r2] = await Promise.all([
    sb.rpc('abrir_ou_continuar_comanda', { p_nome: `${PREFIXO}cliente`, p_celular: '11988887777', p_cliente_id: cli.id }),
    sb.rpc('abrir_ou_continuar_comanda', { p_nome: `${PREFIXO}cliente`, p_celular: '11988887777', p_cliente_id: cli.id }),
  ]);
  const idsIguais = r1.data && r2.data && r1.data[0].comanda_id === r2.data[0].comanda_id;
  ok('Duas chamadas concorrentes pro mesmo cliente retornam a mesma comanda', idsIguais, JSON.stringify({ r1: r1.data, r2: r2.data }));
}

async function testeEstoqueAdmin(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, ADMIN_USER, ADMIN_PASS);
  await page.click('button[data-tab="estoque"]');
  await page.waitForTimeout(500);

  await page.fill('#prod-nome', `${PREFIXO}produto`);
  await page.fill('#prod-preco', '7,50');
  await page.fill('#prod-estoque', '5');
  await page.click('text=Cadastrar produto');
  await page.waitForFunction((prefixo) => produtos.some(p => p.nome === prefixo + 'produto'), PREFIXO, { timeout: 15000 });
  ok('Produto cadastrado aparece na lista', true);

  await page.waitForTimeout(500);
  const editBtn = await page.$(`.card.paper-card:has-text("${PREFIXO}produto") button:has-text("Editar")`);
  ok('Botão Editar existe no produto (admin)', !!editBtn);

  ok('Sem erros de JS no Estoque (admin)', erros.length === 0, erros.join(' | '));
  await page.close();
}

async function testeAdminDashboard(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', msg => { if(msg.type()==='error' && !msg.text().includes('ServiceWorker')) erros.push(msg.text()); });
  await login(page, ADMIN_USER, ADMIN_PASS);
  await page.click('button[data-tab="admin"]');
  await page.waitForTimeout(800);

  ok('Aba Admin abre no sub-tab Resumo', await page.isVisible('text=Comandas abertas'));

  await page.click('button:has-text("Vendas")');
  await page.waitForTimeout(1500);
  const canvases = await page.$$eval('canvas', els => els.length);
  ok('Aba Vendas renderiza os gráficos', canvases >= 4, `canvases: ${canvases}`);
  for(const id of ['grafico-mensal','grafico-faturamento','grafico-ranking','grafico-horario']){
    const box = await page.$eval(`#${id}`, el => { const r = el.getBoundingClientRect(); return r.height; }).catch(() => 0);
    ok(`Gráfico #${id} tem altura > 0`, box > 0, `altura: ${box}`);
  }

  await page.click('button:has-text("Excluídas")');
  await page.waitForTimeout(500);
  ok('Aba Excluídas renderiza sem travar', await page.isVisible('main'));

  await page.click('button:has-text("Caixa")');
  await page.waitForTimeout(500);
  ok('Aba Caixa renderiza (abrir caixa ou turno aberto)', await page.isVisible('text=/Abrir caixa|Caixa aberto/'));

  ok('Sem erros de JS no dashboard Admin', erros.length === 0, erros.join(' | '));
  await page.close();
}

(async () => {
  console.log(`\n=== Limpando dados de teste antigos (prefixo "${PREFIXO}") ===`);
  await limparDadosDeTeste();

  const browser = await chromium.launch();
  console.log(`\n=== Rodando contra ${SITE_URL} ===\n`);

  console.log('--- Login e papéis ---');
  await testeLoginEPapeis(browser);

  console.log('\n--- Busca de cliente e acúmulo de fiado ---');
  await testeBuscaClienteEAcumuloFiado(browser);

  console.log('\n--- Concorrência ao abrir comanda ---');
  await testeConcorrenciaAbrirComanda();

  console.log('\n--- Estoque (admin) ---');
  await testeEstoqueAdmin(browser);

  console.log('\n--- Dashboard Admin ---');
  await testeAdminDashboard(browser);

  await browser.close();

  console.log(`\n=== Limpando dados de teste ===`);
  await limparDadosDeTeste();

  const falhas = resultados.filter(r => !r.passou);
  console.log(`\n=== RESULTADO: ${resultados.length - falhas.length}/${resultados.length} passaram ===`);
  if(falhas.length){
    console.log('Falhas:');
    falhas.forEach(f => console.log(`  ❌ ${f.nome} — ${f.detalhe}`));
    process.exitCode = 1;
  }
})();
