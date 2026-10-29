/**
 * Buzz Run: the 404 easter egg (the slate opens it at take 04). The Buzzflix bee flies between film strips;
 * click, tap or press Space to flap. Loaded only when opened. Drawn on a canvas in fixed game units
 * (W × H) and scaled to fit, so it plays the same on a phone and a desktop.
 */
const W = 360, H = 480, FLOOR = 440;
const GRAVITY = 1400, FLAP = -420, SPEED = 150, GAP = 150, SPACING = 210;
const STRIP = 60, BEE = 62, BEE_X = 96, HIT = 20;
const INK = '#1a1a1a', YELLOW = '#fbe274', ORANGE = '#ee5934', PAPER = '#fff';
const BEST_KEY = 'buzzflix-buzz-run-best';

const bee = new Image();
bee.src = new URL('../images/bee-32d3992.png', import.meta.url).href; // 160 × 129, the logo's bee alone

const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
const saveBest = n => { try { localStorage.setItem(BEST_KEY, String(n)); } catch {} };

let open = false;

export function openGame() {
  if (open) return;
  open = true;

  const dialog = document.createElement('dialog');
  dialog.className = 'bee-game';
  dialog.setAttribute('aria-label', 'Buzz Run minigame');
  dialog.innerHTML = `
    <div class="bee-game-sticks"></div>
    <div class="bee-game-bar">
      <p class="bee-game-title"><span>Now shooting</span>Buzz Run</p>
      <button type="button" class="bee-game-close" aria-label="Close game">×</button>
    </div>
    <canvas tabindex="0" role="img" aria-label="Buzz Run: fly the Buzzflix bee between the film strips"></canvas>
    <p class="bee-game-hint">Click, tap or press Space to fly.</p>
    <p class="visually-hidden" aria-live="polite"></p>`;
  document.body.append(dialog);
  const canvas = dialog.querySelector('canvas');
  const close = dialog.querySelector('.bee-game-close');
  const status = dialog.querySelector('[aria-live]');
  const ctx = canvas.getContext('2d');

  // Keep the canvas sharp at any size.
  let scale = 1;
  const fit = () => {
    const ratio = devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.width * H / W);
    scale = canvas.width / W;
  };
  const resize = new ResizeObserver(fit);
  resize.observe(canvas);

  let state, y, v, strips, score, best = readBest(), time = 0, floorX = 0, overAt = 0, last, frame;
  const reset = () => { state = 'ready'; y = 220; v = 0; strips = []; score = 0; };
  reset();

  const flap = () => {
    if (state === 'over') {
      if (performance.now() - overAt < 500) return; // don't restart from a panicked double tap
      reset();
    }
    if (state === 'ready') { state = 'playing'; strips.push(strip(W + 60)); status.textContent = ''; }
    v = FLAP;
  };
  const strip = x => ({ x, gap: 60 + GAP / 2 + Math.random() * (FLOOR - 120 - GAP), passed: false });
  const crash = () => {
    state = 'over';
    overAt = performance.now();
    if (score > best) { best = score; saveBest(best); }
    status.textContent = `That's a wrap. You scored ${score}. Best ${best}.`;
  };

  // The bee's circle against a rectangle.
  const hits = (rx, ry, rw, rh) => {
    const nx = Math.max(rx, Math.min(BEE_X, rx + rw)), ny = Math.max(ry, Math.min(y, ry + rh));
    return (BEE_X - nx) ** 2 + (y - ny) ** 2 < HIT ** 2;
  };

  const update = dt => {
    time += dt;
    const speed = SPEED + Math.min(score * 3, 60);
    if (state !== 'over') floorX = (floorX + speed * dt) % 40;
    if (state === 'ready') { y = 220 + Math.sin(time * 4) * 8; return; }
    v += GRAVITY * dt;
    y += v * dt;
    if (y < HIT) { y = HIT; v = 0; }
    if (y > FLOOR - HIT) { y = FLOOR - HIT; v = 0; if (state === 'playing') crash(); }
    if (state !== 'playing') return;

    for (const s of strips) {
      s.x -= speed * dt;
      if (!s.passed && s.x + STRIP < BEE_X - HIT) { s.passed = true; score++; }
      const top = s.gap - GAP / 2, bottom = s.gap + GAP / 2;
      if (hits(s.x - 2, 0, STRIP + 4, top) || hits(s.x - 2, bottom, STRIP + 4, FLOOR - bottom)) return crash();
    }
    if (strips[0].x < -STRIP - 10) strips.shift();
    if (strips.at(-1).x < W - SPACING) strips.push(strip(strips.at(-1).x + SPACING));
  };

  // Honeycomb backdrop that drifts slower than the strips.
  const drawBackground = () => {
    const sky = ctx.createLinearGradient(0, 0, 0, FLOOR);
    sky.addColorStop(0, YELLOW);
    sky.addColorStop(1, '#fff6cf');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, FLOOR);
    const r = 22, dx = r * 1.5, dy = r * Math.sqrt(3), shift = (time * 20) % (dx * 2);
    ctx.strokeStyle = '#ffffff73';
    ctx.lineWidth = 2;
    for (let c = -1; c * dx < W + dx * 2; c++) {
      for (let row = -1; row * dy < FLOOR + dy; row++) {
        const cx = c * dx - shift, cy = row * dy + (c % 2 ? dy / 2 : 0);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) ctx.lineTo(cx + r * Math.cos(i * Math.PI / 3), cy + r * Math.sin(i * Math.PI / 3));
        ctx.closePath();
        ctx.stroke();
      }
    }
  };

  // Stage floor with scrolling tape marks.
  const drawFloor = () => {
    ctx.fillStyle = '#3a3a3a'; // lighter than the ink window around the game
    ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.fillStyle = YELLOW;
    for (let x = -floorX; x < W; x += 40) ctx.fillRect(x, FLOOR + 18, 20, 4);
  };

  // A length of film from y0 to y1 with a clapper band on its open end.
  const drawStrip = (x, y0, y1, capAt) => {
    ctx.fillStyle = INK;
    ctx.fillRect(x, y0, STRIP, y1 - y0);
    ctx.fillStyle = '#ffffffd9';
    for (let hy = y0 + 4; hy < y1 - 10; hy += 20) {
      ctx.fillRect(x + 6, hy, 8, 10);
      ctx.fillRect(x + STRIP - 14, hy, 8, 10);
    }
    ctx.fillStyle = '#3a3a3a';
    for (let fy = y0 + 4; fy < y1 - 30; fy += 38) ctx.fillRect(x + 19, fy, STRIP - 38, 30);

    const bandY = capAt === y1 ? y1 - 16 : y0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 4, bandY, STRIP + 8, 16);
    ctx.clip();
    ctx.fillStyle = PAPER;
    ctx.fillRect(x - 4, bandY, STRIP + 8, 16);
    ctx.fillStyle = INK;
    for (let sx = x - 20; sx < x + STRIP + 8; sx += 20) {
      ctx.beginPath();
      ctx.moveTo(sx, bandY + 16);
      ctx.lineTo(sx + 10, bandY + 16);
      ctx.lineTo(sx + 20, bandY);
      ctx.lineTo(sx + 10, bandY);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 3, bandY + 1, STRIP + 6, 14);
  };

  const drawBee = () => {
    const tilt = state === 'ready' ? 0 : Math.max(-0.45, Math.min(1, v / 700));
    ctx.save();
    ctx.translate(BEE_X, y);
    ctx.rotate(tilt);
    if (bee.complete && bee.naturalWidth) ctx.drawImage(bee, -BEE / 2, -BEE * 129 / 320, BEE, BEE * 129 / 160);
    else { ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(0, 0, HIT, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  };

  const text = (str, x, ty, size, weight = 500, color = INK) => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${weight === 500 ? "'Space Grotesk'" : 'Roboto'}, Arial, sans-serif`;
    ctx.fillText(str, x, ty);
  };
  const card = (top, height) => {
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.roundRect(40, top, W - 80, height, 16);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const draw = () => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawBackground();
    for (const s of strips) {
      drawStrip(s.x, 0, s.gap - GAP / 2, s.gap - GAP / 2);
      drawStrip(s.x, s.gap + GAP / 2, FLOOR, s.gap + GAP / 2);
    }
    drawFloor();
    drawBee();

    if (state === 'ready') {
      card(300, 96);
      text('Fly the bee through the film', W / 2, 330, 18);
      text('Tap to start', W / 2, 366, 16, 400);
    } else {
      text(String(score), W / 2, 56, 48);
    }
    if (state === 'over') {
      card(150, 170);
      text("That's a wrap", W / 2, 186, 28);
      text(`Score ${score}   ·   Best ${best}`, W / 2, 228, 18, 400);
      ctx.fillStyle = ORANGE;
      ctx.beginPath();
      ctx.roundRect(W / 2 - 80, 256, 160, 40, 20);
      ctx.fill();
      text('Fly again', W / 2, 277, 16, 400, PAPER);
    }
  };

  const loop = now => {
    const dt = Math.min((now - (last ?? now)) / 1000, 1 / 30);
    last = now;
    update(dt);
    draw();
    frame = requestAnimationFrame(loop);
  };

  canvas.addEventListener('pointerdown', e => { e.preventDefault(); canvas.focus({ preventScroll: true }); flap(); });
  dialog.addEventListener('keydown', e => {
    if (e.target === close || ![' ', 'ArrowUp', 'w', 'W'].includes(e.key)) return;
    e.preventDefault();
    if (!e.repeat) flap();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }); // backdrop
  dialog.addEventListener('close', () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    dialog.remove();
    open = false;
  });

  dialog.showModal();
  canvas.focus({ preventScroll: true });
  fit();
  frame = requestAnimationFrame(loop);
}
