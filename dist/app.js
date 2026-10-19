import {assets,loadPoints} from './atlas-load.js?v=1';
import {sound,revealDestination} from './atlas-audio.js?v=1';
import * as THREE from './vendor/three.module.min.js';
import {cityName,cityPlace,findCityMatches,updateCapitalInfo,observeCityCard,routeDestinations} from './city-catalog.js?v=all-places1';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const rad = v => v * Math.PI / 180;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const smooth = (a,b,v) => { const x=clamp((v-a)/(b-a),0,1); return x*x*(3-2*x); };
const state = { yaw:rad(-105), pitch:rad(21), targetYaw:rad(-105), targetPitch:rad(21), zoom:1, targetZoom:1,
  rotate:true,routes:true,labels:true,capitalOnly:false,cinema:false,camera:false,demo:false,selected:null,hover:null,gesture:'鼠标 · 待机',
  lastInteraction:0,meteorUntil:0,eventUntil:0,tracking:false,mode:'realistic',particleMix:0 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if(reducedMotion) state.rotate=false;
$('auto-rotate').checked=state.rotate;
let width=innerWidth,height=innerHeight,dpr=Math.min(devicePixelRatio,2),lastFrame=0,frameCount=0,lastFps=0;
let renderer,scene,camera,earthGroup,earthSurface,landDots,oceanDots,atmosphere,moon,nightSurface,clouds,grid,coastline;
const sunDirection=new THREE.Vector3(-.8,.7,1).normalize();
let routeArcs=[],routePhotons,oceanCount=assets.oceanCount;
let particlesReady=false,particlesPromise,moonPromise;
const satellites=[];
let handController,gestureBefore='none',lastMeteorGesture=0,landCount=assets.landCount,cityTargets=[],routeGroup;
let dragging=false,pointerTravel=0,lastPointer=null,pointerStart=null,touchDistance=0;
const pointers=new Map();
const starCanvas=$('stars'), starCtx=starCanvas.getContext('2d');
const skyCanvas=document.createElement('canvas'), skyCtx=skyCanvas.getContext('2d');
const labelCanvas=$('labels'), labelCtx=labelCanvas.getContext('2d');
let toastTimer;
function toast(message,time=3600){ $('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),time); }
function interact(){state.lastInteraction=performance.now();if(state.demo)stopDemo();}
function coords(lat,lon,r=1){return new THREE.Vector3(Math.cos(rad(lat))*Math.sin(rad(lon))*r,Math.sin(rad(lat))*r,Math.cos(rad(lat))*Math.cos(rad(lon))*r);}

// City nodes are shared with the world map and loaded during initialization.
const cities = [];

let labelCount=0,labelExclusions=[],lastLabelLayout=0;
let seed=91823;
function random(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
const stars=Array.from({length:1200},()=>({x:random(),y:random(),size:random()<.012?1.3:random()*.6+.3,a:random()*.32+.07,phase:random()*TAU}));
const meteors=[];
function paintSky(){
  skyCanvas.width=width*dpr;skyCanvas.height=height*dpr;skyCtx.setTransform(dpr,0,0,dpr,0,0);
  const bg=skyCtx.createRadialGradient(width*.51,height*.49,0,width*.51,height*.49,Math.max(width,height)*.7);
  bg.addColorStop(0,'#09182c');bg.addColorStop(.42,'#050e1b');bg.addColorStop(1,'#02070e');
  skyCtx.fillStyle=bg;skyCtx.fillRect(0,0,width,height);
  for(const s of stars){
    skyCtx.fillStyle=`rgba(184,214,245,${s.a})`;skyCtx.fillRect(s.x*width,s.y*height,s.size,s.size);
    if(s.size>1.6){skyCtx.fillStyle=`rgba(134,182,250,${s.a*.16})`;skyCtx.fillRect(s.x*width-1,s.y*height-1,3.5,3.5);}
  }
}
function drawStars(time){
  starCtx.setTransform(dpr,0,0,dpr,0,0);starCtx.drawImage(skyCanvas,0,0,width,height);
  if(time<state.meteorUntil&&Math.random()<.09) meteors.push({x:Math.random()*width*.95,y:Math.random()*height*.6,born:time,life:650+Math.random()*500,len:60+Math.random()*100});
  for(let i=meteors.length-1;i>=0;i--){
    const m=meteors[i],age=(time-m.born)/m.life;if(age>1){meteors.splice(i,1);continue;}
    const x=m.x+age*height*.55,y=m.y+age*height*.35;
    const g=starCtx.createLinearGradient(x-m.len,y-m.len*.64,x,y);g.addColorStop(0,'#bddaff00');g.addColorStop(1,`rgba(215,238,255,${Math.sin(age*Math.PI)*.9})`);
    starCtx.strokeStyle=g;starCtx.lineWidth=1;starCtx.beginPath();starCtx.moveTo(x-m.len,y-m.len*.64);starCtx.lineTo(x,y);starCtx.stroke();
  }
}
function glowTexture(color,stops){
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(64,64,0,64,64,64);
  for(const [p,a] of stops)g.addColorStop(p,`rgba(${color},${a})`);ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function sprite(texture,size,position,opacity=1){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false}));s.scale.setScalar(size);if(position)s.position.copy(position);return s;}
function pointCloud(values,size,opacity,ocean=false){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(values,3));
  const colors=[];for(let i=0;i<values.length;i+=3){const y=values[i+1],f=ocean?.3:.68+.29*Math.max(0,y);colors.push(f*.71,f*.9,f);}
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const material=new THREE.PointsMaterial({size,vertexColors:true,transparent:true,opacity,depthWrite:false,sizeAttenuation:true,map:glowTexture('205,237,255',[[0,1],[.68,1],[.87,.45],[1,0]]),alphaTest:.08});
  return new THREE.Points(geometry,material);
}
function earthParticles(values,ocean=false){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(values,3));
  const material=new THREE.ShaderMaterial({
    uniforms:{opacity:{value:1},pointScale:{value:height*dpr*.5},sunDirection:{value:sunDirection},ocean:{value:ocean?1:0}},
    vertexShader:`uniform float pointScale;uniform vec3 sunDirection;uniform float ocean;varying vec3 tint;varying float facing;
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vec3 n=normalize(normalMatrix*position);facing=max(0.0,dot(n,normalize(-mv.xyz)));
      float grain=fract(sin(dot(position,vec3(127.1,311.7,74.7)))*43758.5453);
      float lit=0.55+0.45*max(0.0,dot(normalize(mat3(modelMatrix)*position),sunDirection));
      tint=mix(vec3(0.13,0.38,0.57),mix(vec3(0.12,0.59,0.76),vec3(0.54,0.83,0.93),grain),1.0-ocean)*lit;
      gl_Position=projectionMatrix*mv;gl_PointSize=clamp(mix(0.0075,0.0035,ocean)*pointScale/-mv.z,0.75,2.6);}`,
    fragmentShader:`uniform float opacity;uniform float ocean;varying vec3 tint;varying float facing;
      void main(){float d=length(gl_PointCoord-0.5)*2.0;if(d>1.0)discard;
      float edge=smoothstep(0.02,0.35,facing);float alpha=(1.0-smoothstep(0.25,1.0,d))*opacity*edge;
      gl_FragColor=vec4(tint,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,transparent:true,depthWrite:false,blending:THREE.NormalBlending});
  return new THREE.Points(geometry,material);
}
function makeCoastline(geo){
  const vertices=[];
  for(const feature of geo.features){
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    for(const polygon of polygons)for(const ring of polygon)for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i];if(Math.abs(a[0]-b[0])>180)continue;
      vertices.push(...coords(a[1],a[0],1.007).toArray(),...coords(b[1],b[0],1.007).toArray());
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  return new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x379db7,transparent:true,opacity:.2,depthWrite:false}));
}
function makeGrid(){
  const verts=[];
  for(let lat=-60;lat<=60;lat+=30)for(let lon=-180;lon<180;lon+=2){const a=coords(lat,lon,1.002),b=coords(lat,lon+2,1.002);verts.push(...a.toArray(),...b.toArray());}
  for(let lon=-180;lon<180;lon+=30)for(let lat=-88;lat<88;lat+=2){const a=coords(lat,lon,1.002),b=coords(lat+2,lon,1.002);verts.push(...a.toArray(),...b.toArray());}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));return new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x5688c5,transparent:true,opacity:.045,depthWrite:false}));
}
function buildRoutes(city){
  if(!city||!earthGroup)return;
  if(routeGroup){earthGroup.remove(routeGroup);routeGroup.children.forEach(o=>{o.geometry?.dispose();o.material?.dispose();});}
  routeGroup=new THREE.Group();
  const start=city.position.clone().normalize(),routeVertices=[];routeArcs=[];
  const destinations=routeDestinations(cities.filter(c=>!state.capitalOnly||c.nationalCapital),city,8);
  for(const dest of destinations){
    const end=dest.position.clone().normalize(),angle=start.angleTo(end),sin=Math.sin(angle);let previous;routeArcs.push({start,end,angle,phase:dest.index*.047});
    for(let k=0;k<=46;k++){
      const t=k/46;const v=sin>.0001?start.clone().multiplyScalar(Math.sin((1-t)*angle)/sin).addScaledVector(end,Math.sin(t*angle)/sin):start.clone().lerp(end,t).normalize();
      v.multiplyScalar(1.018+Math.sin(Math.PI*t)*(.025+angle*.045));if(previous)routeVertices.push(...previous.toArray(),...v.toArray());previous=v;
    }
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(routeVertices,3));
  routeGroup.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x8acbff,transparent:true,opacity:.2,depthWrite:false})));
  const photonGeo=new THREE.BufferGeometry();photonGeo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(routeArcs.length*3),3));
  routePhotons=new THREE.Points(photonGeo,new THREE.PointsMaterial({color:0xffd298,size:.015,transparent:true,opacity:.85,depthWrite:false,map:glowTexture('255,231,189',[[0,1],[.5,.9],[1,0]]),blending:THREE.AdditiveBlending}));routeGroup.add(routePhotons);
  earthGroup.add(routeGroup);$('route-count').textContent=`${destinations.length} 连线`;
}
function alignTexture(geometry){
  // Move the geometry's existing UV seam to longitude 180°. This preserves
  // triangle UV continuity and aligns all equirectangular maps with city points.
  geometry.rotateY(-Math.PI/2);
}
function ensureParticles(){
  if(particlesReady)return Promise.resolve(true);
  if(particlesPromise)return particlesPromise;
  $('particle-mode').setAttribute('aria-busy','true');
  particlesPromise=Promise.all([loadPoints(assets.land),loadPoints(assets.ocean)]).then(([land,ocean])=>{
    landDots.geometry.setAttribute('position',new THREE.BufferAttribute(land,3));landDots.geometry.computeBoundingSphere();
    oceanDots.geometry.setAttribute('position',new THREE.BufferAttribute(ocean,3));oceanDots.geometry.computeBoundingSphere();
    landCount=land.length/3;oceanCount=ocean.length/3;particlesReady=true;return true;
  }).catch(()=>{particlesPromise=null;setMode('realistic');toast('粒子视图暂未加载，请再点一次重试。');return false;})
    .finally(()=>$('particle-mode').removeAttribute('aria-busy'));
  return particlesPromise;
}
function loadMoonDetail(){
  if(moonPromise)return moonPromise;
  moonPromise=new THREE.TextureLoader().loadAsync(assets.moon).then(map=>{
    map.colorSpace=THREE.SRGBColorSpace;moon.children[0].material.map=map;moon.children[0].material.needsUpdate=true;
  }).catch(()=>{moonPromise=null;});
  return moonPromise;
}
function loadSurfaceDetail(){
  const loader=new THREE.TextureLoader();
  const load=(url,colorSpace,apply)=>loader.loadAsync(url).then(map=>{
    map.colorSpace=colorSpace;map.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);apply(map);
  }).catch(()=>{}); // Optional visual detail never blocks exploring the globe.
  void load(assets.night,THREE.NoColorSpace,map=>{nightSurface.material.uniforms.nightMap.value.dispose();nightSurface.material.uniforms.nightMap.value=map;});
  void load(assets.clouds,THREE.SRGBColorSpace,map=>{clouds.material.map.dispose();clouds.material.map=map;clouds.material.needsUpdate=true;});
  void load('./assets/earth-normal.jpg',THREE.NoColorSpace,map=>{earthSurface.material.normalMap=map;earthSurface.material.needsUpdate=true;});
  void load('./assets/earth-specular.jpg',THREE.NoColorSpace,map=>{earthSurface.material.specularMap=map;earthSurface.material.needsUpdate=true;});
}
async function init(){
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(dpr);renderer.setSize(width,height);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;
    $('scene').appendChild(renderer.domElement);
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(36,width/height,.1,100);camera.position.z=7.2;
    scene.add(new THREE.AmbientLight(0x91b5dc,.23));scene.add(new THREE.HemisphereLight(0xd1e6ff,0x020817,.25));const light=new THREE.DirectionalLight(0xfff6e9,2.7);light.position.copy(sunDirection).multiplyScalar(6);scene.add(light);
    earthGroup=new THREE.Group();earthGroup.rotation.order='XYZ';scene.add(earthGroup);
    const core=new THREE.Mesh(new THREE.SphereGeometry(.999,96,64),new THREE.MeshPhongMaterial({color:0x082440,emissive:0x010611,shininess:18,specular:0x10273b}));earthGroup.add(core);
    const loader=new THREE.TextureLoader();
    // Show a fully usable Earth first. Surface detail streams in after its first frame.
    const [texture,cityInfo,coasts]=await Promise.all([
      loader.loadAsync(assets.day),
      fetch('./assets/cities.json?v=all-places1').then(r=>{if(!r.ok)throw Error('地点数据未加载');return r.json();}),
      fetch('./assets/ne_110m_land.geojson').then(r=>r.json())
    ]);
    const nightMap=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);nightMap.needsUpdate=true;
    const cloudMap=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);cloudMap.needsUpdate=true;
    const normalMap=null,specularMap=null;
    texture.colorSpace=THREE.SRGBColorSpace;
    cloudMap.colorSpace=THREE.SRGBColorSpace;nightMap.colorSpace=THREE.NoColorSpace;
    cities.push(...cityInfo.map((city,index)=>({...city,index,position:coords(city.lat,city.lon,1.015)})));
    for(const map of [texture,nightMap,cloudMap])map.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
    const surfaceGeo=new THREE.SphereGeometry(1,128,96);alignTexture(surfaceGeo);
    earthSurface=new THREE.Mesh(surfaceGeo,new THREE.MeshPhongMaterial({map:texture,normalMap,normalScale:new THREE.Vector2(.07,.07),specularMap,transparent:true,opacity:1,shininess:36,specular:0x52667a,depthWrite:false}));earthGroup.add(earthSurface);
    const nightGeo=new THREE.SphereGeometry(1.002,96,64);alignTexture(nightGeo);
    nightSurface=new THREE.Mesh(nightGeo,new THREE.ShaderMaterial({
      uniforms:{nightMap:{value:nightMap},sunDirection:{value:sunDirection},visibility:{value:1}},
      vertexShader:`varying vec2 vUv;varying vec3 vNormal;void main(){vUv=uv;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`uniform sampler2D nightMap;uniform vec3 sunDirection;uniform float visibility;varying vec2 vUv;varying vec3 vNormal;
        void main(){vec3 lights=texture2D(nightMap,vUv).rgb;float night=1.0-smoothstep(-0.18,0.18,dot(normalize(vNormal),sunDirection));
        float power=max(lights.r,max(lights.g,lights.b));gl_FragColor=vec4(vec3(1.0,0.61,0.28)*power*1.7,power*night*visibility);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));earthGroup.add(nightSurface);
    const cloudGeo=new THREE.SphereGeometry(1.010,96,64);alignTexture(cloudGeo);
    clouds=new THREE.Mesh(cloudGeo,new THREE.MeshPhongMaterial({map:cloudMap,transparent:true,opacity:.33,depthWrite:false,color:0xe5f0ff,shininess:0,alphaTest:.015}));earthGroup.add(clouds);
    landDots=earthParticles([]);earthGroup.add(landDots);oceanDots=earthParticles([],true);earthGroup.add(oceanDots);grid=makeGrid();earthGroup.add(grid);coastline=makeCoastline(coasts);earthGroup.add(coastline);
    // Named lights are all in the shared catalog. Draw their selectable pins in
    // one canvas pass instead of creating two GPU sprites for every location.
    for(let i=0;i<3;i++){
      const orbit=new THREE.Group();orbit.rotation.set(rad(28+i*41),rad(i*58),rad(14+i*31));earthGroup.add(orbit);
      const craft=sprite(glowTexture('193,219,253',[[0,1],[.12,1],[.3,.35],[1,0]]),.023);orbit.add(craft);satellites.push({craft,radius:1.16,phase:i*2.1,speed:.11+i*.018});
    }
    const stationOrbit=new THREE.Group();stationOrbit.rotation.set(rad(51.6),rad(55),0);earthGroup.add(stationOrbit);
    const station=new THREE.Group();station.add(new THREE.Mesh(new THREE.BoxGeometry(.024,.007,.008),new THREE.MeshBasicMaterial({color:0xabc5de})));
    const panels=new THREE.Mesh(new THREE.BoxGeometry(.039,.014,.002),new THREE.MeshBasicMaterial({color:0x35618b}));station.add(panels);stationOrbit.add(station);satellites.push({craft:station,radius:1.10,phase:1.3,speed:.15});
    buildRoutes(cities[0]);
    atmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.025,96,64),new THREE.ShaderMaterial({
      uniforms:{glowStrength:{value:.5},sunDirection:{value:sunDirection}},
      vertexShader:'varying vec3 n;varying vec3 v;varying vec3 wn;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);n=normalize(normalMatrix*normal);wn=normalize(mat3(modelMatrix)*normal);v=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
      fragmentShader:`varying vec3 n;varying vec3 v;varying vec3 wn;uniform vec3 sunDirection;uniform float glowStrength;
      void main(){float edge=abs(dot(normalize(n),normalize(v)));float rim=pow(1.0-edge,2.4)*smoothstep(0.0,0.17,edge);float daylight=smoothstep(-0.45,0.7,dot(normalize(wn),sunDirection));
      gl_FragColor=vec4(mix(vec3(0.035,0.20,0.55),vec3(0.16,0.59,1.0),daylight),rim*glowStrength*(0.32+0.68*daylight));}`,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.BackSide}));scene.add(atmosphere);
    moon=new THREE.Group();moon.position.set(1.67,-.88,-1.15);moon.scale.setScalar(.72);scene.add(moon);
    const moonMap=null;
    moon.add(new THREE.Mesh(new THREE.SphereGeometry(.21,48,32),new THREE.MeshPhongMaterial({color:0xb9c3d0,map:moonMap,emissive:0x030710,shininess:0})));
    moon.add(new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(.213,4)),new THREE.LineBasicMaterial({color:0x749ec8,transparent:true,opacity:.13})));
    const lunar=[];for(let i=0;i<2100;i++){const y=random()*2-1,a=random()*TAU,r=.214*Math.sqrt(1-y*y);lunar.push(r*Math.cos(a),y*.214,r*Math.sin(a));}
    moon.add(pointCloud(lunar,.003,.35));moon.add(sprite(glowTexture('99,148,213',[[0,0],[.55,0],[.66,.05],[.8,.016],[1,0]]),.72));
    $('particle-count').textContent=landCount.toLocaleString()+' 点';$('city-count').textContent=cities.length+' 节点';
    state.selected=cities[0];updateCityCard(cities[0]);resize();observeCityCard('globe');$('loading').style.opacity='0';setTimeout(()=>$('loading').hidden=true,750);
    lastFps=performance.now();requestAnimationFrame(frame);window.__earthReady=true;
    requestAnimationFrame(()=>setTimeout(loadSurfaceDetail,0));
    if(new URLSearchParams(location.search).has('demo'))startDemo();
  }catch(error){console.error(error);$('loading').querySelector('p').textContent='星球加载遇到问题';$('loading').querySelector('small').textContent='请使用启动脚本打开网页，或刷新后重试。';toast(error.message,8000);}
}

const world=new THREE.Vector3(),projected=new THREE.Vector3(),camDirection=new THREE.Vector3(),normal=new THREE.Vector3();
function drawLabels(time,detail){
  labelCtx.setTransform(dpr,0,0,dpr,0,0);labelCtx.clearRect(0,0,width,height);cityTargets=[];
  const fontSize=width<700?10:11;labelCtx.font=`${fontSize}px "Microsoft YaHei",sans-serif`;labelCtx.textBaseline='middle';
  if(time-lastLabelLayout>250){
    labelExclusions=[...document.querySelectorAll('.masthead,.hero-heading,.city-card,.globe-controls,.help-panel,.control-body,.search-results')]
      .filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>el.getBoundingClientRect());lastLabelLayout=time;
  }
  const featured=['SHANGHAI','BEIJING','TOKYO','SEOUL','SINGAPORE','NEW DELHI','CAIRO','LONDON','PARIS','MOSCOW','NEW YORK','SYDNEY','DUBAI'];
  const candidates=[];
  for(const city of cities){
    if(state.capitalOnly&&!city.nationalCapital)continue;
    earthGroup.localToWorld(world.copy(city.position));normal.copy(world).normalize();camDirection.copy(camera.position).sub(world).normalize();
    const facing=normal.dot(camDirection),selected=city===state.selected,hover=city===state.hover;
    if(facing<=.08)continue;
    const fade=smooth(.08,.45,facing),active=selected||hover;
    projected.copy(world).project(camera);const x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height;
    if(x<0||x>width||y<0||y>height)continue;cityTargets.push({city,x,y});
    if(active){const glow=labelCtx.createRadialGradient(x,y,0,x,y,14);glow.addColorStop(0,'#f5d49d90');glow.addColorStop(.32,'#e6c58c2b');glow.addColorStop(1,'#e6c58c00');labelCtx.fillStyle=glow;labelCtx.fillRect(x-14,y-14,28,28);}
    labelCtx.fillStyle=active?`rgba(255,222,172,${fade})`:city.nationalCapital?`rgba(226,196,136,${fade*.84})`:`rgba(136,205,204,${fade*.6})`;
    labelCtx.beginPath();labelCtx.arc(x,y,active?2:city.nationalCapital?1.25:1,0,TAU);labelCtx.fill();
    if(active){labelCtx.strokeStyle=selected?'#e9c9959c':'#9fdcdba0';labelCtx.lineWidth=.7;labelCtx.beginPath();labelCtx.arc(x,y,selected?5:4,0,TAU);labelCtx.stroke();if(selected&&!reducedMotion){const phase=(time%2800)/2800;labelCtx.strokeStyle=`rgba(233,201,149,${(1-phase)*.34*fade})`;labelCtx.beginPath();labelCtx.arc(x,y,6+phase*12,0,TAU);labelCtx.stroke();}}
    if(!state.labels||(!active&&facing<.38))continue;
    candidates.push({city,x,y,active,selected,hover,priority:selected?10000:hover?9000:(featured.includes(city.en.toUpperCase())?1000:city.capitalPrimary?100:0)+facing*20});
  }
  const occupied=[];labelCount=0;
  const budget=Math.round(width<700?4+smooth(1,3,state.zoom)*18:12+smooth(1.2,3.2,state.zoom)*44);
  for(const item of candidates.sort((a,b)=>b.priority-a.priority)){
    if(labelCount>=budget&&!item.active)continue;
    const {city,x,y,active,selected}=item,label=cityName(city),textWidth=labelCtx.measureText(label).width;
    const boxW=textWidth+16,lx=x+15+boxW>width-16?x-boxW-13:x+13,ly=y-9;
    const rect={left:lx-6,right:lx+boxW,top:ly-11,bottom:ly+11};
    if(labelExclusions.some(b=>rect.left<b.right+8&&rect.right>b.left-8&&rect.top<b.bottom+8&&rect.bottom>b.top-8))continue;
    if(!active&&occupied.some(b=>rect.left<b.right+12&&rect.right>b.left-12&&rect.top<b.bottom+9&&rect.bottom>b.top-9))continue;
    occupied.push(rect);labelCount++;
    if(active){labelCtx.fillStyle='rgba(3,14,25,.8)';labelCtx.beginPath();labelCtx.roundRect(lx-5,ly-10,textWidth+11,20,4);labelCtx.fill();}
    labelCtx.strokeStyle=active?'#dfc59888':'#82c9d04d';labelCtx.lineWidth=.6;labelCtx.beginPath();labelCtx.moveTo(x+3,y-2);labelCtx.lineTo(lx-4,ly+1);labelCtx.stroke();
    labelCtx.fillStyle=selected?'#f3d8ad':item.hover?'#d7f4ee':'#9bbac5';labelCtx.shadowColor='#020812';labelCtx.shadowBlur=4;labelCtx.fillText(label,lx,ly);labelCtx.shadowBlur=0;
  }
  if(time>state.eventUntil)$('event-title').classList.remove('show');
}
function showTitle(name,en,duration=3200){$('event-title').querySelector('h2').textContent=name;$('event-title').querySelector('p').textContent=en;$('event-title').classList.add('show');state.eventUntil=performance.now()+duration;}
function meteorShower(){sound.play('meteor');state.meteorUntil=performance.now()+6800;showTitle('流星雨','METEOR SHOWER',3400);}
function updateCityCard(city){
  if(!$('globe-city-name'))return;$('globe-city-name').textContent=cityName(city);$('globe-city-name').title=city.name;$('globe-city-english').textContent=city.en;
  $('globe-city-region').textContent=cityPlace(city);updateCapitalInfo(city,'globe-city');$('globe-city-coordinate').textContent=Math.abs(city.lat).toFixed(2)+'° '+(city.lat>=0?'N':'S')+' / '+Math.abs(city.lon).toFixed(2)+'° '+(city.lon>=0?'E':'W');
  const intro=$('globe-city-description');if(intro){intro.textContent=city.description||'';intro.hidden=!city.description;}
}
function setMode(mode){if(mode!==state.mode)sound.play('view');if(mode==='particle')void ensureParticles();state.mode=mode;$('realistic-mode')?.setAttribute('aria-pressed',String(mode==='realistic'));$('particle-mode')?.setAttribute('aria-pressed',String(mode==='particle'));}
function focusCity(city,zoom=state.mode==='particle'?1.85:1.35){
  if(!window.__earthReady||!city)return;sound.play('city',city);revealDestination(document.querySelector('.city-card'));
  if(state.capitalOnly&&!city.nationalCapital){state.capitalOnly=false;$('capital-only').checked=false;}
  state.selected=city;const wanted=rad(-city.lon);state.targetYaw+=Math.atan2(Math.sin(wanted-state.targetYaw),Math.cos(wanted-state.targetYaw));
  state.targetPitch=rad(city.lat);state.targetZoom=zoom;state.lastInteraction=performance.now()+2400;buildRoutes(city);updateCityCard(city);showTitle(city.name,city.en,3600);
}
function reset(){if(!window.__earthReady)return;state.capitalOnly=false;$('capital-only').checked=false;state.targetYaw+=Math.atan2(Math.sin(rad(-105)-state.targetYaw),Math.cos(rad(-105)-state.targetYaw));state.targetPitch=rad(21);state.targetZoom=1;state.selected=cities[0];buildRoutes(cities[0]);updateCityCard(cities[0]);$('event-title').classList.remove('show');}
function resize(){
  width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio,2);
  for(const c of [starCanvas,labelCanvas]){c.width=width*dpr;c.height=height*dpr;c.style.width=width+'px';c.style.height=height+'px';}
  paintSky();
  if(moon)moon.position.set(width<700?1.32:1.67,width<700?-1.35:-.88,width<700?-2.0:-1.15);
  if(renderer){renderer.setPixelRatio(dpr);renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();}
  if(landDots)landDots.material.uniforms.pointScale.value=height*dpr*.5;
  if(oceanDots)oceanDots.material.uniforms.pointScale.value=height*dpr*.5;
  lastLabelLayout=-Infinity;
}
window.addEventListener('resize',resize);
function frame(time){
  const dt=lastFrame?Math.min((time-lastFrame)/1000,.05):1/60;lastFrame=time;
  if(state.demo)tickDemo(time);else if(state.rotate&&!dragging&&!state.tracking&&time-state.lastInteraction>1600)state.targetYaw+=dt*.045;
  const lerp=1-Math.exp(-dt*7);state.yaw+=(state.targetYaw-state.yaw)*lerp;state.pitch+=(state.targetPitch-state.pitch)*lerp;state.zoom+=(state.targetZoom-state.zoom)*(1-Math.exp(-dt*5.2));
  earthGroup.rotation.set(state.pitch,state.yaw,0);earthGroup.updateMatrixWorld(true);
  const portrait=Math.max(1,.83/camera.aspect);camera.position.z=1+(camera.aspect<.83?4.55:4.0)/state.zoom*portrait;
  const targetDetail=particlesReady?(state.demo?smooth(1.25,2.3,state.zoom):(state.mode==='particle'?1:0)):0;state.particleMix+=(targetDetail-state.particleMix)*(1-Math.exp(-dt*5));
  const detail=state.particleMix;earthSurface.material.opacity=1-detail;earthSurface.visible=detail<.998;
  nightSurface.material.uniforms.visibility.value=1-detail;nightSurface.visible=detail<.998;
  clouds.rotation.y+=dt*.008;clouds.material.opacity=.36*(1-detail);clouds.visible=detail<.98;
  landDots.material.uniforms.opacity.value=.015+.88*detail;
  oceanDots.material.uniforms.opacity.value=.01+.14*detail;grid.material.opacity=.004+.014*detail;coastline.material.opacity=.015+.24*detail;
  routeGroup.visible=state.routes;routeGroup.children[0].material.opacity=.14+.05*detail;routePhotons.material.opacity=.65;
  const photonAttr=routePhotons.geometry.attributes.position;
  for(let i=0;i<routeArcs.length;i++){const a=routeArcs[i],t=(time*.000024+a.phase)%1,sin=Math.sin(a.angle);const p=sin>.0001?a.start.clone().multiplyScalar(Math.sin((1-t)*a.angle)/sin).addScaledVector(a.end,Math.sin(t*a.angle)/sin):a.start.clone().lerp(a.end,t).normalize();p.multiplyScalar(1.018+Math.sin(Math.PI*t)*(.025+a.angle*.045));photonAttr.setXYZ(i,p.x,p.y,p.z);}photonAttr.needsUpdate=true;
  atmosphere.material.uniforms.glowStrength.value=.6-.18*detail;
  moon.visible=state.demo&&state.zoom<1.65;moon.rotation.y+=dt*.035;moon.children[1].visible=moon.children[2].visible=detail>.5;
  for(const s of satellites){const a=time*.001*s.speed+s.phase;s.craft.position.set(Math.cos(a)*s.radius,0,Math.sin(a)*s.radius);s.craft.rotation.y=a;}
  drawStars(time);renderer.render(scene,camera);drawLabels(time,detail);
  frameCount++;if(time-lastFps>600){const fps=Math.min(240,Math.round(frameCount*1000/(time-lastFps)));lastFps=time;frameCount=0;
    let longitude=(-state.yaw*180/Math.PI)%360;if(longitude>180)longitude-=360;if(longitude<-180)longitude+=360;
    const latitude=state.pitch*180/Math.PI;$('longitude').textContent=Math.abs(longitude).toFixed(1)+'° '+(longitude>=0?'E':'W');$('latitude').textContent=Math.abs(latitude).toFixed(1)+'° '+(latitude>=0?'N':'S');
    $('zoom-value').textContent=state.zoom.toFixed(2)+'×';$('fps').textContent=fps+' FPS';$('gesture').textContent=state.gesture;$('view-mode').textContent=detail>.5?'粒子星球':'真实地球';
    $('zoom-slider').value=state.targetZoom;$('slider-output').textContent=state.targetZoom.toFixed(2)+'×';
  }
  requestAnimationFrame(frame);
}

function pointerPosition(e){return{x:e.clientX,y:e.clientY};}
$('universe').addEventListener('pointerdown',e=>{
  interact();pointers.set(e.pointerId,pointerPosition(e));$('universe').setPointerCapture(e.pointerId);dragging=true;pointerTravel=0;pointerStart=lastPointer=pointerPosition(e);state.gesture='拖动 · 旋转';
  if(pointers.size===2){const p=[...pointers.values()];touchDistance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);}
});
$('universe').addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId)){if(e.pointerType==='mouse'){let best=null;for(const target of cityTargets){const distance=Math.hypot(target.x-e.clientX,target.y-e.clientY);if(distance<14&&(!best||distance<best.distance))best={city:target.city,distance};}state.hover=best?.city??null;renderer.domElement.style.cursor=best?'pointer':'grab';}return;}const p=pointerPosition(e);pointers.set(e.pointerId,p);
  if(pointers.size===2){const t=[...pointers.values()],dist=Math.hypot(t[0].x-t[1].x,t[0].y-t[1].y);if(touchDistance>0)state.targetZoom=clamp(state.targetZoom*dist/touchDistance,.7,4.2);touchDistance=dist;pointerTravel=100;state.gesture='双指 · 缩放';return;}
  const dx=p.x-lastPointer.x,dy=p.y-lastPointer.y;pointerTravel+=Math.abs(dx)+Math.abs(dy);
  state.targetYaw+=dx*.005;state.targetPitch=clamp(state.targetPitch+dy*.004,-1.4,1.4);lastPointer=p;state.lastInteraction=performance.now();
});
function pointerUp(e){
  if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);dragging=pointers.size>0;touchDistance=0;
  if(dragging)lastPointer=[...pointers.values()][0];
  if(!dragging){if(pointerTravel<6){const target=cityTargets.reduce((best,t)=>{const dist=Math.hypot(t.x-e.clientX,t.y-e.clientY);return dist<22&&(!best||dist<best.dist)?{...t,dist}:best;},null);if(target)focusCity(target.city);}
    state.gesture='鼠标 · 待机';state.lastInteraction=performance.now();}
}
$('universe').addEventListener('pointerup',pointerUp);$('universe').addEventListener('pointercancel',pointerUp);
$('universe').addEventListener('pointerleave',()=>{state.hover=null;});
$('universe').addEventListener('wheel',e=>{e.preventDefault();interact();state.targetZoom=clamp(state.targetZoom*Math.exp(-clamp(e.deltaY,-120,120)*.0024),.7,4.2);state.gesture='滚轮 · 缩放';},{passive:false});
$('universe').addEventListener('dblclick',()=>{interact();reset();});

let demoStarted=0,demoAction=-1;
const demoFrames=[
  [0,1,-105,21],[1.4,1,-105,21],[2.7,3.4,-105,21],[3.5,3.4,-105,21],[4.4,1,-105,21],
  [5.4,2.05,-108,22],[6.7,1,-110,20],[8.7,1.08,-110,20],[10,1.36,-145,16],[11.7,1.35,-230,20],
  [13.3,1.32,-310,23],[14.7,1.05,-465,21],[16,3.8,-465,21],[17.3,3.1,-465,21],[18.5,2.15,-481.47,31.23],
  [19.6,2.15,-481.47,31.23],[20.6,2.2,-499.69,35.68],[22,2.2,-597.58,37.77],[23.4,2.2,-719.87,51.51],
  [24.9,2.2,-722.35,48.86],[26.3,2.2,-748.98,41.01],[27.6,2.2,-757.62,55.76],[29,1,-825,21]
];
function startDemo(){sound.play('tour');void ensureParticles();void loadMoonDetail();
  if(!window.__earthReady)return;
  state.capitalOnly=false;$('capital-only').checked=false;
  state.demo=true;state.tracking=false;demoStarted=performance.now();demoAction=-1;$('demo-button').setAttribute('aria-pressed','true');$('demo-progress').hidden=false;
  $('tracking-status').textContent='演示播放';state.gesture='手势 · 演示';state.targetYaw=rad(-105);state.yaw=rad(-105);state.pitch=state.targetPitch=rad(21);state.targetZoom=state.zoom=1;state.selected=null;buildRoutes(cities[0]);toast('正在重现视频中的缩放、流星雨与城市巡游',2500);
}
function stopDemo(){state.demo=false;$('demo-button').setAttribute('aria-pressed','false');$('demo-progress').hidden=true;$('tracking-status').textContent=state.camera?'手势控制':'自由探索';state.lastInteraction=performance.now();state.gesture=state.camera?'等待手掌':'鼠标 · 待机';}
function tickDemo(time){
  const t=(time-demoStarted)/1000;$('demo-fill').style.width=Math.min(100,t/29*100)+'%';if(t>29){stopDemo();reset();return;}
  let i=0;while(i<demoFrames.length-2&&t>demoFrames[i+1][0])i++;
  const a=demoFrames[i],b=demoFrames[i+1],f=smooth(a[0],b[0],t);state.targetZoom=a[1]+(b[1]-a[1])*f;state.targetYaw=rad(a[2]+(b[2]-a[2])*f);state.targetPitch=rad(a[3]+(b[3]-a[3])*f);
  const actions=[[7.4,'meteor'],[18.6,0],[20.0,2],[21.1,45],[22.6,24],[24.1,25],[25.6,21],[27.0,22]];
  let action=-1;for(let n=0;n<actions.length;n++)if(t>=actions[n][0])action=n;
  if(action>demoAction){demoAction=action;if(action>=0){const id=actions[action][1];if(id==='meteor'){meteorShower();state.gesture='V 手势 · 流星';}else{const city=cities[id];state.selected=city;buildRoutes(city);updateCityCard(city);showTitle(city.name,city.en,1900);state.gesture='城市 · 定位';}}}
}

function updateHand(data){
  if(state.demo)return;const names={'none':'等待手掌','tracking':'手掌 · 跟踪','pinch':'捏合 · 旋转','open-palm':'展开 · 放大','fist':'握拳 · 缩小','two-hands':'双手 · 缩放','victory':'V 手势 · 流星'};
  state.tracking=data.handCount>0;state.gesture=(names[data.gesture]||'手掌 · 跟踪')+(data.handCount?' · '+data.handCount+' 只手':'');
  if(state.tracking){state.lastInteraction=performance.now();state.targetYaw+=clamp(data.yawDelta||0,-.08,.08);state.targetPitch=clamp(state.targetPitch+clamp(data.pitchDelta||0,-.06,.06),-1.4,1.4);state.targetZoom=clamp(state.targetZoom*Math.exp(clamp(data.zoomDelta||0,-.035,.035)),.7,4.2);}
  if(data.gesture==='victory'&&gestureBefore!=='victory'&&performance.now()-lastMeteorGesture>3500){meteorShower();lastMeteorGesture=performance.now();}
  $('camera-status').textContent=names[data.gesture]||'手掌跟踪';$('tracking-status').textContent=state.tracking?'追踪中':'等待手掌';gestureBefore=data.gesture;
}
async function toggleCamera(){
  if(state.camera){handController?.stop();state.camera=false;state.tracking=false;$('camera-button').classList.remove('active');$('camera-button').setAttribute('aria-label','开启摄像头手势控制');$('camera-button').querySelector('span').textContent='开启手势';$('camera-preview').hidden=true;$('input-status').textContent='鼠标控制已就绪';$('tracking-status').textContent='自由探索';state.gesture='鼠标 · 待机';return;}
  if(state.demo)stopDemo();$('camera-button').disabled=true;
  try{
    if(!window.isSecureContext)throw Error('手势控制需要 HTTPS 或 localhost，请使用启动脚本。');
    toast('正在启动手势识别，请允许摄像头访问',6000);
    const {HandController}=await import('./hand-controller.js');
    handController??=new HandController({video:$('camera-video'),overlay:$('hand-overlay'),delegate:'CPU',onUpdate:updateHand,onStatus:message=>{$('camera-status').textContent=message;}});
    const started=await handController.start();if(!started||!handController.running){toast($('camera-status').textContent||'摄像头未开启，可继续用鼠标探索。',6500);return;}
    state.camera=true;$('camera-preview').hidden=false;$('camera-button').classList.add('active');$('camera-button').setAttribute('aria-label','关闭摄像头手势控制');$('camera-button').querySelector('span').textContent='手势已开启';$('input-status').textContent='摄像头 · 本机识别';toast('展开手掌放大，握拳缩小；捏合拖动旋转，V 手势召唤流星雨',6500);
  }catch(error){console.error(error);handController?.stop();const denied=['NotAllowedError','PermissionDeniedError'].includes(error.name);const missing=['NotFoundError','DevicesNotFoundError'].includes(error.name);toast(denied?'摄像头权限未开启，可继续用鼠标探索。':missing?'没有检测到摄像头，可继续用鼠标探索。':error.message||'摄像头启动失败，请刷新后重试。',6500);}
  finally{$('camera-button').disabled=false;}
}
function setCinema(value){state.cinema=value;document.body.classList.toggle('cinema',value);$('exit-cinema').hidden=!value;}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前窗口不支持全屏，可使用浏览器的全屏按钮。');}}
$('camera-button').addEventListener('click',toggleCamera);$('hide-camera').addEventListener('click',()=>{$('camera-preview').hidden=true;toast('预览已收起，手势识别仍在运行。点击摄像头按钮可关闭。');});
$('demo-button').addEventListener('click',()=>state.demo?stopDemo():startDemo());$('stop-demo').addEventListener('click',stopDemo);
$('reset-button').addEventListener('click',()=>{interact();reset();});$('fullscreen-button').addEventListener('click',fullscreen);
$('settings-button').addEventListener('click',()=>{const hidden=!$('settings-panel').hidden;$('settings-panel').hidden=hidden;$('settings-button').setAttribute('aria-expanded',String(!hidden));});
$('close-settings').addEventListener('click',()=>{$('settings-panel').hidden=true;$('settings-button').setAttribute('aria-expanded','false');});
if($('realistic-mode'))$('realistic-mode').addEventListener('click',()=>{interact();setMode('realistic');});
if($('particle-mode'))$('particle-mode').addEventListener('click',()=>{interact();setMode('particle');});
function searchCities(query){
  const list=$('globe-search-results'),q=query.trim().toLowerCase();if(!list)return;list.replaceChildren();list.hidden=!q;$('globe-search').setAttribute('aria-expanded',String(!!q));if(!q)return;
  const found=findCityMatches(cities,q);
  if(!found.length){const p=document.createElement('p');p.textContent='没有找到地点，试试中文或英文名称';list.append(p);return;}
  for(const city of found){const button=document.createElement('button');button.type='button';button.setAttribute('role','option');const name=document.createElement('span'),english=document.createElement('small');name.textContent=cityName(city);name.title=city.name;english.textContent=[city.country||city.province||city.region,city.nationalCapital?city.capitalRole:city.en].filter(Boolean).join(' · ');button.append(name,english);button.addEventListener('click',()=>{interact();focusCity(city);list.hidden=true;$('globe-search').value='';$('globe-search').setAttribute('aria-expanded','false');});list.append(button);}
}
if($('globe-search')){const input=$('globe-search');input.addEventListener('input',e=>searchCities(e.target.value));input.addEventListener('keydown',e=>{if(e.key==='Enter'){$('globe-search-results').querySelector('button')?.click();}if(e.key==='Escape')$('globe-search-results').hidden=true;});}
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.search-wrap')&&$('globe-search-results'))$('globe-search-results').hidden=true;});
$('zoom-slider').addEventListener('input',e=>{interact();state.targetZoom=Number(e.target.value);$('slider-output').textContent=state.targetZoom.toFixed(2)+'×';});
$('auto-rotate').addEventListener('change',e=>{interact();state.rotate=e.target.checked;});$('show-routes').addEventListener('change',e=>{state.routes=e.target.checked;});$('show-labels').addEventListener('change',e=>{state.labels=e.target.checked;});
$('capital-only').addEventListener('change',e=>{interact();state.capitalOnly=e.target.checked;if(state.capitalOnly&&!state.selected?.nationalCapital){const city=cities.find(c=>c.capitalPrimary);if(city)focusCity(city);}if(state.selected)buildRoutes(state.selected);});
$('meteor-button').addEventListener('click',meteorShower);$('cinema-button').addEventListener('click',()=>setCinema(true));$('exit-cinema').addEventListener('click',()=>setCinema(false));
window.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA/.test(e.target.tagName))return;const key=e.key.toLowerCase();
  if(key===' '){e.preventDefault();state.rotate=!state.rotate;$('auto-rotate').checked=state.rotate;toast(state.rotate?'自动旋转已开启':'自动旋转已暂停',1800);}
  if(key==='r'){interact();reset();}if(key==='d')state.demo?stopDemo():startDemo();if(key==='m')meteorShower();if(key==='f')fullscreen();if(key==='h')setCinema(!state.cinema);
  if(key==='escape'){setCinema(false);$('settings-panel').hidden=true;$('settings-button').setAttribute('aria-expanded','false');}
  if(cities.length&&(key==='arrowright'||key==='arrowleft')){interact();const start=state.selected?.index??0,step=key==='arrowright'?1:-1;focusCity(cities[(start+step+cities.length)%cities.length]);}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){lastFrame=0;handController?.pause?.();}else{handController?.resume?.();state.lastInteraction=performance.now();}});
window.addEventListener('pagehide',()=>handController?.stop());
// Small, read-only status surface used by the local QA workflow.
window.earthStatus=()=>({ready:window.__earthReady===true,particlesReady,zoom:state.zoom,targetZoom:state.targetZoom,selected:state.selected?.name??null,selectedId:state.selected?.id,selectedCountry:state.selected?.country,selectedScreen:cityTargets.filter(t=>t.city===state.selected).map(t=>({x:t.x,y:t.y}))[0]??null,hovered:state.hover?.name??null,labelsDrawn:labelCount,capitalOnly:state.capitalOnly,capitalCenters:cities.filter(c=>c.nationalCapital).length,visibleCities:cities.filter(c=>!state.capitalOnly||c.nationalCapital).length,routeCount:routeArcs.length,demo:state.demo,camera:state.camera,landPoints:landCount,oceanPoints:oceanCount,cityLights:cities.length,cities:cities.length,cinema:state.cinema,mode:state.mode,particleMix:state.particleMix,routes:state.routes,labels:state.labels,rotation:state.rotate,clouds:!!clouds,nightLights:!!nightSurface,renderFrames:renderer?.info?.render?.frame??0,drawCalls:renderer?.info?.render?.calls??0});
init();
