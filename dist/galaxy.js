import {sound,revealDestination} from './atlas-audio.js?v=1';
import * as THREE from './vendor/three.module.min.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {
  yaw: .20, pitch: .59, targetYaw: .20, targetPitch: .59,
  zoom: 1, targetZoom: 1, rotate: !reducedMotion, dust: true,
  cinema: false, camera: false, preset: 'overview', frames: 0,
  warp: false, warpStarted: 0, lastInteraction: 0,
};
let renderer, scene, camera, galaxy, starMaterial, hazeMaterial, dustMaterial;
let nebula, coreGlow, coreHalo, background, warpLines, warpPositions, warpStars;
let frame = 0, lastTime = 0, toastTimer, handController, previousGesture = '', lastVictory = 0;
let width = innerWidth, height = innerHeight, pixelRatio = 1;
let sceneTarget, bloomA, bloomB, postScene, postCamera, postQuad, blurMaterial, compositeMaterial;
const pointers = new Map();
let pointerGap = 0;
const warpCount = 650;
const starCount = 156000;
const hazeCount = 5600;
const dustCount = 8500;
let seed = 672138;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function gaussian() { return Math.sqrt(-2 * Math.log(Math.max(random(), .00001))) * Math.cos(TAU * random()); }
function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4300);
}

const pointVertex = `
  attribute float aSize;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vPulse;
  uniform float uTime;
  uniform float uScale;
  uniform float uTwinkle;
  void main() {
    vColor = color;
    vPulse = 1.0 - uTwinkle * .16 + uTwinkle * .16 * sin(uTime * .7 + aPhase);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), .7, 125.0);
  }
`;
const pointFragment = `
  varying vec3 vColor;
  varying float vPulse;
  uniform float uOpacity;
  uniform float uSoft;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float star = exp(-r2 * 12.0) + .13 * exp(-r2 * 3.0);
    float cloud = pow(max(0.0, 1.0 - r2), 2.5);
    float a = mix(star, cloud, uSoft) * uOpacity * vPulse;
    gl_FragColor = vec4(vColor, a);
  }
`;

function points(positions, colors, sizes, opacity, soft, twinkle = 0, additive = true) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(sizes.map(() => random() * TAU), 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: pointVertex, fragmentShader: pointFragment, vertexColors: true,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1000 }, uTwinkle: { value: twinkle }, uOpacity: { value: opacity }, uSoft: { value: soft } },
    transparent: true, depthWrite: false, depthTest: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  return new THREE.Points(geometry, material);
}

// A seeded artistic model: log-spiral arms, a warm central bulge and a thin disk.
// These are visual particles, not measurements or a catalogue of real stars.
function spiralPosition(radius, width = 1) {
  const arm = Math.floor(random() * 4);
  const angle = arm * TAU / 4 + Math.log(radius + .45) * 2.72 + .34;
  const spread = (.14 + radius * .068) * width;
  const tangent = gaussian() * spread;
  const radial = gaussian() * spread * .65;
  return [Math.cos(angle) * (radius + radial) - Math.sin(angle) * tangent,
    gaussian() * (.045 + .15 * Math.exp(-radius * .65)),
    Math.sin(angle) * (radius + radial) + Math.cos(angle) * tangent];
}

function starColor(radius, bright = 1, variety = random()) {
  const inner = new THREE.Color(1.0, .67, .36);
  const middle = new THREE.Color(.68, .52, 1.0);
  const outer = new THREE.Color(.28, .66, 1.0);
  const color = radius < 3.5 ? inner.lerp(middle, clamp((radius - .4) / 3.1, 0, 1))
    : middle.lerp(outer, clamp((radius - 3.5) / 5.5, 0, 1));
  if (variety < .20) color.lerp(new THREE.Color(1, .89, .75), .7);
  if (variety > .9) color.lerp(new THREE.Color(1, .25, .56), .7);
  return color.multiplyScalar(bright).toArray();
}

function buildGalaxy() {
  galaxy = new THREE.Group();
  scene.add(galaxy);
  const positions = [], colors = [], sizes = [];
  for (let i = 0; i < starCount; i++) {
    let x, y, z, radius;
    if (i < 24000) {
      const r = Math.pow(random(), .85) * 2.05;
      const angle = random() * TAU;
      const elevation = Math.acos(2 * random() - 1);
      x = Math.sin(elevation) * Math.cos(angle) * r * 1.12;
      y = Math.cos(elevation) * r * .36;
      z = Math.sin(elevation) * Math.sin(angle) * r * .64;
      radius = Math.hypot(x, z);
    } else if (i < 42000) {
      radius = Math.sqrt(random()) * 10.5;
      const a = random() * TAU;
      x = Math.cos(a) * radius; z = Math.sin(a) * radius;
      y = gaussian() * .16;
    } else {
      radius = .28 + Math.pow(random(), 1.16) * 10.0;
      [x, y, z] = spiralPosition(radius);
    }
    positions.push(x, y, z);
    const hero = random() > .996;
    colors.push(...starColor(radius, hero ? 2.8 : .50 + random() * 1.05));
    sizes.push(hero ? .085 + random() * .06 : .016 + Math.pow(random(), 3) * .040);
  }
  const stars = points(positions, colors, sizes, .96, 0, 1);
  starMaterial = stars.material;
  stars.renderOrder = 3;
  galaxy.add(stars);

  const hazePositions = [], hazeColors = [], hazeSizes = [];
  for (let i = 0; i < hazeCount; i++) {
    const radius = .5 + Math.pow(random(), .85) * 9.8;
    const p = spiralPosition(radius, 1.16);
    p[1] -= .12;
    hazePositions.push(...p);
    hazeColors.push(...starColor(radius, .8));
    hazeSizes.push(.24 + random() * .70);
  }
  const haze = points(hazePositions, hazeColors, hazeSizes, .046, 1);
  hazeMaterial = haze.material;
  haze.renderOrder = 1;
  galaxy.add(haze);

  const dustPositions = [], dustColors = [], dustSizes = [];
  for (let i = 0; i < dustCount; i++) {
    const radius = 1.0 + Math.pow(random(), .88) * 8.9;
    const arm = Math.floor(random() * 4);
    const angle = arm * TAU / 4 + Math.log(radius + .45) * 2.72 + .54;
    const offset = gaussian() * (.025 + radius * .014);
    dustPositions.push(Math.cos(angle) * (radius + offset), .13 + random() * .035,
      Math.sin(angle) * (radius + offset));
    dustColors.push(.009, .005, .02);
    dustSizes.push(.10 + random() * .24);
  }
  const dust = points(dustPositions, dustColors, dustSizes, .19, 1, 0, false);
  dustMaterial = dust.material;
  dust.renderOrder = 4;
  dust.name = 'dust-ribbons';
  galaxy.add(dust);

  const cloudVertex = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
  const cloudFragment = `
    varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float n=0.0;float a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+vec2(13.1,7.2);a*=.5;}return n;}
    void main(){
      vec2 p=(vUv-.5)*22.0;
      float r=length(p);
      float a=atan(p.y,p.x);
      float n=fbm(p*2.0);
      float winding=4.0*(a-log(r+.45)*2.72-.34);
      float arms=pow(.5+.5*cos(winding+(n-.5)*1.8),4.0);
      float edge=1.0-smoothstep(8.3,10.6,r);
      float disk=exp(-r*.22)*(.075+.75*arms)*edge;
      float bulge=exp(-r*r*.60);
      vec3 warm=vec3(1.0,.36,.12);
      vec3 cool=mix(vec3(.47,.20,.90),vec3(.13,.42,.86),smoothstep(3.5,9.0,r));
      vec3 color=mix(warm,cool,smoothstep(.7,3.7,r));
      float grain=.3+.8*n;
      gl_FragColor=vec4(color,disk*.32*grain+bulge*.28);
    }
  `;
  nebula = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.ShaderMaterial({
    vertexShader: cloudVertex, fragmentShader: cloudFragment,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  nebula.rotation.x = -Math.PI / 2;
  nebula.position.y = -.17;
  nebula.renderOrder = 0;
  galaxy.add(nebula);

  function glowTexture() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(.13, 'rgba(255,255,255,.85)');
    gradient.addColorStop(.36, 'rgba(255,255,255,.30)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }
  const texture = glowTexture();
  coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: new THREE.Color(2.8, 1.6, .8),
    transparent: true, opacity: .62, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  coreGlow.scale.set(2.7, 1.5, 1);
  coreGlow.renderOrder = 5;
  galaxy.add(coreGlow);
  coreHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0xff8b62,
    transparent: true, opacity: .1, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  coreHalo.scale.set(7.0, 3.8, 1);
  coreHalo.renderOrder = 2;
  galaxy.add(coreHalo);

  const bgPositions = [], bgColors = [], bgSizes = [];
  for (let i = 0; i < 2200; i++) {
    const theta = random() * TAU, y = random() * 2 - 1, r = 78 + random() * 30;
    const s = Math.sqrt(1 - y * y);
    bgPositions.push(r * s * Math.cos(theta), r * y, r * s * Math.sin(theta));
    const b = .18 + random() * .38;
    bgColors.push(b * .74, b * .84, b);
    bgSizes.push(.07 + Math.pow(random(), 5) * .3);
  }
  background = points(bgPositions, bgColors, bgSizes, .65, 0, .5);
  scene.add(background);
}

function buildPostProcessing() {
  const options = { type: THREE.HalfFloatType, depthBuffer: false };
  sceneTarget = new THREE.WebGLRenderTarget(1, 1, options);
  bloomA = new THREE.WebGLRenderTarget(1, 1, options);
  bloomB = new THREE.WebGLRenderTarget(1, 1, options);
  postScene = new THREE.Scene();
  postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vertex = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
  blurMaterial = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec2 uDirection;
    uniform float uThreshold;
    vec3 sampleColor(vec2 uv){vec3 c=texture2D(uTexture,uv).rgb;return max(vec3(0.0),c-uThreshold);}
    void main(){
      vec3 c=sampleColor(vUv)*.227027;
      c+=sampleColor(vUv+uDirection*1.384615)*.316216;
      c+=sampleColor(vUv-uDirection*1.384615)*.316216;
      c+=sampleColor(vUv+uDirection*3.230769)*.070270;
      c+=sampleColor(vUv-uDirection*3.230769)*.070270;
      gl_FragColor=vec4(c,1.0);
    }`, uniforms: { uTexture: { value: null }, uDirection: { value: new THREE.Vector2() }, uThreshold: { value: .25 } }, depthTest: false, depthWrite: false });
  compositeMaterial = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D uScene;
    uniform sampler2D uBloom;
    uniform float uWarp;
    vec3 film(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
    void main(){
      float glow=exp(-dot(vUv-vec2(.56,.5),vUv-vec2(.56,.5))*9.0);
      vec3 c=texture2D(uScene,vUv).rgb+texture2D(uBloom,vUv).rgb*.9;
      c+=vec3(.002,.0015,.006)+vec3(.009,.003,.020)*glow;
      c+=vec3(.12,.07,.35)*uWarp*pow(max(0.0,1.0-length(vUv-.5)*1.5),4.0);
      float vignette=1.0-.19*pow(length((vUv-.5)*1.2),2.0);
      c=film(c*vignette*1.08);
      c=mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-.055,step(vec3(.0031308),c));
      gl_FragColor=vec4(c,1.0);
    }`, uniforms: { uScene: { value: sceneTarget.texture }, uBloom: { value: bloomA.texture }, uWarp: { value: 0 } }, depthTest: false, depthWrite: false });
  postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial);
  postQuad.frustumCulled = false;
  postScene.add(postQuad);
}

function buildWarp() {
  warpPositions = new Float32Array(warpCount * 6);
  const colors = new Float32Array(warpCount * 6);
  warpStars = Array.from({ length: warpCount }, () => {
    const angle = random() * TAU, radius = 1.2 + random() * 21;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: random() * 90, speed: 15 + random() * 30 };
  });
  for (let i = 0; i < warpCount; i++) {
    colors.set([.12, .22, .48, .9, .85, 1.2], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(warpPositions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  warpLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true,
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  warpLines.frustumCulled = false;
  warpLines.renderOrder = 8;
  warpLines.visible = false;
  camera.add(warpLines);
  scene.add(camera);
}

function resize() {
  width = innerWidth; height = innerHeight;
  pixelRatio = Math.min(devicePixelRatio || 1, width < 700 ? 1.25 : 1.7);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const w = Math.round(width * pixelRatio), h = Math.round(height * pixelRatio);
  sceneTarget.setSize(w, h);
  bloomA.setSize(Math.ceil(w * .4), Math.ceil(h * .4));
  bloomB.setSize(Math.ceil(w * .4), Math.ceil(h * .4));
  const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  [starMaterial, hazeMaterial, dustMaterial, background.material].forEach(m => m.uniforms.uScale.value = scale);
}

function setZoom(zoom) {
  state.targetZoom = clamp(zoom, .65, 2.4);
  $('zoom-slider').value = state.targetZoom;
  $('zoom-output').textContent = `${state.targetZoom.toFixed(2)}×`;
}
function interaction() {
  state.lastInteraction = performance.now();
  if (state.preset !== 'free') {
    state.preset = 'free';
    ['overview', 'top', 'close'].forEach(id => $(`view-${id}`).setAttribute('aria-pressed', 'false'));
    $('chapter-name').textContent = '自由探索';
    $('chapter-description').textContent = '拖动视角，让星光向你缓缓展开。';
  }
}
function setView(view, immediate = false) {
  const presets = {
    overview: { yaw: .20, pitch: .59, zoom: 1, name: '银河全景', text: '金色银心，蓝紫旋臂。此刻，置身群星之间。' },
    top: { yaw: .20, pitch: 1.49, zoom: .9, name: '俯瞰旋臂', text: '从星盘上方，看光与尘埃交织成螺旋。' },
    close: { yaw: -.36, pitch: .28, zoom: 2.1, name: '靠近银心', text: '穿过星尘，驶向银河深处的暖金色微光。' },
  };
  const p = presets[view];
  if(!immediate){sound.play('view');revealDestination(document.querySelector('.chapter-card'));}
  state.preset = view;
  state.targetYaw = p.yaw; state.targetPitch = p.pitch; setZoom(p.zoom);
  state.lastInteraction = performance.now();
  if (immediate) { state.yaw = p.yaw; state.pitch = p.pitch; state.zoom = p.zoom; }
  ['overview', 'top', 'close'].forEach(id => $(`view-${id}`).setAttribute('aria-pressed', String(id === view)));
  $('chapter-name').textContent = p.name;
  $('chapter-description').textContent = p.text;
}

function startWarp() {
  if (state.warp) return;
  if (reducedMotion) { toast('已开启减少动态效果；请使用视角按钮探索银河。'); return; }
  sound.play('warp');
  state.warp = true; state.warpStarted = performance.now();
  warpLines.visible = true;
  $('warp-button').disabled = true;
  $('warp-button').setAttribute('aria-pressed', 'true');
  $('galaxy-state').textContent = '正在穿越星海';
  document.body.classList.add('warping');
}

function toggleCinema() {
  state.cinema = !state.cinema;
  document.body.classList.toggle('cinema', state.cinema);
  $('exit-cinema').hidden = !state.cinema;
  $('cinema-button').setAttribute('aria-pressed', String(state.cinema));
}
async function toggleFullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast('当前浏览器不支持全屏，可使用沉浸模式。'); }
}

function resetCameraUi() {
  state.camera = false; previousGesture = '';
  const button = $('camera-button');
  button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', '开启摄像头手势控制');
  button.title = '开启摄像头手势控制'; button.classList.remove('active');
  button.querySelector('span').textContent = '开启手势';
  $('camera-preview').hidden = true;
  $('galaxy-state').textContent = state.warp ? '正在穿越星海' : '自由探索';
}
function cameraStatus(message) {
  const text = message.replaceAll('地球', '银河').replaceAll('召唤流星雨', '开启星际穿越');
  $('camera-status').textContent = text;
  if (state.camera && !handController?.running) { resetCameraUi(); toast(text); }
}
async function toggleCamera() {
  const button = $('camera-button');
  if (state.camera) { resetCameraUi(); handController?.stop(); return; }
  button.disabled = true;
  try {
    const { HandController } = await import('./hand-controller.js');
    handController ??= new HandController({ video: $('camera-video'), overlay: $('hand-overlay'), delegate: 'CPU',
      onStatus: cameraStatus,
      onUpdate: data => {
        const g = data.gesture;
        if (g !== 'none') {
          interaction();
          state.targetYaw += clamp(data.yawDelta || 0, -.07, .07);
          state.targetPitch = clamp(state.targetPitch + clamp(data.pitchDelta || 0, -.05, .05), .06, 1.52);
          setZoom(state.targetZoom * Math.exp(clamp(data.zoomDelta || 0, -.035, .035)));
        }
        if (g === 'victory' && previousGesture !== g && performance.now() - lastVictory > 7000) {
          lastVictory = performance.now(); startWarp();
        }
        previousGesture = g;
      },
    });
    if (!await handController.start() || !handController.running) {
      toast($('camera-status').textContent || '摄像头未开启，可以继续拖动银河。'); return;
    }
    state.camera = true; button.classList.add('active');
    button.setAttribute('aria-pressed', 'true'); button.setAttribute('aria-label', '关闭摄像头手势控制');
    button.title = '关闭摄像头手势控制'; button.querySelector('span').textContent = '手势已开启';
    $('camera-preview').hidden = false;
    $('galaxy-state').textContent = '手势控制 · 本机识别';
    toast('张开手掌放大，握拳缩小；捏合旋转，V 手势开启星际穿越。');
  } catch (error) {
    resetCameraUi(); handController?.stop();
    console.warn('Galaxy camera could not start:', error);
    toast('摄像头未能开启，可以继续用鼠标或触屏探索银河。');
  } finally { button.disabled = false; }
}

function bindControls() {
  for (const view of ['overview', 'top', 'close']) $(`view-${view}`).addEventListener('click', () => setView(view));
  $('auto-rotate').checked = state.rotate;
  $('auto-rotate').addEventListener('change', e => state.rotate = e.target.checked);
  $('show-dust').addEventListener('change', e => {
    state.dust = e.target.checked;
    galaxy.getObjectByName('dust-ribbons').visible = state.dust;
    nebula.visible = state.dust;
    hazeMaterial.uniforms.uOpacity.value = state.dust ? .046 : .012;
  });
  $('zoom-slider').addEventListener('input', e => { interaction(); setZoom(Number(e.target.value)); });
  $('warp-button').addEventListener('click', startWarp);
  $('reset-button').addEventListener('click', () => setView('overview'));
  $('fullscreen-button').addEventListener('click', toggleFullscreen);
  $('cinema-button').addEventListener('click', toggleCinema);
  $('exit-cinema').addEventListener('click', toggleCinema);
  $('camera-button').addEventListener('click', toggleCamera);
  $('hide-camera')?.addEventListener('click', () => {
    $('camera-preview').hidden = true; toast('手势识别仍在运行；再次点击摄像头按钮可关闭。');
  });

  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', '三维银河系，拖动旋转，滚轮或双指缩放');
  canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pointerGap = 0;
    interaction();
  });
  canvas.addEventListener('pointermove', e => {
    const old = pointers.get(e.pointerId); if (!old) return;
    const dx = e.clientX - old.x, dy = e.clientY - old.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      state.targetYaw -= dx * .005;
      state.targetPitch = clamp(state.targetPitch + dy * .005, .06, 1.52);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (pointerGap > 0) setZoom(state.targetZoom * gap / pointerGap);
      pointerGap = gap;
    }
    state.lastInteraction = performance.now();
  });
  const release = e => { pointers.delete(e.pointerId); pointerGap = 0; };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); interaction(); setZoom(state.targetZoom * Math.exp(-clamp(e.deltaY, -120, 120) * .0012));
  }, { passive: false });
  document.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (['w', 'h', 'f', 'r', '1', '2', '3', '+', '=', '-', 'escape', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) e.preventDefault();
    if (key === 'w') startWarp();
    if (key === 'h') toggleCinema();
    if (key === 'f') toggleFullscreen();
    if (key === 'r' || key === '1') setView('overview');
    if (key === '2') setView('top');
    if (key === '3') setView('close');
    if (key === 'escape' && state.cinema) toggleCinema();
    if (key === '+' || key === '=') { interaction(); setZoom(state.targetZoom * 1.12); }
    if (key === '-') { interaction(); setZoom(state.targetZoom / 1.12); }
    if (key.startsWith('arrow')) {
      interaction();
      if (key === 'arrowleft') state.targetYaw += .13;
      if (key === 'arrowright') state.targetYaw -= .13;
      if (key === 'arrowup') state.targetPitch = clamp(state.targetPitch + .1, .06, 1.52);
      if (key === 'arrowdown') state.targetPitch = clamp(state.targetPitch - .1, .06, 1.52);
    }
  });
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    lastTime = 0;
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else if (!frame) frame = requestAnimationFrame(animate);
  });
  addEventListener('pagehide', () => { resetCameraUi(); handController?.stop(); });
}

function drawScene() {
  renderer.setRenderTarget(sceneTarget);
  renderer.render(scene, camera);
  postQuad.material = blurMaterial;
  blurMaterial.uniforms.uTexture.value = sceneTarget.texture;
  blurMaterial.uniforms.uThreshold.value = .20;
  blurMaterial.uniforms.uDirection.value.set(2 / bloomA.width, 0);
  renderer.setRenderTarget(bloomB);
  renderer.render(postScene, postCamera);
  blurMaterial.uniforms.uTexture.value = bloomB.texture;
  blurMaterial.uniforms.uThreshold.value = 0;
  blurMaterial.uniforms.uDirection.value.set(0, 2 / bloomA.height);
  renderer.setRenderTarget(bloomA);
  renderer.render(postScene, postCamera);
  postQuad.material = compositeMaterial;
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCamera);
}

function animate(time) {
  frame = requestAnimationFrame(animate);
  const dt = lastTime ? Math.min((time - lastTime) / 1000, .05) : .016;
  lastTime = time;
  if (state.rotate && time - state.lastInteraction > 2400 && !pointers.size && !state.warp) {
    galaxy.rotation.y += dt * .016;
  }
  const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 4.5);
  state.yaw += (state.targetYaw - state.yaw) * ease;
  state.pitch += (state.targetPitch - state.pitch) * ease;
  state.zoom += (state.targetZoom - state.zoom) * ease;
  // Frame the whole galaxy on phones instead of cropping the arms off-screen.
  const fit = Math.max(1, height / width * 1.10);
  const distance = 29 * fit / state.zoom;
  camera.position.set(Math.sin(state.yaw) * Math.cos(state.pitch) * distance,
    Math.sin(state.pitch) * distance, Math.cos(state.yaw) * Math.cos(state.pitch) * distance);
  camera.lookAt(0, 0, 0);
  const t = reducedMotion ? 0 : time / 1000;
  [starMaterial, hazeMaterial, dustMaterial, background.material].forEach(m => m.uniforms.uTime.value = t);
  coreGlow.material.opacity = .62 + (reducedMotion ? 0 : Math.sin(t * .45) * .018);
  if (state.warp) {
    const age = (time - state.warpStarted) / 1000;
    const strength = Math.sin(Math.PI * clamp(age / 5.6, 0, 1));
    warpLines.material.opacity = Math.min(1, strength * 1.6);
    compositeMaterial.uniforms.uWarp.value = Math.pow(strength, 7) * .32;
    for (let i = 0; i < warpCount; i++) {
      const s = warpStars[i];
      s.z -= dt * (8 + strength * s.speed * 1.8);
      if (s.z < 1) s.z += 85;
      const length = .15 + strength * (1.1 + s.speed * .19);
      warpPositions.set([s.x, s.y, -s.z, s.x, s.y, -s.z - length], i * 6);
    }
    warpLines.geometry.attributes.position.needsUpdate = true;
    if (age >= 5.6) {
      state.warp = false; warpLines.visible = false;
      compositeMaterial.uniforms.uWarp.value = 0;
      $('warp-button').disabled = false; $('warp-button').setAttribute('aria-pressed', 'false');
      $('galaxy-state').textContent = state.camera ? '手势控制 · 本机识别' : '自由探索';
      document.body.classList.remove('warping');
      setView('overview');
    }
  }
  drawScene();
  state.frames++;
  if (!window.__galaxyReady) {
    window.__galaxyReady = true;
    $('loading').hidden = true;
  }
}

try {
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x02020a, 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  $('galaxy-scene').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, width / height, .1, 200);
  buildGalaxy(); buildPostProcessing(); buildWarp(); resize(); bindControls(); setView('overview', true);
  $('particle-count').textContent = `${(starCount / 1000).toFixed(0)}K 星光粒子`;
  window.galaxyStatus = () => ({ ready: !!window.__galaxyReady, frames: state.frames,
    stars: starCount, haze: hazeCount, dustParticles: dustCount, zoom: state.zoom, targetZoom: state.targetZoom,
    yaw: state.yaw, pitch: state.pitch, targetYaw: state.targetYaw, targetPitch: state.targetPitch,
    preset: state.preset, rotate: state.rotate, dust: state.dust, cinema: state.cinema,
    camera: state.camera, warp: state.warp, rotation: galaxy.rotation.y, pixelRatio,
  });
  renderer.domElement.addEventListener('webglcontextlost', e => {
    e.preventDefault(); cancelAnimationFrame(frame); frame = 0;
    toast('图形连接中断；请刷新页面重新进入银河。');
  });
  frame = requestAnimationFrame(animate);
} catch (error) {
  console.error(error);
  $('loading').querySelector('p').textContent = '银河暂时无法绘制';
  const note = $('loading').querySelector('small');
  if (note) note.textContent = '请使用支持 WebGL 的 Chrome 或 Edge，或开启浏览器图形加速。';
}
