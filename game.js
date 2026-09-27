(() => {
  'use strict';

  const canvas = document.querySelector('#track');
  const ctx = canvas.getContext('2d', { alpha: false });
  const mapCanvas = document.querySelector('#minimap');
  const mapCtx = mapCanvas.getContext('2d');
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    menu: $('#menu'), pauseMenu: $('#pauseMenu'), results: $('#results'), hud: $('#hud'),
    touch: $('#touchControls'), pause: $('#pauseButton'), countdown: $('#countdown'),
    toast: $('#toast'), position: $('#position'), lap: $('#lap'), time: $('#time'),
    speed: $('#speed'), charge: $('#chargeValue'), chargeFill: $('#chargeFill'),
    boostHint: $('#boostHint'), resultPlace: $('#resultPlace'), resultSummary: $('#resultSummary'),
  };

  const SEGMENT = 180;
  const SEGMENTS = 460;
  const TRACK_LENGTH = SEGMENT * SEGMENTS;
  const ROAD_WIDTH = 2150;
  const CAMERA_BACK = 1050;
  const CAMERA_HEIGHT = 1120;
  const CAMERA_DEPTH = 1.25;
  const MAX_SPEED = 4900;
  const DRAW_SEGMENTS = 165;
  const TAU = Math.PI * 2;
  const keys = { left: false, right: false, gas: false, drift: false, boost: false };
  const pointerControls = new Map();
  const aiColors = ['#fa5b73', '#ffe45f', '#49e6c3', '#9f83ff', '#ff9e48'];
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const wrap = (v, max) => ((v % max) + max) % max;
  const lerp = (a, b, t) => a + (b - a) * t;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastFrame = performance.now();
  let toastUntil = 0;
  let previousCountdown = '';
  let game = freshGame();

  function freshGame() {
    return {
      mode: 'menu', countdown: 3, distance: 0, speed: 0, lateral: 0,
      steerMomentum: 0, driftCharge: 0, boostTime: 0, raceTime: 0,
      offRoadNotified: false, ai: aiColors.map((color, i) => ({
        color, distance: 1100 + i * 340, lateral: [-0.6, 0.4, 0.05, -0.25, 0.7][i],
        speed: 3500 + i * 180, phase: i * 1.9,
      })),
    };
  }

  function roadCenter(z) {
    const t = wrap(z, TRACK_LENGTH) / TRACK_LENGTH;
    return 1300 * Math.sin(TAU * t) + 1100 * Math.sin(TAU * (3 * t + 0.08)) + 650 * Math.sin(TAU * (5 * t - 0.14));
  }

  function roadHeight(z) {
    const t = wrap(z, TRACK_LENGTH) / TRACK_LENGTH;
    return 250 * Math.sin(TAU * (2 * t + 0.18)) + 150 * Math.sin(TAU * (4 * t - 0.22));
  }

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resetRace() {
    game = freshGame();
    game.mode = 'countdown';
    ui.menu.hidden = true;
    ui.pauseMenu.hidden = true;
    ui.results.hidden = true;
    ui.hud.hidden = false;
    ui.touch.hidden = !matchMedia('(any-pointer: coarse)').matches;
    ui.pause.hidden = false;
    ui.countdown.hidden = false;
    ui.toast.hidden = true;
    previousCountdown = '';
    Object.keys(keys).forEach((key) => { keys[key] = false; });
    pointerControls.clear();
    updateHud();
  }

  function pauseRace() {
    if (game.mode === 'racing' || game.mode === 'countdown') {
      game.wasCounting = game.mode === 'countdown';
      game.mode = 'paused';
      ui.pauseMenu.hidden = false;
      ui.countdown.hidden = true;
      Object.keys(keys).forEach((key) => { keys[key] = false; });
    } else if (game.mode === 'paused') {
      game.mode = game.wasCounting ? 'countdown' : 'racing';
      ui.pauseMenu.hidden = true;
      ui.countdown.hidden = game.mode !== 'countdown';
    }
  }

  function finishRace() {
    game.mode = 'finished';
    const place = rank();
    const suffix = place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th';
    ui.resultPlace.textContent = `${place}${suffix}`;
    ui.resultSummary.textContent = `เวลา ${formatTime(game.raceTime)} · ${place === 1 ? 'สุดยอด! คุณเป็นแชมป์สนามนี้' : 'ลองใหม่แล้วแซงให้ได้!'}`;
    ui.results.hidden = false;
    ui.touch.hidden = true;
    ui.pause.hidden = true;
  }

  function toast(message, duration = 1.4) {
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    toastUntil = performance.now() + duration * 1000;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const d = Math.floor((seconds * 10) % 10);
    return `${m}:${s}.${d}`;
  }

  function rank() {
    return 1 + game.ai.filter((opponent) => opponent.distance > game.distance).length;
  }

  function updateHud() {
    ui.position.innerHTML = `${rank()}<span>/ 6</span>`;
    ui.lap.innerHTML = `${Math.min(3, Math.floor(game.distance / TRACK_LENGTH) + 1)}<span>/ 3</span>`;
    ui.time.textContent = formatTime(game.raceTime);
    ui.speed.textContent = Math.round(game.speed / MAX_SPEED * 225).toString();
    ui.charge.textContent = `${Math.floor(game.driftCharge)}%`;
    ui.chargeFill.style.width = `${game.driftCharge}%`;
    const ready = game.driftCharge >= 55;
    ui.boostHint.textContent = game.boostTime > 0 ? 'TURBO ACTIVE!' : ready ? 'บูสต์พร้อมแล้ว!' : 'ดริฟต์เพื่อชาร์จบูสต์';
    $('.boost-button').classList.toggle('ready', ready);
  }

  function useBoost() {
    if (game.mode !== 'racing' || game.boostTime > 0 || game.driftCharge < 55) return;
    game.driftCharge -= 55;
    game.boostTime = 2.4;
    toast('TURBO BOOST! ⚡', 1.1);
  }

  function update(dt) {
    if (performance.now() > toastUntil) ui.toast.hidden = true;
    if (game.mode === 'countdown') {
      game.countdown -= dt;
      const count = Math.ceil(game.countdown);
      const label = count > 0 ? String(count) : 'GO!';
      if (label !== previousCountdown) {
        ui.countdown.textContent = label;
        previousCountdown = label;
      }
      if (game.countdown <= -0.55) {
        game.mode = 'racing';
        ui.countdown.hidden = true;
      }
      return;
    }
    if (game.mode !== 'racing') return;

    game.raceTime += dt;
    const accelerating = keys.gas || matchMedia('(any-pointer: coarse)').matches;
    const acceleration = keys.gas ? 3300 : 2600;
    const steer = Number(keys.right) - Number(keys.left);
    const drifting = keys.drift && Math.abs(steer) > 0 && game.speed > 1000;
    const cap = game.boostTime > 0 ? MAX_SPEED * 1.32 : MAX_SPEED;
    const drag = game.speed * (game.boostTime > 0 ? 0.06 : 0.10);
    game.speed += (accelerating ? acceleration : -1750) * dt - drag * dt;
    if (game.boostTime > 0) {
      game.boostTime = Math.max(0, game.boostTime - dt);
      game.speed += 2450 * dt;
    }
    if (Math.abs(game.lateral) > 1.03) {
      game.speed -= 2100 * dt;
      if (!game.offRoadNotified) {
        toast('ออกนอกสนาม!');
        game.offRoadNotified = true;
      }
    } else game.offRoadNotified = false;
    game.speed = clamp(game.speed, 0, cap);

    const oldDistance = game.distance;
    game.distance += game.speed * dt;
    const curveShift = (roadCenter(game.distance) - roadCenter(oldDistance)) / ROAD_WIDTH;
    game.steerMomentum = lerp(game.steerMomentum, steer, Math.min(1, dt * (drifting ? 5.5 : 8.5)));
    game.lateral += game.steerMomentum * (drifting ? 1.55 : 1.12) * dt * (0.35 + 0.65 * game.speed / MAX_SPEED);
    game.lateral -= curveShift * (drifting ? 0.32 : 0.6);
    game.lateral = clamp(game.lateral, -1.42, 1.42);

    if (drifting) game.driftCharge = clamp(game.driftCharge + dt * 31 * (0.7 + game.speed / MAX_SPEED), 0, 100);
    if (keys.boost) useBoost();

    for (const opponent of game.ai) {
      opponent.distance += opponent.speed * dt * (1 + Math.sin(game.raceTime * 0.35 + opponent.phase) * 0.055);
      opponent.lateral += (Math.sin(game.raceTime * 0.45 + opponent.phase) * 0.55 - opponent.lateral) * dt * 0.45;
      const gap = opponent.distance - game.distance;
      if (Math.abs(gap) < 260 && Math.abs(opponent.lateral - game.lateral) < 0.27 && game.speed > 1700) {
        game.speed *= Math.max(0.55, 1 - dt * 2.5);
      }
    }

    if (game.distance >= TRACK_LENGTH * 3) {
      game.distance = TRACK_LENGTH * 3;
      finishRace();
    }
    updateHud();
  }

  function project(worldX, worldY, relativeZ, cameraX, cameraY) {
    const scale = CAMERA_DEPTH / Math.max(1, relativeZ);
    return {
      x: width * 0.5 + (worldX - cameraX) * scale * width * 0.5,
      y: height * 0.51 - (worldY - cameraY) * scale * height * 0.5,
      w: ROAD_WIDTH * scale * width * 0.5,
      scale,
    };
  }

  function polygon(points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, height * 0.7);
    sky.addColorStop(0, '#50b4f4');
    sky.addColorStop(0.62, '#a7e9ff');
    sky.addColorStop(1, '#f5eeab');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const sunX = width * 0.76 - roadCenter(game.distance) * 0.018;
    const sunY = height * 0.20;
    ctx.fillStyle = '#fff2b0';
    ctx.beginPath(); ctx.arc(sunX, sunY, Math.max(28, width * 0.035), 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffffb8';
    for (let i = 0; i < 8; i++) {
      const x = wrap(i * 289 + 80 - game.distance * 0.007, width + 340) - 170;
      const y = height * (0.12 + (i % 3) * 0.055);
      ctx.beginPath();
      ctx.ellipse(x, y, 48 + (i % 3) * 18, 10 + (i % 2) * 3, 0, 0, TAU);
      ctx.ellipse(x - 25, y + 4, 30, 9, 0, 0, TAU);
      ctx.ellipse(x + 28, y + 3, 34, 8, 0, 0, TAU);
      ctx.fill();
    }

    const offset = roadCenter(game.distance) * 0.022;
    polygon([[0,height*.53],[0,height*.39],[width*.12-offset,height*.27],[width*.24-offset,height*.41],[width*.38-offset,height*.30],[width*.56-offset,height*.44],[width*.72-offset,height*.34],[width,height*.45],[width,height*.53]], '#7facb6');
    polygon([[0,height*.57],[0,height*.46],[width*.16+offset*.4,height*.43],[width*.28+offset*.4,height*.49],[width*.49+offset*.4,height*.41],[width*.66+offset*.4,height*.50],[width,height*.43],[width,height*.57]], '#4f9d82');
  }

  function drawRoad() {
    const cameraZ = game.distance - CAMERA_BACK;
    const cameraX = roadCenter(game.distance) + game.lateral * ROAD_WIDTH * 0.65;
    const cameraY = roadHeight(game.distance) + CAMERA_HEIGHT;
    const baseZ = Math.floor(cameraZ / SEGMENT) * SEGMENT;
    const visible = [];
    for (let i = 1; i <= DRAW_SEGMENTS; i++) {
      const z = baseZ + i * SEGMENT;
      const relative = z - cameraZ;
      if (relative < 100) continue;
      visible.push({ z, index: Math.floor(z / SEGMENT), p: project(roadCenter(z), roadHeight(z), relative, cameraX, cameraY) });
    }

    for (let i = visible.length - 1; i > 0; i--) {
      const far = visible[i];
      const near = visible[i - 1];
      const a = far.p; const b = near.p;
      if (a.y > height || b.y < 0 || b.y <= a.y) continue;
      const stripe = Math.abs(near.index) % 6 < 3;
      ctx.fillStyle = stripe ? '#4fb168' : '#59b96a';
      ctx.fillRect(0, a.y, width, b.y - a.y + 2);
      polygon([[a.x-a.w*1.12,a.y],[a.x+a.w*1.12,a.y],[b.x+b.w*1.12,b.y],[b.x-b.w*1.12,b.y]], stripe ? '#f7f7eb' : '#fb6460');
      polygon([[a.x-a.w,a.y],[a.x+a.w,a.y],[b.x+b.w,b.y],[b.x-b.w,b.y]], stripe ? '#526875' : '#586f7a');
      if (Math.abs(near.index) % 10 < 5) {
        for (const lane of [-1/3, 1/3]) {
          const markFar = a.x + lane * a.w;
          const markNear = b.x + lane * b.w;
          const lineFar = Math.max(1, a.w * 0.012);
          const lineNear = Math.max(1, b.w * 0.012);
          polygon([[markFar-lineFar,a.y],[markFar+lineFar,a.y],[markNear+lineNear,b.y],[markNear-lineNear,b.y]], '#fff7c6bb');
        }
      }
      if (Math.abs(near.index) % 9 === 0) {
        drawTree(near.z, -1, cameraX, cameraY, cameraZ);
        if (Math.abs(near.index) % 18 === 0) drawTree(near.z, 1, cameraX, cameraY, cameraZ);
      }
      if (Math.abs(near.index) % 36 === 15) drawSign(near.z, cameraX, cameraY, cameraZ);
    }
    drawOpponents(cameraX, cameraY, cameraZ);
  }

  function drawTree(z, side, cameraX, cameraY, cameraZ) {
    const p = project(roadCenter(z) + side * ROAD_WIDTH * 1.95, roadHeight(z), z - cameraZ, cameraX, cameraY);
    if (p.x < -130 || p.x > width + 130 || p.y > height + 100 || p.y < -100) return;
    const size = clamp(p.scale * height * 350, 3, height * 0.42);
    ctx.fillStyle = '#5e6444';
    ctx.fillRect(p.x - size * .08, p.y - size * .65, size * .16, size * .68);
    ctx.fillStyle = '#276e52';
    ctx.beginPath(); ctx.arc(p.x, p.y-size*.78, size*.34, 0, TAU); ctx.fill();
    ctx.fillStyle = '#36a273';
    ctx.beginPath(); ctx.arc(p.x-size*.16, p.y-size*.97, size*.28, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x+size*.19, p.y-size*.9, size*.27, 0, TAU); ctx.fill();
  }

  function drawSign(z, cameraX, cameraY, cameraZ) {
    const p = project(roadCenter(z) + ROAD_WIDTH * 2, roadHeight(z), z - cameraZ, cameraX, cameraY);
    if (p.x < -120 || p.x > width + 120 || p.y > height || p.y < -100) return;
    const s = clamp(p.scale * width * 220, 4, 90);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(p.x-s*.06,p.y-s*1.1,s*.12,s*1.1);
    ctx.fillStyle = '#254e9a'; ctx.fillRect(p.x-s*.75,p.y-s*1.15,s*1.5,s*.56);
    ctx.fillStyle = '#ffe657'; ctx.font = `900 ${Math.max(6,s*.23)}px Kanit, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('TURBO', p.x, p.y-s*.80);
  }

  function drawOpponents(cameraX, cameraY, cameraZ) {
    const visible = [];
    for (const opponent of game.ai) {
      const relative = opponent.distance - cameraZ;
      if (relative < 600 || relative > DRAW_SEGMENTS * SEGMENT) continue;
      const p = project(roadCenter(opponent.distance) + opponent.lateral * ROAD_WIDTH * .82, roadHeight(opponent.distance), relative, cameraX, cameraY);
      visible.push({ p, opponent });
    }
    visible.sort((a,b) => a.p.scale - b.p.scale);
    for (const { p, opponent } of visible) {
      const size = clamp(p.scale * width * 280, 9, width * .29);
      drawKart(p.x, p.y, size, opponent.color, 0, false);
    }
  }

  function roundedRect(x,y,w,h,r,color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fill();
  }

  function drawKart(x, y, size, color, lean, player) {
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(lean);
    const s = size / 200;
    ctx.scale(s,s);
    ctx.fillStyle = '#14283d77';
    ctx.beginPath(); ctx.ellipse(0,9,105,27,0,0,TAU); ctx.fill();
    if (player && game.boostTime > 0) {
      for (const side of [-1,1]) {
        polygon([[side*44,8],[side*31,8],[side*37,54+Math.random()*28],[side*54,20]], '#55eaff');
        polygon([[side*43,9],[side*34,9],[side*40,36+Math.random()*15]], '#fff7ab');
      }
    }
    roundedRect(-96,-47,31,52,12,'#172339');
    roundedRect(65,-47,31,52,12,'#172339');
    roundedRect(-100,-45,10,39,4,'#4f6579');
    roundedRect(90,-45,10,39,4,'#4f6579');
    polygon([[-83,-50],[-65,-94],[65,-94],[83,-50],[68,3],[-68,3]], color);
    polygon([[-58,-82],[-38,-107],[38,-107],[58,-82]], '#ffffffa8');
    roundedRect(-71,-42,142,28,10,'#183055');
    roundedRect(-80,-17,160,23,9,color);
    roundedRect(-70,-10,26,13,4,'#ff554e');
    roundedRect(44,-10,26,13,4,'#ff554e');
    roundedRect(-31,-71,62,28,12,'#1d3260');
    ctx.fillStyle = '#f9d9ad'; ctx.beginPath(); ctx.arc(0,-85,28,0,TAU); ctx.fill();
    ctx.fillStyle = '#2434a3'; ctx.beginPath(); ctx.arc(0,-101,33,Math.PI,TAU); ctx.lineTo(33,-91); ctx.lineTo(-33,-91); ctx.closePath(); ctx.fill();
    roundedRect(-21,-97,42,15,7,'#70e7f1');
    roundedRect(-18,-12,36,13,5,'#ffe55b');
    ctx.restore();
  }

  function drawPlayer() {
    const lean = game.steerMomentum * (keys.drift ? .12 : .055);
    const x = width * .5 + game.lateral * Math.min(width * .09, 90);
    const y = height * (height < 500 ? .88 : .84);
    const size = clamp(Math.min(width * .29, height * .43), 132, 300);
    if (game.speed > 2200) {
      ctx.strokeStyle = game.boostTime > 0 ? '#79edff88' : '#ffffff55';
      ctx.lineWidth = game.boostTime > 0 ? 3 : 2;
      for (let i = 0; i < 10; i++) {
        const t = (i * 0.37 + game.distance * 0.0008) % 1;
        const rayX = width * (.5 + (i - 5) * .08) + game.lateral * 40;
        const rayY = height * (.7 + t * .36);
        ctx.beginPath(); ctx.moveTo(rayX,rayY); ctx.lineTo(rayX+(rayX-width*.5)*.15,rayY+16+t*22); ctx.stroke();
      }
    }
    drawKart(x,y,size,'#f6c931',lean,true);
  }

  function drawMinimap() {
    const w = mapCanvas.width, h = mapCanvas.height;
    mapCtx.clearRect(0,0,w,h);
    const start = game.distance;
    mapCtx.beginPath();
    for (let i = 0; i <= 34; i++) {
      const z = start + i * 330;
      const x = w*.5 + (roadCenter(z)-roadCenter(start)) * .017;
      const y = h - 15 - i * (h - 28) / 34;
      if (i === 0) mapCtx.moveTo(x,y); else mapCtx.lineTo(x,y);
    }
    mapCtx.lineCap = 'round'; mapCtx.lineJoin = 'round';
    mapCtx.strokeStyle = '#244968'; mapCtx.lineWidth = 13; mapCtx.stroke();
    mapCtx.strokeStyle = '#eaf9fd'; mapCtx.lineWidth = 7; mapCtx.stroke();
    mapCtx.fillStyle = '#ffe346'; mapCtx.beginPath(); mapCtx.arc(w*.5,h-15,7,0,TAU); mapCtx.fill();
    for (const opponent of game.ai) {
      const gap = opponent.distance - start;
      if (gap < 0 || gap > 11220) continue;
      const x = w*.5 + (roadCenter(opponent.distance)-roadCenter(start))*.017;
      const y = h - 15 - gap / 11220 * (h - 28);
      mapCtx.fillStyle = opponent.color; mapCtx.beginPath(); mapCtx.arc(x,y,4,0,TAU); mapCtx.fill();
    }
  }

  function render() {
    drawSky();
    drawRoad();
    drawPlayer();
    if (game.mode !== 'menu') drawMinimap();
  }

  function frame(now) {
    const dt = Math.min(.05, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function keyToControl(key) {
    if (key === 'ArrowLeft' || key.toLowerCase() === 'a') return 'left';
    if (key === 'ArrowRight' || key.toLowerCase() === 'd') return 'right';
    if (key === 'ArrowUp' || key.toLowerCase() === 'w') return 'gas';
    if (key === ' ' || key === 'Spacebar') return 'drift';
    if (key === 'Shift') return 'boost';
    return null;
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
      if (!event.repeat) pauseRace();
      event.preventDefault(); return;
    }
    if (event.key === 'Enter' && game.mode === 'menu') { resetRace(); event.preventDefault(); return; }
    const control = keyToControl(event.key);
    if (control) { keys[control] = true; event.preventDefault(); }
  });
  window.addEventListener('keyup', (event) => {
    const control = keyToControl(event.key);
    if (control) { keys[control] = false; event.preventDefault(); }
  });
  window.addEventListener('blur', () => {
    Object.keys(keys).forEach((key) => { keys[key] = false; });
    if (game.mode === 'racing') pauseRace();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.mode === 'racing') pauseRace();
  });

  document.querySelectorAll('[data-control]').forEach((button) => {
    const control = button.dataset.control;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      pointerControls.set(event.pointerId, control);
      keys[control] = true; button.classList.add('active');
    });
    const release = (event) => {
      pointerControls.delete(event.pointerId);
      keys[control] = [...pointerControls.values()].includes(control);
      if (!keys[control]) button.classList.remove('active');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });

  $('#startButton').addEventListener('click', resetRace);
  $('#againButton').addEventListener('click', resetRace);
  $('#restartButton').addEventListener('click', resetRace);
  $('#pauseButton').addEventListener('click', pauseRace);
  $('#resumeButton').addEventListener('click', pauseRace);
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
