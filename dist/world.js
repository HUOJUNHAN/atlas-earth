import {assets,loadPoints} from './atlas-load.js?v=1';
import {sound,revealDestination} from './atlas-audio.js?v=1';
import {cityName,cityPlace,findCityMatches,updateCapitalInfo,observeCityCard,routeDestinations} from './city-catalog.js?v=all-places1';
const d3 = window.d3;
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const radians = Math.PI / 180;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = $('world-map'), ctx = canvas.getContext('2d');
const base = document.createElement('canvas'), mapCtx = base.getContext('2d');
const state = {zoom:1,targetZoom:1,x:0,y:0,tx:0,ty:0,region:'all',routes:true,labels:true,dots:true,capitalOnly:false,
  selected:null,hover:null,hoverCountry:null,tour:false,camera:false,lastInteraction:0};
let width=innerWidth,height=innerHeight,dpr=Math.min(devicePixelRatio,2),projection,geoPath,countries=[],cities=[],landDots=[];
let routePaths=[],visibleCities=[],lastFrame=0,dirty=true,lastView='',tourStarted=0,tourStep=-1,handController;
let pointerDown=false,moved=0,lastPointer=null,lastHover=0,touchGap=0,lastKeyGesture='none',lastHighlight=0;
const pointers=new Map();
const regionNames={'亚洲':'Asia','欧洲':'Europe','非洲':'Africa','北美洲':'North America','南美洲':'South America','大洋洲':'Oceania'};
const timezoneByCity={
  SHANGHAI:'Asia/Shanghai',BEIJING:'Asia/Shanghai',CHENGDU:'Asia/Shanghai',SHENZHEN:'Asia/Shanghai',WUHAN:'Asia/Shanghai',URUMQI:'Asia/Shanghai',
  TOKYO:'Asia/Tokyo',SEOUL:'Asia/Seoul','HONG KONG':'Asia/Hong_Kong',TAIPEI:'Asia/Taipei',SINGAPORE:'Asia/Singapore',BANGKOK:'Asia/Bangkok',
  'KUALA LUMPUR':'Asia/Kuala_Lumpur',JAKARTA:'Asia/Jakarta',MANILA:'Asia/Manila',HANOI:'Asia/Ho_Chi_Minh',MUMBAI:'Asia/Kolkata','NEW DELHI':'Asia/Kolkata',BENGALURU:'Asia/Kolkata',DHAKA:'Asia/Dhaka',
  KARACHI:'Asia/Karachi',DUBAI:'Asia/Dubai',DOHA:'Asia/Qatar',RIYADH:'Asia/Riyadh',TEHRAN:'Asia/Tehran',ISTANBUL:'Europe/Istanbul',MOSCOW:'Europe/Moscow','ST. PETERSBURG':'Europe/Moscow',
  LONDON:'Europe/London',PARIS:'Europe/Paris',BERLIN:'Europe/Berlin',FRANKFURT:'Europe/Berlin',AMSTERDAM:'Europe/Amsterdam',ROME:'Europe/Rome',MADRID:'Europe/Madrid',BARCELONA:'Europe/Madrid',
  VIENNA:'Europe/Vienna',ZURICH:'Europe/Zurich',STOCKHOLM:'Europe/Stockholm',OSLO:'Europe/Oslo',ATHENS:'Europe/Athens',CAIRO:'Africa/Cairo',NAIROBI:'Africa/Nairobi',LAGOS:'Africa/Lagos',
  JOHANNESBURG:'Africa/Johannesburg','CAPE TOWN':'Africa/Johannesburg',CASABLANCA:'Africa/Casablanca','ADDIS ABABA':'Africa/Addis_Ababa',
  'NEW YORK':'America/New_York','SAN FRANCISCO':'America/Los_Angeles','LOS ANGELES':'America/Los_Angeles',CHICAGO:'America/Chicago',WASHINGTON:'America/New_York',SEATTLE:'America/Los_Angeles',
  VANCOUVER:'America/Vancouver',TORONTO:'America/Toronto','MEXICO CITY':'America/Mexico_City','SÃO PAULO':'America/Sao_Paulo','RIO DE JANEIRO':'America/Sao_Paulo','BUENOS AIRES':'America/Argentina/Buenos_Aires',
  LIMA:'America/Lima','BOGOTÁ':'America/Bogota',SANTIAGO:'America/Santiago',SYDNEY:'Australia/Sydney',MELBOURNE:'Australia/Melbourne',AUCKLAND:'Pacific/Auckland',PERTH:'Australia/Perth',HONOLULU:'Pacific/Honolulu'
};
const tourNames=['SHANGHAI','TOKYO','SAN FRANCISCO','NEW YORK','LONDON','PARIS','CAIRO','DUBAI','SYDNEY'];
let toastTimer;
function toast(text,duration=3000){$('map-toast').textContent=text;$('map-toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('map-toast').classList.remove('show'),duration);}
function interaction(){state.lastInteraction=performance.now();if(state.tour)stopTour();}
function setTransform(context){context.setTransform(dpr*state.zoom,0,0,dpr*state.zoom,dpr*(width/2*(1-state.zoom)+state.x),dpr*(height/2*(1-state.zoom)+state.y));}
function screen(point){return[(point[0]-width/2)*state.zoom+width/2+state.x,(point[1]-height/2)*state.zoom+height/2+state.y];}
function inverseScreen(x,y){return[(x-width/2-state.x)/state.zoom+width/2,(y-height/2-state.y)/state.zoom+height/2];}
function setZoom(value,anchor=[width/2,height/2]){
  const z=clamp(value,.85,5),ratio=z/state.targetZoom;
  state.tx=anchor[0]-width/2-(anchor[0]-width/2-state.tx)*ratio;
  state.ty=anchor[1]-height/2-(anchor[1]-height/2-state.ty)*ratio;state.targetZoom=z;constrain();
}
function constrain(){const margin=state.targetZoom-.7;state.tx=clamp(state.tx,-width*margin*.6,width*margin*.6);state.ty=clamp(state.ty,-height*margin*.5,height*margin*.5);}
function countryName(feature){return feature.properties.NAME_ZH||feature.properties.NAME_EN||feature.properties.ADMIN||feature.properties.NAME||'';}
function polygonPath(feature){const p=geoPath(feature);return p?new Path2D(p):new Path2D();}
function reverseGeometry(geometry){const reverse=poly=>poly.map(ring=>ring.slice().reverse());if(geometry.type==='Polygon')geometry.coordinates=reverse(geometry.coordinates);else if(geometry.type==='MultiPolygon')geometry.coordinates=geometry.coordinates.map(reverse);}
function resize(){
  width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio,2);
  canvas.width=base.width=width*dpr;canvas.height=base.height=height*dpr;canvas.style.width=width+'px';canvas.style.height=height+'px';
  const mobile=width<740,top=mobile?170:166,bottom=mobile?height-256:height-215;
  projection=d3.geoNaturalEarth1().precision(.3).fitExtent([[mobile?12:50,top],[width-(mobile?12:50),Math.max(top+140,bottom)]],{type:'Sphere'});
  geoPath=d3.geoPath(projection);
  for(const c of countries){c.path=polygonPath(c.feature);c.bounds=geoPath.bounds(c.feature);c.center=projection(d3.geoCentroid(c.feature));}
  for(const c of cities)c.point=projection([c.lon,c.lat]);
  if(landDots.length)for(const p of landDots)p.point=projection([p.lon,p.lat]);
  if(state.selected)buildRoutes();dirty=true;lastView='';
}
function trace(context,object){context.beginPath();d3.geoPath(projection,context)(object);}
function paintBase(){
  mapCtx.setTransform(dpr,0,0,dpr,0,0);mapCtx.clearRect(0,0,width,height);
  const ocean=mapCtx.createRadialGradient(width*.5,height*.48,0,width*.5,height*.48,width*.68);
  ocean.addColorStop(0,'#103038');ocean.addColorStop(.45,'#0a202a');ocean.addColorStop(1,'#06141d');mapCtx.fillStyle=ocean;mapCtx.fillRect(0,0,width,height);
  mapCtx.strokeStyle='rgba(154,194,189,.023)';mapCtx.lineWidth=1;
  for(let x=0;x<width;x+=72){mapCtx.beginPath();mapCtx.moveTo(x,0);mapCtx.lineTo(x,height);mapCtx.stroke();}
  for(let y=0;y<height;y+=72){mapCtx.beginPath();mapCtx.moveTo(0,y);mapCtx.lineTo(width,y);mapCtx.stroke();}
  setTransform(mapCtx);
  trace(mapCtx,{type:'Sphere'});mapCtx.fillStyle='rgba(20,56,62,.14)';mapCtx.fill();mapCtx.strokeStyle='rgba(108,170,167,.11)';mapCtx.lineWidth=.7/state.zoom;mapCtx.stroke();
  trace(mapCtx,d3.geoGraticule().step([30,30])());mapCtx.strokeStyle='rgba(112,168,163,.11)';mapCtx.lineWidth=.5/state.zoom;mapCtx.stroke();
  const landGradient=mapCtx.createLinearGradient(0,height*.22,width*.85,height*.86);landGradient.addColorStop(0,'#315e58');landGradient.addColorStop(.45,'#2c5751');landGradient.addColorStop(1,'#1a4246');
  for(const c of countries){
    const selected=state.region==='all'||c.feature.properties.CONTINENT===regionNames[state.region];
    mapCtx.fillStyle=selected?landGradient:'#122d34';mapCtx.fill(c.path);
    mapCtx.strokeStyle=selected?'rgba(136,211,186,.49)':'rgba(100,151,147,.18)';mapCtx.lineWidth=.45/state.zoom;mapCtx.stroke(c.path);
  }
  if(state.dots){
    mapCtx.fillStyle='rgba(126,211,189,.36)';const size=state.zoom>2?.75:.8;
    for(const p of landDots){if(state.region!=='all'&&!isRegionPoint(p,state.region))continue;if(!p.point)continue;mapCtx.fillRect(p.point[0],p.point[1],size/state.zoom,size/state.zoom);}
  }
  // Geographic labels stay quieter than the city layer.
  if(state.labels&&state.zoom<1.9){
    const labels=[['北美洲','NORTH AMERICA',-111,38],['南美洲','SOUTH AMERICA',-64,-22],['欧洲','EUROPE',18,51],['非洲','AFRICA',19,4],['亚洲','ASIA',93,40],['大洋洲','OCEANIA',135,-25],['南极洲','ANTARCTICA',0,-77]];
    for(const [name,en,lon,lat] of labels){const p=projection([lon,lat]);if(!p)continue;mapCtx.save();mapCtx.textAlign='center';mapCtx.font=`500 ${clamp(width/108,10,14)/state.zoom}px "Microsoft YaHei",sans-serif`;mapCtx.fillStyle='rgba(183,215,199,.63)';mapCtx.fillText(name,p[0],p[1]);if(width>=740){mapCtx.font=`${6.5/state.zoom}px Arial`;mapCtx.fillStyle='rgba(145,187,175,.47)';mapCtx.fillText(en,p[0],p[1]+13/state.zoom);}mapCtx.restore();}
  }
  mapCtx.setTransform(dpr,0,0,dpr,0,0);mapCtx.font='italic 11px Georgia,serif';mapCtx.textAlign='center';mapCtx.fillStyle='#76959555';
  if(width>=740)for(const [name,lon,lat] of [['PACIFIC OCEAN',-145,-7],['ATLANTIC OCEAN',-34,12],['INDIAN OCEAN',75,-31]]){const p=screen(projection([lon,lat]));if(p[0]>0&&p[0]<width)mapCtx.fillText(name,p[0],p[1]);}
  dirty=false;
}
function isRegionPoint(p,region){const lon=p.lon,lat=p.lat;switch(region){case'亚洲':return lon>27&&lat>-10&&lat<82;case'欧洲':return lon>-26&&lon<60&&lat>35;case'非洲':return lon>-20&&lon<52&&lat>-36&&lat<38;case'北美洲':return lon<-25&&lat>7;case'南美洲':return lon<-30&&lon>-85&&lat<13;case'大洋洲':return lon>110&&lat<-7;default:return true;}}
function buildRoutes(){
  if(!state.selected||!projection)return;const home=state.selected;
  const destinations=cities.filter(c=>(state.region==='all'||c.region===state.region)&&(!state.capitalOnly||c.nationalCapital));
  const curated=routeDestinations(destinations,home,32);
  routePaths=curated.map((dest,index)=>{
    const interpolate=d3.geoInterpolate([home.lon,home.lat],[dest.lon,dest.lat]);
    const coords=Array.from({length:81},(_,i)=>interpolate(i/80));
    const path=geoPath({type:'LineString',coordinates:coords});
    return{dest,interpolate,path:new Path2D(path||''),index};
  });
}
function glow(x,y,size,color='gold',strength=1){
  const rgb=color==='gold'?'245,213,155':'129,223,203';
  const g=ctx.createRadialGradient(x,y,0,x,y,size);g.addColorStop(0,`rgba(${rgb},${.48*strength})`);g.addColorStop(.24,`rgba(${rgb},${.24*strength})`);g.addColorStop(1,`rgba(${rgb},0)`);ctx.fillStyle=g;ctx.fillRect(x-size,y-size,size*2,size*2);
}
function drawDynamic(time){
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.drawImage(base,0,0,width,height);
  setTransform(ctx);
  if(state.hoverCountry){ctx.fillStyle='rgba(107,203,181,.13)';ctx.strokeStyle='rgba(164,231,209,.8)';ctx.lineWidth=.9/state.zoom;ctx.fill(state.hoverCountry.path);ctx.stroke(state.hoverCountry.path);}
  if(state.routes){
    for(const r of routePaths){ctx.strokeStyle=r.index%5===0?'rgba(233,207,163,.34)':'rgba(189,193,163,.19)';ctx.lineWidth=.7/state.zoom;ctx.stroke(r.path);}
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if(state.routes&&!reducedMotion){
    for(const r of routePaths){const phase=(time*.000035+r.index*.083)%1,p=screen(projection(r.interpolate(phase)));if(p[0]<0||p[0]>width||p[1]<0||p[1]>height)continue;glow(p[0],p[1],6,'gold',.7);ctx.fillStyle='#e8d1a8';ctx.beginPath();ctx.arc(p[0],p[1],1.05,0,Math.PI*2);ctx.fill();}
  }
  const visible=cities.filter(c=>(state.region==='all'||c.region===state.region)&&(!state.capitalOnly||c.nationalCapital));visibleCities=[];
  for(const c of visible){const [x,y]=screen(c.point);if(x<-20||x>width+20||y<-20||y>height+20)continue;visibleCities.push({city:c,x,y});}
  const occupied=[];ctx.textBaseline='middle';
  const labelOrder=visibleCities.slice().sort((a,b)=>(b.city===state.selected?100:b.city===state.hover?90:b.city.capitalPrimary?20:b.city.nationalCapital?10:0)-(a.city===state.selected?100:a.city===state.hover?90:a.city.capitalPrimary?20:a.city.nationalCapital?10:0));
  for(const p of labelOrder){const c=p.city,selected=c===state.selected,hover=c===state.hover;
    glow(p.x,p.y,selected?22:hover?17:8,selected||c.nationalCapital?'gold':'teal',selected?1:c.nationalCapital?.55:.65);
    ctx.fillStyle=selected?'#f9dfa9':hover?'#d5f5e6':c.nationalCapital?'#e5c98a':'#8dccba';ctx.beginPath();ctx.arc(p.x,p.y,selected?3.3:hover?2.8:c.nationalCapital?2.1:1.7,0,Math.PI*2);ctx.fill();
    if(c.nationalCapital&&!selected){ctx.strokeStyle='#e5c98a70';ctx.lineWidth=.65;ctx.beginPath();ctx.arc(p.x,p.y,3.8,0,Math.PI*2);ctx.stroke();}
    if(selected){const pulse=reducedMotion?11:10+(Math.sin(time*.0015)+1)*4;ctx.strokeStyle='#e8d1a877';ctx.lineWidth=.6;ctx.beginPath();ctx.arc(p.x,p.y,pulse,0,Math.PI*2);ctx.stroke();}
    if(!state.labels)continue;
    const labeledCities=width<740?[]:['TOKYO','NEW YORK','LONDON','PARIS','DUBAI','SINGAPORE','SYDNEY','SAN FRANCISCO','CAIRO','BEIJING','SÃO PAULO','MOSCOW','JOHANNESBURG'];
    if(state.zoom<1.5&&!selected&&!hover&&!c.nationalCapital&&!labeledCities.includes(c.en))continue;
    if(width<740&&state.zoom<1.25&&!selected&&!hover)continue;
    const label=cityName(c),textWidth=label.length*10+14,lx=p.x+9+textWidth>width-8?p.x-textWidth-5:p.x+9,ly=p.y-(selected?11:6);
    if(!selected&&!hover&&occupied.some(b=>Math.abs(ly-b.y)<13&&lx<b.x+b.w&&lx+textWidth>b.x))continue;
    occupied.push({x:lx,y:ly,w:textWidth});ctx.font=`${selected?'600':'400'} ${selected?12:10}px "Microsoft YaHei",sans-serif`;ctx.shadowColor='#05121b';ctx.shadowBlur=5;ctx.fillStyle=selected?'#f3deb5':hover?'#eef8ee':c.nationalCapital?'#cfc3a2':'#aacdbd';ctx.fillText(label,lx,ly);ctx.shadowBlur=0;
  }
  if(state.labels&&state.zoom>2.2){
    ctx.font='9px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillStyle='rgba(156,191,178,.55)';
    for(const c of countries){const p=screen(c.center);if(p[0]<15||p[0]>width-15||p[1]<130||p[1]>height-190)continue;const area=geoPath.area(c.feature)*state.zoom*state.zoom;if(area<3000)continue;ctx.fillText(countryName(c.feature),p[0],p[1]);}ctx.textAlign='left';
  }
}
function coordinate(value,lat=false){return Math.abs(value).toFixed(2)+'° '+(lat?(value>=0?'N':'S'):(value>=0?'E':'W'));}
function updateClock(){
  const city=state.selected;if(!city)return;const tz=city.timezone||timezoneByCity[city.en];
  $('city-time').textContent=tz?new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()):'—';
}
function selectCity(city,focus=true){
  if(focus){sound.play('city',city);revealDestination(document.querySelector('.city-card'));}
  if(state.capitalOnly&&!city.nationalCapital){state.capitalOnly=false;$('capital-only').checked=false;}
  $('node-count').textContent=cities.filter(c=>(state.region==='all'||c.region===state.region)&&(!state.capitalOnly||c.nationalCapital)).length;
  state.selected=city;state.hover=null;$('city-name').textContent=cityName(city);$('city-name').title=city.name;$('city-english').textContent=city.en;$('city-region').textContent=cityPlace(city);updateCapitalInfo(city);
  $('city-latitude').textContent=coordinate(city.lat,true);$('city-longitude').textContent=coordinate(city.lon);$('city-description').textContent=city.description;updateClock();buildRoutes();
  if(focus){state.targetZoom=width<740?2.15:1.75;const p=city.point;state.tx=-(p[0]-width/2)*state.targetZoom;state.ty=-(p[1]-height/2)*state.targetZoom-15;constrain();}
  $('search-results').hidden=true;$('city-search').value='';$('city-search').setAttribute('aria-expanded','false');
  if($('settings-panel')?.classList.contains('mobile-open')){$('settings-panel').classList.remove('mobile-open');$('map-settings')?.setAttribute('aria-expanded','false');}
}
function filterRegion(region,focus=true){
  state.region=region;document.querySelectorAll('#continent-filters button').forEach(b=>{const on=b.dataset.region===region;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
  $('node-count').textContent=cities.filter(c=>(region==='all'||c.region===region)&&(!state.capitalOnly||c.nationalCapital)).length;
  if(region!=='all'&&state.selected?.region!==region){const city=cities.find(c=>c.region===region&&(!state.capitalOnly||c.nationalCapital));if(city)selectCity(city,false);}
  buildRoutes();dirty=true;
  if(!focus)return;
  if(region==='all'){state.targetZoom=1;state.tx=state.ty=0;return;}
  const focusSpec={'亚洲':[88,28,1.8],'欧洲':[22,51,3.2],'非洲':[22,1,2.45],'北美洲':[-105,37,2.15],'南美洲':[-62,-20,2.6],'大洋洲':[139,-25,2.6]}[region];
  const p=projection([focusSpec[0],focusSpec[1]]);state.targetZoom=focusSpec[2]*(width<740?1.15:1);
  state.tx=(width/2-p[0])*state.targetZoom;state.ty=(height/2-p[1])*state.targetZoom-20;constrain();
}
function reset(){state.capitalOnly=false;$('capital-only').checked=false;filterRegion('all',false);state.targetZoom=1;state.tx=state.ty=0;state.hover=state.hoverCountry=null;selectCity(cities[0],false);}
function startTour(){sound.play('tour');state.tour=true;tourStarted=performance.now();tourStep=-1;$('map-tour').setAttribute('aria-pressed','true');$('tour-state').textContent='暂停巡游';filterRegion('all',false);}
function stopTour(){state.tour=false;$('map-tour').setAttribute('aria-pressed','false');$('tour-state').textContent='世界巡游';}
function tickTour(time){const step=Math.floor((time-tourStarted)/5200)%tourNames.length;if(step!==tourStep){tourStep=step;const c=cities.find(c=>c.en===tourNames[step]);if(c)selectCity(c,true);}}
function frame(time){
  const dt=lastFrame?Math.min((time-lastFrame)/1000,.06):1/60;lastFrame=time;
  if(state.tour)tickTour(time);
  const ease=reducedMotion?1:1-Math.exp(-dt*7);state.zoom+=(state.targetZoom-state.zoom)*ease;state.x+=(state.tx-state.x)*ease;state.y+=(state.ty-state.y)*ease;
  const view=[state.zoom.toFixed(3),state.x.toFixed(1),state.y.toFixed(1)].join(':');if(view!==lastView){dirty=true;lastView=view;}
  if(dirty)paintBase();drawDynamic(time);$('zoom-readout').textContent=state.zoom.toFixed(2)+'×';requestAnimationFrame(frame);
}
function findTarget(x,y){let best=null;for(const p of visibleCities){const dist=Math.hypot(p.x-x,p.y-y);if(dist<16&&(!best||dist<best.dist))best={...p,dist};}return best;}
function findCountry(x,y){const p=inverseScreen(x,y);return countries.find(c=>p[0]>=c.bounds[0][0]&&p[0]<=c.bounds[1][0]&&p[1]>=c.bounds[0][1]&&p[1]<=c.bounds[1][1]&&mapCtx.isPointInPath(c.path,p[0]*dpr,p[1]*dpr))||null;}
function hoverAt(x,y){
  const target=findTarget(x,y);state.hover=target?.city??null;const basePoint=inverseScreen(x,y),geo=projection.invert(basePoint);
  if(geo&&Number.isFinite(geo[0])&&Math.abs(geo[1])<=90)$('coordinate-readout').textContent=coordinate(geo[1],true)+' / '+coordinate(geo[0]);
  state.hoverCountry=target?null:findCountry(x,y);canvas.style.cursor=target||state.hoverCountry?'pointer':'grab';
  const tip=$('map-tooltip');if(tip){tip.hidden=!target&&!state.hoverCountry;tip.textContent=target?[target.city.name,cityPlace(target.city),target.city.nationalCapital?target.city.capitalRole:''].filter(Boolean).join(' · '):state.hoverCountry?countryName(state.hoverCountry.feature):'';tip.style.left=clamp(x+14,10,width-180)+'px';tip.style.top=clamp(y-35,100,height-60)+'px';}
}
canvas.addEventListener('pointerdown',e=>{interaction();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);pointerDown=true;moved=0;lastPointer={x:e.clientX,y:e.clientY};if(pointers.size===2){const a=[...pointers.values()];touchGap=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);}});
canvas.addEventListener('pointermove',e=>{
  if(!pointerDown){if(performance.now()-lastHover>65){lastHover=performance.now();hoverAt(e.clientX,e.clientY);}return;}
  if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2){const a=[...pointers.values()],gap=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);if(touchGap)setZoom(state.targetZoom*gap/touchGap,[(a[0].x+a[1].x)/2,(a[0].y+a[1].y)/2]);touchGap=gap;moved=100;return;}
  const dx=e.clientX-lastPointer.x,dy=e.clientY-lastPointer.y;moved+=Math.abs(dx)+Math.abs(dy);state.tx+=dx;state.ty+=dy;state.x+=dx;state.y+=dy;constrain();lastPointer={x:e.clientX,y:e.clientY};
});
function pointerUp(e){if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);pointerDown=pointers.size>0;touchGap=0;if(pointerDown)return;if(moved<6){const target=findTarget(e.clientX,e.clientY);if(target)selectCity(target.city);else{const c=findCountry(e.clientX,e.clientY);if(c){state.hoverCountry=c;toast(countryName(c.feature));}}}lastPointer=null;}
canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);canvas.addEventListener('pointerleave',()=>{state.hover=state.hoverCountry=null;if($('map-tooltip'))$('map-tooltip').hidden=true;});
canvas.addEventListener('wheel',e=>{e.preventDefault();interaction();setZoom(state.targetZoom*Math.exp(-clamp(e.deltaY,-150,150)*.002),[e.clientX,e.clientY]);},{passive:false});
canvas.addEventListener('dblclick',()=>{interaction();reset();});
$('zoom-in').addEventListener('click',()=>{interaction();setZoom(state.targetZoom*1.25);});$('zoom-out').addEventListener('click',()=>{interaction();setZoom(state.targetZoom/1.25);});$('map-reset').addEventListener('click',()=>{interaction();reset();});
$('map-tour').addEventListener('click',()=>state.tour?stopTour():startTour());
$('continent-filters').addEventListener('click',e=>{const button=e.target.closest('button[data-region]');if(button){interaction();filterRegion(button.dataset.region);}});
$('capital-only').addEventListener('change',e=>{interaction();state.capitalOnly=e.target.checked;if(state.capitalOnly&&!state.selected?.nationalCapital){const city=cities.find(c=>c.capitalPrimary&&(state.region==='all'||c.region===state.region));if(city)selectCity(city,false);}filterRegion(state.region,false);dirty=true;});
for(const [id,key]of[['route-toggle','routes'],['label-toggle','labels'],['dot-toggle','dots']])$(id).addEventListener('change',e=>{state[key]=e.target.checked;dirty=true;});
function search(query){
  const q=query.trim().toLowerCase();const results=$('search-results');results.replaceChildren();results.hidden=!q;$('city-search').setAttribute('aria-expanded',String(!!q));if(!q)return;
  const matches=findCityMatches(cities,q);
  if(!matches.length){const p=document.createElement('p');p.className='no-results';p.textContent='没有找到地点，试试中文或英文名称';results.append(p);return;}
  for(const city of matches){const b=document.createElement('button');b.type='button';b.className='search-result';b.setAttribute('role','option');const name=document.createElement('span'),region=document.createElement('small');name.textContent=cityName(city);name.title=city.name;region.textContent=[city.country||city.province||city.region,city.nationalCapital?city.capitalRole:city.en].filter(Boolean).join(' · ');b.append(name,region);b.addEventListener('click',()=>{interaction();if(state.region!=='all'&&city.region!==state.region)filterRegion('all',false);selectCity(city);});results.append(b);}
}
$('city-search').addEventListener('input',e=>search(e.target.value));$('city-search').addEventListener('focus',e=>search(e.target.value));
$('city-search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('search-results').querySelector('button')?.click();}if(e.key==='Escape')$('search-results').hidden=true;});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#search-results')&&e.target!==$('city-search'))$('search-results').hidden=true;});
if($('map-settings'))$('map-settings').addEventListener('click',()=>{const panel=$('settings-panel');if(panel){panel.classList.toggle('mobile-open');$('map-settings').setAttribute('aria-expanded',String(panel.classList.contains('mobile-open')));}});
$('map-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前窗口不支持全屏');}});
function updateHand(data){
  if(!data.handCount){lastKeyGesture='none';$('camera-status').textContent='等待手掌';return;}if(state.tour)return;state.lastInteraction=performance.now();
  state.tx+=(data.yawDelta||0)*width*1.3;state.ty+=(data.pitchDelta||0)*height*1.3;
  const delta=clamp(data.zoomDelta||0,-.04,.04);if(delta)setZoom(state.targetZoom*Math.exp(delta));constrain();
  if(data.gesture==='victory'&&lastKeyGesture!=='victory'&&performance.now()-lastHighlight>3500){lastHighlight=performance.now();const next=(cities.indexOf(state.selected)+1)%cities.length;selectCity(cities[next]);toast('点亮下一座城市 · '+cities[next].name);}
  lastKeyGesture=data.gesture;const words={'none':'等待手掌','tracking':'手掌跟踪','pinch':'捏合平移','open-palm':'展开 · 放大','fist':'握拳 · 缩小','two-hands':'双手缩放','victory':'切换城市'};$('camera-status').textContent=words[data.gesture]||'手势识别';
}
async function toggleCamera(){
  const button=$('map-camera');
  if(state.camera){handController.stop();state.camera=false;$('camera-preview').hidden=true;button.classList.remove('active');button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','开启摄像头手势控制');button.querySelector('span').textContent='开启手势';return;}
  button.disabled=true;if(state.tour)stopTour();
  try{
    toast('请允许摄像头访问；识别在本机完成',5000);const {HandController}=await import('./hand-controller.js');
    handController??=new HandController({video:$('camera-video'),overlay:$('hand-overlay'),onUpdate:updateHand,onStatus:text=>{$('camera-status').textContent=text;}});
    const started=await handController.start();if(!started||!handController.running){toast($('camera-status').textContent,5000);return;}
    state.camera=true;button.classList.add('active');button.setAttribute('aria-pressed','true');button.setAttribute('aria-label','关闭摄像头手势控制');button.querySelector('span').textContent='关闭手势';$('camera-preview').hidden=false;toast('张掌放大、握拳缩小、捏合移动地图；V 手势切换城市',5500);
  }catch(error){handController?.stop();toast(error.message||'摄像头启动失败',5000);}finally{button.disabled=false;}
}
$('map-camera').addEventListener('click',toggleCamera);
window.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA/.test(e.target.tagName))return;const k=e.key.toLowerCase();
  if(k==='r'){interaction();reset();}if(k==='d')state.tour?stopTour():startTour();if(k==='+'||k==='='){interaction();setZoom(state.targetZoom*1.2);}if(k==='-'){interaction();setZoom(state.targetZoom/1.2);}
  if(k==='arrowright'||k==='arrowleft'){interaction();if(state.region!=='all')filterRegion('all',false);const index=cities.indexOf(state.selected),next=(index+(k==='arrowright'?1:-1)+cities.length)%cities.length;selectCity(cities[next]);}
});
window.addEventListener('resize',resize);window.addEventListener('pagehide',()=>handController?.stop());
window.worldStatus=()=>({ready:window.__worldReady===true,zoom:state.zoom,targetZoom:state.targetZoom,countryCount:countries.length,cityCount:cities.length,selected:state.selected?.name,selectedId:state.selected?.id,selectedCountry:state.selected?.country,capitalOnly:state.capitalOnly,capitalCenters:cities.filter(c=>c.nationalCapital).length,routeCount:routePaths.length,region:state.region,visibleCities:cities.filter(c=>(state.region==='all'||c.region===state.region)&&(!state.capitalOnly||c.nationalCapital)).length,tour:state.tour,camera:state.camera,routes:state.routes,labels:state.labels,dots:state.dots});
async function init(){
  try{
    const [geo,data,points]=await Promise.all([fetch(assets.world).then(r=>{if(!r.ok)throw Error('地图资源未加载');return r.json();}),fetch('./assets/cities.json?v=all-places1').then(r=>{if(!r.ok)throw Error('地点数据未加载');return r.json();}),loadPoints(assets.mapDots)]);
    countries=geo.features.map(feature=>{if(d3.geoArea(feature)>Math.PI*2)reverseGeometry(feature.geometry);return{feature};});cities=data;
    for(let i=0;i<points.length;i+=3){const x=points[i],y=points[i+1],z=points[i+2],r=Math.hypot(x,y,z);landDots.push({lon:Math.atan2(x,z)/radians,lat:Math.asin(clamp(y/r,-1,1))/radians});}
    resize();selectCity(cities[0],false);observeCityCard('world');$('node-count').textContent=cities.length;$('country-count').textContent=countries.length;
    $('map-loading').classList.add('loaded');setTimeout(()=>$('map-loading').hidden=true,600);window.__worldReady=true;requestAnimationFrame(frame);setInterval(updateClock,10000);
  }catch(error){console.error(error);$('map-loading').lastElementChild.textContent='地图加载遇到问题';toast('请使用启动文件打开，或刷新页面后重试。',9000);}
}
init();
