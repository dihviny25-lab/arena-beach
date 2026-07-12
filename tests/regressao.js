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

// A leitura das tabelas (comandas/itens/produtos/clientes/pagamentos/
// creditos_cliente/auditoria) agora exige sessão válida — não dá mais pra
// fazer sb.from(x).select() direto pela chave anônima, igual o app também não
// faz mais. A suíte usa uma sessão admin própria (separada da sessão que o
// navegador cria em cada teste) só pra essas leituras de verificação.
let tokenSuite = null;
async function obterTokenSuite(){
  if(!tokenSuite){
    const { data } = await sb.rpc('criar_sessao', { p_usuario: ADMIN_USER, p_senha: ADMIN_PASS });
    tokenSuite = data[0].token;
  }
  return tokenSuite;
}
async function todasComandas(){ const { data, error } = await sb.rpc('obter_comandas', { p_token: await obterTokenSuite() }); if(error) throw error; return data || []; }
async function todosItens(){ const { data, error } = await sb.rpc('obter_itens', { p_token: await obterTokenSuite() }); if(error) throw error; return data || []; }
async function todosProdutos(){ const { data, error } = await sb.rpc('obter_produtos', { p_token: await obterTokenSuite() }); if(error) throw error; return data || []; }
async function todosClientes(){ const { data, error } = await sb.rpc('obter_clientes', { p_token: await obterTokenSuite() }); if(error) throw error; return data || []; }
async function todosPagamentos(){ const { data, error } = await sb.rpc('obter_pagamentos', { p_token: await obterTokenSuite() }); if(error) throw error; return data || []; }
async function todosCreditos(){ const { data, error } = await sb.rpc('obter_creditos_cliente', { p_token: await obterTokenSuite() }); if(error) throw error; return data || []; }
async function comandaPorId(id){ return (await todasComandas()).find(c => c.id === id) || null; }
async function clientePorNome(nome){ return (await todosClientes()).find(c => c.nome === nome) || null; }

async function limparDadosDeTeste(){
  // comandas e produtos não têm policy de DELETE direta (só via RPC admin_*, de
  // propósito — ninguém apaga comanda/produto direto pela API). Um .delete() direto
  // nessas tabelas é um no-op silencioso da RLS: por muito tempo isso deixou comandas
  // de teste 'aberta' órfãs no banco, que acabavam batendo no índice único de nome
  // (idx_comandas_nome_aberta) em runs futuros. Por isso usamos as RPCs admin_* aqui.
  const tokenAdmin = await obterTokenSuite();
  const comandasTeste = (await todasComandas()).filter(c => c.nome && c.nome.startsWith(PREFIXO));
  for(const c of comandasTeste){
    if(c.status !== 'excluida'){
      await sb.rpc('admin_excluir_comanda', { p_token: tokenAdmin, p_comanda_id: c.id, p_motivo: 'limpeza automática de dados de teste' });
    }
  }
  const produtosTeste = (await todosProdutos()).filter(p => p.nome && p.nome.startsWith(PREFIXO));
  for(const p of produtosTeste){
    await sb.rpc('admin_excluir_produto', { p_token: tokenAdmin, p_produto_id: p.id });
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

  const cliRow = await clientePorNome(`${PREFIXO}cliente`);
  // Filtra 'excluida' porque comandas nunca são apagadas de verdade (soft-delete) e
  // clientes com histórico de teste de execuções anteriores podem carregar comandas
  // excluídas — o teste quer saber quantas comandas ATIVAS existem, não o total histórico.
  let comandasCliente = (await todasComandas()).filter(c => c.cliente_id === cliRow.id && c.status !== 'excluida');
  ok('Criou exatamente 1 comanda pro cliente', comandasCliente.length === 1, `encontradas: ${comandasCliente.length}`);

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

    const comandasDepois = (await todasComandas()).filter(c => c.cliente_id === cliRow.id && c.status !== 'excluida');
    ok('Reabrir pro mesmo cliente NÃO duplica (continua com 1 comanda)', comandasDepois.length === 1, `encontradas: ${comandasDepois.length}`);
    ok('Comanda reaproveitada volta pro status aberta (fiado reaberto)', comandasDepois[0] && comandasDepois[0].status === 'aberta', JSON.stringify(comandasDepois));
  }

  ok('Sem erros de JS no fluxo de nova comanda/fiado', erros.length === 0, erros.join(' | '));
  await page.close();
}

async function testeConcorrenciaAbrirComanda(){
  const cli = await clientePorNome(`${PREFIXO}cliente`);
  if(!cli){ ok('Teste de concorrência (pré-condição)', false, 'cliente de teste não encontrado'); return; }
  const tokenConcorrencia = await obterTokenSuite();
  const itensPayload = [{ descricao: 'Item concorrência', valor: 5 }];
  const [r1, r2] = await Promise.all([
    sb.rpc('criar_comanda_com_itens', { p_nome: `${PREFIXO}cliente`, p_celular: '11988887777', p_cliente_id: cli.id, p_itens: itensPayload, p_token: tokenConcorrencia }),
    sb.rpc('criar_comanda_com_itens', { p_nome: `${PREFIXO}cliente`, p_celular: '11988887777', p_cliente_id: cli.id, p_itens: itensPayload, p_token: tokenConcorrencia }),
  ]);
  const idsIguais = r1.data && r2.data && r1.data[0].comanda_id === r2.data[0].comanda_id;
  ok('Duas chamadas concorrentes pro mesmo cliente retornam a mesma comanda', idsIguais, JSON.stringify({ r1: r1.data, r2: r2.data }));
}

async function testeQuitarFiadoComFormaPagamento(browser){
  // Cria a comanda via RPC (fica 'aberta') e registra um pagamento de R$0 pra
  // virar 'fiado' — é exatamente o que marcarFiado() faz no app de verdade,
  // já que comandas/itens não aceitam mais insert direto pela chave anônima.
  const tokenFixture = await obterTokenSuite();
  const { data: criada, error: erroCriar } = await sb.rpc('criar_comanda_com_itens', {
    p_nome: `${PREFIXO}clientefiado`, p_celular: '11955556666', p_cliente_id: null,
    p_itens: [{ descricao: 'Item teste fiado', valor: 15 }], p_token: tokenFixture
  });
  if(erroCriar) throw erroCriar;
  const comandaTesteId = criada[0].comanda_id;
  await sb.rpc('registrar_pagamento_comanda', {
    p_comanda_id: comandaTesteId, p_pagamentos: [], p_desconto: 0, p_observacao: null,
    p_token: tokenFixture, p_usar_credito: null, p_permitir_credito_sobra: false
  });
  const cliTeste = await clientePorNome(`${PREFIXO}clientefiado`);

  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, ADMIN_USER, ADMIN_PASS);
  await page.click('button[data-tab="fiado"]');
  const cardSel = `.card.paper-card:has-text("${PREFIXO}clientefiado")`;
  const pixBtn = await page.waitForSelector(`${cardSel} button:has-text("📱 Pix")`, { timeout: 20000 }).catch(() => null);
  ok('Tela de Fiado mostra opções de forma de pagamento (Pix)', !!pixBtn);
  if(pixBtn) await pixBtn.click();
  await page.waitForTimeout(1500);
  await page.close();

  const comandaFinal = await comandaPorId(comandaTesteId);
  const pagamentosFinal = (await todosPagamentos()).filter(p => p.comanda_id === comandaTesteId);
  ok('Quitar fiado fecha a comanda e registra o pagamento com a forma escolhida (pix)',
    comandaFinal.status === 'paga' && pagamentosFinal.length === 1 && pagamentosFinal[0].forma === 'pix' && Number(pagamentosFinal[0].valor) === 15,
    JSON.stringify({ comandaFinal, pagamentosFinal }));
  ok('Sem erros de JS ao quitar fiado', erros.length === 0, erros.join(' | '));

  // comandas/itens não têm DELETE direto (ver limparDadosDeTeste); a limpeza final
  // do final da suíte (por prefixo, via admin_excluir_comanda) cuida deste registro.
  if(cliTeste) await sb.from('clientes').delete().eq('id', cliTeste.id);
}

async function testePagamentoDivididoEParcial(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, ADMIN_USER, ADMIN_PASS);

  // Comanda 1: total 30 (2 itens de 15), fechada com pagamento dividido (10 pix + 20 dinheiro)
  await page.click('text=+ Abrir comanda');
  await page.waitForTimeout(500);
  await page.fill('#nc-nome', `${PREFIXO}pagsplit`);
  await page.fill('#nc-celular', '11933334444');
  await page.fill('#nc-item-desc', 'Item A'); await page.fill('#nc-item-valor', '15');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(300);
  await page.fill('#nc-item-desc', 'Item B'); await page.fill('#nc-item-valor', '15');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(300);
  await page.click('text=Criar comanda');
  await page.waitForTimeout(2000);

  const cli1 = await clientePorNome(`${PREFIXO}pagsplit`);
  const comanda1 = (await todasComandas()).find(c => c.cliente_id === cli1.id);

  await page.click('button[onclick="toggleDividirPagamento()"]');
  await page.waitForTimeout(300);
  await page.selectOption('#pg-forma-split', 'pix');
  await page.fill('#pg-valor-split', '10');
  await page.click('button[onclick="onAdicionarPagamentoDividido()"]');
  await page.waitForTimeout(300);
  await page.selectOption('#pg-forma-split', 'dinheiro');
  await page.fill('#pg-valor-split', '20');
  await page.click('button[onclick="onAdicionarPagamentoDividido()"]');
  await page.waitForTimeout(300);
  await page.click(`button[onclick="onConfirmarPagamentoDividido('${comanda1.id}')"]`);
  await page.waitForTimeout(1500);

  const comanda1Final = await comandaPorId(comanda1.id);
  const pagamentos1 = (await todosPagamentos()).filter(p => p.comanda_id === comanda1.id);
  ok('Pagamento dividido cobrindo o total fecha a comanda', comanda1Final.status === 'paga', JSON.stringify(comanda1Final));
  ok('Os 2 pagamentos divididos ficam registrados (pix 10 + dinheiro 20)',
    pagamentos1.length === 2 && pagamentos1.some(p=>p.forma==='pix'&&Number(p.valor)===10) && pagamentos1.some(p=>p.forma==='dinheiro'&&Number(p.valor)===20),
    JSON.stringify(pagamentos1));

  // Comanda 2: total 40, paga parcial (15) -> vira fiado com saldo 25, depois quita o resto pela aba Fiado
  await page.click('button[data-tab="abertas"]');
  await page.waitForTimeout(500);
  await page.click('text=+ Abrir comanda');
  await page.waitForTimeout(500);
  await page.fill('#nc-nome', `${PREFIXO}pagparcial`);
  await page.fill('#nc-celular', '11933335555');
  await page.fill('#nc-item-desc', 'Item C'); await page.fill('#nc-item-valor', '40');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(300);
  await page.click('text=Criar comanda');
  await page.waitForTimeout(2000);

  const cli2 = await clientePorNome(`${PREFIXO}pagparcial`);
  const comanda2 = (await todasComandas()).find(c => c.cliente_id === cli2.id);

  await page.click('button[onclick="toggleDividirPagamento()"]');
  await page.waitForTimeout(300);
  await page.selectOption('#pg-forma-split', 'dinheiro');
  await page.fill('#pg-valor-split', '15');
  await page.click('button[onclick="onAdicionarPagamentoDividido()"]');
  await page.waitForTimeout(300);
  await page.click(`button[onclick="onConfirmarPagamentoDividido('${comanda2.id}')"]`);
  await page.waitForTimeout(1500);

  const comanda2Parcial = await comandaPorId(comanda2.id);
  ok('Pagamento parcial (15 de 40) deixa a comanda em fiado', comanda2Parcial.status === 'fiado', JSON.stringify(comanda2Parcial));

  await page.click('#detail-overlay button.x');
  await page.waitForTimeout(500);
  await page.click('button[data-tab="fiado"]');
  await page.waitForTimeout(800);
  const cardSel2 = `.card.paper-card:has-text("${PREFIXO}pagparcial")`;
  const textoCard = await page.textContent(cardSel2).catch(() => '');
  ok('Aba Fiado mostra o saldo restante (25), não o total original (40)', textoCard.includes('25,00') && !textoCard.includes('40,00'), textoCard);
  await page.click(`${cardSel2} button:has-text("📱 Pix")`);
  await page.waitForTimeout(1500);

  const comanda2Final = await comandaPorId(comanda2.id);
  const pagamentos2 = (await todosPagamentos()).filter(p => p.comanda_id === comanda2.id)
    .sort((a,b) => new Date(a.criado_em) - new Date(b.criado_em));
  ok('Quitar o restante pela aba Fiado fecha a comanda', comanda2Final.status === 'paga', JSON.stringify(comanda2Final));
  ok('Ficam registrados os 2 pagamentos parciais (15 dinheiro + 25 pix)',
    pagamentos2.length === 2 && Number(pagamentos2[0].valor) === 15 && Number(pagamentos2[1].valor) === 25,
    JSON.stringify(pagamentos2));

  // Histórico do cliente: confere que a linha do tempo mistura compra + pagamentos
  await page.click('button[data-tab="clientes"]');
  await page.waitForTimeout(500);
  await page.click(`.card.paper-card:has-text("${PREFIXO}pagparcial") button:has-text("📊 Histórico")`);
  await page.waitForTimeout(500);
  const textoHistorico = await page.textContent('#historico-cliente-overlay').catch(() => '');
  ok('Histórico do cliente mostra indicadores e linha do tempo com compra e pagamento',
    textoHistorico.includes('Total gasto') && textoHistorico.includes('Compra') && textoHistorico.includes('Pagamento'),
    textoHistorico.slice(0, 150));

  ok('Sem erros de JS no fluxo de pagamento dividido/parcial', erros.length === 0, erros.join(' | '));
  await page.close();
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

  const cliDepois = (await todosClientes()).find(c => c.celular === celular);
  ok('Cancelar o aviso NÃO sobrescreve o cadastro existente', cliDepois && cliDepois.nome === `${PREFIXO}dupOriginal`, JSON.stringify(cliDepois));

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
  const prod = (await todosProdutos()).find(p => p.nome === `${PREFIXO}produtoentrada`);
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

  const prodDepois = (await todosProdutos()).find(p => p.id === prod.id);
  ok('Estoque foi de 3 para 10 após entrada de 7 registrada pelo caixa', prodDepois.estoque === 10, `estoque atual: ${prodDepois.estoque}`);

  const { data: entradasLog } = await sb.rpc('admin_obter_entradas_estoque', { p_token: (await sb.rpc('criar_sessao', { p_usuario: ADMIN_USER, p_senha: ADMIN_PASS })).data[0].token });
  const entradaDoTeste = (entradasLog || []).find(e => e.produto_id === prod.id);
  ok('Entrada fica registrada no log (auditoria) com quem e quando', !!entradaDoTeste && entradaDoTeste.registrado_por === CAIXA_USER, JSON.stringify(entradaDoTeste));

  ok('Sem erros de JS no fluxo de entrada de estoque do caixa', erros.length === 0, erros.join(' | '));
  // entradas_estoque não tem policy de DELETE direta (só leitura via RPC admin);
  // limparDadosDeTeste() apaga o produto de teste, o que arrasta a entrada junto (FK on delete cascade).
}

async function testeUnificarSepararAuditoria(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, ADMIN_USER, ADMIN_PASS);

  // Cadastro de cliente pela aba Clientes (agora via RPC registrar_cliente, auditado)
  await page.click('button[data-tab="clientes"]');
  await page.waitForTimeout(500);
  await page.fill('#cli-nome', `${PREFIXO}clienteReg`);
  await page.fill('#cli-whatsapp', '11922223333');
  await page.click('button:has-text("Add")');
  await page.waitForFunction((p) => clientes.some(c => c.nome === p + 'clienteReg'), PREFIXO, { timeout: 15000 });
  ok('Cliente cadastrado via RPC registrar_cliente', true);

  // Cria duas comandas abertas pra unificar
  await page.click('button[data-tab="abertas"]');
  await page.waitForTimeout(500);
  await page.click('text=+ Abrir comanda');
  await page.waitForTimeout(500);
  await page.fill('#nc-nome', `${PREFIXO}unifA`);
  await page.fill('#nc-celular', '11966661111');
  await page.fill('#nc-item-desc', 'Item A'); await page.fill('#nc-item-valor', '10');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(300);
  await page.click('text=Criar comanda');
  await page.waitForFunction(() => !novaComandaAberta && !!openComandaId, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.click('#detail-overlay button.x');
  await page.waitForTimeout(500);

  await page.click('text=+ Abrir comanda');
  await page.waitForTimeout(500);
  await page.fill('#nc-nome', `${PREFIXO}unifB`);
  await page.fill('#nc-celular', '11966662222');
  await page.fill('#nc-item-desc', 'Item B'); await page.fill('#nc-item-valor', '20');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(300);
  await page.click('text=Criar comanda');
  await page.waitForFunction(() => !novaComandaAberta && !!openComandaId, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  // Detalhe da comanda B está aberto: unifica com A
  await page.click('button[onclick="toggleUnificarComanda(\'' + (await (async()=>{
    const cliB0 = await clientePorNome(`${PREFIXO}unifB`);
    const comandaB0 = (await todasComandas()).find(c => c.cliente_id === cliB0.id);
    return comandaB0.id;
  })()) + '\')"]');
  await page.waitForTimeout(500);
  const overlayVisivel = await page.isVisible('#unificar-overlay').catch(()=>false);
  ok('Overlay de unificar comandas abre', overlayVisivel);
  if(overlayVisivel){
    await page.click(`#unificar-overlay .item-row:has-text("${PREFIXO}unifA")`);
    await page.waitForTimeout(1500);
  }

  const cliA = await clientePorNome(`${PREFIXO}unifA`);
  const comandaA = (await todasComandas()).find(c => c.cliente_id === cliA.id);
  const itensA = (await todosItens()).filter(i => i.comanda_id === comandaA.id);
  ok('Comanda A recebeu os itens da B (2 itens)', itensA.length === 2, JSON.stringify(itensA));

  const cliB = await clientePorNome(`${PREFIXO}unifB`);
  const comandaB = (await todasComandas()).find(c => c.cliente_id === cliB.id);
  ok('Comanda B virou "mesclada" apontando pra A', comandaB.status === 'mesclada' && comandaB.mesclada_com === comandaA.id, JSON.stringify(comandaB));

  // Separar 1 dos 2 itens de A pra uma comanda nova
  await page.click('#detail-overlay button.x');
  await page.waitForTimeout(500);
  await page.click('button[data-tab="abertas"]');
  await page.waitForTimeout(800);
  const textoAbertas = await page.textContent('#app');
  ok('Comanda mesclada (B) NÃO aparece mais em Abertas', !textoAbertas.includes(`${PREFIXO}unifB`));

  await page.click(`.card.paper-card:has-text("${PREFIXO}unifA")`);
  await page.waitForTimeout(500);
  const temBotaoSeparar = await page.isVisible('button:has-text("✂️ Separar itens")').catch(()=>false);
  ok('Botão "Separar itens" aparece (comanda tem 2+ itens)', temBotaoSeparar);
  if(temBotaoSeparar){
    await page.click('button:has-text("✂️ Separar itens")');
    await page.waitForTimeout(500);
    await page.locator('#detail-overlay input[type="checkbox"]').first().click();
    await page.waitForTimeout(300);
    await page.fill('#sep-nome', `${PREFIXO}separado`);
    await page.fill('#sep-celular', '11944445555');
    await page.waitForTimeout(300);
    await page.click('button[onclick^="onConfirmarSepararItens"]');
    await page.waitForTimeout(1500);
  }

  const cliSep = await clientePorNome(`${PREFIXO}separado`);
  const comandaSep = (await todasComandas()).find(c => c.cliente_id === cliSep.id);
  const itensSep = (await todosItens()).filter(i => i.comanda_id === comandaSep.id);
  ok('Comanda separada criada com 1 item', itensSep.length === 1, JSON.stringify(itensSep));
  const itensRestantesA = (await todosItens()).filter(i => i.comanda_id === comandaA.id);
  ok('Comanda A ficou com o item restante', itensRestantesA.length === 1, JSON.stringify(itensRestantesA));

  // Aba Auditoria (admin) mostra os eventos
  await page.click('#detail-overlay button.x').catch(()=>{});
  await page.waitForTimeout(500);
  await page.click('button[data-tab="admin"]');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Auditoria")');
  await page.waitForTimeout(1500);
  const textoAuditoria = await page.textContent('#app');
  ok('Aba Auditoria mostra os eventos de unificar/separar', textoAuditoria.includes('unificada') && textoAuditoria.includes('separada'), textoAuditoria.slice(0,150));

  ok('Sem erros de JS no fluxo de unificar/separar/auditoria', erros.length === 0, erros.join(' | '));
  await page.close();

  const pageCaixa = await browser.newPage();
  await login(pageCaixa, CAIXA_USER, CAIXA_PASS);
  const abasCaixa = await pageCaixa.$$eval('#nav-tabs button', els => els.map(e => e.textContent.trim()));
  ok('Caixa não vê aba Admin (logo não vê Auditoria)', !abasCaixa.includes('Admin'), abasCaixa.join(', '));
  await pageCaixa.close();
}

async function testeLinhaDoTempoComanda(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await login(page, ADMIN_USER, ADMIN_PASS);

  await page.click('text=+ Abrir comanda');
  await page.waitForTimeout(500);
  await page.fill('#nc-nome', `${PREFIXO}timeline`);
  await page.fill('#nc-celular', '11977778888');
  await page.fill('#nc-item-desc', 'Item 1'); await page.fill('#nc-item-valor', '10');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(300);
  await page.click('text=Criar comanda');
  await page.waitForFunction(() => !novaComandaAberta && !!openComandaId, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  await page.fill('#item-desc', 'Item 2');
  await page.fill('#item-valor', '7');
  await page.click('button[onclick^="onAddItem"]');
  await page.waitForTimeout(1200);

  const itemRow = page.locator('.item-row', { hasText: 'Item 2' }).first();
  await itemRow.locator('button.x').click();
  await page.waitForTimeout(1200);

  await page.click('button:has-text("🕐 Ver linha do tempo desta comanda")');
  await page.waitForTimeout(1000);
  const textoTimeline = await page.textContent('#detail-overlay');
  ok('Linha do tempo mostra o item adicionado (Item 1)', textoTimeline.includes('Item 1'));
  ok('Linha do tempo mostra o item adicionado e removido (Item 2 aparece 2x)', (textoTimeline.match(/Item 2/g) || []).length >= 2);
  ok('Linha do tempo mostra o rótulo "Item removido"', textoTimeline.includes('Item removido'));

  ok('Sem erros de JS no fluxo de linha do tempo', erros.length === 0, erros.join(' | '));
  await page.close();
}

async function testeEstornoPagamentoEReabrir(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('dialog', async d => { await d.accept(); });
  await login(page, ADMIN_USER, ADMIN_PASS);

  await page.click('text=+ Abrir comanda');
  await page.waitForTimeout(500);
  await page.fill('#nc-nome', `${PREFIXO}estorno`);
  await page.fill('#nc-celular', '11955512345');
  await page.fill('#nc-item-desc', 'Item'); await page.fill('#nc-item-valor', '100');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(300);
  await page.click('text=Criar comanda');
  await page.waitForFunction(() => !novaComandaAberta && !!openComandaId, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  // Paga dividido: pix 50 (certo) + cartao 50 (errado, devia ser fiado)
  await page.click('button[onclick="toggleDividirPagamento()"]');
  await page.waitForTimeout(300);
  await page.selectOption('#pg-forma-split', 'pix');
  await page.fill('#pg-valor-split', '50');
  await page.click('button[onclick="onAdicionarPagamentoDividido()"]');
  await page.waitForTimeout(300);
  await page.selectOption('#pg-forma-split', 'cartao');
  await page.fill('#pg-valor-split', '50');
  await page.click('button[onclick="onAdicionarPagamentoDividido()"]');
  await page.waitForTimeout(300);
  const comandaIdAtual = await page.evaluate(() => openComandaId);
  await page.click(`button[onclick="onConfirmarPagamentoDividido('${comandaIdAtual}')"]`);
  await page.waitForTimeout(1500);

  const comandaPaga = await comandaPorId(comandaIdAtual);
  ok('Comanda ficou paga com os 2 pagamentos', comandaPaga.status === 'paga', JSON.stringify(comandaPaga));

  // Comanda paga fecha o detalhe sozinha; reabre a tela (não a comanda) pra estornar o pagamento errado
  await page.click('button[data-tab="historico"]');
  await page.waitForTimeout(500);
  await page.click(`.card.paper-card:has-text("${PREFIXO}estorno")`);
  await page.waitForTimeout(500);
  await page.waitForSelector('button:has-text("↩️ Estornar")');
  const linhaCartao = page.locator('.item-row', { hasText: 'Cartão' }).first();
  await linhaCartao.locator('button:has-text("↩️ Estornar")').click();
  await page.waitForTimeout(1500);

  const comandaFiado = await comandaPorId(comandaIdAtual);
  ok('Estornar o pagamento errado volta a comanda pra fiado (sem reabrir tudo)', comandaFiado.status === 'fiado', JSON.stringify(comandaFiado));

  const pagamentosBanco = (await todosPagamentos()).filter(p => p.comanda_id === comandaIdAtual);
  ok('Os 2 pagamentos continuam no banco (estorno não apaga nada)', pagamentosBanco.length === 2, JSON.stringify(pagamentosBanco));
  const pixRow = pagamentosBanco.find(p => p.forma === 'pix');
  const cartaoRow = pagamentosBanco.find(p => p.forma === 'cartao');
  ok('O pagamento correto (pix) continua válido', pixRow && !pixRow.estornado_em);
  ok('O pagamento estornado (cartão) fica marcado, não apagado', cartaoRow && !!cartaoRow.estornado_em);

  // Quita o restante corretamente e confirma que fecha
  await page.click(`button[onclick="onPagarTudo('${comandaIdAtual}','dinheiro')"]`);
  await page.waitForTimeout(1500);
  const comandaFinal = await comandaPorId(comandaIdAtual);
  ok('Comanda fecha certo depois do estorno + pagamento correto', comandaFinal.status === 'paga', JSON.stringify(comandaFinal));

  // Testa reabrir_comanda: estorna TODOS os pagamentos válidos sem apagar nenhum
  await page.click('button[data-tab="historico"]');
  await page.waitForTimeout(500);
  await page.click(`.card.paper-card:has-text("${PREFIXO}estorno")`);
  await page.waitForTimeout(500);
  await page.click(`button[onclick="reabrirComanda('${comandaIdAtual}')"]`);
  await page.waitForTimeout(1500);
  const comandaReaberta = await comandaPorId(comandaIdAtual);
  ok('Reabrir comanda volta pra aberta', comandaReaberta.status === 'aberta', JSON.stringify(comandaReaberta));
  const pagamentosAposReabrir = (await todosPagamentos()).filter(p => p.comanda_id === comandaIdAtual);
  const naoEstornados = pagamentosAposReabrir.filter(p => !p.estornado_em);
  ok('Reabrir estorna todos os pagamentos válidos restantes (nenhum é apagado do banco)',
    pagamentosAposReabrir.length === 3 && naoEstornados.length === 0, JSON.stringify(pagamentosAposReabrir));

  ok('Sem erros de JS no fluxo de estorno/reabrir', erros.length === 0, erros.join(' | '));
  await page.close();
}

async function testeSaldoDeCredito(browser){
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('dialog', async d => { await d.accept(); });
  await login(page, ADMIN_USER, ADMIN_PASS);

  // Comanda 1: total 87, paga 100 em dinheiro sem troco -> sobra de 13 vira crédito
  await page.click('text=+ Abrir comanda');
  await page.waitForTimeout(500);
  await page.fill('#nc-nome', `${PREFIXO}creditoCliente`);
  await page.fill('#nc-celular', '11966665555');
  await page.fill('#nc-item-desc', 'Item'); await page.fill('#nc-item-valor', '87');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(300);
  await page.click('text=Criar comanda');
  await page.waitForFunction(() => !novaComandaAberta && !!openComandaId, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  await page.click('button[onclick="toggleDividirPagamento()"]');
  await page.waitForTimeout(300);
  await page.selectOption('#pg-forma-split', 'dinheiro');
  await page.fill('#pg-valor-split', '100');
  await page.click('button[onclick="onAdicionarPagamentoDividido()"]');
  await page.waitForTimeout(300);
  await page.check('#pg-sem-troco');
  await page.waitForTimeout(200);
  const comandaId1 = await page.evaluate(() => openComandaId);
  await page.click(`button[onclick="onConfirmarPagamentoDividido('${comandaId1}')"]`);
  await page.waitForTimeout(1500);

  const comanda1 = await comandaPorId(comandaId1);
  ok('Comanda fecha paga mesmo pagando mais que o total, com "sem troco" marcado', comanda1.status === 'paga', JSON.stringify(comanda1));

  let cli1 = null;
  for(let tentativa = 0; tentativa < 5 && !cli1; tentativa++){
    cli1 = await clientePorNome(`${PREFIXO}creditoCliente`);
    if(!cli1) await new Promise(r => setTimeout(r, 500));
  }
  if(!cli1){ ok('Gera crédito de R$13 (a sobra) pro cliente', false, 'cliente de teste não encontrado após criar comanda 1'); return; }
  // Filtra pela comanda desta execução, não pelo total histórico do cliente: como
  // comandas/clientes de teste nunca são apagados de verdade (soft-delete + FK NO
  // ACTION), um cliente de teste pode acumular créditos de execuções anteriores.
  const creditosComanda1 = (await todosCreditos()).filter(c => c.comanda_id === comandaId1);
  ok('Gera crédito de R$13 (a sobra) pro cliente', creditosComanda1.length === 1 && Number(creditosComanda1[0].valor) === 13 && creditosComanda1[0].tipo === 'gerado', JSON.stringify(creditosComanda1));

  await page.click('button[data-tab="clientes"]');
  await page.waitForTimeout(500);
  const textoClientes = await page.textContent('#app');
  ok('Aba Clientes mostra o crédito disponível (R$13,00)', textoClientes.includes('13,00'));

  // Comanda 2: total 20, usa o crédito de 13, resto (7) em pix
  await page.click('button[data-tab="abertas"]');
  await page.waitForTimeout(500);
  await page.click('text=+ Abrir comanda');
  await page.waitForTimeout(500);
  await page.fill('#nc-nome', `${PREFIXO}creditoCli`);
  await page.waitForTimeout(600);
  const sugg = await page.textContent('#nc-sugestoes');
  if(sugg.includes(`${PREFIXO}creditoCliente`)) await page.click('#nc-sugestoes .item-row');
  await page.waitForTimeout(300);
  await page.fill('#nc-item-desc', 'Item2'); await page.fill('#nc-item-valor', '20');
  await page.click('button[onclick^="onAdicionarAvulsoNovaComanda"]');
  await page.waitForTimeout(300);
  await page.click('text=Criar comanda');
  await page.waitForFunction(() => !novaComandaAberta && !!openComandaId, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const comandaId2 = await page.evaluate(() => openComandaId);

  const temBotaoCredito = await page.isVisible('button:has-text("Usar crédito")').catch(()=>false);
  ok('Botão "Usar crédito" aparece na comanda 2 (cliente tem saldo)', temBotaoCredito);
  if(temBotaoCredito) await page.click('button:has-text("Usar crédito")');
  await page.waitForTimeout(1500);

  // "usado" fica com comanda_id da comanda 2 (onde o crédito foi aplicado); filtra
  // pelas duas comandas desta execução, não pelo histórico todo do cliente (ver
  // comentário acima sobre clientes de teste nunca serem apagados de verdade).
  const creditos2 = (await todosCreditos()).filter(c => c.comanda_id === comandaId1 || c.comanda_id === comandaId2)
    .sort((a,b) => new Date(a.criado_em) - new Date(b.criado_em));
  ok('Uso do crédito fica registrado (usado R$13, nada apagado)', creditos2.length === 2 && creditos2.some(c => c.tipo === 'usado' && Number(c.valor) === 13), JSON.stringify(creditos2));

  const btnsPix = await page.$$('button[onclick*="onPagarTudo"][onclick*="\'pix\'"]');
  if(btnsPix.length) await btnsPix[0].click();
  await page.waitForTimeout(1500);

  const comanda2Final = await comandaPorId(comandaId2);
  ok('Comanda 2 fecha paga depois de usar crédito + pix do restante', comanda2Final.status === 'paga', JSON.stringify(comanda2Final));

  ok('Sem erros de JS no fluxo de saldo de crédito', erros.length === 0, erros.join(' | '));
  await page.close();
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

  // Se qualquer teste lançar uma exceção não tratada (timeout, elemento não
  // encontrado etc.), o finally garante que a limpeza final ainda rode —
  // senão dados de teste ficam presos no banco (ex: um "_regressao_clienteReg"
  // com um número de celular reservado) e quebram a PRÓXIMA execução, porque
  // agora o cadastro de cliente avisa sobre conflito de WhatsApp em vez de
  // sobrescrever silenciosamente.
  try {
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

  console.log('\n--- Pagamento dividido, fiado parcial e histórico do cliente ---');
  await testePagamentoDivididoEParcial(browser);

  console.log('\n--- Duplicidade de cliente (mesmo WhatsApp, nome diferente) ---');
  await testeDuplicidadeCliente(browser);

  console.log('\n--- Caixa: entrada de estoque (sem ver/alterar quantidade) ---');
  await testeCaixaEntradaEstoque(browser);

  console.log('\n--- Unificar/separar comandas e auditoria ---');
  await testeUnificarSepararAuditoria(browser);

  console.log('\n--- Linha do tempo da comanda (item adicionado/removido) ---');
  await testeLinhaDoTempoComanda(browser);

  console.log('\n--- Estorno de pagamento e reabrir comanda (sem apagar histórico) ---');
  await testeEstornoPagamentoEReabrir(browser);

  console.log('\n--- Saldo de crédito (sobra de troco) ---');
  await testeSaldoDeCredito(browser);
  } catch (erroFatal) {
    console.log(`\n❌ Suíte interrompida por erro não tratado: ${erroFatal.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log(`\n=== Limpando dados de teste ===`);
    await limparDadosDeTeste();
    if(tokenSuite){ await sb.rpc('encerrar_sessao', { p_token: tokenSuite }); tokenSuite = null; }
  }

  const falhas = resultados.filter(r => !r.passou);
  console.log(`\n=== RESULTADO: ${resultados.length - falhas.length}/${resultados.length} passaram ===`);
  if(falhas.length){
    console.log('Falhas:');
    falhas.forEach(f => console.log(`  ❌ ${f.nome} — ${f.detalhe}`));
    process.exitCode = 1;
  }
})();
