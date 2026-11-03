const crypto=require('crypto');
module.exports=function registerAdvancedStudioRoutes(app,{pool,auth,asyncRoute}){
 const company=req=>req.user.company_id;
 const safe=(v,n=240)=>String(v??'').trim().slice(0,n);
 const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
 const stages=['planejamento','corte','usinagem','montagem','acabamento','instalacao'];
 const fail=(res,msg,status=400)=>res.status(status).json({error:msg});
 app.get('/api/studio/overview',auth,asyncRoute(async(req,res)=>{
  const c=company(req);
  const [machines,orders,schedule,inspections,quotes]=await Promise.all([
   pool.query('SELECT m.*,CASE WHEN m.last_service_at IS NULL THEN NULL ELSE (m.operating_hours % m.maintenance_interval_hours) END hours_since_service FROM studio_machines m WHERE company_id=$1 ORDER BY name',[c]),
   pool.query("SELECT o.id,o.code,o.stage,o.priority,o.due_date,p.title project_title FROM production_orders o LEFT JOIN projects p ON p.id=o.project_id AND p.company_id=o.company_id WHERE o.company_id=$1 AND o.stage NOT IN ('concluido','cancelado') ORDER BY o.due_date NULLS LAST",[c]),
   pool.query("SELECT s.*,o.code,p.title project_title FROM studio_schedule s JOIN production_orders o ON o.id=s.order_id AND o.company_id=s.company_id JOIN projects p ON p.id=s.project_id AND p.company_id=s.company_id WHERE s.company_id=$1 AND s.status IN ('planejado','em_execucao') AND s.planned_start>=NOW()-INTERVAL '1 day' ORDER BY s.planned_start LIMIT 100",[c]),
   pool.query("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE result<>'aprovado')::int pending FROM studio_inspections WHERE company_id=$1 AND created_at>=NOW()-INTERVAL '30 days'",[c]),
   pool.query('SELECT COUNT(*)::int total,MIN(unit_price) lowest_price FROM studio_supplier_quotes WHERE company_id=$1',[c])
  ]);
  res.json({machines:machines.rows,orders:orders.rows,schedule:schedule.rows,inspections:inspections.rows[0],quotes:quotes.rows[0]});
 }));
 app.get('/api/studio/machines',auth,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT * FROM studio_machines WHERE company_id=$1 ORDER BY name',[company(req)]);res.json(r.rows)}));
 app.post('/api/studio/machines',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{},name=safe(b.name,140),status=safe(b.status,24)||'operacional',interval=Number(b.maintenance_interval_hours||500);
  if(!name||!['operacional','parada','manutencao','inativa'].includes(status)||!Number.isFinite(interval)||interval<=0)return fail(res,'Informe nome, situação e intervalo de manutenção válidos.');
  const r=await pool.query('INSERT INTO studio_machines(company_id,name,code,area,status,maintenance_interval_hours,operating_hours,last_service_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[company(req),name,safe(b.code,50)||null,safe(b.area,100)||null,status,interval,Math.max(0,Number(b.operating_hours)||0),b.last_service_at||null,safe(b.notes,2000)||null]);res.status(201).json(r.rows[0]);
 }));
 app.patch('/api/studio/machines/:id',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{},status=b.status?safe(b.status,24):null;
  if(status&&!['operacional','parada','manutencao','inativa'].includes(status))return fail(res,'Situação de máquina inválida.');
  const r=await pool.query('UPDATE studio_machines SET name=COALESCE($1,name),status=COALESCE($2,status),operating_hours=COALESCE($3,operating_hours),last_service_at=COALESCE($4,last_service_at),notes=COALESCE($5,notes) WHERE id=$6 AND company_id=$7 RETURNING *',[b.name?safe(b.name,140):null,status,b.operating_hours===undefined?null:Math.max(0,Number(b.operating_hours)||0),b.last_service_at||null,b.notes===undefined?null:safe(b.notes,2000),req.params.id,company(req)]);
  if(!r.rowCount)return fail(res,'Máquina não encontrada.',404);res.json(r.rows[0]);
 }));
 app.post('/api/studio/machines/:id/logs',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{},kind=safe(b.kind,24),description=safe(b.description,240),hours=Number(b.hours||0);
  if(!['uso','manutencao','parada'].includes(kind)||!description||!Number.isFinite(hours)||hours<0)return fail(res,'Dados do apontamento inválidos.');
  const client=await pool.connect();try{await client.query('BEGIN');const m=await client.query('SELECT * FROM studio_machines WHERE id=$1 AND company_id=$2 FOR UPDATE',[req.params.id,company(req)]);if(!m.rowCount){await client.query('ROLLBACK');return fail(res,'Máquina não encontrada.',404)}
   const log=await client.query('INSERT INTO studio_machine_logs(company_id,machine_id,kind,description,hours,logged_at,created_by) VALUES($1,$2,$3,$4,$5,COALESCE($6::date,CURRENT_DATE),$7) RETURNING *',[company(req),req.params.id,kind,description,hours,b.logged_at||null,req.user.id]);
   const newHours=Number(m.rows[0].operating_hours)+(kind==='uso'?hours:0);
   await client.query('UPDATE studio_machines SET operating_hours=$1,status=CASE WHEN $2=\'manutencao\' THEN \'manutencao\' WHEN $2=\'parada\' THEN \'parada\' ELSE status END,last_service_at=CASE WHEN $2=\'manutencao\' THEN CURRENT_DATE ELSE last_service_at END WHERE id=$3',[newHours,kind,req.params.id]);
   await client.query('COMMIT');res.status(201).json(log.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 }));
 app.get('/api/studio/machines/:id/logs',auth,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT l.* FROM studio_machine_logs l JOIN studio_machines m ON m.id=l.machine_id AND m.company_id=l.company_id WHERE l.machine_id=$1 AND l.company_id=$2 ORDER BY l.logged_at DESC,l.created_at DESC LIMIT 100',[req.params.id,company(req)]);res.json(r.rows)}));
 app.get('/api/studio/schedule',auth,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT s.*,o.code,p.title project_title FROM studio_schedule s JOIN production_orders o ON o.id=s.order_id AND o.company_id=s.company_id JOIN projects p ON p.id=s.project_id AND p.company_id=s.company_id WHERE s.company_id=$1 ORDER BY s.planned_start LIMIT 250',[company(req)]);res.json(r.rows)}));
 app.post('/api/studio/schedule/auto',auth,asyncRoute(async(req,res)=>{
  const c=company(req),b=req.body||{},hours=Number(b.hours_per_order||2),start=b.start_date?new Date(b.start_date):new Date();
  if(!Number.isFinite(hours)||hours<=0||hours>24||!Number.isFinite(start.getTime()))return fail(res,'Informe duração e data inicial válidas.');
  const orders=await pool.query("SELECT o.id,o.project_id,o.stage,o.due_date,o.priority FROM production_orders o WHERE o.company_id=$1 AND o.stage NOT IN ('concluido','cancelado') ORDER BY CASE o.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END,o.due_date NULLS LAST,o.created_at",[c]);
  const created=[];let cursor=new Date(start);const minutes=Math.round(hours*60);
  for(const o of orders.rows){const stage=stages.includes(o.stage)?o.stage:'planejamento';const end=new Date(cursor.getTime()+minutes*60000);
   const r=await pool.query('INSERT INTO studio_schedule(company_id,order_id,project_id,stage,planned_start,planned_end,planned_minutes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(company_id,order_id,stage) DO UPDATE SET planned_start=EXCLUDED.planned_start,planned_end=EXCLUDED.planned_end,planned_minutes=EXCLUDED.planned_minutes,status=\'planejado\' RETURNING *',[c,o.id,o.project_id,stage,cursor.toISOString(),end.toISOString(),minutes]);created.push(r.rows[0]);cursor=end;
  }
  res.json({scheduled:created.length,items:created,assumption:'Sequenciamento linear por prioridade e prazo; revise disponibilidade real de pessoas e máquinas.'});
 }));
 app.patch('/api/studio/schedule/:id',auth,asyncRoute(async(req,res)=>{const status=safe(req.body?.status,20);if(!['planejado','em_execucao','concluido','reprogramar'].includes(status))return fail(res,'Status inválido.');const r=await pool.query('UPDATE studio_schedule SET status=$1 WHERE id=$2 AND company_id=$3 RETURNING *',[status,req.params.id,company(req)]);if(!r.rowCount)return fail(res,'Agendamento não encontrado.',404);res.json(r.rows[0])}));
 app.post('/api/studio/nesting/optimize',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{},project=safe(b.project_id,64),W=Number(b.sheet_width),H=Number(b.sheet_height),kerf=Number(b.kerf_mm??3);
  if(!project||![W,H,kerf].every(Number.isFinite)||W<=0||H<=0||kerf<0||kerf>20)return fail(res,'Informe projeto, dimensões da chapa e espessura de serra válidos.');
  const parts=await pool.query('SELECT pp.id,pp.name,pp.length_mm,pp.width_mm,pp.quantity,pp.grain_direction FROM project_parts pp WHERE pp.project_id=$1 AND pp.company_id=$2',[project,company(req)]);
  if(!parts.rowCount)return fail(res,'Projeto sem peças cadastradas.',404);
  const items=[];for(const p of parts.rows){const qty=Math.min(1000,Math.max(0,Number(p.quantity)||0));for(let i=0;i<qty;i++)items.push({id:p.id,name:p.name,w:Number(p.length_mm),h:Number(p.width_mm),grain:!!p.grain_direction})}
  if(items.some(p=>!Number.isFinite(p.w)||!Number.isFinite(p.h)||p.w<=0||p.h<=0))return fail(res,'Há peças com dimensões inválidas na ficha técnica.');
  items.sort((a,b)=>Math.max(b.w,b.h)-Math.max(a.w,a.h));
  const sheets=[];
  for(const item of items){let placed=false;for(let si=0;si<sheets.length&&!placed;si++){const s=sheets[si];for(const rotated of [false,true]){if(rotated&&item.grain)continue;const w=(rotated?item.h:item.w)+kerf,h=(rotated?item.w:item.h)+kerf;if(w>s.width||h>s.height)continue;
   let x=s.x,y=s.y,rowH=s.rowH;if(x+w>s.width){x=0;y+=rowH;rowH=0}if(y+h<=s.height){s.parts.push({id:item.id,name:item.name,x,y,width:w-kerf,height:h-kerf,rotated});s.x=x+w;s.y=y;s.rowH=Math.max(rowH,h);placed=true;break}
  }}
  if(!placed){let w=item.w+kerf,h=item.h+kerf,rotated=false;if(w>W||h>H){if(!item.grain&&item.h+kerf<=W&&item.w+kerf<=H){w=item.h+kerf;h=item.w+kerf;rotated=true}else return fail(res,'Uma ou mais peças não cabem na chapa informada: '+item.name)}
   sheets.push({width:W,height:H,x:w,y:0,rowH:h,parts:[{id:item.id,name:item.name,x:0,y:0,width:w-kerf,height:h-kerf,rotated}]});
  }}
  const usedArea=items.reduce((n,p)=>n+p.w*p.h,0),sheetArea=W*H*sheets.length,utilization=sheetArea?usedArea/sheetArea*100:0;
  const result={sheets:sheets.map((s,i)=>({number:i+1,width:W,height:H,parts:s.parts})),parts:items.length,usedArea,sheetArea,wasteArea:sheetArea-usedArea,kerf,algorithm:'shelf-first-fit',rotation:'somente peças sem restrição de veio'};
  const saved=await pool.query('INSERT INTO studio_nesting_runs(company_id,project_id,sheet_width,sheet_height,kerf_mm,result,utilization,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id,created_at',[company(req),project,W,H,kerf,JSON.stringify(result),utilization,req.user.id]);
  res.json({id:saved.rows[0].id,created_at:saved.rows[0].created_at,...result,utilization:Number(utilization.toFixed(2))});
 }));
 app.get('/api/studio/nesting/:projectId',auth,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT id,sheet_width,sheet_height,kerf_mm,result,utilization,created_at FROM studio_nesting_runs WHERE project_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 20',[req.params.projectId,company(req)]);res.json(r.rows)}));
 app.get('/api/studio/quotes',auth,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT q.*,m.name material_name FROM studio_supplier_quotes q LEFT JOIN materials m ON m.id=q.material_id AND m.company_id=q.company_id WHERE q.company_id=$1 ORDER BY q.unit_price,q.quoted_at DESC LIMIT 300',[company(req)]);res.json(r.rows)}));
 app.post('/api/studio/quotes',auth,asyncRoute(async(req,res)=>{const b=req.body||{},supplier=safe(b.supplier_name,160),description=safe(b.description,180),price=Number(b.unit_price),qty=Number(b.quantity||1),lead=b.lead_days===''||b.lead_days==null?null:Number(b.lead_days);if(b.material_id){const material=await pool.query('SELECT id FROM materials WHERE id=$1 AND company_id=$2',[b.material_id,company(req)]);if(!material.rowCount)return fail(res,'Material não pertence à empresa.')}if(!supplier||!description||!Number.isFinite(price)||price<0||!Number.isFinite(qty)||qty<=0||(lead!==null&&(!Number.isInteger(lead)||lead<0)))return fail(res,'Dados da cotação inválidos.');const r=await pool.query('INSERT INTO studio_supplier_quotes(company_id,supplier_name,material_id,description,unit_price,quantity,lead_days,quoted_at,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date,CURRENT_DATE),$9,$10) RETURNING *',[company(req),supplier,b.material_id||null,description,price,qty,lead,b.quoted_at||null,safe(b.notes,1200)||null,req.user.id]);res.status(201).json(r.rows[0])}));
 app.delete('/api/studio/quotes/:id',auth,asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM studio_supplier_quotes WHERE id=$1 AND company_id=$2 RETURNING id',[req.params.id,company(req)]);if(!r.rowCount)return fail(res,'Cotação não encontrada.',404);res.status(204).end()}));
 app.post('/api/studio/configurations',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{},name=safe(b.name,160)||'Módulo personalizado',W=Number(b.width_mm),H=Number(b.height_mm),D=Number(b.depth_mm),t=Number(b.thickness_mm||18),back=Number(b.back_mm||6),doors=Math.max(0,Math.min(4,Math.floor(Number(b.doors)||0))),shelves=Math.max(0,Math.min(12,Math.floor(Number(b.shelves)||0))),price=Number(b.material_cost_m2||0);
  if(![W,H,D,t,back,price].every(Number.isFinite)||W<200||H<200||D<100||W>6000||H>4000||D>2000||t<10||t>40||back<3||back>20||price<0)return fail(res,'Dimensões ou parâmetros fora dos limites.');
  const parts=[{name:'Lateral esquerda',length_mm:H,width_mm:D,quantity:1},{name:'Lateral direita',length_mm:H,width_mm:D,quantity:1},{name:'Base',length_mm:W-2*t,width_mm:D,quantity:1},{name:'Tampo',length_mm:W-2*t,width_mm:D,quantity:1},{name:'Fundo',length_mm:H-2*t,width_mm:W-2*t,quantity:1,thickness_mm:back}];
  for(let i=1;i<=shelves;i++)parts.push({name:'Prateleira '+i,length_mm:W-2*t,width_mm:D-20,quantity:1});
  for(let i=1;i<=doors;i++)parts.push({name:'Porta '+i,length_mm:H-4,width_mm:(W-4)/doors,quantity:1});
  const area=parts.reduce((n,p)=>n+p.length_mm*p.width_mm*p.quantity/1000000,0),cost=area*price;
  const config={width_mm:W,height_mm:H,depth_mm:D,thickness_mm:t,back_mm:back,doors,shelves,material_cost_m2:price};
  const saved=await pool.query('INSERT INTO studio_configurations(company_id,project_id,name,config,parts,material_area_m2,estimated_cost,created_by) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) RETURNING id,created_at',[company(req),b.project_id||null,name,JSON.stringify(config),JSON.stringify(parts),area,cost,req.user.id]);
  res.status(201).json({id:saved.rows[0].id,created_at:saved.rows[0].created_at,name,config,parts,material_area_m2:Number(area.toFixed(3)),estimated_material_cost:Number(cost.toFixed(2)),note:'Estimativa de área bruta; não inclui otimização de corte, ferragens, fita de borda ou mão de obra.'});
 }));
 app.get('/api/studio/configurations',auth,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT id,name,config,parts,material_area_m2,estimated_cost,created_at FROM studio_configurations WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[company(req)]);res.json(r.rows)}));
 app.get('/api/studio/inspections',auth,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT i.*,p.title project_title FROM studio_inspections i JOIN projects p ON p.id=i.project_id AND p.company_id=i.company_id WHERE i.company_id=$1 ORDER BY i.created_at DESC LIMIT 150',[company(req)]);res.json(r.rows)}));
 app.post('/api/studio/inspections',auth,asyncRoute(async(req,res)=>{const b=req.body||{},project=safe(b.project_id,64),stage=safe(b.stage,40),result=safe(b.result,20),checklist=Array.isArray(b.checklist)?b.checklist.slice(0,40).map(x=>({item:safe(x.item,120),passed:!!x.passed})):[];if(!project||!stages.includes(stage)||!['aprovado','ajustes','reprovado'].includes(result)||!checklist.length)return fail(res,'Informe projeto, etapa, resultado e checklist.');const projectExists=await pool.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2',[project,company(req)]);if(!projectExists.rowCount)return fail(res,'Projeto não encontrado.',404);if(b.order_id){const order=await pool.query('SELECT id FROM production_orders WHERE id=$1 AND project_id=$2 AND company_id=$3',[b.order_id,project,company(req)]);if(!order.rowCount)return fail(res,'Ordem não pertence ao projeto.',400)}if(result==='aprovado'&&checklist.some(x=>!x.passed))return fail(res,'Não é possível aprovar uma inspeção com itens pendentes.');const r=await pool.query('INSERT INTO studio_inspections(company_id,project_id,order_id,stage,result,checklist,notes,photo_url,inspected_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING *',[company(req),project,b.order_id||null,stage,result,JSON.stringify(checklist),safe(b.notes,2000)||null,safe(b.photo_url,1000)||null,req.user.id]);res.status(201).json(r.rows[0])}));
 app.post('/api/studio/passports',auth,asyncRoute(async(req,res)=>{const project=safe(req.body?.project_id,64);if(!project)return fail(res,'Selecione um projeto.');const p=await pool.query('SELECT id FROM projects WHERE id=$1 AND company_id=$2',[project,company(req)]);if(!p.rowCount)return fail(res,'Projeto não encontrado.',404);const token=crypto.randomBytes(32).toString('hex'),warranty=req.body?.warranty_until||null;const r=await pool.query('INSERT INTO studio_passports(company_id,project_id,token_hash,warranty_until,expires_at,created_by) VALUES($1,$2,$3,$4,NULL,$5) RETURNING id,created_at,warranty_until',[company(req),project,hash(token),warranty,req.user.id]);res.status(201).json({...r.rows[0],url:'/passaporte/'+token})}));
 app.get('/api/studio/passports',auth,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT sp.id,sp.project_id,p.title,sp.warranty_until,sp.revoked_at,sp.created_at FROM studio_passports sp JOIN projects p ON p.id=sp.project_id AND p.company_id=sp.company_id WHERE sp.company_id=$1 ORDER BY sp.created_at DESC',[company(req)]);res.json(r.rows)}));
 app.delete('/api/studio/passports/:id',auth,asyncRoute(async(req,res)=>{const r=await pool.query('UPDATE studio_passports SET revoked_at=NOW() WHERE id=$1 AND company_id=$2 AND revoked_at IS NULL RETURNING id',[req.params.id,company(req)]);if(!r.rowCount)return fail(res,'Passaporte não encontrado ou já revogado.',404);res.status(204).end()}));
 app.get('/api/studio/passport/public/:token',asyncRoute(async(req,res)=>{const r=await pool.query("SELECT p.title,p.description,p.status,p.created_at,sp.warranty_until,c.name company_name FROM studio_passports sp JOIN projects p ON p.id=sp.project_id AND p.company_id=sp.company_id JOIN companies c ON c.id=sp.company_id WHERE sp.token_hash=$1 AND sp.revoked_at IS NULL AND (sp.expires_at IS NULL OR sp.expires_at>NOW())",[hash(safe(req.params.token,100))]);if(!r.rowCount)return fail(res,'Passaporte indisponível.',404);res.set('Cache-Control','no-store');res.json(r.rows[0])}));
};
