/* Lore Machine — rainy cyberpunk city (Three.js r147, UMD)
   PASS 1: city mass, lit windows, sky + horizon glow, depth fog,
           street glow, light rain, bloom, camera drift, mood hook.
   Mounts on <canvas id="scene">. Exposes window.loreScene.setMood().   */
(function () {
  'use strict';
  var canvas = document.getElementById('scene');
  if (!canvas || !window.THREE) return;
  var T = window.THREE;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mobile = window.matchMedia('(max-width: 760px)').matches || /Mobi|Android/i.test(navigator.userAgent);

  var renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no gl');
  } catch (e) { return; } // CSS gradient on the canvas stays as the fallback

  var DPR_MAX = mobile ? 1.25 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_MAX));
  renderer.setClearColor(0x07021a, 1);

  /* ---------- palette (display-space colours) ---------- */
  var C = {
    top:     new T.Color('#05010f'),
    mid:     new T.Color('#1c0640'),
    horizon: new T.Color('#4a1560'),
    glow:    new T.Color('#ff3c8c'),
    fogNear: new T.Color('#12062a'),
    base:    new T.Color('#070414')
  };
  var MOOD = {
    none:     new T.Color(1, 1, 1),
    software: new T.Color('#3fe7f2'),
    studio:   new T.Color('#ff375e')
  };

  var scene = new T.Scene();
  var camera = new T.PerspectiveCamera(55, 1, 0.5, 4000);
  // each page is a different vantage point in the same city
  var VIEWS = {
    home:  { cam: [0, 92, 40],    look: [0, 22, -700] },
    press: { cam: [-60, 34, -40], look: [140, 70, -620] },
    news:  { cam: [70, 26, -90],  look: [-120, 48, -700] },
    software: { cam: [-30, 60, -20], look: [60, 38, -700] },
    studio:   { cam: [30, 60, -20],  look: [-60, 38, -700] },
    about:    { cam: [0, 140, 60],   look: [0, 10, -600] }
  };
  var V = VIEWS[document.body.getAttribute('data-view')] || VIEWS.home;
  var CAM_BASE = new T.Vector3(V.cam[0], V.cam[1], V.cam[2]);
  var LOOK = new T.Vector3(V.look[0], V.look[1], V.look[2]);
  var LOOK_X = LOOK.x;

  var U = {
    uTime:    { value: 0 },
    uCam:     { value: camera.position },
    uFogNear: { value: C.fogNear.clone() },
    uFogFar:  { value: C.horizon.clone() },
    uFogDen:  { value: 0.0015 },
    uGlow:    { value: C.glow.clone() },
    uMood:    { value: new T.Color(1, 1, 1) },
    uMoodAmt: { value: 0 }
  };

  /* ---------- deterministic randomness ---------- */
  var seed = 1337;
  function rand() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  function hash(x, y) { var s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  /* ---------- shared GLSL ---------- */
  var FOG = [
    'uniform vec3 uCam; uniform vec3 uFogNear; uniform vec3 uFogFar; uniform float uFogDen;',
    'uniform vec3 uMood; uniform float uMoodAmt;',
    'vec3 fogFar(){ return mix(uFogFar, uFogFar * uMood * 1.35, uMoodAmt); }',
    'float fogAmt(vec3 wp){',
    '  float d = length(wp - uCam);',
    '  float f = 1.0 - exp(-pow(d * uFogDen, 1.4));',
    '  float low = exp(-max(wp.y, 0.0) * 0.035) * smoothstep(40.0, 400.0, d);',
    '  return clamp(f + low * 0.3, 0.0, 1.0);',
    '}',
    'vec3 fogCol(vec3 wp){ float d = length(wp - uCam); return mix(uFogNear, fogFar(), smoothstep(60.0, 1100.0, d)); }'
  ].join('\n');

  var HASH = 'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }';

  /* ---------- sky ---------- */
  var skyMat = new T.ShaderMaterial({
    uniforms: {
      uTime: U.uTime, uTop: { value: C.top }, uMid: { value: C.mid },
      uHor: U.uFogFar, uGlow: U.uGlow, uMood: U.uMood, uMoodAmt: U.uMoodAmt
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: [
      'uniform float uTime; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uGlow;',
      'uniform vec3 uMood; uniform float uMoodAmt; varying vec3 vDir;',
      HASH,
      'float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);',
      '  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }',
      'float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=0.5; } return s; }',
      'void main(){',
      '  vec3 d = normalize(vDir); float y = d.y;',
      '  vec3 hor = mix(uHor, uHor * uMood * 1.35, uMoodAmt);',
      '  vec3 glowC = mix(uGlow, uGlow * 0.4 + uMood * 0.6, uMoodAmt);',
      '  vec3 col = mix(hor, uMid, smoothstep(0.0, 0.2, y));',
      '  col = mix(col, uTop, smoothstep(0.18, 0.65, y));',
      '  float fwd = pow(max(0.0, -d.z), 4.0);',
      '  col += glowC * (exp(-abs(y) * 22.0) * 0.55 + exp(-abs(y) * 6.0) * 0.12) * fwd;',
      '  if (y > 0.0) {',
      '    vec2 uv = d.xz / (y + 0.06) * 0.55; uv.x += uTime * 0.012; uv.y += uTime * 0.004;',
      '    float c = smoothstep(0.42, 0.9, fbm(uv));',
      '    vec3 lit = hor * 0.9 + glowC * 0.35 * exp(-y * 5.0);',
      '    col = mix(col, lit, c * smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(0.3, 0.7, y)) * 0.6);',
      '  } else { col = hor; }',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n'),
    side: T.BackSide, depthWrite: false
  });
  var sky = new T.Mesh(new T.SphereGeometry(3000, 32, 16), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);

  /* ---------- ground + street glow ---------- */
  var PITCH = 20;
  var groundMat = new T.ShaderMaterial({
    uniforms: U,
    extensions: { derivatives: true },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: [
      'uniform float uTime; varying vec3 vW;', FOG,
      'float street(float c){ float dx = abs(fract(c / ' + PITCH.toFixed(1) + ') - 0.5) * ' + PITCH.toFixed(1) + '; return exp(-dx * dx * 0.35); }',
      'void main(){',
      '  vec3 base = vec3(0.02, 0.012, 0.04);',
      '  float s = max(street(vW.x), street(vW.z));',
      '  float fw = fwidth(vW.x / ' + PITCH.toFixed(1) + ') + fwidth(vW.z / ' + PITCH.toFixed(1) + ');',
      '  s = mix(s, 0.22, smoothstep(0.08, 0.35, fw));',
      '  float blvd = exp(-pow(vW.x / 22.0, 2.0));',
      '  vec3 e = vec3(1.0, 0.55, 0.3) * street(vW.x) * mix(1.0, 0.25, smoothstep(0.08, 0.35, fw)) * 0.18 + vec3(1.0, 0.3, 0.45) * blvd * 0.35;',
      '  float f = fogAmt(vW);',
      '  vec3 col = mix(base, fogCol(vW), f) + e * (1.0 - f * 0.8);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  var ground = new T.Mesh(new T.PlaneGeometry(6000, 3000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -1400);
  scene.add(ground);

  /* ---------- buildings ---------- */
  var DEPTH = mobile ? 1150 : 1500;
  var list = [];
  for (var d = 30; d < DEPTH; d += PITCH) {
    var far = d > 700;
    var step = far ? PITCH * 2 : PITCH;
    var xmax = 180 + d * (mobile ? 0.8 : 1.1);
    for (var x = -xmax; x <= xmax; x += step) {
      var gx = Math.round(x / PITCH) * PITCH;
      if (Math.abs(gx) < PITCH * 1.6) continue;             // central boulevard
      if (rand() < 0.06) continue;                           // plazas / gaps
      var n = vnoise(gx * 0.006, d * 0.006);
      var h = (6 + Math.pow(rand(), 3) * 44) * (0.4 + 1.5 * n);
      if (d > 450 && rand() < 0.022) h = 140 + rand() * 220;           // megatowers
      if (d < 220 && Math.abs(gx) > 210 && rand() < 0.45) h = 55 + rand() * 70; // flanking canyon
      if (d < 300 && Math.abs(gx) < 190) h = Math.min(h, 14 + d * 0.06);         // keep the near view open
      var fp = far ? step * 0.8 : 10 + rand() * 6;
      list.push([gx + (rand() - 0.5) * 2, -d, fp, h, fp * (0.8 + rand() * 0.3), rand()]);
    }
  }
  var bGeo = new T.BoxGeometry(1, 1, 1);
  bGeo.translate(0, 0.5, 0);
  var N = list.length;
  var aScale = new Float32Array(N * 3), aSeed = new Float32Array(N);
  var bMat = new T.ShaderMaterial({
    uniforms: U,
    extensions: { derivatives: true },
    vertexShader: [
      'attribute vec3 aScale; attribute float aSeed;',
      'varying vec3 vW; varying vec3 vL; varying vec3 vN; varying float vSeed; varying vec3 vS;',
      'void main(){',
      '  vec3 p = position * aScale;',
      '  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);',
      '  vW = w.xyz; vL = p; vN = normal; vSeed = aSeed; vS = aScale;',
      '  gl_Position = projectionMatrix * viewMatrix * w;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime; uniform vec3 uGlow;',
      'varying vec3 vW; varying vec3 vL; varying vec3 vN; varying float vSeed; varying vec3 vS;',
      FOG, HASH,
      'void main(){',
      '  vec3 base = vec3(0.022, 0.016, 0.05);',
      '  vec3 e = vec3(0.0);',
      '  float hy = vL.y / vS.y;',
      '  if (vN.y > 0.5) {',
      '    base *= 0.7;',
      '  } else {',
      '    float u = (abs(vN.x) > 0.5 ? vL.z : vL.x) + (vN.x * 3.1 + vN.z * 7.7) * 13.0;',
      '    vec2 cell = vec2(u / 1.05, vL.y / 0.9);',
      '    vec2 id = floor(cell); vec2 f = fract(cell);',
      '    float win = step(0.26, f.x) * step(f.x, 0.74) * step(0.3, f.y) * step(f.y, 0.72);',
      '    float r = h21(id + vSeed * 91.7);',
      '    float density = 0.1 + 0.32 * pow(fract(vSeed * 7.31), 1.5);',
      '    float lit = step(1.0 - density, r) * step(0.22, h21(vec2(id.y, vSeed * 13.1)));',
      '    float cr = h21(id * 1.7 + vSeed * 3.3);',
      '    vec3 wc = cr < 0.55 ? vec3(1.0, 0.7, 0.45) : (cr < 0.82 ? vec3(0.5, 0.92, 1.0) : vec3(1.0, 0.38, 0.62));',
      '    float flick = r > 0.992 ? 0.35 + 0.65 * step(0.4, fract(uTime * 2.3 + r * 17.0)) : 1.0;',
      '    vec3 detail = win * lit * wc * (0.55 + 0.6 * r) * flick + win * (1.0 - lit) * vec3(0.03, 0.02, 0.06);',
      '    vec2 fw = fwidth(cell);',
      '    float far = smoothstep(0.3, 0.75, max(fw.x, fw.y));',
      '    vec3 avg = vec3(0.95, 0.72, 0.6) * density * 0.2 * (0.5 + fract(vSeed * 3.7));',
      '    e = mix(detail, avg, far);',
      '    base += fogFar() * 0.05 * hy;',
      '  }',
      '  float rim = smoothstep(vS.y - 2.5, vS.y, vL.y);',
      '  base += mix(uGlow, fogFar(), 0.5) * rim * 0.18;',
      '  if (vSeed > 0.86 && vS.y > 40.0) {',
      '    float band = smoothstep(vS.y - 0.9, vS.y - 0.5, vL.y) * (1.0 - smoothstep(vS.y - 0.3, vS.y, vL.y));',
      '    e += (fract(vSeed * 11.0) > 0.5 ? vec3(0.25, 0.9, 1.0) : vec3(1.0, 0.25, 0.55)) * band * 1.4;',
      '  }',
      '  float fa = fogAmt(vW);',
      '  vec3 col = mix(base, fogCol(vW), fa) + e * (1.0 - fa * 0.7);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  var city = new T.InstancedMesh(bGeo, bMat, N);
  var m4 = new T.Matrix4();
  for (var i = 0; i < N; i++) {
    var b = list[i];
    m4.makeTranslation(b[0], 0, b[1]);
    city.setMatrixAt(i, m4);
    aScale[i * 3] = b[2]; aScale[i * 3 + 1] = b[3]; aScale[i * 3 + 2] = b[4];
    aSeed[i] = b[5];
  }
  bGeo.setAttribute('aScale', new T.InstancedBufferAttribute(aScale, 3));
  bGeo.setAttribute('aSeed', new T.InstancedBufferAttribute(aSeed, 1));
  city.frustumCulled = false;
  scene.add(city);

  /* ---------- rain (light — heavier rain comes in a later pass) ---------- */
  var DROPS = mobile ? 1400 : 3500;
  var rPos = new Float32Array(DROPS * 6), rEnd = new Float32Array(DROPS * 2), rSpd = new Float32Array(DROPS * 2);
  for (var k = 0; k < DROPS; k++) {
    var px = (rand() - 0.5) * 180, py = rand() * 110, pz = -rand() * 220 + 10, sp = 55 + rand() * 45;
    for (var j = 0; j < 2; j++) {
      rPos[(k * 2 + j) * 3] = px; rPos[(k * 2 + j) * 3 + 1] = py; rPos[(k * 2 + j) * 3 + 2] = pz;
      rEnd[k * 2 + j] = j; rSpd[k * 2 + j] = sp;
    }
  }
  var rGeo = new T.BufferGeometry();
  rGeo.setAttribute('position', new T.BufferAttribute(rPos, 3));
  rGeo.setAttribute('aEnd', new T.BufferAttribute(rEnd, 1));
  rGeo.setAttribute('aSpd', new T.BufferAttribute(rSpd, 1));
  var rain = new T.LineSegments(rGeo, new T.ShaderMaterial({
    uniforms: { uTime: U.uTime, uCamB: { value: CAM_BASE } },
    vertexShader: [
      'attribute float aEnd; attribute float aSpd; uniform float uTime; uniform vec3 uCamB; varying float vA;',
      'void main(){',
      '  vec3 p = position; p.y = mod(p.y - uTime * aSpd, 110.0);',
      '  vec3 w = uCamB + vec3(p.x, p.y - 70.0, p.z);',
      '  w += vec3(-0.18, -1.0, 0.0) * aEnd * (0.9 + aSpd * 0.025);',
      '  vec4 mv = viewMatrix * vec4(w, 1.0); float dist = -mv.z;',
      '  vA = mix(1.0, 0.15, aEnd) * smoothstep(3.0, 12.0, dist) * (1.0 - smoothstep(90.0, 220.0, dist));',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(0.75, 0.88, 1.0), vA * 0.33); }',
    transparent: true, depthWrite: false, blending: T.AdditiveBlending
  }));
  rain.frustumCulled = false;
  if (!reduce) scene.add(rain);

  /* ---------- post: bloom ---------- */
  var composer = null, bloom = null;
  if (T.EffectComposer && T.UnrealBloomPass) {
    composer = new T.EffectComposer(renderer);
    composer.addPass(new T.RenderPass(scene, camera));
    bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), 0.95, 0.55, 0.5);
    composer.addPass(bloom);
  }
  var BLOOM_BASE = 0.95;

  /* ---------- sizing ---------- */
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 68 : 55;
    camera.updateProjectionMatrix();
    if (composer) {
      composer.setSize(w, h);
      bloom.resolution.set(w / 2, h / 2);
    }
    if (reduce) draw();
  }
  window.addEventListener('resize', resize);

  /* ---------- interaction ---------- */
  var ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!mobile && !reduce) {
    window.addEventListener('pointermove', function (e) {
      ptr.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ptr.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }
  var moodTarget = { c: MOOD.none, a: 0 };
  function setMood(m) {
    moodTarget.c = MOOD[m] || MOOD.none;
    moodTarget.a = MOOD[m] ? 1 : 0;
    if (reduce) { U.uMood.value.copy(moodTarget.c); U.uMoodAmt.value = moodTarget.a * 0.35; draw(); }
  }

  /* ---------- loop ---------- */
  var clock = new T.Clock(), t = 0, frames = 0, slowSum = 0, degraded = false;
  function draw() {
    camera.lookAt(LOOK);
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  var paused = false;
  function tick() {
    if (paused) { clock.getDelta(); requestAnimationFrame(tick); return; }
    var dt = Math.min(clock.getDelta(), 0.1);
    t += dt;
    U.uTime.value = t;
    ptr.x += (ptr.tx - ptr.x) * 0.04; ptr.y += (ptr.ty - ptr.y) * 0.04;
    camera.position.set(
      CAM_BASE.x + Math.sin(t * 0.05) * 6 + ptr.x * 5,
      CAM_BASE.y + Math.sin(t * 0.07) * 1.5 - ptr.y * 2.5,
      CAM_BASE.z + Math.sin(t * 0.031) * 4
    );
    LOOK.x = LOOK_X + Math.sin(t * 0.04) * 20 + ptr.x * 30;
    U.uMood.value.lerp(moodTarget.c, 0.05);
    U.uMoodAmt.value += (moodTarget.a * 0.35 - U.uMoodAmt.value) * 0.05;
    if (bloom) bloom.strength = BLOOM_BASE + U.uMoodAmt.value * 0.4;
    draw();
    // adaptive quality: if the first ~2s run slow, drop resolution once
    if (!degraded && frames < 120) {
      frames++; if (frames > 20) slowSum += dt;
      if (frames === 120 && slowSum / 100 > 0.026) {
        degraded = true;
        renderer.setPixelRatio(1);
        resize();
      }
    }
    requestAnimationFrame(tick);
  }

  resize();
  if (reduce) { U.uTime.value = 12; draw(); } else requestAnimationFrame(tick);

  window.loreScene = { pause: function () { paused = true; }, resume: function () { paused = false; }, setMood: setMood, ready: true, bloom: bloom, uniforms: U, camera: camera };
  window.dispatchEvent(new Event('lorescene:ready'));
})();
