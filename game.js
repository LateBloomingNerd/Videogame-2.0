/* Sonic Christmas
   Korte platformer in de geest van de klassieke Sonic-spellen:
   aanloop, glijden, ringen die een klap opvangen, en een finish.
   Alles is zelf getekend op het canvas. Geen externe plaatjes.
*/
(() => {
  'use strict';

  const VIEW_W = 960;
  const VIEW_H = 540;

  // Beweging per frame (60 fps), in de trant van het origineel:
  // optrekken, hard afremmen, en een beetje doorglijden.
  const ACCEL = 0.09;
  const DECEL = 0.48;
  const FRIC = 0.085;
  const AIR = 0.15;
  const TOP = 6.35;
  const GRAV = 0.27;
  const JUMP = 8.05;
  const FALL_MAX = 11;
  const SPRING_V = -11.6;

  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const screenEl = document.getElementById('screen');
  const cardEl = document.getElementById('card');
  const playBtn = document.getElementById('play');
  const ledeEl = document.getElementById('lede');
  const helpEl = document.getElementById('help');
  const hMain = document.getElementById('h-main');
  const hSub = document.getElementById('h-sub');
  const eyebrowEl = document.getElementById('eyebrow');
  const winLine = document.getElementById('win-line');
  const WIN_TEXT = 'Bine jucat! Ai câștigat. Româncă nebunatică ;)';

  // Vaste grond. Gaten tussen de stukken zijn afgronden.
  // y groeit naar beneden. y1 is de hoogte aan de rechterkant (helling).
  const TERRAIN = [
    { x: 0, w: 2500, y: 460, y1: 460 },
    { x: 3080, w: 1400, y: 460, y1: 460 },
    { x: 4480, w: 420, y: 460, y1: 530 },
    { x: 5090, w: 750, y: 530, y1: 530 },
    { x: 5840, w: 460, y: 530, y1: 460 },
    { x: 6300, w: 360, y: 460, y1: 460 },
    { x: 7600, w: 1500, y: 460, y1: 460 },
  ];
  const LEVEL_W = 9100;
  const GOAL_X = 8520;

  const held = new Set();
  let wantJump = false;
  let state = 'title';
  let anim = 0;
  let zoneTimer = 0;
  let deadTimer = 0;
  let clearTimer = 0;
  let flash = 0;
  let hudPop = 0;
  let actx = null;
  let musicGain = null;
  let noiseBuf = null;
  let musicOn = false;
  let musicStep = 0;
  let musicTime = 0;

  const cam = { x: 0, y: 0, shake: 0 };
  const player = {
    x: 200, y: 460, vx: 0, vy: 0, facing: 1,
    onGround: true, jumping: false, ride: null,
    coyote: 0, buffer: 0, cutLock: 0,
    lives: 3, rings: 0, score: 0, invuln: 0,
    runFrame: 0, spin: 0,
  };
  let spawn = { x: 200, y: 460 };

  let rings = [];
  let loose = [];
  let enemies = [];
  let platforms = [];
  let springs = [];
  let presents = [];
  let checkpoints = [];
  let projectiles = [];
  let sparks = [];
  let popups = [];
  let groundMesh = [];
  const goal = { clear: false, done: false };

  const snow = Array.from({ length: 80 }, (_, i) => ({
    x: hash(i + 1) * VIEW_W,
    y: hash(i + 7) * VIEW_H,
    r: hash(i + 3) * 2.1 + 0.6,
    v: hash(i + 5) * 1.15 + 0.35,
    drift: hash(i + 9) * Math.PI * 2,
  }));

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.repeat) return;
    held.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyW') wantJump = true;
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); wantJump = false; });

  function hash(n) {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function pad(n, len) {
    const s = String(Math.max(0, n | 0));
    return s.length >= len ? s : '0'.repeat(len - s.length) + s;
  }

  function groundY(x) {
    for (const s of TERRAIN) {
      if (x >= s.x && x <= s.x + s.w) {
        const t = s.w === 0 ? 0 : (x - s.x) / s.w;
        return s.y + (s.y1 - s.y) * t;
      }
    }
    return null;
  }

  function slopeAt(x) {
    const left = groundY(x - 12);
    const right = groundY(x + 12);
    if (left == null || right == null) return 0;
    return (right - left) / 24;
  }

  function makePlatform(x, y, w, h, axis, amp, speed, phase) {
    const p = {
      x, y, w, h, baseX: x, baseY: y,
      axis: axis || 'none', amp: amp || 0, speed: speed || 0,
      phase: phase || 0, prevX: x, prevY: y,
    };
    placePlatform(p);
    p.prevX = p.x;
    p.prevY = p.y;
    return p;
  }

  function placePlatform(p) {
    if (p.axis === 'x') p.x = p.baseX + Math.sin(p.phase) * p.amp;
    else p.x = p.baseX;
    if (p.axis === 'y') p.y = p.baseY + Math.sin(p.phase) * p.amp;
    else p.y = p.baseY;
  }

  function ring(x, y) { rings.push({ x, y }); }

  function ringLine(x, y, n, gap) {
    for (let i = 0; i < n; i++) ring(x + i * gap, y);
  }

  function ringOnGround(x, n, gap, lift) {
    for (let i = 0; i < n; i++) {
      const rx = x + i * gap;
      const gy = groundY(rx);
      if (gy != null) ring(rx, gy - lift);
    }
  }

  function ringHump(x0, x1, baseY, height, n) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      ring(x0 + (x1 - x0) * t, baseY - Math.sin(t * Math.PI) * height);
    }
  }

  // Het level: intro, brug, schutter, afdaling, grote afgrond, finish.
  function buildWorld() {
    rings = [];
    loose = [];
    projectiles = [];
    sparks = [];
    popups = [];
    goal.clear = false;
    goal.done = false;

    platforms = [
      makePlatform(780, 390, 110, 16, 'x', 55, 0.03, 0),
      makePlatform(1500, 370, 120, 16, 'none', 0, 0, 0),
      makePlatform(1740, 300, 120, 16, 'none', 0, 0, 0),
      makePlatform(1980, 230, 130, 16, 'none', 0, 0, 0),
      makePlatform(2240, 400, 120, 16, 'y', 55, 0.022, 0),
      // Brug over de eerste afgrond, start aan de linkerkant vast.
      // Brug: linker rand beweegt van de ene oever naar de andere.
      makePlatform(2710, 460, 160, 18, 'x', 230, 0.016, -Math.PI / 2),
      makePlatform(6060, 300, 260, 16, 'none', 0, 0, 0),
      makePlatform(6915, 460, 160, 18, 'x', 275, 0.012, -Math.PI / 2),
      makePlatform(7420, 400, 150, 16, 'y', 24, 0.02, 0),
    ];

    ringOnGround(320, 7, 44, 58);
    ringHump(700, 980, 400, 70, 7);
    ringLine(760, 348, 3, 36);
    ringLine(1540, 328, 3, 28);
    ringLine(1770, 258, 3, 28);
    ringLine(2010, 188, 3, 32);
    ringLine(2140, 300, 4, 32);
    ringLine(2580, 400, 8, 52);
    ringOnGround(3200, 8, 42, 64);
    ringHump(4920, 5070, 490, 86, 7);
    ringOnGround(5200, 6, 40, 60);
    ringLine(6120, 258, 5, 36);
    ringLine(6880, 400, 6, 48);
    ringLine(7360, 340, 3, 34);
    ringOnGround(7780, 8, 46, 62);
    ringHump(8280, 8480, 400, 60, 6);

    enemies = [
      { kind: 'walker', x: 1500, y: 460, min: 1420, max: 1760, dir: 1, speed: 1.05, frame: 0, dead: false, puff: 0 },
      { kind: 'walker', x: 5480, y: 530, min: 5360, max: 5720, dir: -1, speed: 1.15, frame: 0, dead: false, puff: 0 },
      { kind: 'thrower', x: 3400, y: 460, hop: 0, vy: 0, onGround: true, face: -1, dead: false, puff: 0 },
      { kind: 'thrower', x: 7780, y: 460, hop: 30, vy: 0, onGround: true, face: -1, dead: false, puff: 0 },
    ];
    for (const e of enemies) {
      const gy = groundY(e.x);
      if (gy != null) e.y = gy;
    }

    springs = [
      { x: 1020, y: groundY(1020), anim: 0, cool: 0 },
      { x: 6160, y: groundY(6160), anim: 0, cool: 0 },
    ];

    presents = [
      { x: 560, y: groundY(560), opened: false },
      { x: 2040, y: 230, opened: false },
      { x: 6240, y: 300, opened: false },
      { x: 8320, y: groundY(8320), opened: false },
    ];

    checkpoints = [
      { x: 4250, lit: false },
      { x: 5980, lit: false },
      { x: 6500, lit: false },
    ];

    groundMesh = [];
    let cur = [];
    for (let x = 0; x <= LEVEL_W; x += 8) {
      const y = groundY(x);
      if (y == null) {
        if (cur.length) groundMesh.push(cur);
        cur = [];
      } else cur.push({ x, y });
    }
    if (cur.length) groundMesh.push(cur);
  }

  function resetPlayer(full) {
    if (full) {
      player.lives = 3;
      player.rings = 0;
      player.score = 0;
      spawn = { x: 200, y: groundY(200) };
    }
    player.x = full ? 200 : spawn.x;
    player.y = (full ? groundY(200) : spawn.y);
    player.vx = 0;
    player.vy = 0;
    player.facing = 1;
    player.onGround = true;
    player.jumping = false;
    player.ride = null;
    player.coyote = 0;
    player.buffer = 0;
    player.cutLock = 0;
    player.invuln = full ? 0 : 150;
    player.runFrame = 0;
    player.spin = 0;
  }

  function snapCam() {
    cam.x = clamp(player.x - VIEW_W * 0.36, 0, LEVEL_W - VIEW_W);
    cam.y = clamp(player.y - 380, 0, 200);
    cam.shake = 0;
  }

  function ensureAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
  }

  // Jingle Bells (publiek domein) in een snel, vierkant chiptune-tempo.
  const MELODY = [
    76, 76, 76, 0, 76, 76, 76, 0,
    76, 79, 72, 74, 76, 0, 0, 0,
    77, 77, 77, 77, 77, 76, 76, 76,
    76, 74, 74, 76, 74, 0, 79, 0,
    76, 76, 76, 0, 76, 76, 76, 0,
    76, 79, 72, 74, 76, 0, 0, 0,
    79, 81, 79, 76, 74, 76, 79, 81,
    84, 0, 79, 76, 74, 72, 0, 0,
  ];
  const BASS_ROOT = [36, 36, 41, 43, 36, 36, 36, 43];
  const MUSIC_STEP = 60 / 156 / 2;

  function midi(n) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  function startMusic() {
    ensureAudio();
    if (!actx || musicOn) return;
    musicGain = actx.createGain();
    musicGain.gain.value = 0.9;
    musicGain.connect(actx.destination);
    const len = Math.floor(actx.sampleRate * 0.045);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    musicOn = true;
    musicStep = 0;
    musicTime = actx.currentTime + 0.08;
  }

  function voice(time, note, dur, type, gain, cutoff) {
    const o = actx.createOscillator();
    const f = actx.createBiquadFilter();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(midi(note), time);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, time);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(f).connect(g).connect(musicGain);
    o.start(time);
    o.stop(time + dur + 0.03);
  }

  function sleigh(time) {
    voice(time, 91, 0.05, 'sine', 0.018, 5000);
    voice(time + 0.03, 96, 0.04, 'sine', 0.012, 5000);
    const src = actx.createBufferSource();
    const f = actx.createBiquadFilter();
    const g = actx.createGain();
    src.buffer = noiseBuf;
    f.type = 'highpass';
    f.frequency.value = 6000;
    g.gain.setValueAtTime(0.025, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    src.connect(f).connect(g).connect(musicGain);
    src.start(time);
    src.stop(time + 0.04);
  }

  function scheduleMusic() {
    if (!musicOn || !actx) return;
    if (musicTime < actx.currentTime - 0.05) musicTime = actx.currentTime + 0.05;
    const horizon = actx.currentTime + 0.28;
    while (musicTime < horizon) {
      const i = musicStep % MELODY.length;
      if (MELODY[i]) voice(musicTime, MELODY[i], MUSIC_STEP * 0.9, 'square', 0.05, 2400);
      const root = BASS_ROOT[Math.floor(i / 8) % BASS_ROOT.length];
      const step = i % 8;
      const bass = (step === 1 || step === 5) ? root + 12
        : (step === 3 || step === 7) ? root + 7
          : root;
      voice(musicTime, bass, MUSIC_STEP * 0.85, 'triangle', 0.07, 640);
      if (i % 2 === 0) sleigh(musicTime);
      musicTime += MUSIC_STEP;
      musicStep++;
    }
  }

  function tone(freq, when, dur, type, gain) {
    if (!actx) return;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g).connect(actx.destination);
    o.start(when);
    o.stop(when + dur);
  }

  function sfx(name) {
    if (!actx) return;
    const now = actx.currentTime;
    if (name === 'jump') tone(620, now, 0.08, 'square', 0.04);
    if (name === 'ring') {
      tone(880, now, 0.06, 'sine', 0.05);
      tone(1320, now + 0.05, 0.08, 'sine', 0.04);
    }
    if (name === 'hurt') tone(140, now, 0.18, 'sawtooth', 0.05);
    if (name === 'die') {
      tone(392, now, 0.12, 'square', 0.05);
      tone(262, now + 0.1, 0.18, 'square', 0.05);
    }
    if (name === 'spring') tone(420, now, 0.12, 'square', 0.05);
    if (name === 'stomp') tone(180, now, 0.08, 'square', 0.05);
    if (name === 'present') [523, 659, 784].forEach((f, i) => tone(f, now + i * 0.06, 0.1, 'square', 0.04));
    if (name === 'check') tone(660, now, 0.1, 'square', 0.04);
    if (name === 'win') [523, 659, 784, 1046].forEach((f, i) => tone(f, now + i * 0.12, 0.18, 'square', 0.05));
  }

  function burst(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + hash(i + x);
      sparks.push({
        x, y,
        vx: Math.cos(a) * (1.4 + hash(i) * 1.6),
        vy: Math.sin(a) * (1.4 + hash(i + 2) * 1.6),
        life: 18,
        color,
      });
    }
  }

  function boom(x, y) {
    const colors = ['#e10600', '#ffd24a', '#3ecf4a', '#4d8dff', '#fff'];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      sparks.push({
        x, y,
        vx: Math.cos(a) * (1.6 + hash(i + y) * 2.2),
        vy: Math.sin(a) * (1.6 + hash(i + 4) * 2.2),
        life: 46,
        color: colors[i % colors.length],
      });
    }
  }

  function popup(x, y, text) {
    popups.push({ x, y, text, life: 42 });
  }

  function grantRings(n, x, y) {
    player.rings += n;
    player.score += n * 100;
    hudPop = 8;
    burst(x, y - 10, '#ffd24a');
    sfx('ring');
  }

  function facingDir() {
    const left = held.has('ArrowLeft') || held.has('KeyA');
    const right = held.has('ArrowRight') || held.has('KeyD');
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  function jumpHeld() {
    return held.has('Space') || held.has('KeyW');
  }

  function doJump() {
    player.vy = -JUMP;
    player.onGround = false;
    player.jumping = true;
    player.ride = null;
    player.coyote = 0;
    player.buffer = 0;
    player.cutLock = 1;
    player.spin = 0;
    sfx('jump');
  }

  function updatePlatforms() {
    for (const p of platforms) {
      p.prevX = p.x;
      p.prevY = p.y;
      if (p.axis !== 'none') p.phase += p.speed;
      placePlatform(p);
    }
  }

  function carryPlayer() {
    const ride = player.ride;
    if (!ride) return;
    player.x += ride.x - ride.prevX;
    player.y += ride.y - ride.prevY;
  }

  // Zwaartekracht, grond en platforms. Wordt ook bij de finish gebruikt.
  function moveBody(allowInput) {
    const wasGround = player.onGround;
    player.prevX = player.x;
    player.prevY = player.y;

    if (allowInput) {
      if (wantJump) player.buffer = 8;
      wantJump = false;
      if (player.buffer > 0 && (wasGround || player.coyote > 0)) doJump();
      else if (player.buffer > 0) player.buffer--;

      const dir = facingDir();
      const slope = wasGround && !player.ride ? slopeAt(player.x) : 0;
      if (wasGround) {
        if (dir !== 0) {
          if (player.vx !== 0 && Math.sign(player.vx) !== dir) player.vx += dir * DECEL;
          else player.vx += dir * ACCEL;
        } else {
          const fr = Math.abs(slope) > 0.08 ? 0.02 : FRIC;
          player.vx -= Math.sign(player.vx) * Math.min(Math.abs(player.vx), fr);
        }
        if (!player.ride) player.vx += slope * 0.45;
        const extra = slope * Math.sign(player.vx || 1) > 0.08 ? 2 : 0;
        player.vx = clamp(player.vx, -(TOP + extra), TOP + extra);
      } else if (dir !== 0) {
        player.vx += dir * AIR;
        player.vx = clamp(player.vx, -(TOP + 2), TOP + 2);
      }

      if (player.cutLock > 0) player.cutLock--;
      else if (!jumpHeld() && player.vy < -3) player.vy *= 0.62;

      if (dir !== 0) player.facing = dir;
    } else {
      wantJump = false;
      player.vx *= 0.9;
    }

    player.vy = Math.min(FALL_MAX, player.vy + GRAV);
    player.x += player.vx;
    player.y += player.vy;
    // De tekening steekt links en rechts uit; blijf binnen beeld.
    if (player.x < 78) { player.x = 78; if (player.vx < 0) player.vx = 0; }
    if (player.x > LEVEL_W - 70) { player.x = LEVEL_W - 70; if (player.vx > 0) player.vx = 0; }

    let landed = null;
    let gy = groundY(player.x);
    if (gy != null && player.vy >= 0 && player.prevY - gy > 70) {
      // Te steile rand: niet de heuvel in lopen.
      player.x = player.prevX;
      player.vx = 0;
      gy = groundY(player.x);
    }
    if (gy != null && player.vy >= 0) {
      const crossed = player.prevY <= gy + 1 && player.y >= gy - 1;
      const stick = wasGround && player.y <= gy + 18 && gy - player.y < 40;
      const buried = player.y > gy && player.y - gy < 36;
      if (crossed || stick || buried) landed = { top: gy, ride: null };
    }

    for (const plat of platforms) {
      const hw = 16;
      if (player.x + hw < plat.x || player.x - hw > plat.x + plat.w) continue;
      if (player.vy < 0 && player.ride !== plat) continue;
      const top = plat.y;
      const crossed = player.prevY <= top + 1 && player.y >= top - 1;
      const stick = player.ride === plat && player.y >= top - 4 && player.y - top < 22;
      if ((crossed || stick) && player.vy >= 0) {
        if (!landed || top < landed.top) landed = { top, ride: plat };
      }
    }

    if (landed) {
      player.y = landed.top;
      player.vy = 0;
      player.onGround = true;
      player.jumping = false;
      player.ride = landed.ride;
      player.coyote = 8;
    } else {
      player.onGround = false;
      player.ride = null;
      if (player.coyote > 0) player.coyote--;
    }

    if (player.jumping) player.spin += 0.45 + Math.abs(player.vx) * 0.02;
    else if (player.onGround && Math.abs(player.vx) > 0.4) player.runFrame += Math.abs(player.vx) * 0.18;
  }

  function playerBox() {
    const h = player.jumping ? 34 : 58;
    return { l: player.x - 16, r: player.x + 16, t: player.y - h, b: player.y };
  }

  function overlap(a, b) {
    return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  }

  function hurt() {
    if (player.invuln > 0 || state !== 'play') return;
    if (player.rings > 0) {
      const n = Math.min(player.rings, 12);
      player.rings = 0;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.32;
        loose.push({
          x: player.x,
          y: player.y - 36,
          vx: Math.cos(a) * 3.1,
          vy: Math.sin(a) * 3.4 - 1,
          life: 260,
          wait: 28,
        });
      }
      player.invuln = 120;
      player.vy = -4.4;
      player.vx = -player.facing * 3.4;
      player.onGround = false;
      player.jumping = true;
      player.ride = null;
      cam.shake = 8;
      flash = 8;
      sfx('hurt');
    } else {
      startDeath();
    }
  }

  function startDeath() {
    if (state !== 'play') return;
    state = 'dead';
    player.lives -= 1;
    player.rings = 0;
    player.vx = -player.facing * 1.6;
    player.vy = -5;
    player.jumping = true;
    player.onGround = false;
    player.ride = null;
    deadTimer = 0;
    cam.shake = 10;
    flash = 12;
    sfx('die');
  }

  function updateEnemies() {
    for (const e of enemies) {
      if (e.dead) {
        e.puff -= 1;
        continue;
      }
      if (e.kind === 'walker') {
        const next = e.x + e.dir * e.speed;
        const here = groundY(next);
        const ahead = groundY(next + e.dir * 26);
        const blocked = next < e.min || next > e.max || here == null || ahead == null
          || Math.abs(ahead - here) > 40;
        if (blocked) e.dir *= -1;
        else {
          e.x = next;
          e.y = here;
        }
        e.frame++;
      } else {
        e.hop++;
        e.face = Math.sign(player.x - e.x) || e.face;
        if (e.onGround && e.hop > 108) {
          e.vy = -6.3;
          e.onGround = false;
          e.hop = 0;
          if (Math.abs(player.x - e.x) < 500) {
            projectiles.push({
              x: e.x + e.face * 18,
              y: e.y - 38,
              vx: e.face * 3.35,
              vy: -1.15,
              life: 150,
            });
          }
        }
        e.vy += 0.22;
        e.y += e.vy;
        const gy = groundY(e.x);
        if (gy != null && e.vy > 0 && e.y >= gy) {
          e.y = gy;
          e.vy = 0;
          e.onGround = true;
        }
      }
    }

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.vy += 0.055;
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      const gy = groundY(p.x);
      if (p.life <= 0 || p.y > 800 || (gy != null && p.y > gy)) projectiles.splice(i, 1);
    }
  }

  function collideHazards() {
    if (player.invuln > 0) return;
    const box = playerBox();
    for (const e of enemies) {
      if (e.dead) continue;
      const hh = e.kind === 'walker' ? 72 : 74;
      const hw = 16;
      const eb = { l: e.x - hw, r: e.x + hw, t: e.y - hh, b: e.y - 2 };
      if (!overlap(box, eb)) continue;
      if (player.vy > 0.3 && player.prevY <= e.y - hh + 12) {
        e.dead = true;
        e.puff = 16;
        player.vy = -5.6;
        player.onGround = false;
        player.jumping = true;
        player.score += 200;
        popup(e.x, e.y - 48, '+200');
        burst(e.x, e.y - 20, '#fff');
        sfx('stomp');
      } else {
        hurt();
        return;
      }
    }
    for (const p of projectiles) {
      const pb = { l: p.x - 8, r: p.x + 8, t: p.y - 8, b: p.y + 8 };
      if (overlap(box, pb)) {
        p.life = 0;
        hurt();
        return;
      }
    }
  }

  function collectBits() {
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      const dx = r.x - player.x;
      const dy = r.y - (player.y - 32);
      if (dx * dx + dy * dy < 32 * 32) {
        rings.splice(i, 1);
        grantRings(1, r.x, r.y);
      }
    }

    for (let i = loose.length - 1; i >= 0; i--) {
      const r = loose[i];
      r.vy += GRAV;
      r.x += r.vx;
      r.y += r.vy;
      r.life--;
      const gy = groundY(r.x);
      if (gy != null && r.y > gy && r.vy > 0) {
        r.y = gy - 16;
        r.vy *= -0.45;
        r.vx *= 0.8;
      }
      if (r.wait > 0) r.wait--;
      else {
        const dx = r.x - player.x;
        const dy = r.y - (player.y - 28);
        if (dx * dx + dy * dy < 36 * 36) {
          loose.splice(i, 1);
          grantRings(1, r.x, r.y);
          continue;
        }
      }
      if (r.life <= 0 || r.y > 820) loose.splice(i, 1);
    }

    for (const s of springs) {
      if (s.cool > 0) s.cool--;
      if (s.anim > 0) s.anim--;
      const hit = Math.abs(player.x - s.x) < 24 && player.y >= s.y - 18 && player.y <= s.y + 6;
      if (hit && player.vy >= 0 && s.cool <= 0) {
        player.vy = SPRING_V;
        player.onGround = false;
        player.jumping = true;
        player.ride = null;
        player.coyote = 0;
        s.cool = 14;
        s.anim = 8;
        sfx('spring');
      }
    }

    for (const gift of presents) {
      if (gift.opened) continue;
      const box = { l: gift.x - 18, r: gift.x + 18, t: gift.y - 28, b: gift.y };
      if (overlap(playerBox(), box) && player.vy >= -0.1) {
        gift.opened = true;
        player.vy = -5;
        player.onGround = false;
        player.jumping = true;
        grantRings(8, gift.x, gift.y - 20);
        player.score += 200;
        popup(gift.x, gift.y - 46, '+1000');
        sfx('present');
      }
    }
  }

  function updateCheckpoints() {
    for (const cp of checkpoints) {
      if (cp.lit) continue;
      if (Math.abs(player.x - cp.x) < 28 && player.onGround && player.x >= spawn.x) {
        cp.lit = true;
        const gy = groundY(cp.x);
        spawn = { x: cp.x, y: gy == null ? player.y : gy };
        popup(cp.x, player.y - 78, 'CHECKPOINT');
        sfx('check');
      }
    }
  }

  function updateCamera() {
    let targetX = player.x - VIEW_W * 0.36 - player.facing * 30;
    targetX = clamp(targetX, 0, LEVEL_W - VIEW_W);
    const targetY = clamp(player.y - 380, 0, 200);
    cam.x += (targetX - cam.x) * 0.12;
    cam.y += (targetY - cam.y) * 0.08;
    // Sonic blijft in beeld, ook als een klap hem terugduwt.
    const minX = Math.max(0, player.x - (VIEW_W - 100));
    const maxX = Math.min(LEVEL_W - VIEW_W, Math.max(0, player.x - 80));
    cam.x = clamp(cam.x, minX, maxX);
    if (cam.shake > 0.4) cam.shake *= 0.86;
    else cam.shake = 0;
  }

  function updateSnow() {
    for (const s of snow) {
      s.y += s.v;
      s.x += Math.sin(anim * 0.02 + s.drift) * 0.45;
      if (s.y > VIEW_H + 6) s.y = -6;
      if (s.x > VIEW_W + 6) s.x = -6;
      if (s.x < -6) s.x = VIEW_W + 6;
    }
  }

  function updateSparks() {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.04;
      s.life--;
      if (s.life <= 0) sparks.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      popups[i].y -= 0.7;
      popups[i].life--;
      if (popups[i].life <= 0) popups.splice(i, 1);
    }
    if (hudPop > 0) hudPop *= 0.86;
  }

  function stepDead() {
    deadTimer++;
    player.vy = Math.min(FALL_MAX, player.vy + GRAV);
    player.x += player.vx;
    player.y += player.vy;
    player.spin += 0.4;
    updateCamera();
    if (deadTimer > 72) {
      if (player.lives <= 0) {
        state = 'over';
        showScreen('over');
      } else {
        projectiles = [];
        resetPlayer(false);
        snapCam();
        state = 'play';
      }
    }
  }

  function stepClearing() {
    clearTimer++;
    updatePlatforms();
    moveBody(false);
    player.vx = 0;
    if (clearTimer % 18 === 0) boom(GOAL_X + hash(clearTimer) * 90, groundY(GOAL_X) - 150);
    updateCamera();
    if (clearTimer > 105 && !goal.done) {
      goal.done = true;
      player.score += player.lives * 1000;
      state = 'won';
      sfx('win');
      showScreen('won');
    }
  }

  function stepPlay() {
    if (player.invuln > 0) player.invuln--;
    updatePlatforms();
    carryPlayer();
    moveBody(true);

    if (player.onGround && Math.abs(player.vx) > 4.4 && anim % 6 === 0) {
      sparks.push({
        x: player.x - player.facing * 12,
        y: player.y - 2,
        vx: -player.facing * 0.6,
        vy: -0.3,
        life: 12,
        color: 'rgba(255,255,255,0.8)',
      });
    }

    collectBits();
    updateEnemies();
    collideHazards();
    updateCheckpoints();

    if (state === 'play' && player.x >= GOAL_X) {
      state = 'clearing';
      goal.clear = true;
      clearTimer = 0;
      player.vx = 0;
      popup(GOAL_X, groundY(GOAL_X) - 150, 'FINISH!');
    }

    if (state === 'play' && player.y > 760) startDeath();
    if (zoneTimer > 0) zoneTimer--;
    updateCamera();
  }

  function update() {
    anim++;
    updateSnow();
    updateSparks();
    if (state === 'title') {
      cam.x = 0;
      cam.y = 0;
      return;
    }
    if (state === 'won') {
      if (anim % 28 === 0) boom(GOAL_X + 20 + hash(anim) * 80, groundY(GOAL_X) - 130);
      return;
    }
    if (state === 'over') return;
    if (state === 'dead') { stepDead(); return; }
    if (state === 'clearing') { stepClearing(); return; }
    stepPlay();
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function star(x, y, spikes, outer, inner) {
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const rad = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / spikes;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#6eb7f6');
    g.addColorStop(0.55, '#d7f0ff');
    g.addColorStop(1, '#fff4dd');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const sunX = VIEW_W - 120;
    const sunY = 86;
    const glow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 90);
    glow.addColorStop(0, 'rgba(255, 236, 170, 0.95)');
    glow.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe7a2';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 28, 0, Math.PI * 2);
    ctx.fill();

    drawSleigh();
  }

  function drawSleigh() {
    // Blijft rechts van de scorebalk, zodat hij niet als een hoekje in beeld komt.
    const x = 460 + ((anim * 0.45) % 420);
    const y = 58 + Math.sin(anim * 0.02) * 5;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#8d5a32';
    ctx.beginPath();
    ctx.ellipse(-52, 12, 16, 7, 0, 0, Math.PI * 2);
    ctx.ellipse(-22, 10, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-66, 6, 5, 4, 0, 0, Math.PI * 2);
    ctx.ellipse(-32, 5, 4, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e10600';
    ctx.beginPath();
    ctx.arc(-70, 6, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6b4424';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-68, 2);
    ctx.lineTo(-74, -8);
    ctx.moveTo(-66, 1);
    ctx.lineTo(-62, -8);
    ctx.moveTo(-34, 2);
    ctx.lineTo(-38, -7);
    ctx.stroke();
    ctx.fillStyle = '#d0122a';
    roundRect(0, 2, 52, 16, 6);
    ctx.fill();
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(2, 18);
    ctx.quadraticCurveTo(26, 28, 52, 16);
    ctx.stroke();
    ctx.fillStyle = '#3ecf4a';
    ctx.fillRect(28, -8, 10, 10);
    ctx.fillStyle = '#ffd24a';
    ctx.fillRect(40, -6, 8, 8);
    ctx.restore();
  }

  function drawHills() {
    ctx.save();
    ctx.translate(-cam.x * 0.28, -cam.y);
    ctx.fillStyle = '#9fc3dd';
    ctx.beginPath();
    ctx.moveTo(-100, 800);
    for (let x = -100; x <= LEVEL_W + 100; x += 24) {
      const y = 300 + Math.sin(x * 0.008) * 34 + Math.sin(x * 0.002) * 22;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(LEVEL_W + 100, 800);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(-cam.x * 0.5, -cam.y);
    for (let x = 40; x < LEVEL_W; x += 260) {
      const y = 360 + Math.sin(x * 0.01) * 16;
      ctx.fillStyle = '#2f6d45';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 28, y + 70);
      ctx.lineTo(x - 28, y + 70);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 12, y + 22);
      ctx.lineTo(x - 12, y + 22);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPits() {
    for (let i = 0; i < groundMesh.length - 1; i++) {
      const a = groundMesh[i];
      const b = groundMesh[i + 1];
      const x1 = a[a.length - 1].x;
      const x2 = b[0].x;
      const y = Math.max(a[a.length - 1].y, b[0].y) + 28;
      const g = ctx.createLinearGradient(0, y, 0, y + 200);
      g.addColorStop(0, '#e7f8ff');
      g.addColorStop(0.35, '#7ec4e4');
      g.addColorStop(1, '#1b4f78');
      ctx.fillStyle = g;
      ctx.fillRect(x1, y, x2 - x1, 240);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1 + 16, y + 24);
      ctx.lineTo((x1 + x2) / 2, y + 70);
      ctx.lineTo(x2 - 24, y + 36);
      ctx.stroke();
    }
  }

  function drawGround() {
    for (const poly of groundMesh) {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (const p of poly) ctx.lineTo(p.x, p.y);
      ctx.lineTo(poly[poly.length - 1].x, 860);
      ctx.lineTo(poly[0].x, 860);
      ctx.closePath();
      ctx.fillStyle = '#6d4126';
      ctx.fill();

      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const alt = (Math.floor(a.x / 26) + Math.floor(a.y / 26)) % 2 === 0;
        ctx.fillStyle = alt ? '#1f9a45' : '#157536';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x, b.y + 34);
        ctx.lineTo(a.x, a.y + 34);
        ctx.fill();
      }

      ctx.beginPath();
      poly.forEach((p, i) => {
        const y = p.y + 12 + Math.sin(p.x * 0.07) * 2;
        if (i === 0) ctx.moveTo(p.x, y);
        else ctx.lineTo(p.x, y);
      });
      for (let i = poly.length - 1; i >= 0; i--) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fillStyle = '#f4fbff';
      ctx.fill();
    }
  }

  function drawCane(x, y, dir) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir || 1, 1);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -78);
    ctx.arc(14, -78, 14, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = '#e10600';
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawTree(x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#6b3a22';
    ctx.fillRect(-6, -26, 12, 30);
    [0, 1, 2].forEach((i) => {
      const ly = -30 - i * 28;
      const w = 48 - i * 8;
      ctx.fillStyle = i % 2 ? '#176b32' : '#1f8f42';
      ctx.beginPath();
      ctx.moveTo(0, ly - 34);
      ctx.lineTo(w, ly);
      ctx.lineTo(-w, ly);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.moveTo(0, ly - 34);
      ctx.lineTo(w * 0.45, ly - 14);
      ctx.lineTo(-w * 0.45, ly - 14);
      ctx.fill();
    });
    [[-14, -62, '#e10600'], [12, -50, '#ffd24a'], [-6, -40, '#2f6bff'], [8, -78, '#e10600']].forEach(([bx, by, c]) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(bx, by, 3.6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#ffd24a';
    star(0, -128, 5, 8, 3.4);
    ctx.restore();
  }

  function drawSnowman(x, y) {
    ctx.fillStyle = '#f7fbff';
    ctx.beginPath();
    ctx.arc(x, y - 16, 16, 0, Math.PI * 2);
    ctx.arc(x, y - 40, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e10600';
    ctx.fillRect(x - 10, y - 46, 20, 5);
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 46);
    ctx.lineTo(x + 8, y - 62);
    ctx.lineTo(x + 10, y - 46);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + 8, y - 64, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(x - 4, y - 42, 1.4, 0, Math.PI * 2);
    ctx.arc(x + 4, y - 42, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e07a2f';
    ctx.beginPath();
    ctx.moveTo(x + 4, y - 38);
    ctx.lineTo(x + 16, y - 36);
    ctx.lineTo(x + 4, y - 34);
    ctx.fill();
  }

  function drawLights(x1, y1, x2, y2, sag) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 + sag;
    ctx.strokeStyle = 'rgba(50, 24, 24, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, x2, y2);
    ctx.stroke();
    const colors = ['#e10600', '#ffd24a', '#3ecf4a', '#2f6bff'];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const u = 1 - t;
      const x = u * u * x1 + 2 * u * t * mx + t * t * x2;
      const y = u * u * y1 + 2 * u * t * my + t * t * y2;
      ctx.fillStyle = colors[i % 4];
      ctx.beginPath();
      ctx.arc(x, y + 3, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawDecor() {
    const trees = [
      [90, 1.05], [430, 0.85], [760, 0.7], [1280, 1], [2100, 0.9],
      [3300, 1.1], [3920, 0.8], [4700, 0.85], [5600, 0.95],
      [6420, 0.8], [7900, 1], [8680, 1.15],
    ];
    for (const [x, s] of trees) {
      const gy = groundY(x);
      if (gy != null) drawTree(x, gy, s);
    }
    [520, 4550, 8040].forEach((x) => {
      const gy = groundY(x);
      if (gy != null) drawSnowman(x, gy);
    });
    drawLights(180, 250, 860, 250, 46);
    drawLights(7900, 240, 8600, 230, 40);

    // Zuurtjesstokken langs de randen van elke afgrond.
    for (let i = 0; i < TERRAIN.length - 1; i++) {
      const a = TERRAIN[i];
      const b = TERRAIN[i + 1];
      const end = a.x + a.w;
      if (b.x - end > 80) {
        drawCane(end - 16, a.y1, 1);
        drawCane(b.x + 16, b.y, -1);
      }
    }

    const gy = groundY(150);
    ctx.fillStyle = '#6b3a22';
    ctx.fillRect(148, gy - 52, 6, 52);
    ctx.fillStyle = '#178a3a';
    roundRect(112, gy - 76, 74, 26, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '800 14px Trebuchet MS, Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('START', 149, gy - 58);
  }

  function drawPlatform(p) {
    const moving = p.axis !== 'none';
    ctx.fillStyle = moving ? '#8d4e24' : '#3d7a32';
    roundRect(p.x, p.y, p.w, p.h + 8, 6);
    ctx.fill();
    ctx.fillStyle = '#f7fbff';
    roundRect(p.x - 2, p.y - 4, p.w + 4, 10, 5);
    ctx.fill();
    if (moving) {
      ctx.fillStyle = '#e10600';
      for (let x = p.x + 8; x < p.x + p.w - 4; x += 16) ctx.fillRect(x, p.y + 8, 8, 6);
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.arc(p.x + p.w / 2, p.y + p.h + 12, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#e10600';
      ctx.fillRect(p.x + 8, p.y - 2, 6, 8);
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(p.x + p.w - 16, p.y - 2, 6, 8);
    }
  }

  function drawSpring(s) {
    const squash = s.anim > 0 ? 0.55 : 1;
    const h = 28 * squash;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = '#c1121f';
    ctx.fillRect(-16, -6, 32, 8);
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = -8 - (i / 4) * h;
      const x = i % 2 === 0 ? -10 : 10;
      if (i === 0) ctx.moveTo(-10, -8);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-14, -12 - h, 28, 6);
    ctx.restore();
  }

  function drawPresent(gift) {
    ctx.save();
    ctx.translate(gift.x, gift.y);
    if (gift.opened) {
      ctx.fillStyle = '#c1121f';
      ctx.fillRect(-16, -8, 32, 8);
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(-3, -8, 6, 8);
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#c1121f';
    roundRect(-16, -26, 32, 26, 3);
    ctx.fill();
    ctx.fillStyle = '#ffd24a';
    ctx.fillRect(-3, -26, 6, 26);
    ctx.fillRect(-16, -16, 32, 5);
    ctx.beginPath();
    ctx.arc(-6, -28, 5, 0, Math.PI * 2);
    ctx.arc(6, -28, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRingAt(x, y, spin, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale((0.28 + Math.abs(Math.cos(spin)) * 0.72) * scale, scale);
    ctx.strokeStyle = '#ffe14a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#fff6b0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-2, -2, 7, 0.2, 1.4);
    ctx.stroke();
    ctx.restore();
  }

  function drawCheckpoint(cp) {
    const gy = groundY(cp.x);
    if (gy == null) return;
    drawCane(cp.x, gy, 1);
    ctx.fillStyle = cp.lit ? '#ffd24a' : '#9eb0c4';
    ctx.beginPath();
    ctx.arc(cp.x + 28, gy - 78, 7, 0, Math.PI * 2);
    ctx.fill();
    if (cp.lit) {
      ctx.fillStyle = 'rgba(255, 210, 74, 0.35)';
      ctx.beginPath();
      ctx.arc(cp.x + 28, gy - 78, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGoal() {
    const gy = groundY(GOAL_X);
    drawCane(GOAL_X - 36, gy, 1);
    drawCane(GOAL_X + 86, gy, -1);
    ctx.fillStyle = '#c1121f';
    roundRect(GOAL_X - 16, gy - 132, 96, 30, 6);
    ctx.fill();
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '800 16px Trebuchet MS, Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FINISH', GOAL_X + 32, gy - 112);
    ctx.save();
    ctx.translate(GOAL_X + 32, gy - 162);
    if (goal.clear) ctx.rotate(anim * 0.18);
    ctx.fillStyle = '#ffd24a';
    star(0, 0, 5, goal.clear ? 18 : 14, 6);
    ctx.restore();
    ctx.fillStyle = '#178a3a';
    ctx.beginPath();
    ctx.arc(GOAL_X + 32, gy - 78, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e10600';
    ctx.beginPath();
    ctx.arc(GOAL_X + 26, gy - 80, 3, 0, Math.PI * 2);
    ctx.arc(GOAL_X + 38, gy - 76, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHat(x, y, tilt, bob) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e10600';
    ctx.beginPath();
    ctx.moveTo(-12, -1);
    ctx.quadraticCurveTo(-4, -26, 10, -28);
    ctx.quadraticCurveTo(4, -8, 13, 1);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(12, -28 + bob, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawShoe(x, y, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = '#c1121f';
    roundRect(-12, -8, 26, 12, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-12, -2, 26, 4);
    ctx.fillRect(6, -8, 8, 12);
    ctx.restore();
  }

  function drawSonic() {
    const blink = player.invuln > 0 && state === 'play' && Math.floor(anim / 4) % 2 === 0;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.fillStyle = 'rgba(20, 40, 70, 0.18)';
    ctx.beginPath();
    ctx.ellipse(0, -2, 16, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (blink) { ctx.restore(); return; }

    ctx.scale(player.facing, 1);

    if (Math.abs(player.vx) > 5.6 && !player.jumping && state === 'play') {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-18 - i * 8, -30 - i * 8);
        ctx.lineTo(-34 - i * 10, -30 - i * 8);
        ctx.stroke();
      }
    }

    if (player.jumping || state === 'dead') {
      // Draai om het midden van de bal, niet om de voeten.
      ctx.translate(0, -24);
      ctx.rotate(player.spin);
      ctx.fillStyle = '#1a6dff';
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0d4ec4';
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(-22, 2);
      ctx.lineTo(-6, 8);
      ctx.fill();
      drawShoe(-2, 10, 0.5);
      drawShoe(4, -12, -0.7);
      drawHat(2, -16, -0.5, 0);
      ctx.restore();
      return;
    }

    const bob = player.onGround && Math.abs(player.vx) < 0.3 ? Math.sin(anim * 0.08) : 0;
    const leg = player.onGround && Math.abs(player.vx) > 0.45 ? Math.sin(player.runFrame) : (Math.sin(anim * 0.15) > 0.92 ? 0.5 : 0);
    ctx.translate(0, bob);

    ctx.fillStyle = '#1a6dff';
    // Rugstekels.
    [[-8, -34, 26, 2.6], [-6, -48, 30, 2.9], [-4, -60, 24, 3.2]].forEach(([x, y, len, rot]) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, 7);
      ctx.fill();
      ctx.restore();
    });

    drawShoe(-8, -4, -leg * 0.7);
    ctx.fillStyle = '#1a6dff';
    ctx.beginPath();
    ctx.ellipse(0, -32, 16, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd2a8';
    ctx.beginPath();
    ctx.ellipse(2, -28, 8, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(8, -56, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#1a6dff';
    ctx.fill();
    ctx.fillStyle = '#ffd2a8';
    ctx.beginPath();
    ctx.ellipse(16, -52, 9, 7, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(14, -58, 7, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a8f3c';
    ctx.beginPath();
    ctx.ellipse(16, -58, 3.4, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(17, -58, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(15, -60, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(16, -50, 4, 0.15, 0.9);
    ctx.stroke();

    drawHat(4, -70, -0.45, Math.sin(anim * 0.2) * 1.5);
    drawShoe(8, -4, leg * 0.7);

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(18, -34, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Boze oude baboesjka: hoofddoek, schort en een diepe frons.
  // De springer zwaait met een deegroller en gooit een pantoffel.
  function drawBabushka(e) {
    if (e.dead && e.puff <= 0) return;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.dead) {
      ctx.globalAlpha = Math.max(0, e.puff / 16);
      ctx.fillStyle = '#9d1c34';
      ctx.beginPath();
      ctx.arc(0, -30, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const wild = e.kind === 'thrower';
    const face = wild ? e.face : e.dir;
    ctx.scale(face || 1, 1);
    const step = Math.sin((e.frame || 0) * 0.45);
    const hop = wild && !e.onGround ? Math.min(10, -e.vy) : 0;
    ctx.translate(0, -hop * 0.2);

    ctx.fillStyle = '#2a160e';
    ctx.fillRect(-14, -8, 10, 7);
    ctx.fillRect(4, -8 - step * 2, 10, 7);

    ctx.fillStyle = '#3b1024';
    ctx.beginPath();
    ctx.moveTo(-20, -40);
    ctx.lineTo(20, -40);
    ctx.lineTo(24, -6);
    ctx.quadraticCurveTo(0, 4, -24, -6);
    ctx.fill();
    ctx.fillStyle = '#e7c56a';
    ctx.fillRect(-16, -28, 4, 4);
    ctx.fillRect(6, -22, 4, 4);
    ctx.fillRect(-4, -16, 4, 4);

    ctx.fillStyle = '#fffaf2';
    ctx.beginPath();
    ctx.moveTo(-11, -40);
    ctx.lineTo(11, -40);
    ctx.lineTo(13, -10);
    ctx.lineTo(-13, -10);
    ctx.fill();
    ctx.fillStyle = '#c1121f';
    ctx.fillRect(-11, -40, 22, 4);

    ctx.strokeStyle = wild ? '#d9d0c2' : '#8a5a32';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (wild) {
      ctx.moveTo(10, -46);
      ctx.lineTo(24, -64 - hop * 0.3);
    } else {
      ctx.moveTo(-8, -36);
      ctx.lineTo(-20, -4 + step * 3);
    }
    ctx.stroke();
    if (wild) {
      ctx.fillStyle = '#efe8dc';
      ctx.fillRect(20, -76 - hop * 0.3, 6, 16);
    }

    ctx.fillStyle = '#f3c7a6';
    ctx.beginPath();
    ctx.arc(2, -56, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = wild ? '#1c1c1c' : '#b1122a';
    ctx.beginPath();
    ctx.moveTo(-18, -58);
    ctx.lineTo(2, -80);
    ctx.lineTo(20, -56);
    ctx.lineTo(16, -42);
    ctx.lineTo(-14, -42);
    ctx.fill();
    const tail = Math.sin(anim * 0.2 + e.x) * 3;
    ctx.beginPath();
    ctx.moveTo(8, -48);
    ctx.lineTo(16, -30 + tail);
    ctx.lineTo(8, -28 + tail);
    ctx.fill();

    ctx.fillStyle = '#f3c7a6';
    ctx.beginPath();
    ctx.ellipse(6, -54, 8, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1a100c';
    ctx.beginPath();
    ctx.moveTo(1, -57);
    ctx.lineTo(13, -63);
    ctx.lineTo(14, -58);
    ctx.lineTo(3, -52);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(10, -52, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a120c';
    ctx.beginPath();
    ctx.arc(11.2, -52, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#6d2030';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(9, -45, 4.6, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = 'rgba(186, 42, 42, 0.8)';
    ctx.beginPath();
    ctx.arc(15, -49, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSlipper(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(anim * 0.35 * Math.sign(p.vx || 1));
    ctx.fillStyle = '#6b3a22';
    ctx.beginPath();
    ctx.ellipse(0, 1, 10, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c46a4a';
    ctx.beginPath();
    ctx.ellipse(-3, -2, 4.2, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHud() {
    ctx.fillStyle = 'rgba(8, 18, 36, 0.55)';
    roundRect(12, 12, 430, 36, 10);
    ctx.fill();
    ctx.font = '800 16px Trebuchet MS, Verdana, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText('SCORE ' + pad(player.score, 6), 24, 35);

    const pop = 1 + Math.min(0.35, hudPop * 0.04);
    drawRingAt(168, 29, anim * 0.15, pop);
    ctx.fillStyle = player.rings === 0 ? '#ffb4b4' : '#fff';
    ctx.fillText(pad(player.rings, 2), 186, 35);

    for (let i = 0; i < player.lives; i++) {
      const x = 250 + i * 28;
      ctx.fillStyle = '#1a6dff';
      ctx.beginPath();
      ctx.arc(x, 28, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e10600';
      ctx.beginPath();
      ctx.moveTo(x - 6, 22);
      ctx.lineTo(x + 2, 14);
      ctx.lineTo(x + 6, 22);
      ctx.fill();
    }
  }

  function drawZoneCard() {
    if (zoneTimer <= 0 || state !== 'play') return;
    const a = zoneTimer > 130 ? (160 - zoneTimer) / 30 : zoneTimer < 30 ? zoneTimer / 30 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.fillStyle = 'rgba(8, 18, 36, 0.72)';
    roundRect(VIEW_W / 2 - 210, 78, 420, 64, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '800 28px Trebuchet MS, Verdana, sans-serif';
    ctx.fillText('CHRISTMAS HILL ZONE', VIEW_W / 2, 120);
    ctx.restore();
  }

  function render() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(VIEW_W * dpr)) {
      canvas.width = Math.floor(VIEW_W * dpr);
      canvas.height = Math.floor(VIEW_H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSky();
    drawHills();

    ctx.save();
    const sx = cam.shake ? (hash(anim) - 0.5) * cam.shake : 0;
    const sy = cam.shake ? (hash(anim + 2) - 0.5) * cam.shake : 0;
    ctx.translate(-cam.x + sx, -cam.y + sy);
    drawPits();
    drawGround();
    drawDecor();
    checkpoints.forEach(drawCheckpoint);
    platforms.forEach(drawPlatform);
    springs.forEach(drawSpring);
    presents.forEach(drawPresent);
    rings.forEach((r, i) => drawRingAt(r.x, r.y, anim * 0.12 + i, 1));
    loose.forEach((r) => drawRingAt(r.x, r.y, anim * 0.2, 1));
    enemies.forEach(drawBabushka);
    projectiles.forEach(drawSlipper);
    drawGoal();
    for (const s of sparks) {
      ctx.globalAlpha = Math.max(0, s.life / 20);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawSonic();
    ctx.fillStyle = '#fff';
    ctx.font = '800 14px Trebuchet MS, Verdana, sans-serif';
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, p.life / 42);
      ctx.fillText(p.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    for (const s of snow) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    drawHud();
    drawZoneCard();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash / 18})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      flash--;
    }
  }

  function loop(t) {
    if (!loop.last) loop.last = t;
    let acc = (loop.acc || 0) + Math.min(48, t - loop.last);
    loop.last = t;
    while (acc >= 1000 / 60) {
      update();
      acc -= 1000 / 60;
    }
    loop.acc = acc;
    scheduleMusic();
    render();
    requestAnimationFrame(loop);
  }

  function phoneLayout() {
    return window.matchMedia('(pointer: coarse)').matches
      || window.matchMedia('(max-width: 820px)').matches;
  }

  function helpText() {
    return phoneLayout()
      ? 'Use the buttons to run and jump · 3 lives'
      : 'Arrows or A/D to run · Space or W to jump · 3 lives';
  }

  function showScreen(mode) {
    cardEl.className = 'mode-' + mode;
    helpEl.hidden = mode !== 'title';
    eyebrowEl.hidden = mode !== 'title';
    winLine.hidden = mode !== 'won';
    if (mode === 'title') {
      hMain.textContent = 'SONIC';
      hSub.textContent = 'CHRISTMAS';
      ledeEl.textContent = 'Collect the rings — they absorb a hit — and reach the finish.';
      helpEl.textContent = helpText();
      playBtn.textContent = 'Start';
    } else if (mode === 'won') {
      winLine.textContent = WIN_TEXT;
      ledeEl.textContent = 'Score ' + pad(player.score, 6);
      playBtn.textContent = 'Play again';
    } else {
      hMain.textContent = 'GAME';
      hSub.textContent = 'OVER';
      ledeEl.textContent = 'Score ' + pad(player.score, 6) + '. The rings ran out.';
      playBtn.textContent = 'Play again';
    }
    screenEl.hidden = false;
    playBtn.focus();
  }

  function startGame() {
    ensureAudio();
    startMusic();
    buildWorld();
    resetPlayer(true);
    snapCam();
    state = 'play';
    zoneTimer = 160;
    flash = 0;
    screenEl.hidden = true;
    wantJump = false;
    player.buffer = 0;
    playBtn.blur();
  }

  playBtn.addEventListener('click', startGame);

  function bindTouch(btn, code, jump) {
    const press = (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      held.add(code);
      if (jump) wantJump = true;
      ensureAudio();
    };
    const release = (e) => {
      held.delete(code);
      if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindTouch(document.getElementById('btn-left'), 'ArrowLeft', false);
  bindTouch(document.getElementById('btn-right'), 'ArrowRight', false);
  bindTouch(document.getElementById('btn-jump'), 'Space', true);

  function syncTouch() {
    document.body.classList.toggle('show-touch', phoneLayout());
    if (state === 'title') helpEl.textContent = helpText();
  }
  syncTouch();
  window.addEventListener('resize', syncTouch);
  document.addEventListener('touchmove', (e) => {
    if (e.target.closest && e.target.closest('#app')) e.preventDefault();
  }, { passive: false });

  buildWorld();
  resetPlayer(true);
  showScreen('title');
  requestAnimationFrame(loop);
})();
