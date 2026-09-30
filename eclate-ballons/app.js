(() => {
  'use strict';

  const STORAGE_KEY = 'eclate-ballons-state';
  const colors = ['#ff557b', '#ff9f43', '#ffd747', '#4ed7c5', '#54b8ff', '#9b7bff'];
  const game = document.getElementById('game');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const livesEl = document.getElementById('lives');
  const intro = document.getElementById('intro');
  const gameover = document.getElementById('gameover');
  const pause = document.getElementById('pause');
  const announcer = document.getElementById('announcer');
  const bestIntro = document.getElementById('best-intro');
  const bestFinal = document.getElementById('best-final');
  const finalScore = document.getElementById('final-score');
  const finalLevel = document.getElementById('final-level');
  const recordMessage = document.getElementById('record-message');
  const soundButton = document.getElementById('sound');

  let best = loadBest();
  let score = 0;
  let level = 1;
  let lives = 3;
  let running = false;
  let paused = false;
  let balloons = [];
  let animationId = 0;
  let lastFrame = 0;
  let lastSpawn = 0;
  let balloonId = 0;
  let soundOn = true;
  let audioContext = null;
  let masterGain = null;
  let musicTimer = 0;
  let musicStep = 0;

  bestIntro.textContent = best;
  bestFinal.textContent = best;
  updateHud();

  document.getElementById('start').addEventListener('click', startGame);
  document.getElementById('replay').addEventListener('click', startGame);
  document.getElementById('resume').addEventListener('click', resumeGame);
  soundButton.addEventListener('click', toggleSound);

  game.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('.balloon');
    if (!target || !running || paused) return;
    event.preventDefault();
    popBalloon(Number(target.dataset.id));
  });

  game.addEventListener('keydown', (event) => {
    const target = event.target.closest('.balloon');
    if (!target || !running || paused || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    popBalloon(Number(target.dataset.id));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running && !paused) {
      paused = true;
      cancelAnimationFrame(animationId);
      stopMusic();
    } else if (!document.hidden && running && paused) {
      pause.hidden = false;
      requestAnimationFrame(() => pause.classList.add('visible'));
      document.getElementById('resume').focus();
    }
  });

  window.addEventListener('resize', () => {
    const width = game.clientWidth;
    balloons.forEach((balloon) => {
      balloon.x = Math.max(0, Math.min(balloon.x, width - balloon.size));
    });
  });

  function loadBest() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return 0;
      const saved = JSON.parse(raw);
      return Number.isFinite(saved.bestScore) ? Math.max(0, Math.floor(saved.bestScore)) : 0;
    } catch (_) {
      return 0;
    }
  }

  function saveBest() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ bestScore: best }));
    } catch (_) {
      // The game remains fully playable when private storage is unavailable.
    }
  }

  function startGame() {
    cancelAnimationFrame(animationId);
    clearBalloons();
    score = 0;
    level = 1;
    lives = 3;
    running = true;
    paused = false;
    lastFrame = performance.now();
    lastSpawn = lastFrame - 500;
    updateHud();
    hideOverlay(intro);
    hideOverlay(gameover);
    hideOverlay(pause);
    announcer.textContent = 'Partie commencée. Trois vies.';
    startMusic();
    animationId = requestAnimationFrame(tick);
  }

  function resumeGame() {
    if (!running) return;
    paused = false;
    lastFrame = performance.now();
    lastSpawn = lastFrame;
    hideOverlay(pause);
    game.focus({ preventScroll: true });
    startMusic();
    animationId = requestAnimationFrame(tick);
  }

  function hideOverlay(element) {
    element.classList.remove('visible');
    window.setTimeout(() => {
      if (!element.classList.contains('visible')) element.hidden = true;
    }, 230);
  }

  function showOverlay(element) {
    element.hidden = false;
    requestAnimationFrame(() => element.classList.add('visible'));
  }

  function tick(now) {
    if (!running || paused) return;
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    const interval = Math.max(340, 1120 - (level - 1) * 85);
    if (now - lastSpawn >= interval) {
      spawnBalloon();
      if (level >= 4 && Math.random() < Math.min(.12 + level * .018, .3)) {
        window.setTimeout(() => {
          if (running && !paused) spawnBalloon();
        }, 120);
      }
      lastSpawn = now;
    }

    for (let i = balloons.length - 1; i >= 0; i -= 1) {
      const balloon = balloons[i];
      balloon.y -= balloon.speed * dt;
      balloon.phase += dt * balloon.swaySpeed;
      const sway = Math.sin(balloon.phase) * balloon.sway;
      balloon.el.style.setProperty('--x', `${balloon.x + sway}px`);
      balloon.el.style.setProperty('--y', `${balloon.y}px`);
      if (balloon.y + balloon.size * 1.25 < 0) escapeBalloon(i);
    }
    animationId = requestAnimationFrame(tick);
  }

  function spawnBalloon() {
    const width = game.clientWidth;
    const height = game.clientHeight;
    if (width < 60 || height < 100) return;
    const size = Math.round(55 + Math.random() * 22);
    const x = 5 + Math.random() * Math.max(1, width - size - 10);
    const y = height + 12;
    const speed = Math.min(255, 72 + level * 10 + Math.random() * 34);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const id = ++balloonId;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'balloon';
    el.dataset.id = id;
    el.setAttribute('aria-label', `Éclater le ballon ${colorName(color)}`);
    el.style.setProperty('--size', `${size}px`);
    el.style.setProperty('--balloon', color);
    el.style.setProperty('--x', `${x}px`);
    el.style.setProperty('--y', `${y}px`);
    el.style.setProperty('--tilt', `${-6 + Math.random() * 12}deg`);
    game.appendChild(el);
    balloons.push({ id, el, x, y, size, speed, color, phase: Math.random() * 6.28, sway: 4 + Math.random() * 9, swaySpeed: 1.5 + Math.random() * 1.7 });
  }

  function popBalloon(id) {
    const index = balloons.findIndex((item) => item.id === id);
    if (index < 0) return;
    const balloon = balloons[index];
    balloons.splice(index, 1);
    balloon.el.remove();
    createBurst(balloon);
    playPop();
    score += 1;
    const nextLevel = Math.floor(score / 8) + 1;
    if (nextLevel !== level) {
      level = nextLevel;
      announcer.textContent = `Niveau ${level}. Les ballons accélèrent.`;
    }
    updateHud();
  }

  function escapeBalloon(index) {
    const balloon = balloons[index];
    balloons.splice(index, 1);
    balloon.el.remove();
    lives -= 1;
    updateHud();
    announcer.textContent = lives > 0 ? `Ballon échappé. ${lives} ${lives === 1 ? 'vie restante' : 'vies restantes'}.` : 'Plus de vies.';
    if (lives <= 0) endGame();
  }

  function createBurst(balloon) {
    const centerX = balloon.x + balloon.size / 2;
    const centerY = balloon.y + balloon.size / 2;
    for (let i = 0; i < 16; i += 1) {
      const bit = document.createElement('i');
      const angle = (Math.PI * 2 * i) / 16 + Math.random() * .25;
      bit.className = 'pop-bit';
      bit.style.setProperty('--px', `${centerX}px`);
      bit.style.setProperty('--py', `${centerY}px`);
      bit.style.setProperty('--dx', `${Math.cos(angle) * (38 + Math.random() * 35)}px`);
      bit.style.setProperty('--dy', `${Math.sin(angle) * (38 + Math.random() * 35) + 18}px`);
      bit.style.setProperty('--rot', `${180 + Math.random() * 360}deg`);
      bit.style.setProperty('--bit', colors[Math.floor(Math.random() * colors.length)]);
      game.appendChild(bit);
      window.setTimeout(() => bit.remove(), 650);
    }
  }

  function initAudio() {
    if (audioContext) {
      if (audioContext.state === 'suspended') audioContext.resume();
      return true;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = .32;
    masterGain.connect(audioContext.destination);
    return true;
  }

  function playTone(frequency, duration, volume, type) {
    if (!soundOn || !initAudio()) return;
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type || 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  function playPop() {
    if (!soundOn || !initAudio()) return;
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(520, now);
    oscillator.frequency.exponentialRampToValueAtTime(110, now + .12);
    gain.gain.setValueAtTime(.65, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + .13);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + .13);
  }

  function startMusic() {
    if (!soundOn || !running || paused || !initAudio()) return;
    stopMusic();
    const melody = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23];
    const playNext = () => {
      if (!running || paused || !soundOn) return;
      playTone(melody[musicStep % melody.length], .28, .12, 'sine');
      musicStep += 1;
      musicTimer = window.setTimeout(playNext, 360);
    };
    playNext();
  }

  function stopMusic() {
    window.clearTimeout(musicTimer);
    musicTimer = 0;
  }

  function toggleSound() {
    soundOn = !soundOn;
    soundButton.setAttribute('aria-pressed', String(!soundOn));
    soundButton.setAttribute('aria-label', soundOn ? 'Couper le son' : 'Réactiver le son');
    soundButton.textContent = soundOn ? '♪' : '×';
    if (soundOn) {
      initAudio();
      startMusic();
    } else {
      stopMusic();
    }
  }

  function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    const hearts = livesEl.querySelectorAll('span');
    hearts.forEach((heart, index) => heart.classList.toggle('lost', index >= lives));
    livesEl.setAttribute('aria-label', `${lives} ${lives === 1 ? 'vie restante' : 'vies restantes'} sur 3`);
  }

  function endGame() {
    running = false;
    cancelAnimationFrame(animationId);
    stopMusic();
    const oldBest = best;
    if (score > best) {
      best = score;
      saveBest();
    }
    clearBalloons();
    finalScore.textContent = score;
    finalLevel.textContent = level;
    bestFinal.textContent = best;
    bestIntro.textContent = best;
    recordMessage.textContent = score > oldBest && score > 0 ? 'Nouveau record !' : '';
    showOverlay(gameover);
    window.setTimeout(() => document.getElementById('replay').focus(), 250);
  }

  function clearBalloons() {
    balloons.forEach((balloon) => balloon.el.remove());
    balloons = [];
    game.querySelectorAll('.pop-bit').forEach((bit) => bit.remove());
  }

  function colorName(color) {
    const names = {
      '#ff557b': 'rose', '#ff9f43': 'orange', '#ffd747': 'jaune',
      '#4ed7c5': 'turquoise', '#54b8ff': 'bleu', '#9b7bff': 'violet'
    };
    return names[color] || 'coloré';
  }
})();
