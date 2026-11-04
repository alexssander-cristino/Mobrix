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

    const initialOverview = await expectStatus(await request('/projects/'+project.id+'/overview',{token:registered.token}),200,'Visão integrada do projeto');
    assert.equal(initialOverview.project.customer_name,'Cliente de teste','Projeto não vinculou corretamente o cliente.');
    const approved = await expectStatus(await request('/projects/'+project.id+'/approve',{token:registered.token,method:'POST',body:{}}),200,'Aprovação integrada');
    assert.equal(approved.order?.id,order.id,'Aprovação deveria reutilizar a ordem de produção já vinculada.');
    const approvedAgain = await expectStatus(await request('/projects/'+project.id+'/approve',{token:registered.token,method:'POST',body:{}}),200,'Aprovação idempotente');
    assert.equal(approvedAgain.order.id,approved.order.id,'Aprovação duplicou a ordem de produção.');

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

    await expectStatus(await request('/production/factory', { token: registered.token }), 200, 'Painel da fábrica');
    await expectStatus(await request('/production/planning', { token: registered.token }), 200, 'Planejamento inteligente');
    await expectStatus(await request('/intelligence/overview', { token: registered.token }), 200, 'Mobrix Intelligence');
    await expectStatus(await request('/settings/hourly-cost', {
      token: registered.token, method: 'PATCH', body: { hourly_cost: 42.5 }
    }), 200, 'Custo interno por hora');

    const inspection = await expectStatus(await request('/quality/checks', {
      token: registered.token, method: 'POST',
      body: { project_id: project.id, order_id: order.id, stage: 'Corte', result: 'aprovado',
        checklist: [{ item: 'Medidas conferidas', ok: true }, { item: 'Corte sem lascas', ok: true }] }
    }), 201, 'Inspeção de qualidade');
    assert.equal(inspection.checklist.length, 2, 'Checklist de qualidade não foi persistido.');
    const incompleteInspection = await request('/quality/checks', {
      token: registered.token, method: 'POST',
      body: { project_id: project.id, order_id: order.id, stage: 'Montagem', result: 'aprovado',
        checklist: [{ item: 'Ferragens conferidas', ok: false }] }
    });
    assert.equal(incompleteInspection.status, 400, 'Inspeção incompleta não deveria ser aprovada.');

    await expectStatus(await request('/quality/checks', { token: registered.token }), 200, 'Histórico de qualidade');

    const portal = await expectStatus(await request('/projects/'+project.id+'/portal', {
      token: registered.token, method: 'POST', body: {}
    }), 201, 'Criação do portal do cliente');
    assert.ok(portal.url && portal.id, 'Portal não retornou link e identificador.');
    const portalToken = new URL(portal.url).pathname.split('/').pop();
    const portalData = await expectStatus(await request('/portal/'+portalToken), 200, 'Acesso público do portal');
    assert.ok(!('description' in portalData.project), 'Portal público não deve expor descrição interna.');
    await expectStatus(await request('/portal/links', { token: registered.token }), 200, 'Listagem de acessos do portal');


    // Intelligent Factory: 12 new capabilities and company scoping.
    const autopilot = await expectStatus(await request('/intelligent/autopilot', { token: registered.token }), 200, 'Mobrix Autopilot');
    assert.ok(Array.isArray(autopilot.actions), 'Autopilot deve retornar recomendações.');
    const machine = await expectStatus(await request('/studio/machines', {
      token: registered.token, method: 'POST',
      body: { name: 'Seccionadora CI', code: 'SEC-CI', area: 'Corte', maintenance_interval_hours: 500, operating_hours: 470 }
    }), 201, 'Cadastro de máquina para IoT');
    const reverse = await expectStatus(await request('/intelligent/reverse-engineering', {
      token: registered.token, method: 'POST',
      body: { title: 'Armário referência CI', image_url: 'https://example.com/cabinet.jpg', project_id: project.id, width_mm: 800, height_mm: 720, depth_mm: 550 }
    }), 201, 'Engenharia reversa assistida');
    await expectStatus(await request('/intelligent/reverse-engineering/'+reverse.id, {
      token: registered.token, method: 'PATCH', body: { status: 'approved' }
    }), 200, 'Aprovação da referência');
    const showroom = await expectStatus(await request('/intelligent/showroom', {
      token: registered.token, method: 'POST',
      body: { project_id: project.id, title: 'Showroom CI', model_url: 'https://example.com/model.glb', config: { accent: '#aa2222' } }
    }), 201, 'Criação do showroom');
    const showroomToken = showroom.share_url.split('/').pop();
    await expectStatus(await request('/intelligent/showroom/public/'+showroomToken), 200, 'Acesso público ao showroom');
    const simulation = await expectStatus(await request('/intelligent/simulations', {
      token: registered.token, method: 'POST', body: { title: 'Cenário CI', daily_hours: 8, minutes_per_order: 120, working_days: 5 }
    }), 201, 'Simulador de fábrica');
    assert.ok(simulation.estimated_hours >= 0, 'Simulação deve calcular horas.');
    const scan = await expectStatus(await request('/intelligent/inventory-scans', {
      token: registered.token, method: 'POST',
      body: { photo_url: 'https://example.com/stock.jpg', items: [{ material_id: material.id, quantity: 2 }] }
    }), 201, 'Conferência de estoque por imagem');
    await expectStatus(await request('/intelligent/inventory-scans/'+scan.id+'/confirm', {
      token: registered.token, method: 'POST', body: {}
    }), 200, 'Confirmação da entrada por conferência');
    const guide = await expectStatus(await request('/intelligent/assembly', {
      token: registered.token, method: 'POST',
      body: { project_id: project.id, title: 'Montagem CI', steps: [{ title: 'Separar peças' }, { title: 'Instalar ferragens' }] }
    }), 201, 'Guia de montagem');
    await expectStatus(await request('/intelligent/assembly/'+guide.id+'/steps', {
      token: registered.token, method: 'PATCH', body: { steps: guide.steps.map((step, i) => ({ ...step, done: i === 0 })) }
    }), 200, 'Atualização do progresso da montagem');
    const device = await expectStatus(await request('/intelligent/iot/devices', {
      token: registered.token, method: 'POST', body: { machine_id: machine.id, name: 'Sensor CI' }
    }), 201, 'Provisionamento IoT');
    const telemetryResponse = await fetch(base+'/intelligent/iot/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mobrix-Device-Token': device.device_token },
      body: JSON.stringify({ temperature_c: 31.5, vibration_mm_s: 1.2, power_kw: 2.1, runtime_hours: 471, state: 'operacional' })
    });
    assert.equal(telemetryResponse.status, 201, 'Ingestão IoT deve aceitar token válido.');
    await expectStatus(await request('/intelligent/iot/telemetry', { token: registered.token }), 200, 'Consulta de telemetria');
    await expectStatus(await request('/intelligent/collaboration/'+project.id, {
      token: registered.token, method: 'POST', body: { content: 'Projeto revisado pela equipe.' }
    }), 201, 'Comentário colaborativo');
    await expectStatus(await request('/intelligent/collaboration/'+project.id, { token: registered.token }), 200, 'Histórico colaborativo');
    await expectStatus(await request('/intelligent/history/'+project.id, {
      token: registered.token, method: 'POST', body: { event_type: 'maintenance', title: 'Ajuste de ferragens', details: { operator: 'Equipe CI' }, is_public: true }
    }), 201, 'Histórico vitalício');
    const passport = await expectStatus(await request('/studio/passports', {
      token: registered.token, method: 'POST', body: { project_id: project.id }
    }), 201, 'Passaporte para histórico público');
    const passportToken = passport.url.split('/').pop();
    const publicHistory = await expectStatus(await request('/intelligent/history/public/'+passportToken), 200, 'Histórico público do produto');
    assert.ok(publicHistory.some(event => event.title === 'Ajuste de ferragens'), 'Evento público deve aparecer no passaporte.');

    const second = await expectStatus(await request('/auth/register', {
      method: 'POST',
      body: { company: 'Outra empresa CI', name: 'Outro admin', email: `other-${Date.now()}@madevix.test`, password: 'Senha-forte-123' }
    }), 201, 'Cadastro de segunda empresa');
    const isolated = await expectStatus(await request('/customers', { token: second.token }), 200, 'Isolamento entre empresas');
    assert.equal(isolated.length, 0, 'Uma empresa conseguiu visualizar dados de outra empresa.');

    await expectStatus(await request('/portal/links', { token: second.token }), 200, 'Isolamento de links do portal');
    await expectStatus(await request('/portal/links/'+portal.id, {
      token: second.token, method: 'DELETE'
    }), 404, 'Bloqueio de revogação entre empresas');
    await expectStatus(await request('/portal/links/'+portal.id, {
      token: registered.token, method: 'DELETE'
    }), 200, 'Revogação de acesso do portal');
    await expectStatus(await request('/portal/'+portalToken), 404, 'Link revogado');

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
