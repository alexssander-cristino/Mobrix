const PDFJS_VERSION='4.10.38';
const THREE_VERSION='0.180.0';
function readImageMeta(src){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(Error('Não foi possível abrir a imagem.'));image.src=src})}
function svgData(svg){return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}
function parseDxf(text){
 const lines=text.replace(/\r/g,'').split('\n'),entities=[];let section=false,record=null;
 for(let i=0;i<lines.length-1;i+=2){const code=Number(lines[i].trim()),value=lines[i+1].trim();if(code===0&&value==='SECTION'){section=false;record=null;continue}if(code===2&&value==='ENTITIES'){section=true;continue}if(code===0&&value==='ENDSEC'&&section){if(record)entities.push(record);break}if(!section)continue;if(code===0){if(record)entities.push(record);record={type:value,values:[]}}else if(record)record.values.push([code,value])}
 if(record)entities.push(record);
 const points=[],shapes=[];
 for(const ent of entities){const vals=ent.values,all=c=>vals.filter(v=>v[0]===c).map(v=>Number(v[1]));if(ent.type==='LINE'){const xs=[...all(10),...all(11)],ys=[...all(20),...all(21)];if(xs.length>=2&&ys.length>=2){points.push([xs[0],ys[0]],[xs[1],ys[1]]);shapes.push({type:'line',points:[[xs[0],ys[0]],[xs[1],ys[1]]]})}}else if(ent.type==='LWPOLYLINE'){const xs=all(10),ys=all(20),pts=xs.map((x,i)=>[x,ys[i]??0]);if(pts.length>1){points.push(...pts);shapes.push({type:'poly',points:pts,closed:all(70)[0]===1})}}else if(ent.type==='CIRCLE'){const x=all(10)[0],y=all(20)[0],r=all(40)[0];if(Number.isFinite(x)&&Number.isFinite(y)&&r>0){points.push([x-r,y-r],[x+r,y+r]);shapes.push({type:'circle',x,y,r})}}}
 if(!points.length)throw Error('Não encontrei entidades LINE, LWPOLYLINE ou CIRCLE no DXF. Exporte como DXF R12/R2000 ou envie PDF/imagem.');
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),w=maxX-minX||1,h=maxY-minY||1,pad=Math.max(w,h)*.06;
 const path=shapes.map(s=>{if(s.type==='circle')return '<circle cx="'+(s.x-minX+pad)+'" cy="'+(maxY-s.y+pad)+'" r="'+s.r+'"/>';const pts=s.points.map(p=>(p[0]-minX+pad)+','+(maxY-p[1]+pad)).join(' ');return '<polyline points="'+pts+(s.closed?' '+(s.points[0][0]-minX+pad)+','+(maxY-s.points[0][1]+pad):'')+'"/>'}).join('');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+(w+pad*2)+' '+(h+pad*2)+'"><rect width="100%" height="100%" fill="#fff"/><g fill="none" stroke="#475569" stroke-width="'+Math.max(w,h)*.002+'">'+path+'</g></svg>';
 return{previewUrl:svgData(svg),width:Math.round(w),height:Math.round(h),entities:shapes.length,notes:'DXF lido: '+shapes.length+' entidades. Medidas externas estimadas pelo desenho; confira a unidade do arquivo.'};
}
export async function inspectProjectFile(file){
 const ext=(file.name.split('.').pop()||'').toLowerCase(),url=URL.createObjectURL(file),base={name:file.name,size:file.size,ext,url};
 if(['png','jpg','jpeg','webp','gif','bmp'].includes(ext)){const meta=await readImageMeta(url);return{...base,kind:'drawing',previewUrl:url,aspectRatio:meta.width/meta.height,dimensions:{width:1200,height:Math.max(1,Math.round(1200*meta.height/meta.width)),depth:550},notes:'Imagem analisada para extrair o contorno frontal e gerar um volume 3D. A profundidade é ajustável; confira o resultado com o projeto técnico.'};}
 if(ext==='pdf'){
  const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@'+PDFJS_VERSION+'/build/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@'+PDFJS_VERSION+'/build/pdf.worker.min.mjs';
  const doc=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise,page=await doc.getPage(1),viewport=page.getViewport({scale:1.35}),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:ctx,viewport}).promise;
  let text='';for(let p=1;p<=Math.min(doc.numPages,8);p++){const pg=await doc.getPage(p),content=await pg.getTextContent();text+=' '+content.items.map(x=>x.str).join(' ')}
  const normalized=text.replace(/\\s+/g,' ').trim(),measure=normalized.match(/(\\d{3,5})\\s*(?:mm)?\\s*[xX×]\\s*(\\d{3,5})\\s*(?:mm)?\\s*[xX×]\\s*(\\d{3,5})\\s*mm/i),two=normalized.match(/(\\d{3,5})\\s*(?:mm)?\\s*[xX×]\\s*(\\d{3,5})\\s*mm/i);
  const title=(normalized.match(/(?:Rack|Painel|Arm[aá]rio|Balc[aã]o|Gabinete)[^.;]{0,60}/i)||[])[0]||file.name.replace(/\\.pdf$/i,'');
  const isTvRack=/rack.{0,20}(?:tv|televis[aã]o)|(?:tv|televis[aã]o).{0,20}rack/i.test(normalized)||/rack.{0,15}tv/i.test(file.name);
  const thickness=Number((normalized.match(/(?:MDF|MDP)\\s*(\\d{1,2})\\s*mm/i)||[])[1])||18;
  const finish=(normalized.match(/(?:acabamento\\s*)?([A-ZÀ-Ú][a-zà-ú]+)\\s*(?:2 de abrir|\\d+ de abrir|1 prateleira|\\d+ prateleiras)/i)||[])[1]||((normalized.match(/\\b(Carvalho|Nogueira|Freij[oó]|Am[eé]ndoa|Branco|Preto|Cinza)\\b/i)||[])[1]||'Carvalho');
  const doors=Number((normalized.match(/(\\d+)\\s*(?:portas?|de abrir)/i)||[])[1])||(/duas portas|2 de abrir/i.test(normalized)?2:0);
  const shelves=Number((normalized.match(/(\\d+)\\s*prateleiras?/i)||[])[1])||(/uma prateleira/i.test(normalized)?1:0);
  const specification=isTvRack&&measure?{type:'tv-rack',title,dimensions:{width:Number(measure[1]),height:Number(measure[2]),depth:Number(measure[3])},thickness,finish,doors:doors||2,centralOpen:/v[aã]o central aberto/i.test(normalized),shelves:shelves||1}:null;
  const dimensions=measure?{width:Number(measure[1]),height:Number(measure[2]),depth:Number(measure[3])}:two?{width:Number(two[1]),height:Number(two[2]),depth:550}:{width:1200,height:Math.round(1200/(viewport.width/viewport.height)),depth:550};
  return{...base,kind:specification?'specified':'drawing',previewUrl:canvas.toDataURL('image/png'),pages:doc.numPages,dimensions,specification,extractedText:normalized,notes:specification?'Projeto identificado: '+title+'. '+dimensions.width+' × '+dimensions.height+' × '+dimensions.depth+' mm; MDF '+thickness+' mm; '+specification.finish+'; '+specification.doors+' portas; '+specification.shelves+' prateleira(s). O modelo 3D será montado com essas peças e divisões.':'PDF lido ('+doc.numPages+' página(s)). Não encontrei especificações suficientes para montar o móvel por componentes; confira a vista e as medidas.'}
 }
 if(ext==='svg'){const raw=await file.text(),doc=new DOMParser().parseFromString(raw,'image/svg+xml'),el=doc.documentElement,view=(el.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number),w=Number(el.getAttribute('width'))||view[2]||1200,h=Number(el.getAttribute('height'))||view[3]||2100;if(doc.querySelector('parsererror'))throw Error('O arquivo SVG está inválido.');return{...base,kind:'drawing',previewUrl:url,dimensions:{width:Math.round(w),height:Math.round(h),depth:550},notes:'SVG vetorial carregado. O contorno será convertido em volume 3D; confirme a escala em milímetros.'}}
 if(ext==='dxf'){const parsed=parseDxf(await file.text());return{...base,kind:'drawing',...parsed,dimensions:{width:parsed.width,height:parsed.height,depth:550}}}
 if(['glb','gltf','obj','stl'].includes(ext))return{...base,kind:'model',notes:'Modelo 3D carregado. Arraste para orbitar e use a roda para aproximar.'};
 throw Error('Formato não suportado. Envie PNG, JPG, WEBP, PDF, SVG, DXF, GLB, GLTF, OBJ ou STL.');
}
export async function mountImportedModel(host,file){
 const THREE=await import('https://cdn.jsdelivr.net/npm/three@'+THREE_VERSION+'/build/three.module.js');
 const [{OrbitControls},{GLTFLoader},{OBJLoader},{STLLoader}]=await Promise.all([import('https://cdn.jsdelivr.net/npm/three@'+THREE_VERSION+'/examples/jsm/controls/OrbitControls.js'),import('https://cdn.jsdelivr.net/npm/three@'+THREE_VERSION+'/examples/jsm/loaders/GLTFLoader.js'),import('https://cdn.jsdelivr.net/npm/three@'+THREE_VERSION+'/examples/jsm/loaders/OBJLoader.js'),import('https://cdn.jsdelivr.net/npm/three@'+THREE_VERSION+'/examples/jsm/loaders/STLLoader.js')]);
 const ext=file.name.split('.').pop().toLowerCase(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(host.clientWidth||700,host.clientHeight||460);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;host.innerHTML='';host.appendChild(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#eef1ef');scene.add(new THREE.HemisphereLight(0xffffff,0x89918b,2));const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(4,7,6);scene.add(key);const fill=new THREE.DirectionalLight(0xffffff,1.2);fill.position.set(-5,2,-4);scene.add(fill);const camera=new THREE.PerspectiveCamera(42,Math.max(.1,host.clientWidth/Math.max(1,host.clientHeight)),.01,100000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.screenSpacePanning=true;scene.add(new THREE.GridHelper(10,20,0xc4ccc6,0xdde2de));
 const bytes=await file.arrayBuffer();let object;if(ext==='glb'||ext==='gltf'){const loader=new GLTFLoader();object=await new Promise((resolve,reject)=>loader.parse(bytes,'',g=>resolve(g.scene),reject))}else if(ext==='obj')object=new OBJLoader().parse(new TextDecoder().decode(bytes));else{const geometry=new STLLoader().parse(bytes);geometry.computeVertexNormals();object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xb99570,roughness:.72}))}
 scene.add(object);object.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());if(!Number.isFinite(size.length())||size.length()===0)throw Error('O arquivo 3D não contém geometria visível.');object.position.sub(center);
 const maxDim=Math.max(size.x,size.y,size.z),sourceUnitToMm=maxDim<=20?1000:1,sourceSizeMm={x:size.x*sourceUnitToMm,y:size.y*sourceUnitToMm,z:size.z*sourceUnitToMm};let currentSize={...sourceSizeMm};
 const fitCamera=()=>{const maxCurrent=Math.max(currentSize.x,currentSize.y,currentSize.z)/sourceUnitToMm,dist=maxCurrent*2.25;camera.position.set(dist*.95,dist*.7,dist*1.1);camera.near=Math.max(.001,maxCurrent/10000);camera.far=maxCurrent*100;camera.updateProjectionMatrix();controls.target.set(0,0,0);controls.minDistance=maxCurrent*.35;controls.maxDistance=maxCurrent*12;controls.update();return dist};
 let dist=fitCamera();
 function applySize(dimensions={}){const target={x:Number(dimensions.width)||sourceSizeMm.x,y:Number(dimensions.height)||sourceSizeMm.y,z:Number(dimensions.depth)||sourceSizeMm.z};object.scale.set(target.x/sourceSizeMm.x,target.y/sourceSizeMm.y,target.z/sourceSizeMm.z);currentSize=target;dist=fitCamera();return{...currentSize}}
 let raf=0,dead=false;const resize=()=>{if(dead)return;const w=host.clientWidth||700,h=host.clientHeight||460;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};const observer=new ResizeObserver(resize);observer.observe(host);const animate=()=>{if(dead)return;controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(animate)};animate();
 return{resize:applySize,reset(){dist=fitCamera()},destroy(){dead=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();renderer.dispose();renderer.domElement.remove();scene.traverse(o=>{o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose?.()})},size:{x:size.x,y:size.y,z:size.z},sourceSizeMm};
}

function traceOuterContour(mask,w,h){
 const edges=[],add=(x1,y1,x2,y2)=>edges.push({a:x1+','+y1,b:x2+','+y2,x:x1,y:y1});
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!mask[i])continue;if(y===0||!mask[i-w])add(x,y,x+1,y);if(x===w-1||!mask[i+1])add(x+1,y,x+1,y+1);if(y===h-1||!mask[i+w])add(x+1,y+1,x,y+1);if(x===0||!mask[i-1])add(x,y+1,x,y)}
 const starts=new Map();edges.forEach((e,i)=>{if(!starts.has(e.a))starts.set(e.a,[]);starts.get(e.a).push(i)});
 const used=new Uint8Array(edges.length),loops=[];
 for(let i=0;i<edges.length;i++){if(used[i])continue;const loop=[];let n=i,guard=0;while(n!==undefined&&!used[n]&&guard++<edges.length+2){const e=edges[n];used[n]=1;loop.push([e.x,e.y]);const next=starts.get(e.b)||[];n=next.find(k=>!used[k])}if(loop.length>12)loops.push(loop)}
 const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1]},0)/2);
 loops.sort((a,b)=>area(b)-area(a));return loops[0]||[];
}
function simplifyContour(points,threshold=1.8){if(points.length<4)return points;const out=[points[0]];for(let i=1;i<points.length;i++){const a=out[out.length-1],b=points[i];if(Math.hypot(b[0]-a[0],b[1]-a[1])>=threshold)out.push(b)}return out}
export async function mountDrawingModel(host,details,dimensions={}){
 const THREE=await import('https://cdn.jsdelivr.net/npm/three@'+THREE_VERSION+'/build/three.module.js');
 const [{OrbitControls}]=await Promise.all([import('https://cdn.jsdelivr.net/npm/three@'+THREE_VERSION+'/examples/jsm/controls/OrbitControls.js')]);
 const image=await readImageMeta(details.previewUrl).then(()=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Não foi possível interpretar a imagem do projeto.'));im.src=details.previewUrl}));
 const maxSide=240,scale=Math.min(1,maxSide/Math.max(image.naturalWidth,image.naturalHeight)),w=Math.max(8,Math.round(image.naturalWidth*scale)),h=Math.max(8,Math.round(image.naturalHeight*scale));
 const source=document.createElement('canvas');source.width=w;source.height=h;const sctx=source.getContext('2d',{willReadFrequently:true});sctx.drawImage(image,0,0,w,h);const pixels=sctx.getImageData(0,0,w,h).data;
 const corners=[[0,0],[w-1,0],[0,h-1],[w-1,h-1]].map(([x,y])=>{const i=(y*w+x)*4;return[pixels[i],pixels[i+1],pixels[i+2]]});const bg=[0,1,2].map(k=>corners.reduce((n,c)=>n+c[k],0)/4);
 const isBackground=i=>{const d=Math.abs(pixels[i]-bg[0])+Math.abs(pixels[i+1]-bg[1])+Math.abs(pixels[i+2]-bg[2]);return d<92};
 const outside=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
 const seed=i=>{if(!outside[i]&&isBackground(i*4)){outside[i]=1;queue[tail++]=i}};
 for(let x=0;x<w;x++){seed(x);seed((h-1)*w+x)}for(let y=0;y<h;y++){seed(y*w);seed(y*w+w-1)}
 while(head<tail){const i=queue[head++],x=i%w,y=(i/w)|0;if(x>0)seed(i-1);if(x<w-1)seed(i+1);if(y>0)seed(i-w);if(y<h-1)seed(i+w)}
 const mask=new Uint8Array(w*h);let count=0,minX=w,minY=h,maxX=0,maxY=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!outside[i]){mask[i]=1;count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}}
 if(count<w*h*.002||maxX-minX<5||maxY-minY<5)throw Error('Não consegui separar o móvel do fundo. Envie uma vista frontal com fundo uniforme e contorno visível.');
 const contour=simplifyContour(traceOuterContour(mask,w,h));if(contour.length<8)throw Error('O contorno do móvel não está fechado o suficiente para gerar o volume 3D. Use uma vista frontal com o móvel inteiro visível.');
 const sourceWidth=Number(details.dimensions?.width)||1200,sourceHeight=Number(details.dimensions?.height)||Math.round(sourceWidth*h/w),sourceDepth=Number(details.dimensions?.depth)||550;
 let current={width:Number(dimensions.width)||sourceWidth,height:Number(dimensions.height)||sourceHeight,depth:Number(dimensions.depth)||sourceDepth};
 const shape=new THREE.Shape();contour.forEach(([x,y],i)=>{const px=(x/w-.5)*sourceWidth,py=(.5-y/h)*sourceHeight;if(i===0)shape.moveTo(px,py);else shape.lineTo(px,py)});shape.closePath();
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:sourceDepth,bevelEnabled:false,curveSegments:2});geometry.translate(0,0,-sourceDepth/2);geometry.computeVertexNormals();
 const body=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xc5a27c,roughness:.78,metalness:.02}));
 const overlay=document.createElement('canvas');overlay.width=w;overlay.height=h;const octx=overlay.getContext('2d');octx.drawImage(source,0,0);const od=octx.getImageData(0,0,w,h);for(let i=0;i<mask.length;i++){if(!mask[i])od.data[i*4+3]=0}octx.putImageData(od,0,0);
 const texture=new THREE.CanvasTexture(overlay);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const front=new THREE.Mesh(new THREE.PlaneGeometry(sourceWidth,sourceHeight),new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide,depthWrite:false}));front.position.z=sourceDepth/2+.35;body.add(front);
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setSize(host.clientWidth||700,host.clientHeight||460);host.innerHTML='';host.appendChild(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#eef1ef');scene.add(new THREE.HemisphereLight(0xffffff,0x89918b,2));const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(4,7,6);scene.add(key);const fill=new THREE.DirectionalLight(0xffffff,1.2);fill.position.set(-5,2,-4);scene.add(fill);scene.add(body);
 const camera=new THREE.PerspectiveCamera(42,Math.max(.1,host.clientWidth/Math.max(1,host.clientHeight)),.01,100000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.screenSpacePanning=true;
 const fit=()=>{const maxDim=Math.max(current.width,current.height,current.depth),dist=maxDim*2.25;camera.position.set(dist*.95,dist*.7,dist*1.1);camera.near=Math.max(.001,maxDim/10000);camera.far=maxDim*100;camera.updateProjectionMatrix();controls.target.set(0,0,0);controls.minDistance=maxDim*.35;controls.maxDistance=maxDim*12;controls.update()};
 const applySize=d=>{current={width:Number(d.width)||current.width,height:Number(d.height)||current.height,depth:Number(d.depth)||current.depth};body.scale.set(current.width/sourceWidth,current.height/sourceHeight,current.depth/sourceDepth);fit();return{...current}};fit();
 let raf=0,dead=false;const onResize=()=>{if(dead)return;const cw=host.clientWidth||700,ch=host.clientHeight||460;renderer.setSize(cw,ch,false);camera.aspect=cw/ch;camera.updateProjectionMatrix()};const observer=new ResizeObserver(onResize);observer.observe(host);const animate=()=>{if(dead)return;controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(animate)};animate();
 return{resize:applySize,reset:fit,sourceSizeMm:{x:sourceWidth,y:sourceHeight,z:sourceDepth},destroy(){dead=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();renderer.dispose();texture.dispose();geometry.dispose();body.material.dispose();front.geometry.dispose();front.material.dispose();renderer.domElement.remove()}};
}

export async function mountSpecifiedFurniture(host,details,dimensions={}){
 const THREE=await import('https://cdn.jsdelivr.net/npm/three@'+THREE_VERSION+'/build/three.module.js');
 const [{OrbitControls}]=await Promise.all([import('https://cdn.jsdelivr.net/npm/three@'+THREE_VERSION+'/examples/jsm/controls/OrbitControls.js')]);
 const spec=details.specification||{},source={width:Number(spec.dimensions?.width)||1800,height:Number(spec.dimensions?.height)||400,depth:Number(spec.dimensions?.depth)||500},thickness=Number(spec.thickness)||18;
 const finish=String(spec.finish||'Carvalho').toLowerCase(),woodColor=/branco/.test(finish)?0xe7e3dc:/nogueira/.test(finish)?0x79563e:/preto|grafite/.test(finish)?0x44484b:0xc99b68;
 const group=new THREE.Group(),wood=new THREE.MeshStandardMaterial({color:woodColor,roughness:.78}),inner=new THREE.MeshStandardMaterial({color:/branco/.test(finish)?0xd8d3ca:0x8a694a,roughness:.85}),backMat=new THREE.MeshStandardMaterial({color:/branco/.test(finish)?0xe0ddd5:0x987451,roughness:.9}),metal=new THREE.MeshStandardMaterial({color:0xbfc3c4,metalness:.78,roughness:.28});
 const addBox=(x,y,z,w,h,d,mat=wood)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);group.add(mesh);return mesh};
 const W=source.width,H=source.height,D=source.depth,t=thickness,bottom=-H/2,top=H/2,front=D/2,back=-D/2;
 // Carcaça externa: tampo, base, laterais e fundo.
 addBox(0,top-t/2,0,W,t,D);
 addBox(0,bottom+t/2,0,W,t,D);
 addBox(-W/2+t/2,0,0,t,H-2*t,D-t);
 addBox(W/2-t/2,0,0,t,H-2*t,D-t);
 addBox(0,0,back+t/2,W-2*t,H-2*t,t,backMat);
 const centralWidth=W/3,dividerX=centralWidth/2+t/2;
 addBox(-dividerX,0,0,t,H-2*t,D-t,inner);
 addBox(dividerX,0,0,t,H-2*t,D-t,inner);
 // Nicho central aberto com uma prateleira regulada pelo meio da altura.
 const shelfY=bottom+(H-2*t)*.53;
 if(Number(spec.shelves)>0)addBox(0,shelfY,0,centralWidth-t,D-2*t,t,wood);
 // Duas portas frontais nos módulos laterais.
 const doorWidth=(W-centralWidth)/2-t*.75,doorHeight=H-2*t-t*.35,doorY=bottom+t+doorHeight/2;
 const doorOffset=centralWidth/2+doorWidth/2+t*.15;
 const doorZ=front+t*.55;
 addBox(-doorOffset,doorY,doorZ,doorWidth,doorHeight,t,wood);
 addBox(doorOffset,doorY,doorZ,doorWidth,doorHeight,t,wood);
 // Puxadores verticais próximos ao encontro das portas com o vão central.
 const handleX=centralWidth/2+22,handleY=0,handleZ=front+t+7;
 const handle=(x)=>{const h=addBox(x,handleY,handleZ,8,72,8,metal);const cap1=addBox(x,handleY-31,handleZ-3,13,5,5,metal);const cap2=addBox(x,handleY+31,handleZ-3,13,5,5,metal);return h};
 handle(-handleX);handle(handleX);
 // Prateleira inferior interna dos módulos laterais para dar leitura de compartimento.
 addBox(-doorOffset,bottom+t+(H-2*t)*.28,back+t+((D-2*t)/2),doorWidth*.92,t,D-2*t,inner);
 addBox(doorOffset,bottom+t+(H-2*t)*.28,back+t+((D-2*t)/2),doorWidth*.92,t,D-2*t,inner);
 // Moldura frontal discreta do casco.
 addBox(0,top-t/2,front+t*.15,W,t*.45,t*.45,inner);
 const sourceSizeMm={x:W,y:H,z:D};let current={width:Number(dimensions.width)||W,height:Number(dimensions.height)||H,depth:Number(dimensions.depth)||D};
 group.scale.set(current.width/W,current.height/H,current.depth/D);
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(host.clientWidth||700,host.clientHeight||460);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;host.innerHTML='';host.appendChild(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#eef1ef');scene.add(new THREE.HemisphereLight(0xffffff,0x89918b,2));const key=new THREE.DirectionalLight(0xffffff,2.4);key.position.set(4,7,6);scene.add(key);const fill=new THREE.DirectionalLight(0xffffff,1.15);fill.position.set(-5,2,-4);scene.add(fill);scene.add(new THREE.GridHelper(Math.max(W,D)*1.7,20,0xc4ccc6,0xdde2de));scene.add(group);
 const camera=new THREE.PerspectiveCamera(42,Math.max(.1,host.clientWidth/Math.max(1,host.clientHeight)),.01,100000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.screenSpacePanning=true;
 const fit=()=>{const maxDim=Math.max(current.width,current.height,current.depth),dist=maxDim*2.25;camera.position.set(dist*.95,dist*.7,dist*1.1);camera.near=Math.max(.001,maxDim/10000);camera.far=maxDim*100;camera.updateProjectionMatrix();controls.target.set(0,0,0);controls.minDistance=maxDim*.35;controls.maxDistance=maxDim*12;controls.update()};fit();
 const resizeModel=d=>{current={width:Number(d.width)||current.width,height:Number(d.height)||current.height,depth:Number(d.depth)||current.depth};group.scale.set(current.width/W,current.height/H,current.depth/D);fit();return{...current}};
 let raf=0,dead=false;const onResize=()=>{if(dead)return;const w=host.clientWidth||700,h=host.clientHeight||460;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};const observer=new ResizeObserver(onResize);observer.observe(host);const animate=()=>{if(dead)return;controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(animate)};animate();
 return{resize:resizeModel,reset:fit,sourceSizeMm,destroy(){dead=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();renderer.dispose();renderer.domElement.remove();group.traverse(o=>{o.geometry?.dispose?.();if(o.material&&!Array.isArray(o.material))o.material.dispose()})}};
}
