(() => {
  const STORAGE_KEY = 'ma-position-state';
  const map = document.getElementById('map');
  const mapMessage = document.getElementById('mapMessage');
  const accuracyEl = document.getElementById('accuracy');
  const updatedEl = document.getElementById('updated');
  const notice = document.getElementById('notice');
  const badge = document.getElementById('stateBadge');
  let saved = null;
  let last = null;
  let timer = null;

  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { saved = null; }

  function setStatus(label, type) {
    badge.textContent = label;
    badge.className = 'state-badge ' + type;
  }

  function formatTime(iso) {
    try { return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
    catch (_) { return '—'; }
  }

  function project(lat, lon, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    const sin = Math.sin(lat * Math.PI / 180);
    return { x: (lon + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
  }

  function drawMap(position) {
    const zoom = 15;
    const width = map.clientWidth;
    const height = map.clientHeight;
    if (!width || !height) return;
    map.querySelectorAll('.tile, .marker').forEach(el => el.remove());
    const center = project(position.latitude, position.longitude, zoom);
    const left = center.x - width / 2;
    const top = center.y - height / 2;
    const firstX = Math.floor(left / 256);
    const firstY = Math.floor(top / 256);
    const countX = Math.ceil(width / 256) + 1;
    const countY = Math.ceil(height / 256) + 1;
    const max = Math.pow(2, zoom);
    for (let yy = firstY; yy < firstY + countY; yy++) {
      if (yy < 0 || yy >= max) continue;
      for (let xx = firstX; xx < firstX + countX; xx++) {
        const wrapped = ((xx % max) + max) % max;
        const tile = document.createElement('img');
        tile.className = 'tile';
        tile.alt = '';
        tile.setAttribute('aria-hidden', 'true');
        tile.src = `https://tile.openstreetmap.org/${zoom}/${wrapped}/${yy}.png`;
        tile.style.left = `${xx * 256 - left}px`;
        tile.style.top = `${yy * 256 - top}px`;
        tile.onerror = () => { tile.hidden = true; };
        map.appendChild(tile);
      }
    }
    const marker = document.createElement('div');
    marker.className = 'marker';
    marker.setAttribute('aria-label', 'Votre position actuelle');
    marker.style.left = `${center.x - left}px`;
    marker.style.top = `${center.y - top}px`;
    map.appendChild(marker);
    mapMessage.hidden = true;
    map.setAttribute('aria-label', `Votre position : ${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}`);
  }

  function showPosition(data, fromCache) {
    last = data;
    accuracyEl.textContent = Number.isFinite(data.accuracy) ? `${Math.round(data.accuracy)} m` : '—';
    updatedEl.textContent = formatTime(data.timestamp);
    notice.className = 'notice';
    notice.textContent = fromCache ? 'Dernière position enregistrée. Actualisation en cours…' : 'Position actualisée automatiquement.';
    setStatus(fromCache ? 'Dernière connue' : 'En direct', fromCache ? 'waiting' : 'live');
    drawMap(data);
  }

  async function locate() {
    try {
      const result = await window.creativeBoard.location.read();
      const data = { latitude: result.latitude, longitude: result.longitude, accuracy: result.accuracy, timestamp: new Date().toISOString() };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
      showPosition(data, false);
    } catch (error) {
      const reason = String(error || 'unknown');
      setStatus('Indisponible', 'error');
      notice.className = 'notice error';
      notice.textContent = reason === 'not_granted' ? 'L’accès à la localisation est nécessaire pour afficher votre position.' : 'Position indisponible pour le moment. Vérifiez l’autorisation de localisation.';
      if (!last) mapMessage.textContent = 'Position indisponible';
    }
  }

  if (saved && Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) showPosition(saved, true);
  locate();
  timer = window.setInterval(locate, 15000);
  window.addEventListener('resize', () => { if (last) drawMap(last); });
})();
