const crypto = require('crypto');
const path = require('path');
module.exports = function registerWorkshopRoutes(app, deps) {
 const {pool,auth,asyncRoute}=deps;
 app.get('/api/intelligence/overview',auth,asyncRoute(async(req,res)=>{
  const company=req.user.company_id;
  const q=await Promise.all([
   pool.query('SELECT COALESCE(hourly_cost,0)::numeric AS hourly_cost FROM companies WHERE id=$1',[company]),
   pool.query("SELECT p.id,p.title,p.status,p.deadline,p.sale_price,p.estimated_cost,c.name AS customer_name, COALESCE(SUM(f.amount) FILTER(WHERE f.transaction_type='despesa' AND f.paid_at IS NOT NULL),0)::numeric AS paid_expenses, COALESCE(SUM(f.amount) FILTER(WHERE f.transaction_type='receita' AND f.paid_at IS NOT NULL),0)::numeric AS received, COALESCE((SELECT SUM(t.duration_minutes) FROM time_entries t WHERE t.project_id=p.id AND t.company_id=p.company_id),0)::int AS labor_minutes FROM projects p LEFT JOIN customers c ON c.id=p.customer_id AND c.company_id=p.company_id LEFT JOIN finance_transactions f ON f.project_id=p.id AND f.company_id=p.company_id WHERE p.company_id=$1 GROUP BY p.id,c.name ORDER BY p.created_at DESC",[company]),
   pool.query('SELECT COUNT(*) FILTER(WHERE quantity<=minimum_quantity)::int AS low_stock,COUNT(*)::int AS materials FROM materials WHERE company_id=$1',[company]),
   pool.query("SELECT supplier,COUNT(*)::int AS materials,AVG(unit_cost)::numeric AS average_cost FROM materials WHERE company_id=$1 AND NULLIF(BTRIM(supplier),'') IS NOT NULL GROUP BY supplier ORDER BY AVG(unit_cost),COUNT(*) DESC LIMIT 8",[company]),
   pool.query("SELECT COUNT(*)::int AS total FROM production_orders WHERE company_id=$1 AND stage NOT IN ('concluido','cancelado') AND due_date<CURRENT_DATE",[company]),
   pool.query("SELECT COALESCE(SUM(duration_minutes),0)::int AS minutes,COUNT(*)::int AS entries FROM time_entries WHERE company_id=$1 AND started_at>=date_trunc('month',CURRENT_DATE)",[company])
  ]);
  const hourly=Number(q[0].rows[0].hourly_cost||0);
  const projects=q[1].rows.map(p=>{
   const labor=Number(p.labor_minutes||0)/60*hourly;
   const paid=Number(p.paid_expenses||0);
   const actual=paid+labor;
   const cost=paid>0?actual:Number(p.estimated_cost||0);
   const sale=Number(p.sale_price||0);
   return {...p,labor_cost:labor,estimated_total_cost:cost,profit:sale-cost,margin_percent:sale>0?(sale-cost)/sale*100:0};
  });
  const active=projects.filter(p=>!['concluido','cancelado'].includes(p.status));
  const sales=active.reduce((n,p)=>n+Number(p.sale_price||0),0),cost=active.reduce((n,p)=>n+Number(p.estimated_total_cost||0),0),profit=sales-cost;
  res.json({hourlyCost:hourly,projects,stock:q[2].rows[0],suppliers:q[3].rows,overdueOrders:q[4].rows[0].total,work:q[5].rows[0],
   summary:{activeProjects:active.length,totalSales:sales,estimatedCost:cost,projectedProfit:profit,averageMargin:sales?profit/sales*100:0,lowMarginProjects:active.filter(p=>Number(p.margin_percent)<15).length}});
 }));
 app.patch('/api/settings/hourly-cost',auth,asyncRoute(async(req,res)=>{
  if(req.user.role!=='admin')return res.status(403).json({error:'Somente administradores podem alterar o custo por hora.'});
  const value=Number(req.body?.hourly_cost);
  if(!Number.isFinite(value)||value<0||value>100000)return res.status(400).json({error:'Informe um custo por hora válido.'});
  const r=await pool.query('UPDATE companies SET hourly_cost=$1 WHERE id=$2 RETURNING hourly_cost',[value,req.user.company_id]);
  res.json(r.rows[0]);
 }));
 app.get('/api/production/factory',auth,asyncRoute(async(req,res)=>{
  const company=req.user.company_id;
  const q=await Promise.all([
   pool.query("SELECT o.id,o.code,o.stage,o.priority,o.due_date,o.started_at,o.created_at,o.project_id,p.title AS project_title,c.name AS customer_name FROM production_orders o LEFT JOIN projects p ON p.id=o.project_id AND p.company_id=o.company_id LEFT JOIN customers c ON c.id=p.customer_id AND c.company_id=p.company_id WHERE o.company_id=$1 AND o.stage NOT IN ('concluido','cancelado') ORDER BY CASE o.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,o.due_date NULLS LAST,o.created_at",[company]),
   pool.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE result='reprovado')::int AS failed FROM quality_checks WHERE company_id=$1 AND created_at>=date_trunc('day',CURRENT_DATE)",[company]),
   pool.query('SELECT COUNT(*)::int AS total FROM time_entries WHERE company_id=$1 AND ended_at IS NULL',[company])
  ]);
  const lanes=['planejamento','corte','usinagem','montagem','acabamento','instalacao','pausado'];
  res.json({orders:q[0].rows,lanes:lanes.map(stage=>({stage,orders:q[0].rows.filter(o=>o.stage===stage)})),quality:q[1].rows[0],runningEntries:q[2].rows[0].total});
 }));
 app.get('/api/production/planning',auth,asyncRoute(async(req,res)=>{
  const r=await pool.query("SELECT o.id,o.code,o.stage,o.priority,o.due_date,p.title AS project_title,CASE WHEN o.due_date<CURRENT_DATE THEN 'atrasada' WHEN o.due_date<=CURRENT_DATE+3 THEN 'critica' WHEN o.due_date<=CURRENT_DATE+7 THEN 'proxima' ELSE 'normal' END AS risk,(CASE WHEN o.priority='urgente' THEN 100 WHEN o.priority='alta' THEN 60 ELSE 20 END + CASE WHEN o.due_date<CURRENT_DATE THEN 100 WHEN o.due_date<=CURRENT_DATE+3 THEN 70 WHEN o.due_date<=CURRENT_DATE+7 THEN 35 ELSE 0 END) AS planning_score FROM production_orders o LEFT JOIN projects p ON p.id=o.project_id AND p.company_id=o.company_id WHERE o.company_id=$1 AND o.stage NOT IN ('concluido','cancelado') ORDER BY planning_score DESC,o.due_date NULLS LAST",[req.user.company_id]);
  res.json(r.rows);
 }));
 app.get('/api/quality/checks',auth,asyncRoute(async(req,res)=>{
  const r=await pool.query('SELECT q.*,p.title AS project_title,o.code AS order_code,u.name AS inspector FROM quality_checks q JOIN projects p ON p.id=q.project_id AND p.company_id=q.company_id LEFT JOIN production_orders o ON o.id=q.order_id AND o.company_id=q.company_id LEFT JOIN users u ON u.id=q.checked_by WHERE q.company_id=$1 ORDER BY q.created_at DESC LIMIT 200',[req.user.company_id]);
  res.json(r.rows);
 }));
 app.post('/api/quality/checks',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{},company=req.user.company_id,projectId=String(b.project_id||''),stage=String(b.stage||'').trim();
  const result=['aprovado','reprovado','pendente'].includes(b.result)?b.result:'pendente';
  const checklist=Array.isArray(b.checklist)?b.checklist.slice(0,40).map(x=>({item:String(x.item||'').slice(0,120),ok:Boolean(x.ok)})):[];
  if(!projectId||!stage||!checklist.length)return res.status(400).json({error:'Informe projeto, etapa e ao menos um item de inspeção.'});
  if(result==='aprovado'&&checklist.some(item=>!item.ok))return res.status(400).json({error:'Não é possível aprovar uma inspeção com itens pendentes.'});
  const p=await pool.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2',[projectId,company]);
  if(!p.rowCount)return res.status(404).json({error:'Projeto não encontrado.'});
  const orderId=b.order_id||null;
  if(orderId){const o=await pool.query('SELECT id FROM production_orders WHERE id=$1 AND project_id=$2 AND company_id=$3',[orderId,projectId,company]);if(!o.rowCount)return res.status(400).json({error:'Ordem não pertence ao projeto selecionado.'});}
  const r=await pool.query("INSERT INTO quality_checks(company_id,project_id,order_id,stage,result,checklist,notes,checked_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *",[company,projectId,orderId,stage,result,JSON.stringify(checklist),String(b.notes||'').slice(0,2000)||null,req.user.id]);
  res.status(201).json(r.rows[0]);
 }));
 app.get('/api/portal/links',auth,asyncRoute(async(req,res)=>{
  const r=await pool.query('SELECT t.id,t.project_id,t.created_at,t.expires_at,t.revoked_at,p.title AS project_title FROM project_portal_tokens t JOIN projects p ON p.id=t.project_id AND p.company_id=t.company_id WHERE t.company_id=$1 ORDER BY t.created_at DESC LIMIT 100',[req.user.company_id]);
  res.json(r.rows);
 }));
 app.post('/api/projects/:id/portal',auth,asyncRoute(async(req,res)=>{
  const company=req.user.company_id,id=req.params.id;
  const p=await pool.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2',[id,company]);
  if(!p.rowCount)return res.status(404).json({error:'Projeto não encontrado.'});
  const token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex');
  const expires=new Date(Date.now()+30*24*60*60*1000);
  const saved=await pool.query('INSERT INTO project_portal_tokens(company_id,project_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at',[company,id,hash,expires,req.user.id]);
  const rawBase=process.env.PUBLIC_URL||req.protocol+'://'+req.get('host');
  const base=rawBase.endsWith('/')?rawBase.slice(0,-1):rawBase;
  res.status(201).json({...saved.rows[0],url:base+'/cliente/'+token});
 }));
 app.delete('/api/portal/links/:id',auth,asyncRoute(async(req,res)=>{
  const r=await pool.query('UPDATE project_portal_tokens SET revoked_at=NOW() WHERE id=$1 AND company_id=$2 AND revoked_at IS NULL RETURNING id',[req.params.id,req.user.company_id]);
  if(!r.rowCount)return res.status(404).json({error:'Link não encontrado ou já revogado.'});
  res.json({ok:true});
 }));
 app.get('/api/portal/:token',asyncRoute(async(req,res)=>{
  const token=String(req.params.token||'');
  if(token.length<30||token.length>100)return res.status(404).json({error:'Link inválido.'});
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  const r=await pool.query('SELECT p.title,p.status,p.deadline,c.name AS company_name FROM project_portal_tokens t JOIN projects p ON p.id=t.project_id AND p.company_id=t.company_id JOIN companies c ON c.id=t.company_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>NOW()',[hash]);
  if(!r.rowCount)return res.status(404).json({error:'Este link expirou ou não está mais disponível.'});
  const timeline=await pool.query('SELECT l.to_stage,l.created_at FROM project_portal_tokens t JOIN production_orders o ON o.project_id=t.project_id AND o.company_id=t.company_id JOIN production_stage_logs l ON l.order_id=o.id AND l.company_id=o.company_id WHERE t.token_hash=$1 ORDER BY l.created_at DESC LIMIT 30',[hash]);
  res.set('Cache-Control','no-store');
  res.set('Referrer-Policy','no-referrer');
  res.json({project:r.rows[0],timeline:timeline.rows});
 }));
 app.get('/cliente/:token',(req,res)=>res.sendFile(path.join(__dirname,'public','portal.html')));
};
