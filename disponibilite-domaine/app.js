(() => {
  'use strict';
  const STORE = 'disponibilite-domaine-state-v1';
  const EXTENSIONS = ['.com', '.fr', '.net', '.org', '.io'];
  const els = {
    search: document.getElementById('searchView'), results: document.getElementById('resultsView'), form: document.getElementById('searchForm'), input: document.getElementById('domainInput'), clear: document.getElementById('clearButton'), hint: document.getElementById('inputHint'), msg: document.getElementById('searchMessage'), back: document.getElementById('backButton'), list: document.getElementById('resultsList'), subtitle: document.getElementById('resultsSubtitle'), meta: document.getElementById('resultsMeta'), newSearch: document.getElementById('newSearchButton'), teaser: document.getElementById('cachedTeaser'), chips: document.getElementById('extensionChips'), extensionInput: document.getElementById('extensionInput'), addExtension: document.getElementById('addExtensionButton')
  };
  let active = null;
  let extensions = EXTENSIONS.slice();

  function readState() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { return null; } }
  function saveState(value) { try { localStorage.setItem(STORE, JSON.stringify(value)); } catch (_) {} }
  function saveExtensions() {
    const state = readState() || {};
    state.extensions = extensions;
    saveState(state);
  }
  function setMessage(text) { els.msg.textContent = text || ''; }
  function clean(raw) {
    return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
  function domainsFor(raw) {
    const value = clean(raw);
    const lastDot = value.lastIndexOf('.');
    const suffix = lastDot >= 0 ? value.slice(lastDot) : '';
    const recognized = /^[a-z]{2,63}$/.test(suffix.slice(1)) && value.length > suffix.length;
    return { value, domains: recognized ? [value] : extensions.map(ext => value + ext), complete: recognized };
  }
  function isValid(value) { return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value); }
  function errorKind(reason) {
    const r = String(reason || '').toLowerCase();
    if (r.includes('malformed')) return 'Paramètres invalides pour le service WHOIS.';
    if (r.includes('budget')) return 'La limite quotidienne du service WHOIS est atteinte. Réessayez demain.';
    if (r.includes('too_many')) return 'Trop de vérifications simultanées. Les résultats vont reprendre progressivement.';
    return 'Le service WHOIS est momentanément indisponible. Vérifiez votre connexion puis réessayez.';
  }
  function parts(answer) {
    const parsed = [], prose = [];
    (answer && Array.isArray(answer.content) ? answer.content : []).forEach(part => {
      const text = typeof part === 'string' ? part : part && part.text;
      if (!text) return;
      try { parsed.push(JSON.parse(text)); } catch (_) { prose.push(text); }
    });
    if (answer && answer.structuredContent) parsed.push(answer.structuredContent);
    return { parsed, prose: prose.join('\n').trim() };
  }
  function flatten(value) {
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (value && typeof value === 'object') return [value, ...Object.values(value).flatMap(v => typeof v === 'object' ? flatten(v) : [])];
    return [];
  }
  function textOf(answer) { return parts(answer).prose + ' ' + JSON.stringify(parts(answer).parsed); }
  function statusFrom(answer, domain) {
    if (!answer) return { domain, status: 'error', detail: 'Aucune réponse reçue du service WHOIS.' };
    const raw = textOf(answer).toLowerCase();
    const is404 = /\b404\b|not found|no match|available|unregistered|non enregistré|non-enregistré|libre/.test(raw);
    if (answer.isError && is404) return { domain, status: 'available', detail: 'Aucun enregistrement RDAP : ce domaine semble disponible.' };
    if (answer.isError) return { domain, status: 'error', detail: parts(answer).prose || 'La vérification n’a pas abouti.' };
    const objects = parts(answer).parsed.flatMap(flatten);
    const record = objects.find(o => o && (o.ldhName || o.domain || o.name || o.events || o.entities));
    if (record || /registrar|registered|registration|rdap/.test(raw)) {
      let detail = 'Domaine déjà enregistré.';
      const registrar = record && (record.registrar || record.registrarName);
      if (registrar) detail += ' Registrar : ' + registrar + '.';
      return { domain, status: 'taken', detail };
    }
    if (is404) return { domain, status: 'available', detail: 'Aucun enregistrement RDAP : ce domaine semble disponible.' };
    return { domain, status: 'taken', detail: parts(answer).prose || 'Domaine déjà enregistré.' };
  }
  function card(result) {
    const article = document.createElement('article'); article.className = 'result-card';
    const top = document.createElement('div'); top.className = 'result-top';
    const name = document.createElement('div'); name.className = 'domain-name'; name.textContent = result.domain;
    const badge = document.createElement('span'); badge.className = 'badge ' + (result.status === 'available' ? 'available' : result.status === 'taken' ? 'taken' : 'pending');
    badge.textContent = result.status === 'available' ? 'DISPONIBLE' : result.status === 'taken' ? 'ENREGISTRÉ' : result.status === 'pending' ? 'VÉRIFICATION…' : 'À RÉESSAYER';
    top.append(name, badge); article.append(top);
    const detail = document.createElement('p'); detail.className = 'result-detail'; detail.textContent = result.detail || ''; article.append(detail);
    return article;
  }
  function renderResults(state) {
    active = state; els.search.classList.add('hidden'); els.results.classList.remove('hidden'); els.back.classList.remove('hidden');
    els.subtitle.textContent = state.complete ? state.query : state.query + ' · ' + state.domains.length + ' extensions';
    const done = state.results.filter(r => r.status !== 'pending').length;
    els.meta.textContent = done + ' / ' + state.domains.length + ' réponses reçues';
    els.list.replaceChildren(...state.results.map(card));
  }
  function showSearch() { els.results.classList.add('hidden'); els.search.classList.remove('hidden'); els.back.classList.add('hidden'); }
  function pushResults(state) { history.pushState({ view: 'results' }, '', '#resultats'); renderResults(state); }
  function renderExtensions() {
    els.chips.replaceChildren(...extensions.map(extension => {
      const chip = document.createElement('span'); chip.className = 'extension-chip';
      const label = document.createElement('span'); label.textContent = extension;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-extension'; remove.setAttribute('aria-label', 'Supprimer ' + extension); remove.textContent = '×';
      remove.addEventListener('click', () => { extensions = extensions.filter(item => item !== extension); saveExtensions(); renderExtensions(); updateHint(); });
      chip.append(label, remove); return chip;
    }));
  }
  function updateHint() { els.hint.textContent = /\.[a-z]{2,63}$/i.test(els.input.value.trim()) ? 'Extension reconnue : seul ce domaine sera vérifié.' : 'Sans extension, ' + extensions.length + ' extension' + (extensions.length > 1 ? 's' : '') + ' configurée' + (extensions.length > 1 ? 's' : '') + ' seront testées.'; }
  function launchSearch(raw) {
    const parsed = domainsFor(raw);
    if (!parsed.value || (!parsed.complete && !extensions.length) || !isValid(parsed.complete ? parsed.value : parsed.value + '.com')) { setMessage(extensions.length ? 'Saisissez un nom valide, par exemple atelier-lune ou atelier-lune.fr.' : 'Ajoutez au moins une extension pour vérifier un radical.'); return; }
    setMessage('');
    const state = { query: parsed.value, domains: parsed.domains, complete: parsed.complete, extensions: extensions.slice(), results: parsed.domains.map(domain => ({ domain, status: 'pending', detail: 'Interrogation du service WHOIS…' })), started: Date.now() };
    saveState(state); pushResults(state); runChecks(state);
  }
  async function one(domain) {
    try { return statusFrom(await creativeBoard.mcp.call('io.github.KincaidYang/whois', 'whois_lookup', { query: domain }), domain); }
    catch (reason) { return { domain, status: 'error', detail: errorKind(reason) }; }
  }
  async function runChecks(state) {
    try {
      const answer = await creativeBoard.mcp.call('io.github.KincaidYang/whois', 'whois_batch_lookup', { queries: state.domains });
      const p = parts(answer), items = p.parsed.flatMap(flatten).filter(x => x && typeof x === 'object');
      const byDomain = new Map(items.map(x => [String(x.domain || x.query || x.ldhName || '').toLowerCase(), x]));
      if (items.length) {
        state.results = state.domains.map(domain => byDomain.has(domain) ? statusFrom({ content: [{ text: JSON.stringify(byDomain.get(domain)) }] }, domain) : ({ domain, status: 'error', detail: 'Réponse incomplète du service WHOIS.' }));
        saveState(state); renderResults(state); return;
      }
      throw new Error('batch shape');
    } catch (_) {
      for (let i = 0; i < state.domains.length; i += 4) {
        const batch = await Promise.all(state.domains.slice(i, i + 4).map(one));
        batch.forEach(result => { const index = state.results.findIndex(r => r.domain === result.domain); if (index >= 0) state.results[index] = result; });
        saveState(state); renderResults(state);
      }
    }
  }
  els.form.addEventListener('submit', e => { e.preventDefault(); launchSearch(els.input.value); });
  els.input.addEventListener('input', () => { els.clear.classList.toggle('hidden', !els.input.value); updateHint(); });
  els.clear.addEventListener('click', () => { els.input.value = ''; els.clear.classList.add('hidden'); els.input.focus(); updateHint(); });
  els.addExtension.addEventListener('click', () => {
    const value = '.' + els.extensionInput.value.trim().replace(/^\./, '').toLowerCase();
    if (!/^[a-z]{2,63}$/.test(value.slice(1))) return;
    if (!extensions.includes(value)) { extensions.push(value); saveExtensions(); renderExtensions(); updateHint(); }
    els.extensionInput.value = '';
  });
  els.extensionInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); els.addExtension.click(); } });
  els.newSearch.addEventListener('click', () => { history.back(); });
  els.back.addEventListener('click', () => history.back());
  window.addEventListener('popstate', e => { if (e.state && e.state.view === 'results') { const stored = readState(); if (stored) renderResults(stored); } else showSearch(); });
  const cached = readState();
  if (cached && Array.isArray(cached.extensions) && cached.extensions.every(item => /^\.[a-z]{2,63}$/.test(item))) extensions = [...new Set(cached.extensions)];
  renderExtensions(); updateHint();
  if (cached && cached.results && cached.results.length) { els.cachedTeaser.textContent = 'Dernière recherche : ' + cached.query + ' · ' + new Date(cached.started).toLocaleDateString('fr-FR'); els.cachedTeaser.classList.remove('hidden'); }
  if (location.hash === '#resultats' && cached) renderResults(cached); else showSearch();
})();