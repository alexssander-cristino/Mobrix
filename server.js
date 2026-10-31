require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();

const jwtSecret = process.env.JWT_SECRET?.trim();
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET ausente ou muito curta. Configure no .env uma chave aleatória com pelo menos 32 caracteres.');
}

// Fail fast with an actionable message instead of allowing every API request
// to fail later with a PostgreSQL SCRAM password error.
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL não foi definida. Crie o arquivo .env na raiz do projeto e configure a conexão PostgreSQL.');
}

let databaseConnection;
try {
  databaseConnection = new URL(databaseUrl);
} catch {
  throw new Error('DATABASE_URL inválida. Use o formato postgresql://USUARIO:SENHA@HOST:5432/BANCO.');
}

if (!['postgres:', 'postgresql:'].includes(databaseConnection.protocol)) {
  throw new Error('DATABASE_URL deve usar o protocolo postgres:// ou postgresql://.');
}
if (!databaseConnection.username || !databaseConnection.password) {
  throw new Error('DATABASE_URL precisa conter usuário e senha. Codifique caracteres especiais da senha para URL (ex.: @ vira %40 e # vira %23).');
}

const pool = new Pool({
  connectionString: databaseUrl,
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
const signToken = user => jwt.sign({ sub: user.id, companyId: user.company_id, role: user.role }, jwtSecret, { expiresIn: '7d' });

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Sessão expirada ou inválida.' });
  }

  try {
    const result = await pool.query('SELECT id, company_id, name, email, role FROM users WHERE id=$1 AND company_id=$2 AND active=TRUE', [payload.sub, payload.companyId]);
    if (!result.rowCount) return res.status(401).json({ error: 'Sessão inválida.' });
    req.user = result.rows[0];
    return next();
  } catch (error) {
    return next(error);
  }
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  const requiredTables = ['companies','users','customers','materials','projects','production_orders','stock_movements','finance_transactions','project_parts','offcuts','time_entries','production_stage_logs'];
  const result = await pool.query(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])',
    ['public', requiredTables]
  );
  const found = new Set(result.rows.map(row => row.table_name));
  const missingTables = requiredTables.filter(table => !found.has(table));
  if (missingTables.length) {
    return res.status(503).json({
      ok: false,
      database: 'connected',
      service: 'madevix-api',
      missingTables,
      error: 'Banco conectado, mas a estrutura do MADEVIX está incompleta. Execute npm run db:setup.'
    });
  }
  res.json({ ok: true, database: 'connected', service: 'madevix-api' });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { company, name, email, password } = req.body || {};
  if ([company, name, email].some(value => typeof value !== 'string' || !value.trim()) ||
      typeof password !== 'string' || password.length < 8 || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Informe empresa, nome, e-mail válido e senha com pelo menos 8 caracteres.' });
  }
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
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password)
    return res.status(400).json({ error: 'Informe e-mail e senha válidos.' });
  const result = await pool.query('SELECT id,company_id,name,email,password_hash,role FROM users WHERE email=LOWER($1) AND active=TRUE ORDER BY created_at', [email.trim()]);
  let user = null;
  for (const candidate of result.rows) {
    if (await bcrypt.compare(password, candidate.password_hash)) { user = candidate; break; }
  }
  if (!user) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
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
  materials: { table: 'materials', fields: ['name','category','unit','quantity','minimum_quantity','unit_cost','supplier','sheet_length_mm','sheet_width_mm','sheet_thickness_mm'], required: ['name'], order: 'name ASC' },
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


/* MADEVIX 2.0 — módulos industriais (migração 002). */
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


app.get('/api/purchasing/plan',auth,asyncRoute(async(req,res)=>{
 const projectId=String(req.query.project_id||''),company=req.user.company_id;
 if(!projectId)return res.status(400).json({error:'Selecione um projeto.'});
 const [project,parts,materials,offcuts]=await Promise.all([
  pool.query('SELECT id,title FROM projects WHERE id=$1 AND company_id=$2',[projectId,company]),
  pool.query('SELECT pp.*,m.name material_name FROM project_parts pp LEFT JOIN materials m ON m.id=pp.material_id AND m.company_id=pp.company_id WHERE pp.company_id=$1 AND pp.project_id=$2 ORDER BY pp.length_mm*pp.width_mm DESC',[company,projectId]),
  pool.query('SELECT * FROM materials WHERE company_id=$1',[company]),
  pool.query("SELECT * FROM offcuts WHERE company_id=$1 AND status='disponivel' ORDER BY length_mm*width_mm DESC",[company])
 ]);
 if(!project.rowCount)return res.status(404).json({error:'Projeto não encontrado.'});
 const map=new Map(materials.rows.map(m=>[m.id,m])),groups=new Map();
 for(const p of parts.rows){if(!p.material_id)continue;const a=groups.get(p.material_id)||[];for(let i=0;i<Number(p.quantity);i++)a.push({name:p.name,l:+p.length_mm,w:+p.width_mm,t:+p.thickness_mm,grain:p.grain_direction});groups.set(p.material_id,a)}
 const output=[];
 for(const [id,pieces] of groups){
  const m=map.get(id);if(!m)continue;
  const sources=offcuts.rows.filter(o=>o.material_id===id&&Math.abs(+o.thickness_mm-pieces[0].t)<.01).map(o=>({kind:'retalho',label:o.label,free:[{w:+o.length_mm,h:+o.width_mm}]}));
  const sl=+m.sheet_length_mm||0,sw=+m.sheet_width_mm||0;
  if(sl&&sw&&Math.abs((+m.sheet_thickness_mm||0)-pieces[0].t)<0.01&&String(m.unit).toLowerCase().includes('chap'))for(let i=0;i<Math.floor(+m.quantity||0);i++)sources.push({kind:'chapa',label:m.name+' · chapa '+(i+1),free:[{w:sl,h:sw}]});
  const used=[],missing=[];
  for(const p of pieces){let best=null;for(const s of sources)for(let i=0;i<s.free.length;i++){const f=s.free[i],normal=p.l<=f.w&&p.w<=f.h,rot=p.grain==='livre'&&p.w<=f.w&&p.l<=f.h;if(normal||rot){const waste=f.w*f.h-p.l*p.w;if(!best||waste<best.waste)best={s,i,f,rot,waste}}}
   if(!best){missing.push(p);continue}
   const {s,i,f,rot}=best,w=rot?p.w:p.l,h=rot?p.l:p.w;s.free.splice(i,1);if(f.w-w>0&&h>0)s.free.push({w:f.w-w,h});if(f.h-h>0&&f.w>0)s.free.push({w:f.w,h:f.h-h});used.push({piece:p.name,dimensions:p.l+' × '+p.w+' mm',source:s.label,kind:s.kind});
  }
  const sourceNames=[...new Set(used.map(x=>x.source))],usedOffcuts=sourceNames.filter(n=>sources.some(s=>s.label===n&&s.kind==='retalho')).length,usedSheets=sourceNames.filter(n=>sources.some(s=>s.label===n&&s.kind==='chapa')).length;
  const area=missing.reduce((n,p)=>n+p.l*p.w,0),sheetArea=sl*sw,sheetConfigured=!!sheetArea&&Math.abs((+m.sheet_thickness_mm||0)-pieces[0].t)<0.01&&String(m.unit).toLowerCase().includes('chap'),sheets=sheetConfigured?Math.ceil(area/sheetArea):null;
  output.push({material_id:id,material:m.name,required:pieces.length,allocated:used.length,missing:missing.length,usedOffcuts,usedSheets,purchaseSheets:sheetArea?sheets:null,estimatedPurchase:sheetArea?sheets*(+m.unit_cost||0):null,sheetConfigured,sheet:sheetConfigured?sl+' × '+sw+' × '+m.sheet_thickness_mm+' mm':'Dimensões/espessura não configuradas',assigned:used,unallocated:missing.map(p=>({name:p.name,dimensions:p.l+' × '+p.w+' mm'}))});
 }
 const unlinked=parts.rows.filter(p=>!p.material_id).map(p=>p.name);
 res.json({project:project.rows[0],materials:output,unlinkedParts:unlinked,summary:{pieces:output.reduce((n,x)=>n+x.required,0),allocated:output.reduce((n,x)=>n+x.allocated,0),missing:output.reduce((n,x)=>n+x.missing,0),purchaseSheets:output.reduce((n,x)=>n+(x.purchaseSheets||0),0),estimatedPurchase:output.reduce((n,x)=>n+(x.estimatedPurchase||0),0)}});
}));


/* Visão 360º do projeto: consolida os módulos vinculados em uma única consulta. */
app.get('/api/projects/:id/overview',auth,asyncRoute(async(req,res)=>{
 const company=req.user.company_id,id=req.params.id;
 const [project,orders,parts,finance,time,materials,offcuts]=await Promise.all([
  pool.query('SELECT p.*,c.name customer_name,c.phone customer_phone,c.email customer_email,c.address customer_address FROM projects p LEFT JOIN customers c ON c.id=p.customer_id AND c.company_id=p.company_id WHERE p.id=$1 AND p.company_id=$2',[id,company]),
  pool.query('SELECT * FROM production_orders WHERE project_id=$1 AND company_id=$2 ORDER BY created_at DESC',[id,company]),
  pool.query('SELECT pp.*,m.name material_name,m.unit,m.quantity stock_quantity,m.unit_cost FROM project_parts pp LEFT JOIN materials m ON m.id=pp.material_id AND m.company_id=pp.company_id WHERE pp.project_id=$1 AND pp.company_id=$2 ORDER BY pp.created_at',[id,company]),
  pool.query('SELECT * FROM finance_transactions WHERE project_id=$1 AND company_id=$2 ORDER BY due_date NULLS LAST,created_at DESC',[id,company]),
  pool.query('SELECT * FROM time_entries WHERE project_id=$1 AND company_id=$2 ORDER BY started_at DESC LIMIT 100',[id,company]),
  pool.query(`SELECT m.id,m.name,m.unit,m.quantity,m.minimum_quantity,m.unit_cost,COALESCE(SUM(pp.quantity),0)::int AS planned_units FROM materials m LEFT JOIN project_parts pp ON pp.material_id=m.id AND pp.project_id=$2 AND pp.company_id=m.company_id WHERE m.company_id=$1 GROUP BY m.id ORDER BY m.name`,[company,id]),
  pool.query("SELECT COUNT(*)::int total FROM offcuts WHERE company_id=$1 AND status='disponivel'",[company])
 ]);
 if(!project.rowCount)return res.status(404).json({error:'Projeto não encontrado.'});
 const transactions=finance.rows,paid=transactions.filter(x=>x.paid_at),income=paid.filter(x=>x.transaction_type==='receita').reduce((n,x)=>n+Number(x.amount),0),expenses=paid.filter(x=>x.transaction_type==='despesa').reduce((n,x)=>n+Number(x.amount),0);
 res.json({project:project.rows[0],orders:orders.rows,parts:parts.rows,finance:transactions,timeEntries:time.rows,materials:materials.rows,availableOffcuts:offcuts.rows[0].total,financial:{income,expenses,result:income-expenses,receivables:transactions.filter(x=>x.transaction_type==='receita'&&!x.paid_at).reduce((n,x)=>n+Number(x.amount),0),payables:transactions.filter(x=>x.transaction_type==='despesa'&&!x.paid_at).reduce((n,x)=>n+Number(x.amount),0)}});
}));

/* Aprovação comercial cria a ordem operacional uma única vez, sem lançar recebimento fictício. */
app.post('/api/projects/:id/approve',auth,asyncRoute(async(req,res)=>{
 const client=await pool.connect(),company=req.user.company_id,id=req.params.id;
 try{
  await client.query('BEGIN');
  const p=await client.query('SELECT * FROM projects WHERE id=$1 AND company_id=$2 FOR UPDATE',[id,company]);
  if(!p.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Projeto não encontrado.'});}
  if(['cancelado','concluido'].includes(p.rows[0].status)){await client.query('ROLLBACK');return res.status(409).json({error:'Projetos concluídos ou cancelados não podem ser aprovados para produção.'});}
  let order=await client.query('SELECT * FROM production_orders WHERE project_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1',[id,company]);
  const created=!order.rowCount;
  if(created){
   order=await client.query("INSERT INTO production_orders(company_id,project_id,stage,priority,due_date,notes) VALUES($1,$2,'planejamento','normal',$3,'Criada automaticamente na aprovação do projeto.') RETURNING *",[company,id,p.rows[0].deadline]);
   await client.query("INSERT INTO production_stage_logs(company_id,order_id,from_stage,to_stage,changed_by,notes) VALUES($1,$2,NULL,'planejamento',$3,'Ordem criada pela aprovação comercial.')",[company,order.rows[0].id,req.user.id]);
  }
  const updated=await client.query("UPDATE projects SET status='aprovado' WHERE id=$1 AND company_id=$2 RETURNING *",[id,company]);
  await client.query('COMMIT');
  res.json({project:updated.rows[0],order:order.rows[0],created});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
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
    const updated=await client.query("UPDATE production_orders SET stage=$1::varchar,started_at=CASE WHEN $1::varchar <> 'planejamento' AND started_at IS NULL THEN NOW() ELSE started_at END WHERE id=$2 AND company_id=$3 RETURNING *",[stage,req.params.id,req.user.company_id]);
    await client.query('INSERT INTO production_stage_logs(company_id,order_id,from_stage,to_stage,changed_by,notes) VALUES($1,$2,$3,$4,$5,$6)',[req.user.company_id,req.params.id,current.rows[0].stage,stage,req.user.id,req.body.notes||null]);
    await client.query('COMMIT');res.json(updated.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));


app.use((err, _req, res, _next) => {
  console.error('[MADEVIX API]', err);
  const knownErrors = {
    '23503': [400, 'A operação referencia um registro inexistente ou pertencente a outra empresa.'],
    '23505': [409, 'Já existe um registro com esses dados.'],
    '23514': [400, 'Um dos valores informados não atende às regras do cadastro.'],
    '22P02': [400, 'Um dos valores informados possui formato inválido.'],
    '22007': [400, 'Uma data informada é inválida.']
  };
  const mapped = knownErrors[err.code];
  const malformedJson = err instanceof SyntaxError && err.status === 400 && 'body' in err;
  const status = malformedJson ? 400 : (mapped?.[0] || 500);
  const message = malformedJson ? 'O corpo da requisição contém JSON inválido.' : (mapped?.[1] || (process.env.NODE_ENV === 'production' ? 'Erro interno do servidor.' : err.message));
  res.status(status).json({ error: message, ...(process.env.NODE_ENV !== 'production' && err.code ? { code: err.code } : {}) });
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`MADEVIX API running on port ${port}`));
