const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const port = 3187;
const base = `http://127.0.0.1:${port}/api`;
const jwtSecret = process.env.JWT_SECRET || 'madevix-ci-secret-'.padEnd(48, 'x');
let server;

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function expectStatus(result, status, label) {
  assert.equal(result.status, status, `${label}: esperado HTTP ${status}, recebido ${result.status}. Resposta: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error('A API encerrou antes de ficar disponível.');
    try {
      const result = await request('/health');
      if (result.status === 200) return;
      if (result.status === 503) throw new Error(result.data?.error || 'Schema do banco incompleto.');
    } catch (error) {
      if (error.message.includes('Banco conectado') || error.message.includes('Schema do banco')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('A API não ficou disponível dentro do tempo limite.');
}

async function main() {
  server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: jwtSecret },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  server.stdout.on('data', chunk => { logs += chunk.toString(); });
  server.stderr.on('data', chunk => { logs += chunk.toString(); });

  try {
    await waitForServer();
    const health = await request('/health');
    assert.equal(health.data?.ok, true, 'Health check não confirmou banco e schema.');

    const email = `smoke-${Date.now()}@madevix.test`;
    const registered = await expectStatus(await request('/auth/register', {
      method: 'POST',
      body: { company: 'MADEVIX CI', name: 'Administrador CI', email, password: 'Senha-forte-123' }
    }), 201, 'Cadastro');
    assert.ok(registered.token && registered.user?.company_id, 'Cadastro não retornou sessão válida.');

    await expectStatus(await request('/me', { token: registered.token }), 200, 'Sessão');
    await expectStatus(await request('/dashboard', { token: registered.token }), 200, 'Dashboard');
    const initialOverview = await expectStatus(await request('/projects/'+project.id+'/overview',{token:registered.token}),200,'Visão integrada do projeto');
    assert.equal(initialOverview.project.customer_name,'Cliente de teste','Projeto não vinculou corretamente o cliente.');
    const approved = await expectStatus(await request('/projects/'+project.id+'/approve',{token:registered.token,method:'POST',body:{}}),200,'Aprovação integrada');
    assert.ok(approved.order?.id,'Aprovação não criou ordem de produção.');
    const approvedAgain = await expectStatus(await request('/projects/'+project.id+'/approve',{token:registered.token,method:'POST',body:{}}),200,'Aprovação idempotente');
    assert.equal(approvedAgain.order.id,approved.order.id,'Aprovação duplicou a ordem de produção.');


    const customer = await expectStatus(await request('/customers', {
      token: registered.token, method: 'POST', body: { name: 'Cliente de teste' }
    }), 201, 'Cadastro de cliente');
    const project = await expectStatus(await request('/projects', {
      token: registered.token, method: 'POST',
      body: { title: 'Cozinha planejada CI', customer_id: customer.id, estimated_cost: 2500, sale_price: 5000 }
    }), 201, 'Cadastro de projeto');
    const order = await expectStatus(await request('/orders', {
      token: registered.token, method: 'POST', body: { project_id: project.id, stage: 'planejamento' }
    }), 201, 'Ordem de produção');

    const material = await expectStatus(await request('/materials', {
      token: registered.token, method: 'POST',
      body: { name: 'MDF CI', unit: 'chapa', quantity: 5, minimum_quantity: 1, unit_cost: 180 }
    }), 201, 'Cadastro de material');
    await expectStatus(await request('/stock/movement', {
      token: registered.token, method: 'POST',
      body: { material_id: material.id, movement_type: 'entrada', quantity: 2, reason: 'Teste CI' }
    }), 201, 'Movimentação de estoque');

    await expectStatus(await request('/finance', {
      token: registered.token, method: 'POST',
      body: { description: 'Sinal do projeto', transaction_type: 'receita', amount: 1000, project_id: project.id }
    }), 201, 'Lançamento financeiro');

    await expectStatus(await request('/engineering/parts', {
      token: registered.token, method: 'POST',
      body: { project_id: project.id, material_id: material.id, name: 'Lateral', length_mm: 720, width_mm: 560, thickness_mm: 18, quantity: 2 }
    }), 201, 'Ficha técnica');

    const offcut = await expectStatus(await request('/offcuts', {
      token: registered.token, method: 'POST',
      body: { material_id: material.id, label: 'Retalho CI', length_mm: 500, width_mm: 300, thickness_mm: 18 }
    }), 201, 'Banco de retalhos');
    await expectStatus(await request(`/offcuts/${offcut.id}`, {
      token: registered.token, method: 'PATCH', body: { status: 'reservado' }
    }), 200, 'Atualização de retalho');

    const started = new Date();
    const ended = new Date(started.getTime() + 60000);
    await expectStatus(await request('/time-entries', {
      token: registered.token, method: 'POST',
      body: { project_id: project.id, employee_name: 'Operador CI', operation: 'Corte', started_at: started.toISOString(), ended_at: ended.toISOString() }
    }), 201, 'Apontamento de tempo');
    await expectStatus(await request(`/orders/${order.id}/stage`, {
      token: registered.token, method: 'PATCH', body: { stage: 'corte' }
    }), 200, 'Avanço de produção');

    const plan = await expectStatus(await request('/purchasing/plan?project_id='+project.id, { token: registered.token }), 200, 'Planejamento de compra inteligente');
    assert.equal(plan.summary.pieces, 2, 'Planejador não considerou a quantidade de peças da ficha técnica.');
    assert.equal(plan.summary.allocated, 0, 'Não deveria encaixar sem dimensões de chapa ou retalho compatível.');

    for (const path of ['/customers', '/projects', '/orders', '/materials', '/finance', '/stock/movements', '/engineering/parts', '/offcuts', '/time-entries', '/production/metrics']) {
      await expectStatus(await request(path, { token: registered.token }), 200, `Leitura ${path}`);
    }

    const second = await expectStatus(await request('/auth/register', {
      method: 'POST',
      body: { company: 'Outra empresa CI', name: 'Outro admin', email: `other-${Date.now()}@madevix.test`, password: 'Senha-forte-123' }
    }), 201, 'Cadastro de segunda empresa');
    const isolated = await expectStatus(await request('/customers', { token: second.token }), 200, 'Isolamento entre empresas');
    assert.equal(isolated.length, 0, 'Uma empresa conseguiu visualizar dados de outra empresa.');

    const badPayload = await request('/auth/register', { method: 'POST', body: { company: 123, name: null, email: 'x', password: '123' } });
    assert.equal(badPayload.status, 400, 'Payload inválido deveria retornar HTTP 400.');

    console.log('Smoke test concluído: autenticação, dashboard, cadastros, produção, estoque, financeiro, módulos industriais e isolamento multiempresa.');
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    if (server && server.exitCode === null) server.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
