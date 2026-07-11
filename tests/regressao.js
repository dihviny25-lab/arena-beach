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
  // comandas e produtos não têm policy de DELETE direta (só via RPC admin_*, de
  // propósito — ninguém apaga comanda/produto direto pela API). Um .delete() direto
  // nessas tabelas é um no-op silencioso da RLS: por muito tempo isso deixou comandas
  // de teste 'aberta' órfãs no banco, que acabavam batendo no índice único de nome
  // (idx_comandas_nome_aberta) em runs futuros. Por isso usamos as RPCs admin_* aqui.
  const { data: sessaoAdmin } = await sb.rpc('criar_sessao', { p_usuario: ADMIN_USER, p_senha: ADMIN_PASS });
  const tokenAdmin = sessaoAdmin && sessaoAdmin[0] && sessaoAdmin[0].token;
  if(tokenAdmin){
    const { data: comandasTeste } = await sb.from('comandas').select('id,status').ilike('nome', `${PREFIXO}%`);
    for(const c of (comandasTeste || [])){
      if(c.status !== 'excluida'){
        await sb.rpc('admin_excluir_comanda', { p_token: tokenAdmin, p_comanda_id: c.id, p_motivo: 'limpeza automática de dados de teste' });
      }
    }
    const { data: produtosTeste } = await sb.from('produtos').select('id').ilike('nome', `${PREFIXO}%`);
    for(const p of (produtosTeste || [])){
      await sb.rpc('admin_excluir_produto', { p_token: tokenAdmin, p_produto_id: p.id });
    }
    await sb.rpc('encerrar_sessao', { p_token: tokenAdmin });
  }
  await sb.from('clientes').delete().ilike('nome', `${PREFIXO}%`);
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

async function testeNovaComandaEAcumuloFiado(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, ADMIN_USER, ADMIN_PASS);

  // Cadastra cliente antecipadamente pra testar a busca dentro da tela de Nova comanda
  await page.click('button[data-tab="clientes"]');
  await page.waitForTimeout(500);
  await page.fill('#cli-nome', `${PREFIXO}cliente`);
  await page.fill('#cli-whatsapp', '11988887777');
  await page.click('button:has-text("Add")');
  await page.waitForFunction((prefixo) => clientes.some(c => c.nome === prefixo + 'cliente'), PREFIXO, { timeout: 25000 });
  await page.waitForTimeout(1000);

  // Abre a tela única de Nova comanda: busca o cliente, adiciona 1 item avulso, cria
  await page.click('button[data-tab="abertas"]');
  await page.waitForTimeout(500);
  await page.click('text=+ Abrir comanda');
  await page.waitForTimeout(500);
  await page.fill('#nc-nome', `${PREFIXO}cli`);
  await page.waitForTimeout(600);
  const sugestao = await page.textContent('#nc-sugestoes');
  ok('Nova comanda: busca de cliente mostra sugestão', sugestao.includes(`${PREFIXO}cliente`), sugestao.slice(0,80));
  if(sugestao.includes(`${PREFIXO}cliente`)){
    await page.click('#nc-sugestoes .item-row');
    await page.waitForTimeout(300);
    const celular = await page.inputValue('#nc-celular');
    ok('Nova comanda: selecionar sugestão preenche o WhatsApp', celular === '11988887777', celular);
  }
  await page.fill('#nc-item-desc', 'Item regressão 1');
  await page.fill('#nc-item-valor', '10');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(500);
  await page.click('text=Criar comanda');
  await page.waitForTimeout(2000);

  const { data: cliRow } = await sb.from('clientes').select('id').eq('nome', `${PREFIXO}cliente`).single();
  const { data: comandasCliente } = await sb.from('comandas').select('id,status,cliente_id,itens:itens(*)')
    .eq('cliente_id', cliRow.id);
  ok('Criou exatamente 1 comanda pro cliente', (comandasCliente || []).length === 1, `encontradas: ${(comandasCliente||[]).length}`);

  if(comandasCliente && comandasCliente.length === 1){
    // Criar comanda já abre o detalhe dela automaticamente (fluxo intencional);
    // não precisa clicar no card da lista de novo.
    await page.click('button:has-text("Fechar como Fiado")');
    await page.waitForTimeout(2000);
    // Marcar fiado mantém o detalhe aberto de propósito (pra mostrar o link de WhatsApp
    // na hora); fecha manualmente antes de navegar pra outra aba.
    await page.click('#detail-overlay button.x');
    await page.waitForTimeout(500);

    // Reabre nova comanda pro mesmo cliente: deve reaproveitar, não duplicar
    await page.click('button[data-tab="abertas"]');
    await page.waitForTimeout(500);
    await page.click('text=+ Abrir comanda');
    await page.waitForTimeout(500);
    await page.fill('#nc-nome', `${PREFIXO}cli`);
    await page.waitForTimeout(600);
    const sugg2 = await page.textContent('#nc-sugestoes');
    if(sugg2.includes(`${PREFIXO}cliente`)){
      await page.click('#nc-sugestoes .item-row');
      await page.waitForTimeout(300);
    }
    await page.fill('#nc-item-desc', 'Item regressão 2 (fiado acumulado)');
    await page.fill('#nc-item-valor', '8');
    await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
    await page.waitForTimeout(500);
    await page.click('text=Criar comanda');
    await page.waitForTimeout(2000);

    const { data: comandasDepois } = await sb.from('comandas').select('id,status').eq('cliente_id', cliRow.id);
    ok('Reabrir pro mesmo cliente NÃO duplica (continua com 1 comanda)', (comandasDepois || []).length === 1, `encontradas: ${(comandasDepois||[]).length}`);
    ok('Comanda reaproveitada volta pro status aberta (fiado reaberto)', comandasDepois && comandasDepois[0] && comandasDepois[0].status === 'aberta', JSON.stringify(comandasDepois));
  }

  ok('Sem erros de JS no fluxo de nova comanda/fiado', erros.length === 0, erros.join(' | '));
  await page.close();
}

async function testeConcorrenciaAbrirComanda(){
  const { data: cli } = await sb.from('clientes').select('id').eq('nome', `${PREFIXO}cliente`).single();
  if(!cli){ ok('Teste de concorrência (pré-condição)', false, 'cliente de teste não encontrado'); return; }
  const itensPayload = [{ descricao: 'Item concorrência', valor: 5 }];
  const [r1, r2] = await Promise.all([
    sb.rpc('criar_comanda_com_itens', { p_nome: `${PREFIXO}cliente`, p_celular: '11988887777', p_cliente_id: cli.id, p_itens: itensPayload }),
    sb.rpc('criar_comanda_com_itens', { p_nome: `${PREFIXO}cliente`, p_celular: '11988887777', p_cliente_id: cli.id, p_itens: itensPayload }),
  ]);
  const idsIguais = r1.data && r2.data && r1.data[0].comanda_id === r2.data[0].comanda_id;
  ok('Duas chamadas concorrentes pro mesmo cliente retornam a mesma comanda', idsIguais, JSON.stringify({ r1: r1.data, r2: r2.data }));
}

async function testeQuitarFiadoComFormaPagamento(browser){
  const { data: cliTeste } = await sb.from('clientes').insert({ nome: `${PREFIXO}clientefiado`, celular: '11955556666' }).select().single();
  const { data: comandaTeste } = await sb.from('comandas').insert({ nome: `${PREFIXO}clientefiado`, status: 'fiado', cliente_id: cliTeste.id }).select().single();
  await sb.from('itens').insert({ comanda_id: comandaTeste.id, descricao: 'Item teste fiado', valor: 15 });

  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, ADMIN_USER, ADMIN_PASS);
  await page.click('button[data-tab="fiado"]');
  const pixBtn = await page.waitForSelector('button:has-text("📱 Pix")', { timeout: 20000 }).catch(() => null);
  ok('Tela de Fiado mostra opções de forma de pagamento (Pix)', !!pixBtn);
  if(pixBtn) await pixBtn.click();
  await page.waitForTimeout(1500);
  await page.close();

  const { data: comandaFinal } = await sb.from('comandas').select('*').eq('id', comandaTeste.id).single();
  ok('Quitar fiado grava a forma de pagamento escolhida (pix), não mais "fiado"', comandaFinal.status === 'paga' && comandaFinal.forma_pagamento === 'pix', JSON.stringify(comandaFinal));
  ok('Sem erros de JS ao quitar fiado', erros.length === 0, erros.join(' | '));

  // comandas não tem DELETE direto (ver limparDadosDeTeste); a limpeza final do
  // final da suíte (por prefixo, via admin_excluir_comanda) cuida deste registro.
  await sb.from('itens').delete().eq('comanda_id', comandaTeste.id);
  await sb.from('clientes').delete().eq('id', cliTeste.id);
}

async function testeDuplicidadeCliente(browser){
  const celular = '11988889999';
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, ADMIN_USER, ADMIN_PASS);
  await page.click('button[data-tab="clientes"]');
  await page.waitForTimeout(500);

  await page.fill('#cli-nome', `${PREFIXO}dupOriginal`);
  await page.fill('#cli-whatsapp', celular);
  await page.click('button:has-text("Add")');
  await page.waitForFunction((prefixo) => clientes.some(c => c.nome === prefixo + 'dupOriginal'), PREFIXO, { timeout: 20000 });

  let dialogMsg = null;
  page.once('dialog', async d => { dialogMsg = d.message(); await d.dismiss(); });
  await page.fill('#cli-nome', `${PREFIXO}dupDiferente`);
  await page.fill('#cli-whatsapp', celular);
  await page.click('button:has-text("Add")');
  await page.waitForTimeout(1500);
  ok('Cadastro com WhatsApp já usado por outro nome pede confirmação', dialogMsg && dialogMsg.includes(`${PREFIXO}dupOriginal`), dialogMsg);

  const { data: cliDepois } = await sb.from('clientes').select('*').eq('celular', celular).single();
  ok('Cancelar o aviso NÃO sobrescreve o cadastro existente', cliDepois.nome === `${PREFIXO}dupOriginal`, JSON.stringify(cliDepois));

  ok('Sem erros de JS no fluxo de duplicidade', erros.length === 0, erros.join(' | '));
  await page.close();
  await sb.from('clientes').delete().eq('celular', celular);
}

async function testeCaixaEntradaEstoque(browser){
  const { data: sessaoAdmin } = await sb.rpc('criar_sessao', { p_usuario: ADMIN_USER, p_senha: ADMIN_PASS });
  const tokenAdmin = sessaoAdmin[0].token;
  await sb.rpc('admin_cadastrar_produto', {
    p_token: tokenAdmin, p_nome: `${PREFIXO}produtoentrada`, p_preco: 9, p_estoque: 3, p_minimo: 2, p_categoria: 'Testes', p_tipo: 'produto'
  });
  const { data: prod } = await sb.from('produtos').select('id').eq('nome', `${PREFIXO}produtoentrada`).single();
  await sb.rpc('encerrar_sessao', { p_token: tokenAdmin });

  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, CAIXA_USER, CAIXA_PASS);
  await page.click('button[data-tab="estoque"]');
  await page.waitForSelector(`#entrada-${prod.id}`, { timeout: 20000 }).catch(() => null);

  const textoEstoque = await page.textContent('#app');
  ok('Caixa NÃO vê "em estoque:" na aba Estoque', !textoEstoque.includes('em estoque:'));
  ok('Caixa NÃO vê botão Repor', !(await page.isVisible('button:has-text("Repor")').catch(()=>false)));
  ok('Caixa NÃO vê botão Excluir produto', !(await page.isVisible('button:has-text("Excluir")').catch(()=>false)));

  const inputEntrada = await page.$(`#entrada-${prod.id}`);
  ok('Caixa vê campo de entrada de estoque pro produto de teste', !!inputEntrada);
  if(inputEntrada){
    await inputEntrada.fill('7');
    await page.click(`button[onclick="onRegistrarEntradaEstoque('${prod.id}')"]`);
    await page.waitForTimeout(1500);
  }
  await page.close();

  const { data: prodDepois } = await sb.from('produtos').select('estoque').eq('id', prod.id).single();
  ok('Estoque foi de 3 para 10 após entrada de 7 registrada pelo caixa', prodDepois.estoque === 10, `estoque atual: ${prodDepois.estoque}`);

  const { data: entradasLog } = await sb.rpc('admin_obter_entradas_estoque', { p_token: (await sb.rpc('criar_sessao', { p_usuario: ADMIN_USER, p_senha: ADMIN_PASS })).data[0].token });
  const entradaDoTeste = (entradasLog || []).find(e => e.produto_id === prod.id);
  ok('Entrada fica registrada no log (auditoria) com quem e quando', !!entradaDoTeste && entradaDoTeste.registrado_por === CAIXA_USER, JSON.stringify(entradaDoTeste));

  ok('Sem erros de JS no fluxo de entrada de estoque do caixa', erros.length === 0, erros.join(' | '));
  // entradas_estoque não tem policy de DELETE direta (só leitura via RPC admin);
  // limparDadosDeTeste() apaga o produto de teste, o que arrasta a entrada junto (FK on delete cascade).
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
  await page.waitForFunction((prefixo) => produtos.some(p => p.nome === prefixo + 'produto'), PREFIXO, { timeout: 25000 });
  ok('Produto cadastrado aparece na lista', true);

  const editBtn = await page.waitForSelector(`.card.paper-card:has-text("${PREFIXO}produto") button:has-text("Editar")`, { timeout: 20000 }).catch(() => null);
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

  console.log('\n--- Nova comanda (tela única) e acúmulo de fiado ---');
  await testeNovaComandaEAcumuloFiado(browser);

  console.log('\n--- Concorrência ao criar comanda ---');
  await testeConcorrenciaAbrirComanda();

  console.log('\n--- Estoque (admin) ---');
  await testeEstoqueAdmin(browser);

  console.log('\n--- Dashboard Admin ---');
  await testeAdminDashboard(browser);

  console.log('\n--- Quitar fiado com forma de pagamento ---');
  await testeQuitarFiadoComFormaPagamento(browser);

  console.log('\n--- Duplicidade de cliente (mesmo WhatsApp, nome diferente) ---');
  await testeDuplicidadeCliente(browser);

  console.log('\n--- Caixa: entrada de estoque (sem ver/alterar quantidade) ---');
  await testeCaixaEntradaEstoque(browser);

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
