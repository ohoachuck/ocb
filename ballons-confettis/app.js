(function () {
  'use strict';

  const STORAGE_KEY = 'ballons-confettis-data-v1';

  const MAX_LIFE = 10;
  const BALLOON_TYPES = [
    { name: 'petit-bleu', size: 56, color: '#6ecbff', points: 1 },
    { name: 'moyen-rose', size: 68, color: '#ff7eb6', points: 2 },
    { name: 'grand-or', size: 80, color: '#ffd66e', points: 3 },
    { name: 'petit-vert', size: 52, color: '#6effa5', points: 1 }
  ];

  const GAME_CONFIG = {
    spawnIntervalStart: 1000,
    spawnIntervalMin: 300,
    baseSpeedMin: 3600,
    baseSpeedMax: 5600,
    difficultyRamp: 0.985,
    missedLifeLoss: 1,
    tapPenalty: 1,
    recentScoresMax: 10
  };

  let dom = {};
  let state = {
    running: false,
    score: 0,
    life: MAX_LIFE,
    bestScore: 0,
    recentScores: [],
    soundEnabled: true,
    spawnTimer: null,
    difficultyFactor: 1,
    gameStartTime: 0,
    rafId: null,
    balloons: new Map(),
    nextBalloonId: 1,
    audio: {
      musicCtx: null,
      musicNode: null,
      musicGain: null,
      sfxCtx: null,
      muted: false
    }
  };

  function safeLoad() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.bestScore === 'number') state.bestScore = data.bestScore;
      if (Array.isArray(data.recentScores)) state.recentScores = data.recentScores.slice(0, GAME_CONFIG.recentScoresMax);
      if (typeof data.soundEnabled === 'boolean') {
        state.soundEnabled = data.soundEnabled;
      }
    } catch (e) {
      console.warn('Storage unavailable', e);
    }
  }

  function safeSave() {
    const data = {
      bestScore: state.bestScore,
      recentScores: state.recentScores.slice(0, GAME_CONFIG.recentScoresMax),
      soundEnabled: state.soundEnabled
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Unable to save', e);
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function initDom() {
    dom = {
      homeScreen: $('homeScreen'),
      gameScreen: $('gameScreen'),
      endScreen: $('endScreen'),
      gameArea: $('gameArea'),
      startButton: $('startButton'),
      restartButton: $('restartButton'),
      homeButton: $('homeButton'),
      soundToggle: $('soundToggle'),
      lifeFill: $('lifeFill'),
      scoreValue: $('scoreValue'),
      finalScore: $('finalScore'),
      bestScore: $('bestScore'),
      bestScoreHome: $('bestScoreHome'),
      lastScoreHome: $('lastScoreHome'),
      recentScoresList: $('recentScoresList')
    };
  }

  function updateScreens(active) {
    ['homeScreen', 'gameScreen', 'endScreen'].forEach(key => {
      const el = dom[key];
      const isActive = key === active;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });
  }

  function updateHud() {
    if (dom.scoreValue) dom.scoreValue.textContent = String(state.score);
    if (dom.lifeFill) {
      const ratio = Math.max(0, Math.min(1, state.life / MAX_LIFE));
      dom.lifeFill.style.transform = 'scaleX(' + ratio + ')';
    }
  }

  function updateHomeInfo(lastScore) {
    if (dom.bestScoreHome) dom.bestScoreHome.textContent = String(state.bestScore);
    if (dom.lastScoreHome) dom.lastScoreHome.textContent = typeof lastScore === 'number' ? String(lastScore) : (state.recentScores[0] || '–');
  }

  function renderRecentScores() {
    const list = dom.recentScoresList;
    if (!list) return;
    list.innerHTML = '';
    if (!state.recentScores.length) {
      const li = document.createElement('li');
      li.textContent = 'Aucun score pour le moment.';
      list.appendChild(li);
      return;
    }
    state.recentScores.slice(0, GAME_CONFIG.recentScoresMax).forEach(score => {
      const li = document.createElement('li');
      li.textContent = score;
      list.appendChild(li);
    });
  }

  function setSoundEnabled(enabled) {
    state.soundEnabled = enabled;
    if (dom.soundToggle) {
      dom.soundToggle.setAttribute('aria-pressed', enabled ? 'false' : 'true');
      dom.soundToggle.innerHTML = '<span aria-hidden="true">' + (enabled ? '🔊' : '🔇') + '</span>';
    }
    if (!enabled) {
      stopMusic();
    }
    safeSave();
  }

  function ensureSfxContext() {
    if (!state.audio.sfxCtx) {
      try {
        state.audio.sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('Web Audio SFX unavailable', e);
      }
    }
    return state.audio.sfxCtx;
  }

  function ensureMusicContext() {
    if (!state.audio.musicCtx) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.22;
        gainNode.connect(ctx.destination);
        state.audio.musicCtx = ctx;
        state.audio.musicGain = gainNode;
      } catch (e) {
        console.warn('Web Audio music unavailable', e);
      }
    }
    return state.audio.musicCtx;
  }

  function playBalloonPop() {
    if (!state.soundEnabled) return;
    const ctx = ensureSfxContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(240, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  }

  function startMusic() {
    if (!state.soundEnabled) return;
    const ctx = ensureMusicContext();
    if (!ctx || state.audio.musicNode) return;

    const tempo = 96;
    const beat = 60 / tempo;
    const length = 4 * beat;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    osc.connect(gain);
    gain.connect(state.audio.musicGain);

    const now = ctx.currentTime + 0.05;
    const notes = [0, 4, 7, 9, 7, 4, 0, -3];
    const baseFreq = 440;

    notes.forEach((semi, i) => {
      const t = now + i * beat * 0.5;
      const freq = baseFreq * Math.pow(2, semi / 12);
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.05);
      gain.gain.linearRampToValueAtTime(0.05, t + beat * 0.5 - 0.05);
    });

    gain.gain.linearRampToValueAtTime(0.0, now + length);

    osc.start(now);

    const loopNode = {
      stop: () => osc.stop(),
      ctx,
      osc,
      gain
    };

    osc.onended = () => {
      state.audio.musicNode = null;
      if (state.running && state.soundEnabled) {
        startMusic();
      }
    };

    state.audio.musicNode = loopNode;
  }

  function stopMusic() {
    if (state.audio.musicNode && state.audio.musicNode.stop) {
      try {
        state.audio.musicNode.stop();
      } catch (e) {
        // ignore
      }
    }
    state.audio.musicNode = null;
  }

  function resetGameState() {
    state.running = false;
    state.score = 0;
    state.life = MAX_LIFE;
    state.difficultyFactor = 1;
    state.gameStartTime = performance.now();
    state.balloons.clear();
    state.nextBalloonId = 1;
    if (state.spawnTimer) {
      clearTimeout(state.spawnTimer);
      state.spawnTimer = null;
    }
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    if (dom.gameArea) {
      dom.gameArea.innerHTML = '';
    }
    updateHud();
  }

  function scheduleNextSpawn() {
    if (!state.running) return;
    const factor = state.difficultyFactor;
    const delay = Math.max(
      GAME_CONFIG.spawnIntervalMin,
      GAME_CONFIG.spawnIntervalStart * factor
    );
    state.spawnTimer = setTimeout(() => {
      spawnBalloon();
      state.difficultyFactor *= GAME_CONFIG.difficultyRamp;
      scheduleNextSpawn();
    }, delay);
  }

  function spawnBalloon() {
    if (!dom.gameArea) return;
    const areaRect = dom.gameArea.getBoundingClientRect();
    const type = BALLOON_TYPES[Math.floor(Math.random() * BALLOON_TYPES.length)];
    const id = state.nextBalloonId++;

    const balloon = document.createElement('div');
    balloon.className = 'balloon balloon-floating';
    const size = type.size;
    balloon.style.setProperty('--size', size + 'px');
    balloon.style.setProperty('--color-main', type.color);

    const maxX = areaRect.width - size - 10;
    const minX = 10;
    const x = minX + Math.random() * Math.max(0, maxX - minX);
    balloon.style.left = x + 'px';
    balloon.style.bottom = '-120px';

    const stringEl = document.createElement('div');
    stringEl.className = 'string';
    balloon.appendChild(stringEl);

    const speedMin = GAME_CONFIG.baseSpeedMin * state.difficultyFactor * 0.9;
    const speedMax = GAME_CONFIG.baseSpeedMax * state.difficultyFactor * 0.9;
    const duration = speedMin + Math.random() * (speedMax - speedMin);
    balloon.style.animationDuration = duration + 'ms';

    balloon.setAttribute('data-id', String(id));
    balloon.setAttribute('role', 'button');
    balloon.setAttribute('tabindex', '-1');
    balloon.setAttribute('aria-label', 'Ballon, +' + type.points + ' points');

    const onAnimationEnd = () => {
      if (!state.balloons.has(id)) return;
      dom.gameArea && dom.gameArea.removeChild(balloon);
      state.balloons.delete(id);
      loseLife(GAME_CONFIG.missedLifeLoss);
    };

    balloon.addEventListener('animationend', onAnimationEnd);

    const data = { id, type, element: balloon, removeHandler: onAnimationEnd };
    state.balloons.set(id, data);

    dom.gameArea.appendChild(balloon);
  }

  function burstConfetti(x, y) {
    if (!dom.gameArea) return;
    const colors = ['#ff7eb6', '#ffd66e', '#6ecbff', '#6effa5', '#ffffff'];
    const rect = dom.gameArea.getBoundingClientRect();
    const localX = x - rect.left;
    const localY = y - rect.top;

    const pieces = 12;
    for (let i = 0; i < pieces; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-burst';
      const color = colors[Math.floor(Math.random() * colors.length)];
      piece.style.backgroundColor = color;
      piece.style.left = localX + 'px';
      piece.style.top = localY + 'px';
      const angle = (Math.PI * 2 * i) / pieces + (Math.random() * 0.6 - 0.3);
      const distance = 40 + Math.random() * 45;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      piece.style.setProperty('--dx', dx + 'px');
      piece.style.setProperty('--dy', dy + 'px');
      piece.style.opacity = '1';
      piece.style.animation = 'confetti-pop 320ms ease-out forwards';
      dom.gameArea.appendChild(piece);
      setTimeout(() => {
        piece.remove();
      }, 400);
    }
  }

  function loseLife(amount) {
    if (!state.running) return;
    state.life = Math.max(0, state.life - amount);
    updateHud();
    if (state.life <= 0) {
      endGame();
    }
  }

  function applyTapPenalty() {
    if (!state.running) return;
    const newScore = Math.max(0, state.score - GAME_CONFIG.tapPenalty);
    if (newScore !== state.score) {
      state.score = newScore;
      updateHud();
    }
  }

  function onGameAreaPointer(ev) {
    if (!state.running) return;
    if (ev.type === 'pointerdown' || ev.type === 'mousedown' || ev.type === 'touchstart') {
      const target = ev.target && ev.target.closest ? ev.target.closest('.balloon') : null;
      if (target && dom.gameArea.contains(target)) {
        ev.preventDefault();
        const touch = ev.touches && ev.touches[0];
        const clientX = typeof ev.clientX === 'number' ? ev.clientX : (touch ? touch.clientX : 0);
        const clientY = typeof ev.clientY === 'number' ? ev.clientY : (touch ? touch.clientY : 0);
        popBalloonElement(target, clientX, clientY);
      } else {
        applyTapPenalty();
      }
    }
  }

  function popBalloonElement(el, clientX, clientY) {
    const idStr = el.getAttribute('data-id');
    if (!idStr) return;
    const id = Number(idStr);
    const data = state.balloons.get(id);
    if (!data) return;
    state.balloons.delete(id);

    if (data.removeHandler) {
      el.removeEventListener('animationend', data.removeHandler);
    }

    if (dom.gameArea && el.parentElement === dom.gameArea) {
      dom.gameArea.removeChild(el);
    }

    state.score += data.type.points;
    updateHud();
    burstConfetti(clientX, clientY);
    playBalloonPop();
  }

  function startGame() {
    resetGameState();
    state.running = true;
    updateScreens('gameScreen');
    updateHomeInfo();
    scheduleNextSpawn();
    startMusic();
    dom.gameArea && dom.gameArea.focus();
  }

  function endGame() {
    if (!state.running) return;
    state.running = false;
    if (state.spawnTimer) {
      clearTimeout(state.spawnTimer);
      state.spawnTimer = null;
    }
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }

    const finalScore = state.score;

    state.recentScores.unshift(finalScore);
    state.recentScores = state.recentScores.slice(0, GAME_CONFIG.recentScoresMax);

    if (finalScore > state.bestScore) {
      state.bestScore = finalScore;
    }

    safeSave();

    if (dom.finalScore) dom.finalScore.textContent = String(finalScore);
    if (dom.bestScore) dom.bestScore.textContent = String(state.bestScore);

    renderRecentScores();
    updateScreens('endScreen');
    updateHomeInfo(finalScore);

    startMusic();
  }

  function onKeyDown(ev) {
    if (!state.running) return;
    if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      const balloons = Array.from(state.balloons.values());
      if (!balloons.length) return;
      let closest = balloons[0];
      let minY = Infinity;
      balloons.forEach(b => {
        const rect = b.element.getBoundingClientRect();
        if (rect.top < minY) {
          minY = rect.top;
          closest = b;
        }
      });
      const rect = closest.element.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      popBalloonElement(closest.element, cx, cy);
    }
  }

  function attachEvents() {
    if (dom.startButton) dom.startButton.addEventListener('click', startGame);
    if (dom.restartButton) dom.restartButton.addEventListener('click', startGame);
    if (dom.homeButton) dom.homeButton.addEventListener('click', () => {
      updateScreens('homeScreen');
      stopMusic();
      updateHomeInfo();
    });

    if (dom.soundToggle) {
      dom.soundToggle.addEventListener('click', () => {
        setSoundEnabled(!state.soundEnabled);
      });
    }

    if (dom.gameArea) {
      dom.gameArea.addEventListener('pointerdown', onGameAreaPointer);
      dom.gameArea.addEventListener('mousedown', onGameAreaPointer);
      dom.gameArea.addEventListener('touchstart', onGameAreaPointer, { passive: false });
      dom.gameArea.addEventListener('keydown', onKeyDown);
    }
  }

  function init() {
    initDom();
    safeLoad();
    updateHud();
    updateHomeInfo();
    setSoundEnabled(state.soundEnabled);
    renderRecentScores();
    attachEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
