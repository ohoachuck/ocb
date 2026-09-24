"use strict";

const COLS = 18;
const ROWS = 22;
const STORAGE_KEY = "snake-state-v1";
const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const scoreElement = document.getElementById("score");
const bestElement = document.getElementById("bestScore");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const startButton = document.getElementById("startButton");
const message = document.getElementById("gameMessage");
const directionButtons = Array.from(document.querySelectorAll(".direction"));

let best = loadBest();
let snake = [];
let food = { x: 4, y: 4 };
let direction = DIRECTIONS.right;
let queuedDirection = DIRECTIONS.right;
let score = 0;
let state = "ready";
let timer = null;
let turnQueued = false;

bestElement.textContent = String(best);
resetGame();
resizeCanvas();

function loadBest() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const value = JSON.parse(raw);
    return Number.isInteger(value.best) && value.best >= 0 ? value.best : 0;
  } catch (error) {
    return 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ best }));
  } catch (error) {
    // Le jeu continue normalement si le stockage privé est indisponible.
  }
}

function resetGame() {
  const centerY = Math.floor(ROWS / 2);
  snake = [
    { x: 9, y: centerY },
    { x: 8, y: centerY },
    { x: 7, y: centerY },
    { x: 6, y: centerY }
  ];
  direction = DIRECTIONS.right;
  queuedDirection = DIRECTIONS.right;
  turnQueued = false;
  score = 0;
  scoreElement.textContent = "0";
  placeFood();
  draw();
}

function startGame() {
  clearTimeout(timer);
  resetGame();
  state = "playing";
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  message.textContent = "Partie en cours";
  scheduleTick();
}

function scheduleTick() {
  const delay = Math.max(68, 158 - score * 4);
  timer = setTimeout(tick, delay);
}

function tick() {
  if (state !== "playing") return;

  direction = queuedDirection;
  turnQueued = false;
  const head = snake[0];
  const next = { x: head.x + direction.x, y: head.y + direction.y };
  const hitWall = next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS;
  const eating = next.x === food.x && next.y === food.y;
  const body = eating ? snake : snake.slice(0, -1);
  const hitSelf = body.some(part => part.x === next.x && part.y === next.y);

  if (hitWall || hitSelf) {
    endGame();
    return;
  }

  snake.unshift(next);
  if (eating) {
    score += 1;
    scoreElement.textContent = String(score);
    if (score > best) {
      best = score;
      bestElement.textContent = String(best);
      saveBest();
    }
    placeFood();
  } else {
    snake.pop();
  }

  updateCanvasLabel();
  draw();
  scheduleTick();
}

function endGame() {
  state = "ended";
  clearTimeout(timer);
  draw();
  overlayTitle.textContent = "Partie terminée";
  overlayText.textContent = score === best && score > 0
    ? `Nouveau record : ${score} !`
    : `Score : ${score} · Record : ${best}`;
  startButton.textContent = "Rejouer";
  overlay.classList.remove("hidden");
  overlay.removeAttribute("aria-hidden");
  message.textContent = "Collision. Touchez Rejouer pour recommencer.";
  startButton.focus({ preventScroll: true });
}

function setDirection(name) {
  if (state !== "playing" || turnQueued) return;
  const next = DIRECTIONS[name];
  if (!next) return;
  const isOpposite = next.x + direction.x === 0 && next.y + direction.y === 0;
  if (isOpposite) return;
  queuedDirection = next;
  turnQueued = true;
}

function placeFood() {
  const free = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!snake.some(part => part.x === x && part.y === y)) free.push({ x, y });
    }
  }
  if (free.length) food = free[Math.floor(Math.random() * free.length)];
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  draw();
}

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function roundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
  ctx.fill();
}

function draw() {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;

  const cellW = width / COLS;
  const cellH = height / ROWS;
  const inset = Math.min(cellW, cellH) * 0.12;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = cssColor("--board");
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = cssColor("--grid");
  ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
  ctx.beginPath();
  for (let x = 1; x < COLS; x += 1) {
    ctx.moveTo(x * cellW, 0);
    ctx.lineTo(x * cellW, height);
  }
  for (let y = 1; y < ROWS; y += 1) {
    ctx.moveTo(0, y * cellH);
    ctx.lineTo(width, y * cellH);
  }
  ctx.stroke();

  const foodX = (food.x + 0.5) * cellW;
  const foodY = (food.y + 0.5) * cellH;
  const foodRadius = Math.min(cellW, cellH) * 0.34;
  ctx.fillStyle = cssColor("--food");
  ctx.beginPath();
  ctx.arc(foodX, foodY, foodRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cssColor("--food-shine");
  ctx.beginPath();
  ctx.arc(foodX - foodRadius * 0.28, foodY - foodRadius * 0.28, foodRadius * 0.19, 0, Math.PI * 2);
  ctx.fill();

  snake.forEach((part, index) => {
    ctx.fillStyle = cssColor(index === 0 ? "--snake-head" : "--snake");
    roundedRect(
      part.x * cellW + inset,
      part.y * cellH + inset,
      cellW - inset * 2,
      cellH - inset * 2,
      Math.min(cellW, cellH) * (index === 0 ? 0.28 : 0.22)
    );
  });

  drawEyes(cellW, cellH);
}

function drawEyes(cellW, cellH) {
  if (!snake.length) return;
  const head = snake[0];
  const centerX = (head.x + 0.5) * cellW;
  const centerY = (head.y + 0.5) * cellH;
  const sideX = direction.y * cellW * 0.16;
  const sideY = -direction.x * cellH * 0.16;
  const frontX = direction.x * cellW * 0.16;
  const frontY = direction.y * cellH * 0.16;
  const radius = Math.min(cellW, cellH) * 0.055;
  ctx.fillStyle = cssColor("--board");
  [-1, 1].forEach(side => {
    ctx.beginPath();
    ctx.arc(centerX + frontX + sideX * side, centerY + frontY + sideY * side, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function updateCanvasLabel() {
  canvas.setAttribute("aria-label", `Grille de Snake. Score actuel : ${score}.`);
}

startButton.addEventListener("click", startGame);

directionButtons.forEach(button => {
  button.addEventListener("click", () => setDirection(button.dataset.direction));
  button.addEventListener("pointerdown", () => button.classList.add("active"));
  const release = () => button.classList.remove("active");
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
});

window.addEventListener("keydown", event => {
  const keys = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right"
  };
  const name = keys[event.key];
  if (name) {
    event.preventDefault();
    setDirection(name);
  }
  if ((event.key === "Enter" || event.key === " ") && state !== "playing" && document.activeElement === canvas) {
    event.preventDefault();
    startGame();
  }
});

window.addEventListener("resize", resizeCanvas);
new ResizeObserver(resizeCanvas).observe(canvas);

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
if (typeof colorScheme.addEventListener === "function") {
  colorScheme.addEventListener("change", draw);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") {
    clearTimeout(timer);
    state = "paused";
    overlayTitle.textContent = "En pause";
    overlayText.textContent = `Score : ${score}`;
    startButton.textContent = "Reprendre";
    overlay.classList.remove("hidden");
    overlay.removeAttribute("aria-hidden");
    message.textContent = "Partie en pause";
  }
});

startButton.addEventListener("click", () => {
  if (state === "paused") {
    state = "playing";
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    message.textContent = "Partie en cours";
    scheduleTick();
  }
});
