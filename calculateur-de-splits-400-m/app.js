(() => {
  'use strict';
  const STORAGE_KEY = 'calculateur-splits-400-state';
  const distanceInput = document.querySelector('#distance');
  const minutesInput = document.querySelector('#minutes');
  const secondsInput = document.querySelector('#seconds');
  const customSplitInput = document.querySelector('#custom-split');
  const message = document.querySelector('#form-message');
  const results = document.querySelector('#results');
  const customResults = document.querySelector('#custom-results');
  const emptyState = document.querySelector('#empty-state');
  const list = document.querySelector('#split-list');
  const customList = document.querySelector('#custom-split-list');
  const averagePace = document.querySelector('#average-pace');
  const customAveragePace = document.querySelector('#custom-average-pace');
  const summaryLine = document.querySelector('#summary-line');
  const customSummaryLine = document.querySelector('#custom-summary-line');
  const resetButton = document.querySelector('#reset-button');

  const readState = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (_) { return null; }
  };
  const saveState = (state) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
  };
  const numberValue = (input) => input.value.trim() === '' ? NaN : Number(input.value);
  const formatTime = (totalSeconds) => {
    const rounded = Math.round(totalSeconds);
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };
  const formatDistance = (value) => Number.isInteger(value) ? String(value) : value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const renderSegments = (target, segments) => target.replaceChildren(...segments.map((segment, index) => {
    const item = document.createElement('li');
    item.className = 'split-row';
    const num = document.createElement('span'); num.className = 'row-number'; num.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span'); label.className = 'row-label'; label.textContent = segment.label;
    const detail = document.createElement('small'); detail.textContent = `${formatDistance(segment.cumulativeDistance)} m cumulés`;
    label.append(detail);
    const time = document.createElement('strong'); time.className = 'row-time'; time.textContent = formatTime(segment.cumulativeTime);
    item.append(num, label, time); return item;
  }));

  function calculate(shouldSave = true) {
    const distance = numberValue(distanceInput);
    const minutes = numberValue(minutesInput);
    const seconds = numberValue(secondsInput);
    const customSplit = numberValue(customSplitInput);
    message.textContent = '';

    if (!Number.isFinite(distance) && !Number.isFinite(minutes) && !Number.isFinite(seconds) && !Number.isFinite(customSplit)) {
      results.hidden = true; customResults.hidden = true; emptyState.hidden = false; return;
    }
    if (!Number.isFinite(distance) || distance <= 0) return showError('Indique une distance supérieure à 0 m.');
    if (!Number.isFinite(minutes) || minutes < 0 || !Number.isInteger(minutes)) return showError('Indique les minutes avec un nombre entier.');
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 59 || !Number.isInteger(seconds)) return showError('Les secondes doivent être comprises entre 0 et 59.');
    if (!Number.isFinite(customSplit) || customSplit <= 0) return showError('Indique un split personnalisé supérieur à 0 m.');
    const totalSeconds = minutes * 60 + seconds;
    if (totalSeconds <= 0) return showError('Le temps total doit être supérieur à 0.');

    const buildSegments = (split, name) => {
      const pace = totalSeconds * split / distance;
      const fullSplits = Math.floor(distance / split);
      const remainder = distance - fullSplits * split;
      const segments = [];
      for (let i = 1; i <= fullSplits; i += 1) segments.push({ distance: split, cumulativeDistance: i * split, cumulativeTime: pace * i, label: `${name} ${i}` });
      if (remainder > 0.00001) segments.push({ distance: remainder, cumulativeDistance: distance, cumulativeTime: totalSeconds, label: 'Dernière portion' });
      return { pace, segments };
    };
    const fourHundred = buildSegments(400, 'Passage');
    const custom = buildSegments(customSplit, 'Passage');
    renderSegments(list, fourHundred.segments);
    renderSegments(customList, custom.segments);
    averagePace.textContent = `${formatTime(fourHundred.pace)} / 400 m`;
    customAveragePace.textContent = `${formatTime(custom.pace)} / ${formatDistance(customSplit)} m`;
    summaryLine.textContent = `${formatDistance(distance)} m · ${formatTime(totalSeconds)} au total · allure constante`;
    customSummaryLine.textContent = `${formatDistance(distance)} m · ${formatDistance(customSplit)} m par split`;
    results.hidden = false; customResults.hidden = false; emptyState.hidden = true;
    if (shouldSave) saveState({ distance, minutes, seconds, customSplit });
  }
  function showError(text) {
    message.textContent = text; results.hidden = true; customResults.hidden = true; emptyState.hidden = false;
  }
  function reset() {
    distanceInput.value = ''; minutesInput.value = ''; secondsInput.value = ''; customSplitInput.value = '';
    message.textContent = ''; results.hidden = true; customResults.hidden = true; emptyState.hidden = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* storage unavailable */ }
    distanceInput.focus();
  }
  [distanceInput, minutesInput, secondsInput, customSplitInput].forEach(input => input.addEventListener('input', () => calculate(true)));
  resetButton.addEventListener('click', reset);
  const saved = readState();
  if (saved && Number.isFinite(saved.distance)) {
    distanceInput.value = saved.distance; minutesInput.value = saved.minutes; secondsInput.value = saved.seconds; customSplitInput.value = saved.customSplit || '';
    calculate(false);
  }
})();
