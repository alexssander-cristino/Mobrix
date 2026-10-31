require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const signToken = user => jwt.sign({ sub: user.id, companyId: user.company_id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT id, company_id, name, email, role FROM users WHERE id=$1 AND company_id=$2 AND active=TRUE', [payload.sub, payload.companyId]);
    if (!result.rowCount) return res.status(401).json({ error: 'Sessão inválida.' });
    req.user = result.rows[0];
    next();
  } catch { return res.status(401).json({ error: 'Sessão expirada ou inválida.' }); }
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, database: 'connected', service: 'mobrix-api' });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { company, name, email, password } = req.body || {};
  if (!company?.trim() || !name?.trim() || !email?.trim() || !password || password.length < 8)
    return res.status(400).json({ error: 'Informe empresa, nome, e-mail e senha com pelo menos 8 caracteres.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query('INSERT INTO companies(name) VALUES($1) RETURNING id', [company.trim()]);
    const hash = await bcrypt.hash(password, 12);
    const u = await client.query('INSERT INTO users(company_id,name,email,password_hash,role) VALUES($1,$2,LOWER($3),$4,$5) RETURNING id,company_id,name,email,role', [c.rows[0].id, name.trim(), email.trim(), hash, 'admin']);
    await client.query('COMMIT');
    res.status(201).json({ token: signToken(u.rows[0]), user: u.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado nesta empresa.' });
    throw e;
  } finally { client.release(); }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  const result = await pool.query('SELECT id,company_id,name,email,password_hash,role FROM users WHERE email=LOWER($1) AND active=TRUE ORDER BY created_at LIMIT 1', [email.trim()]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  delete user.password_hash;
  res.json({ token: signToken(user), user });
}));

app.get('/api/me', auth, asyncRoute(async (req, res) => {
  const c = await pool.query('SELECT name FROM companies WHERE id=$1', [req.user.company_id]);
  res.json({ user: req.user, company: c.rows[0] || null });
}));

app.get('/api/dashboard', auth, asyncRoute(async (req, res) => {
  const id = req.user.company_id;
  const [projects, orders, stock, finance, recent] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status NOT IN ('concluido','cancelado'))::int AS active, COALESCE(SUM(sale_price) FILTER (WHERE status NOT IN ('concluido','cancelado')),0)::numeric AS pipeline FROM projects WHERE company_id=$1", [id]),
    pool.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE stage NOT IN ('concluido','cancelado'))::int AS active FROM production_orders WHERE company_id=$1", [id]),
    pool.query('SELECT COUNT(*) FILTER (WHERE quantity <= minimum_quantity)::int AS low_stock FROM materials WHERE company_id=$1', [id]),
    pool.query("SELECT COALESCE(SUM(amount) FILTER (WHERE transaction_type='receita' AND paid_at IS NOT NULL),0)::numeric AS income, COALESCE(SUM(amount) FILTER (WHERE transaction_type='despesa' AND paid_at IS NOT NULL),0)::numeric AS expenses FROM finance_transactions WHERE company_id=$1", [id]),
    pool.query('SELECT p.id,p.title,p.status,p.deadline,c.name AS customer FROM projects p LEFT JOIN customers c ON c.id=p.customer_id WHERE p.company_id=$1 ORDER BY p.created_at DESC LIMIT 6', [id])
  ]);
  res.json({ projects: projects.rows[0], orders: orders.rows[0], lowStock: stock.rows[0].low_stock, finance: finance.rows[0], recent: recent.rows });
}));

const resources = {
  customers: { table: 'customers', fields: ['name','phone','email','document','address','notes'], required: ['name'], order: 'created_at DESC' },
  materials: { table: 'materials', fields: ['name','category','unit','quantity','minimum_quantity','unit_cost','supplier'], required: ['name'], order: 'name ASC' },
  projects: { table: 'projects', fields: ['customer_id','title','description','status','estimated_cost','sale_price','deadline'], required: ['title'], order: 'created_at DESC' },
  orders: { table: 'production_orders', fields: ['project_id','stage','priority','due_date','notes'], required: ['project_id'], order: 'created_at DESC' },
  finance: { table: 'finance_transactions', fields: ['project_id','description','transaction_type','amount','due_date','paid_at'], required: ['description','transaction_type','amount'], order: 'created_at DESC' }
};

for (const [key, cfg] of Object.entries(resources)) {
  app.get('/api/' + key, auth, asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM ${cfg.table} WHERE company_id=$1 ORDER BY ${cfg.order}`, [req.user.company_id]);
    res.json(result.rows);
  }));
  app.post('/api/' + key, auth, asyncRoute(async (req, res) => {
    const body = req.body || {};
    for (const field of cfg.required) if (body[field] === undefined || body[field] === '') return res.status(400).json({ error: `Campo obrigatório: ${field}` });
    const fields = cfg.fields.filter(f => body[f] !== undefined);
    const values = fields.map(f => body[f] === '' ? null : body[f]);
    const columns = ['company_id', ...fields];
    const params = [req.user.company_id, ...values];
    const placeholders = params.map((_, i) => '$' + (i + 1));
    const result = await pool.query(`INSERT INTO ${cfg.table} (${columns.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`, params);
    res.status(201).json(result.rows[0]);
  }));
  app.patch('/api/' + key + '/:id', auth, asyncRoute(async (req, res) => {
    const fields = cfg.fields.filter(f => req.body?.[f] !== undefined);
    if (!fields.length) return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });
    const values = fields.map(f => req.body[f] === '' ? null : req.body[f]);
    const sets = fields.map((f, i) => `${f}=$${i + 1}`);
    values.push(req.params.id, req.user.company_id);
    const result = await pool.query(`UPDATE ${cfg.table} SET ${sets.join(',')} WHERE id=$${values.length - 1} AND company_id=$${values.length} RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ error: 'Registro não encontrado.' });
    res.json(result.rows[0]);
  }));
}

app.post('/api/stock/movement', auth, asyncRoute(async (req, res) => {
  const { material_id, movement_type, quantity, reason } = req.body || {};
  if (!material_id || !['entrada','saida','ajuste'].includes(movement_type) || !(Number(quantity) > 0))
    return res.status(400).json({ error: 'Dados de movimentação inválidos.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = await client.query('SELECT id,quantity FROM materials WHERE id=$1 AND company_id=$2 FOR UPDATE', [material_id, req.user.company_id]);
    if (!m.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Material não encontrado.' }); }
    const delta = movement_type === 'entrada' ? Number(quantity) : -Number(quantity);
    const next = movement_type === 'ajuste' ? Number(quantity) : Number(m.rows[0].quantity) + delta;
    if (next < 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Estoque insuficiente para esta saída.' }); }
    await client.query('UPDATE materials SET quantity=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3', [next, material_id, req.user.company_id]);
    const movement = await client.query('INSERT INTO stock_movements(company_id,material_id,movement_type,quantity,reason) VALUES($1,$2,$3,$4,$5) RETURNING *', [req.user.company_id, material_id, movement_type, quantity, reason || null]);
    await client.query('COMMIT');
    res.status(201).json(movement.rows[0]);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));


/* MOBRIX 2.0 — módulos industriais (migração 002). */
app.get('/api/engineering/parts', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT pp.*, p.title AS project_title, m.name AS material_name
    FROM project_parts pp
    JOIN projects p ON p.id=pp.project_id AND p.company_id=pp.company_id
    LEFT JOIN materials m ON m.id=pp.material_id AND m.company_id=pp.company_id
    WHERE pp.company_id=$1 ORDER BY pp.created_at DESC
  `, [req.user.company_id]);
  res.json(result.rows);
}));

app.post('/api/engineering/parts', auth, asyncRoute(async (req, res) => {
  const b=req.body||{};
  const length=Number(b.length_mm), width=Number(b.width_mm), thickness=Number(b.thickness_mm), quantity=Number(b.quantity||1);
  if(!b.project_id || !String(b.name||'').trim() || !Number.isInteger(length) || length<=0 || !Number.isInteger(width) || width<=0 || !(thickness>0) || !Number.isInteger(quantity) || quantity<=0)
    return res.status(400).json({error:'Informe projeto, nome, medidas válidas e quantidade inteira maior que zero.'});
  const company=req.user.company_id;
  const project=await pool.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2',[b.project_id,company]);
  if(!project.rowCount)return res.status(400).json({error:'Projeto inválido para esta empresa.'});
  if(b.material_id){const material=await pool.query('SELECT id FROM materials WHERE id=$1 AND company_id=$2',[b.material_id,company]);if(!material.rowCount)return res.status(400).json({error:'Material inválido para esta empresa.'});}
  const result=await pool.query(`INSERT INTO project_parts(company_id,project_id,material_id,name,length_mm,width_mm,thickness_mm,quantity,grain_direction,edge_banding,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [company,b.project_id||null,b.material_id||null,String(b.name).trim(),length,width,thickness,quantity,['livre','comprimento','largura'].includes(b.grain_direction)?b.grain_direction:'livre',b.edge_banding||null,b.notes||null]);
  res.status(201).json(result.rows[0]);
}));

app.delete('/api/engineering/parts/:id', auth, asyncRoute(async (req,res)=>{
  const result=await pool.query('DELETE FROM project_parts WHERE id=$1 AND company_id=$2 RETURNING id',[req.params.id,req.user.company_id]);
  if(!result.rowCount)return res.status(404).json({error:'Peça não encontrada.'});
  res.status(204).end();
}));

app.get('/api/offcuts', auth, asyncRoute(async(req,res)=>{
  const result=await pool.query(`SELECT o.*,m.name AS material_name FROM offcuts o LEFT JOIN materials m ON m.id=o.material_id AND m.company_id=o.company_id WHERE o.company_id=$1 ORDER BY CASE o.status WHEN 'disponivel' THEN 0 WHEN 'reservado' THEN 1 ELSE 2 END,o.created_at DESC`,[req.user.company_id]);
  res.json(result.rows);
}));

app.post('/api/offcuts', auth, asyncRoute(async(req,res)=>{
  const b=req.body||{}, l=Number(b.length_mm), w=Number(b.width_mm), t=Number(b.thickness_mm);
  if(!String(b.label||'').trim()||!Number.isInteger(l)||l<=0||!Number.isInteger(w)||w<=0||!(t>0))return res.status(400).json({error:'Informe identificação e dimensões válidas do retalho.'});
  if(b.material_id){const m=await pool.query('SELECT id FROM materials WHERE id=$1 AND company_id=$2',[b.material_id,req.user.company_id]);if(!m.rowCount)return res.status(400).json({error:'Material inválido.'});}
  if(b.source_project_id){const p=await pool.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2',[b.source_project_id,req.user.company_id]);if(!p.rowCount)return res.status(400).json({error:'Projeto de origem inválido.'});}
  const result=await pool.query(`INSERT INTO offcuts(company_id,material_id,label,length_mm,width_mm,thickness_mm,grain_direction,source_project_id,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[req.user.company_id,b.material_id||null,String(b.label).trim(),l,w,t,['livre','comprimento','largura'].includes(b.grain_direction)?b.grain_direction:'livre',b.source_project_id||null,b.notes||null]);
  res.status(201).json(result.rows[0]);
}));

app.patch('/api/offcuts/:id', auth, asyncRoute(async(req,res)=>{
  const allowed=['disponivel','reservado','consumido','descartado'],status=req.body?.status;
  if(!allowed.includes(status))return res.status(400).json({error:'Situação de retalho inválida.'});
  const result=await pool.query('UPDATE offcuts SET status=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3 RETURNING *',[status,req.params.id,req.user.company_id]);
  if(!result.rowCount)return res.status(404).json({error:'Retalho não encontrado.'});
  res.json(result.rows[0]);
}));

app.get('/api/time-entries', auth, asyncRoute(async(req,res)=>{
  const result=await pool.query(`SELECT t.*,p.title AS project_title FROM time_entries t JOIN projects p ON p.id=t.project_id AND p.company_id=t.company_id WHERE t.company_id=$1 ORDER BY t.started_at DESC LIMIT 300`,[req.user.company_id]);
  res.json(result.rows);
}));

app.post('/api/time-entries', auth, asyncRoute(async(req,res)=>{
  const b=req.body||{},start=new Date(b.started_at),end=b.ended_at?new Date(b.ended_at):null;
  if(!b.project_id||!String(b.employee_name||'').trim()||!String(b.operation||'').trim()||Number.isNaN(start.getTime())||(end&&Number.isNaN(end.getTime()))||(end&&end<start))return res.status(400).json({error:'Preencha projeto, colaborador, operação e horários válidos.'});
  const company=req.user.company_id;
  const p=await pool.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2',[b.project_id,company]);if(!p.rowCount)return res.status(400).json({error:'Projeto inválido.'});
  if(b.order_id){const o=await pool.query('SELECT id FROM production_orders WHERE id=$1 AND company_id=$2',[b.order_id,company]);if(!o.rowCount)return res.status(400).json({error:'Ordem de produção inválida.'});}
  const minutes=end?Math.max(0,Math.round((end-start)/60000)):null;
  const result=await pool.query(`INSERT INTO time_entries(company_id,project_id,order_id,employee_name,operation,started_at,ended_at,duration_minutes,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[company,b.project_id,b.order_id||null,String(b.employee_name).trim(),String(b.operation).trim(),start.toISOString(),end?.toISOString()||null,minutes,b.notes||null]);
  res.status(201).json(result.rows[0]);
}));

app.get('/api/stock/movements', auth, asyncRoute(async(req,res)=>{
  const result=await pool.query(`SELECT sm.*,m.name AS material_name,m.unit FROM stock_movements sm JOIN materials m ON m.id=sm.material_id AND m.company_id=sm.company_id WHERE sm.company_id=$1 ORDER BY sm.created_at DESC LIMIT 300`,[req.user.company_id]);
  res.json(result.rows);
}));

app.get('/api/production/metrics', auth, asyncRoute(async(req,res)=>{
  const id=req.user.company_id;
  const [stages,late,work,offcuts]=await Promise.all([
    pool.query(`SELECT stage,COUNT(*)::int AS total FROM production_orders WHERE company_id=$1 AND stage NOT IN ('concluido','cancelado') GROUP BY stage ORDER BY stage`,[id]),
    pool.query(`SELECT COUNT(*)::int AS total FROM production_orders WHERE company_id=$1 AND stage NOT IN ('concluido','cancelado') AND due_date<CURRENT_DATE`,[id]),
    pool.query(`SELECT COALESCE(SUM(duration_minutes),0)::int AS minutes,COUNT(*)::int AS entries FROM time_entries WHERE company_id=$1 AND started_at>=date_trunc('month',CURRENT_DATE)`,[id]),
    pool.query(`SELECT COUNT(*) FILTER(WHERE status='disponivel')::int AS available,COALESCE(SUM(length_mm::numeric*width_mm::numeric)/1000000,0)::numeric AS area_m2 FROM offcuts WHERE company_id=$1`,[id])
  ]);
  res.json({stages:stages.rows,lateOrders:late.rows[0].total,work:work.rows[0],offcuts:offcuts.rows[0]});
}));

app.patch('/api/orders/:id/stage', auth, asyncRoute(async(req,res)=>{
  const allowed=['planejamento','corte','usinagem','montagem','acabamento','instalacao','concluido','pausado','cancelado'];
  const stage=req.body?.stage;
  if(!allowed.includes(stage))return res.status(400).json({error:'Etapa de produção inválida.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=await client.query('SELECT id,stage FROM production_orders WHERE id=$1 AND company_id=$2 FOR UPDATE',[req.params.id,req.user.company_id]);
    if(!current.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Ordem não encontrada.'});}
    const updated=await client.query("UPDATE production_orders SET stage=$1,started_at=CASE WHEN $1 <> 'planejamento' AND started_at IS NULL THEN NOW() ELSE started_at END WHERE id=$2 AND company_id=$3 RETURNING *",[stage,req.params.id,req.user.company_id]);
    await client.query('INSERT INTO production_stage_logs(company_id,order_id,from_stage,to_stage,changed_by,notes) VALUES($1,$2,$3,$4,$5,$6)',[req.user.company_id,req.params.id,current.rows[0].stage,stage,req.user.id,req.body.notes||null]);
    await client.query('COMMIT');res.json(updated.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));


app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Erro interno do servidor.' : err.message });
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`MOBRIX API running on port ${port}`));
