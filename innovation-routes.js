const crypto = require('crypto');
const { randomUUID } = require('crypto');
module.exports = function registerInnovationRoutes(app,{pool,auth,asyncRoute}){
 const company=req=>req.user.company_id;
 const tokenHash=t=>crypto.createHash('sha256').update(t).digest('hex');
 const safe=(v,n=200)=>String(v??'').trim().slice(0,n);
 const stages=['planejamento','corte','usinagem','montagem','acabamento','instalacao','pausado','concluido'];
 app.get('/api/innovation/overview',auth,asyncRoute(async(req,res)=>{
  const c=company(req);
  const [orders,capacity,stock,projects,costs]=await Promise.all([
   pool.query("SELECT o.id,o.code,o.stage,o.priority,o.due_date,p.title project_title FROM production_orders o LEFT JOIN projects p ON p.id=o.project_id AND p.company_id=o.company_id WHERE o.company_id=$1 AND o.stage NOT IN ('concluido','cancelado') ORDER BY CASE o.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END,o.due_date NULLS LAST",[c]),
   pool.query('SELECT stage,daily_minutes FROM production_capacity WHERE company_id=$1',[c]),
   pool.query('SELECT COUNT(*) FILTER(WHERE quantity<=minimum_quantity)::int low,COUNT(*)::int total FROM materials WHERE company_id=$1',[c]),
   pool.query("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE deadline<CURRENT_DATE AND status NOT IN ('concluido','cancelado'))::int overdue FROM projects WHERE company_id=$1",[c]),
   pool.query("SELECT COALESCE(SUM(quantity*unit_cost),0)::numeric total FROM project_cost_items WHERE company_id=$1 AND incurred_on>=date_trunc('month',CURRENT_DATE)",[c])
  ]);
  const cap=Object.fromEntries(capacity.rows.map(x=>[x.stage,Number(x.daily_minutes)]));
  const lanes=stages.map(stage=>({stage,orders:orders.rows.filter(o=>o.stage===stage),capacityMinutes:cap[stage]||480,load:orders.rows.filter(o=>o.stage===stage).length}));
  const recommendations=[];
  if(Number(stock.rows[0].low))recommendations.push({level:'warning',title:'Estoque crítico',detail:stock.rows[0].low+' material(is) no mínimo ou abaixo.'});
  if(Number(projects.rows[0].overdue))recommendations.push({level:'danger',title:'Projetos atrasados',detail:projects.rows[0].overdue+' projeto(s) com prazo vencido.'});
  const overloaded=lanes.filter(x=>x.orders.length*120>x.capacityMinutes);
  overloaded.forEach(x=>recommendations.push({level:'warning',title:'Possível gargalo em '+x.stage,detail:'Carga estimada excede a capacidade diária configurada.'}));
  res.json({lanes,recommendations,summary:{activeOrders:orders.rows.length,criticalStock:stock.rows[0].low,projects:projects.rows[0],monthCosts:costs.rows[0].total}});
 }));
 app.put('/api/innovation/capacity/:stage',auth,asyncRoute(async(req,res)=>{
  if(req.user.role!=='admin')return res.status(403).json({error:'Somente administradores podem configurar capacidade.'});
  const stage=safe(req.params.stage,40),minutes=Number(req.body?.daily_minutes);
  if(!stages.includes(stage)||!Number.isInteger(minutes)||minutes<1||minutes>1440)return res.status(400).json({error:'Etapa ou capacidade inválida.'});
  const r=await pool.query('INSERT INTO production_capacity(company_id,stage,daily_minutes) VALUES($1,$2,$3) ON CONFLICT(company_id,stage) DO UPDATE SET daily_minutes=EXCLUDED.daily_minutes RETURNING *',[company(req),stage,minutes]);res.json(r.rows[0]);
 }));
 app.get('/api/innovation/measurements/:projectId',auth,asyncRoute(async(req,res)=>{
  const r=await pool.query('SELECT * FROM project_measurements WHERE project_id=$1 AND company_id=$2 ORDER BY measured_at DESC',[req.params.projectId,company(req)]);res.json(r.rows);
 }));
 app.post('/api/innovation/measurements',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{},project=safe(b.project_id,64),room=safe(b.room,120);
  if(!project||!room)return res.status(400).json({error:'Informe o projeto e o ambiente.'});
  const dims=['width_mm','height_mm','depth_mm'].map(k=>b[k]===''||b[k]==null?null:Number(b[k]));
  if(dims.some(x=>x!==null&&(!Number.isFinite(x)||x<0||x>100000)))return res.status(400).json({error:'Medidas inválidas.'});
  const r=await pool.query('INSERT INTO project_measurements(company_id,project_id,room,wall,width_mm,height_mm,depth_mm,doors,windows,outlets,notes,photo_url,measured_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13) RETURNING *',[company(req),project,room,safe(b.wall,120)||null,...dims,JSON.stringify(Array.isArray(b.doors)?b.doors.slice(0,30):[]),JSON.stringify(Array.isArray(b.windows)?b.windows.slice(0,30):[]),JSON.stringify(Array.isArray(b.outlets)?b.outlets.slice(0,50):[]),safe(b.notes,3000)||null,safe(b.photo_url,1000)||null,req.user.id]);res.status(201).json(r.rows[0]);
 }));
 app.delete('/api/innovation/measurements/:id',auth,asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM project_measurements WHERE id=$1 AND company_id=$2 RETURNING id',[req.params.id,company(req)]);if(!r.rowCount)return res.status(404).json({error:'Levantamento não encontrado.'});res.status(204).end()}));
 app.get('/api/innovation/costs/:projectId',auth,asyncRoute(async(req,res)=>{
  const c=company(req),id=req.params.projectId;
  const [items,base,labor,parts]=await Promise.all([
   pool.query('SELECT * FROM project_cost_items WHERE project_id=$1 AND company_id=$2 ORDER BY incurred_on DESC,created_at DESC',[id,c]),
   pool.query('SELECT sale_price,estimated_cost FROM projects WHERE id=$1 AND company_id=$2',[id,c]),
   pool.query('SELECT COALESCE(SUM(duration_minutes),0)::numeric minutes FROM time_entries WHERE project_id=$1 AND company_id=$2',[id,c]),
   pool.query('SELECT COALESCE(SUM(pp.quantity*m.unit_cost),0)::numeric materials FROM project_parts pp JOIN materials m ON m.id=pp.material_id AND m.company_id=pp.company_id WHERE pp.project_id=$1 AND pp.company_id=$2',[id,c])
  ]);
  if(!base.rowCount)return res.status(404).json({error:'Projeto não encontrado.'});
  const hourly=await pool.query('SELECT hourly_cost FROM companies WHERE id=$1',[c]);
  const laborCost=Number(labor.rows[0].minutes)/60*Number(hourly.rows[0].hourly_cost||0);
  const manual=items.rows.reduce((n,x)=>n+Number(x.quantity)*Number(x.unit_cost),0);
  const materialCost=Number(parts.rows[0].materials||0),total=manual+laborCost+materialCost;
  const sale=Number(base.rows[0].sale_price||0);
  res.json({items:items.rows,summary:{sale,estimated:Number(base.rows[0].estimated_cost||0),materials:materialCost,labor:laborCost,additional:manual,total,profit:sale-total,margin:sale?((sale-total)/sale*100):0}});
 }));
 app.post('/api/innovation/costs',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{},project=safe(b.project_id,64),description=safe(b.description,180),category=safe(b.category,40),qty=Number(b.quantity??1),cost=Number(b.unit_cost);
  if(!project||!description||!['material','mao_de_obra','terceiro','frete','retrabalho','outro'].includes(category)||!(qty>0)||!Number.isFinite(cost)||cost<0)return res.status(400).json({error:'Informe categoria, descrição, quantidade e custo válidos.'});
  const r=await pool.query('INSERT INTO project_cost_items(company_id,project_id,category,description,quantity,unit_cost,incurred_on,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::date,CURRENT_DATE),$8,$9) RETURNING *',[company(req),project,category,description,qty,cost,b.incurred_on||null,safe(b.notes,1000)||null,req.user.id]);res.status(201).json(r.rows[0]);
 }));
 app.delete('/api/innovation/costs/:id',auth,asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM project_cost_items WHERE id=$1 AND company_id=$2 RETURNING id',[req.params.id,company(req)]);if(!r.rowCount)return res.status(404).json({error:'Custo não encontrado.'});res.status(204).end()}));
 app.get('/api/innovation/trace',auth,asyncRoute(async(req,res)=>{
  const r=await pool.query('SELECT l.*,p.title project_title,o.code order_code FROM production_trace_labels l JOIN projects p ON p.id=l.project_id AND p.company_id=l.company_id LEFT JOIN production_orders o ON o.id=l.order_id AND o.company_id=l.company_id WHERE l.company_id=$1 ORDER BY l.created_at DESC LIMIT 500',[company(req)]);res.json(r.rows);
 }));
 app.post('/api/innovation/trace/generate',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{},project=safe(b.project_id,64),c=company(req),orderId=b.order_id||null;
  const p=await pool.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2',[project,c]);if(!p.rowCount)return res.status(404).json({error:'Projeto não encontrado.'});
  if(orderId){const o=await pool.query('SELECT id FROM production_orders WHERE id=$1 AND project_id=$2 AND company_id=$3',[orderId,project,c]);if(!o.rowCount)return res.status(400).json({error:'Ordem inválida para este projeto.'})}
  const parts=Array.isArray(b.parts)?b.parts:[];if(!parts.length)return res.status(400).json({error:'Selecione ao menos uma peça para etiquetar.'});
  const created=[];let remainingLabels=500;
  for(const item of parts.slice(0,200)){if(remainingLabels<=0)break;
   const part=await pool.query('SELECT id,name,length_mm,width_mm,thickness_mm,quantity FROM project_parts WHERE id=$1 AND project_id=$2 AND company_id=$3',[item.part_id,project,c]);if(!part.rowCount)continue;
   for(let i=1;i<=Math.min(remainingLabels,100,Number(part.rows[0].quantity)||1);i++){
    const code='MBX-'+randomUUID().replace(/-/g,'').slice(0,12).toUpperCase(),r=await pool.query('INSERT INTO production_trace_labels(company_id,project_id,part_id,order_id,label_code,part_name,dimensions,unit_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[c,project,part.rows[0].id,orderId,code,part.rows[0].name,part.rows[0].length_mm+' × '+part.rows[0].width_mm+' × '+part.rows[0].thickness_mm+' mm',i]);created.push(r.rows[0]);remainingLabels--;
   }
  }
  res.status(201).json({labels:created});
 }));
 app.patch('/api/innovation/trace/:id',auth,asyncRoute(async(req,res)=>{
  const status=safe(req.body?.status,30),notes=safe(req.body?.notes,1000)||null;if(!['aguardando','corte','usinagem','montagem','acabamento','instalacao','concluida','problema'].includes(status))return res.status(400).json({error:'Etapa inválida.'});
  const client=await pool.connect();try{await client.query('BEGIN');const old=await client.query('SELECT * FROM production_trace_labels WHERE id=$1 AND company_id=$2 FOR UPDATE',[req.params.id,company(req)]);if(!old.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Etiqueta não encontrada.'})}const r=await client.query('UPDATE production_trace_labels SET status=$1,notes=COALESCE($2,notes),updated_at=NOW() WHERE id=$3 RETURNING *',[status,notes,req.params.id]);await client.query('INSERT INTO production_trace_events(company_id,label_id,from_status,to_status,notes,changed_by) VALUES($1,$2,$3,$4,$5,$6)',[company(req),req.params.id,old.rows[0].status,status,notes,req.user.id]);await client.query('COMMIT');res.json(r.rows[0])}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 }));
 app.get('/api/innovation/trace/public/:code',asyncRoute(async(req,res)=>{const r=await pool.query('SELECT l.id,l.label_code,l.part_name,l.dimensions,l.status,l.updated_at,p.title project_title,c.name company_name FROM production_trace_labels l JOIN projects p ON p.id=l.project_id AND p.company_id=l.company_id JOIN companies c ON c.id=l.company_id WHERE l.label_code=$1',[safe(req.params.code,40)]);if(!r.rowCount)return res.status(404).json({error:'Etiqueta não encontrada.'});res.set('Cache-Control','no-store');res.json(r.rows[0])}));
 app.get('/api/innovation/cnc/:projectId',auth,asyncRoute(async(req,res)=>{
  const c=company(req),id=req.params.projectId;
  const [project,parts]=await Promise.all([pool.query('SELECT id,title FROM projects WHERE id=$1 AND company_id=$2',[id,c]),pool.query('SELECT pp.name,pp.length_mm,pp.width_mm,pp.thickness_mm,pp.quantity,pp.grain_direction,pp.edge_banding,m.name material FROM project_parts pp LEFT JOIN materials m ON m.id=pp.material_id AND m.company_id=pp.company_id WHERE pp.project_id=$1 AND pp.company_id=$2 ORDER BY m.name,pp.name',[id,c])]);
  if(!project.rowCount)return res.status(404).json({error:'Projeto não encontrado.'});
  const rows=parts.rows.map(p=>({project:project.rows[0].title,part:p.name,material:p.material||'',length_mm:p.length_mm,width_mm:p.width_mm,thickness_mm:p.thickness_mm,quantity:p.quantity,grain:p.grain_direction,edge_banding:p.edge_banding||''}));
  await pool.query('INSERT INTO cnc_exports(company_id,project_id,format,file_name,created_by) VALUES($1,$2,$3,$4,$5)',[c,id,'csv','madevix-cnc-'+id+'.csv',req.user.id]);
  const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv=['Projeto,Peça,Material,Comprimento_mm,Largura_mm,Espessura_mm,Quantidade,Veio,Fita_borda',...rows.map(r=>[r.project,r.part,r.material,r.length_mm,r.width_mm,r.thickness_mm,r.quantity,r.grain,r.edge_banding].map(quote).join(','))].join('\r\n');
  res.set('Content-Type','text/csv; charset=utf-8');res.set('Content-Disposition','attachment; filename="madevix-cnc-'+id+'.csv"');res.send('\uFEFF'+csv);
 }));
 app.get('/api/innovation/supply-forecast',auth,asyncRoute(async(req,res)=>{
  const c=company(req);
  const r=await pool.query(`SELECT m.id,m.name,m.unit,m.quantity,m.minimum_quantity,m.unit_cost,m.supplier,
   COALESCE((SELECT SUM(pp.quantity) FROM project_parts pp JOIN projects p ON p.id=pp.project_id AND p.company_id=pp.company_id WHERE pp.material_id=m.id AND pp.company_id=m.company_id AND p.status NOT IN ('cancelado','concluido')),0)::numeric committed,
   COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.material_id=m.id AND sm.company_id=m.company_id AND sm.movement_type='saida' AND sm.created_at>=NOW()-INTERVAL '30 days'),0)::numeric used_30d
   FROM materials m WHERE m.company_id=$1 ORDER BY m.name`,[c]);
  const items=r.rows.map(m=>{const available=Number(m.quantity)-Number(m.committed),daily=Number(m.used_30d)/30,days=daily>0?Math.floor(available/daily):null,target=Math.max(Number(m.minimum_quantity),daily*21),suggest=Math.max(0,Math.ceil(target-available));return {...m,available,daily_use:daily,days_until_stockout:days,suggested_quantity:suggest,suggested_cost:suggest*Number(m.unit_cost||0),risk:available<=0?'critico':days!==null&&days<=7?'alto':available<=target?'atencao':'normal'}});
  res.json({items,summary:{critical:items.filter(x=>x.risk==='critico'||x.risk==='alto').length,suggestedCost:items.reduce((n,x)=>n+x.suggested_cost,0)}});
 }));
 app.post('/api/innovation/copilot',auth,asyncRoute(async(req,res)=>{
  const question=safe(req.body?.question,500);if(!question)return res.status(400).json({error:'Escreva uma pergunta.'});
  const c=company(req);
  const [projects,orders,stock,finance,costs]=await Promise.all([
   pool.query("SELECT p.title,p.status,p.deadline,p.sale_price,p.estimated_cost,c.name customer FROM projects p LEFT JOIN customers c ON c.id=p.customer_id AND c.company_id=p.company_id WHERE p.company_id=$1 ORDER BY p.deadline NULLS LAST LIMIT 100",[c]),
   pool.query("SELECT o.code,o.stage,o.priority,o.due_date,p.title FROM production_orders o LEFT JOIN projects p ON p.id=o.project_id AND p.company_id=o.company_id WHERE o.company_id=$1 AND o.stage NOT IN ('concluido','cancelado') ORDER BY o.due_date NULLS LAST",[c]),
   pool.query('SELECT name,quantity,minimum_quantity,unit FROM materials WHERE company_id=$1 ORDER BY quantity-minimum_quantity LIMIT 30',[c]),
   pool.query("SELECT COALESCE(SUM(amount) FILTER(WHERE transaction_type='receita' AND paid_at IS NOT NULL),0)::numeric income,COALESCE(SUM(amount) FILTER(WHERE transaction_type='despesa' AND paid_at IS NOT NULL),0)::numeric expenses FROM finance_transactions WHERE company_id=$1",[c]),
   pool.query("SELECT p.title,COALESCE(SUM(ci.quantity*ci.unit_cost),0)::numeric extra FROM project_cost_items ci JOIN projects p ON p.id=ci.project_id AND p.company_id=ci.company_id WHERE ci.company_id=$1 GROUP BY p.id ORDER BY extra DESC LIMIT 5",[c])
  ]);
  const late=orders.rows.filter(x=>x.due_date&&new Date(x.due_date)<new Date(new Date().toDateString()));
  const low=stock.rows.filter(x=>Number(x.quantity)<=Number(x.minimum_quantity));
  const income=Number(finance.rows[0].income),expenses=Number(finance.rows[0].expenses);
  const answer='Análise baseada nos dados cadastrados (não é um modelo generativo externo).\n\n'+
   '• Produção: '+orders.rows.length+' ordem(ns) em aberto; '+late.length+' com prazo vencido.\n'+
   '• Estoque: '+low.length+' material(is) no mínimo ou abaixo'+(low.length?': '+low.slice(0,8).map(x=>x.name).join(', '):'')+'.\n'+
   '• Financeiro: '+(income-expenses>=0?'saldo recebido positivo de ':'saldo recebido negativo de ')+new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(income-expenses)+'.\n'+
   '• Projetos: '+projects.rows.filter(x=>x.status==='orcamento').length+' orçamento(s) aguardando decisão.\n'+
   (late.length?'Ação sugerida: replaneje primeiro as ordens atrasadas e confira a disponibilidade de materiais.':'Ação sugerida: mantenha a fila priorizada e revise semanalmente o estoque comprometido.');
  res.json({question,answer,generatedAt:new Date().toISOString(),evidence:{openOrders:orders.rows.length,lateOrders:late.length,lowStock:low.length,projects:projects.rows.length,paidIncome:income,paidExpenses:expenses,topExtraCosts:costs.rows}});
 }));
 app.get('/api/innovation/approvals',auth,asyncRoute(async(req,res)=>{
  const r=await pool.query('SELECT a.id,a.project_id,a.status,a.expires_at,a.responded_at,a.response_notes,a.created_at,p.title,p.sale_price,c.name customer_name FROM project_approvals a JOIN projects p ON p.id=a.project_id AND p.company_id=a.company_id LEFT JOIN customers c ON c.id=p.customer_id AND c.company_id=p.company_id WHERE a.company_id=$1 ORDER BY a.created_at DESC',[company(req)]);res.json(r.rows);
 }));
 app.post('/api/innovation/approvals/:projectId',auth,asyncRoute(async(req,res)=>{
  const c=company(req),id=req.params.projectId,p=await pool.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2',[id,c]);if(!p.rowCount)return res.status(404).json({error:'Projeto não encontrado.'});
  const token=crypto.randomBytes(32).toString('base64url'),expires=new Date(Date.now()+14*86400000);
  const r=await pool.query("INSERT INTO project_approvals(company_id,project_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at",[c,id,tokenHash(token),expires,req.user.id]);
  const base=(process.env.PUBLIC_URL||req.protocol+'://'+req.get('host')).replace(/\/$/,'');
  res.status(201).json({...r.rows[0],url:base+'/aprovacao/'+token});
 }));
 app.get('/api/innovation/approval/:token',asyncRoute(async(req,res)=>{
  const r=await pool.query("SELECT a.id,a.status,a.expires_at,p.title,p.description,p.sale_price,p.deadline,c.name company_name,cu.name customer_name FROM project_approvals a JOIN projects p ON p.id=a.project_id AND p.company_id=a.company_id JOIN companies c ON c.id=a.company_id LEFT JOIN customers cu ON cu.id=p.customer_id AND cu.company_id=p.company_id WHERE a.token_hash=$1",[tokenHash(req.params.token)]);
  if(!r.rowCount||r.rows[0].status!=='aguardando'||new Date(r.rows[0].expires_at)<new Date())return res.status(404).json({error:'Este link não está mais disponível.'});
  res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.json(r.rows[0]);
 }));
 app.post('/api/innovation/approval/:token/respond',asyncRoute(async(req,res)=>{
  const decision=safe(req.body?.decision,20),notes=safe(req.body?.notes,2000);
  if(!['aprovado','ajustes'].includes(decision))return res.status(400).json({error:'Resposta inválida.'});
  const client=await pool.connect();try{await client.query('BEGIN');const a=await client.query("SELECT * FROM project_approvals WHERE token_hash=$1 AND status='aguardando' AND expires_at>NOW() FOR UPDATE",[tokenHash(req.params.token)]);if(!a.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Link expirado ou já respondido.'})}await client.query('UPDATE project_approvals SET status=$1,response_notes=$2,responded_at=NOW() WHERE id=$3',[decision,notes||null,a.rows[0].id]);let orderCreated=false;if(decision==='aprovado'){await client.query("UPDATE projects SET status='aprovado' WHERE id=$1 AND company_id=$2 AND status='orcamento'",[a.rows[0].project_id,a.rows[0].company_id]);const existing=await client.query('SELECT id FROM production_orders WHERE project_id=$1 AND company_id=$2 LIMIT 1',[a.rows[0].project_id,a.rows[0].company_id]);if(!existing.rowCount){const project=await client.query('SELECT deadline FROM projects WHERE id=$1 AND company_id=$2',[a.rows[0].project_id,a.rows[0].company_id]);const created=await client.query("INSERT INTO production_orders(company_id,project_id,stage,priority,due_date,notes) VALUES($1,$2,'planejamento','normal',$3,'Criada pela aprovação digital do cliente.') RETURNING id",[a.rows[0].company_id,a.rows[0].project_id,project.rows[0].deadline]);await client.query("INSERT INTO production_stage_logs(company_id,order_id,from_stage,to_stage,changed_by,notes) VALUES($1,$2,NULL,'planejamento',NULL,'Ordem criada pela aprovação digital.')",[a.rows[0].company_id,created.rows[0].id]);orderCreated=true}}await client.query('COMMIT');res.json({ok:true,status:decision,orderCreated})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 }));
 app.get('/aprovacao/:token',(req,res)=>res.sendFile(require('path').join(__dirname,'public','approval.html')));
 app.get('/rastreio/:code',(req,res)=>res.sendFile(require('path').join(__dirname,'public','trace.html')));
};
