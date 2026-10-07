(() => {
  'use strict';

  const STORE = 'disponibilite-domaine-state-v1';
  const DEFAULT_EXTENSIONS = ['.com', '.fr', '.net', '.org', '.io'];
  const SERVER = 'io.github.KincaidYang/whois';

  function storedExtensions() {
    try {
      const state = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (state && Array.isArray(state.extensions)) {
        const valid = state.extensions.filter(item => /^\.[a-z]{2,63}$/.test(item));
        if (valid.length) return [...new Set(valid)];
      }
    } catch (_) {}
    return DEFAULT_EXTENSIONS.slice();
  }

  function clean(raw) {
    return String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }

  function domainsFor(raw) {
    const value = clean(raw);
    const dot = value.lastIndexOf('.');
    const suffix = dot >= 0 ? value.slice(dot) : '';
    const complete = /^[a-z]{2,63}$/.test(suffix.slice(1)) && value.length > suffix.length;
    const extensions = storedExtensions();
    return { value, complete, domains: complete ? [value] : extensions.map(extension => value + extension) };
  }

  function validDomain(value) {
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
  }

  function parts(answer) {
    const parsed = [];
    const prose = [];
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
    if (value && typeof value === 'object') return [value, ...Object.values(value).flatMap(item => typeof item === 'object' ? flatten(item) : [])];
    return [];
  }

  function answerText(answer) {
    const p = parts(answer);
    return (p.prose + ' ' + JSON.stringify(p.parsed)).toLowerCase();
  }

  function resultFrom(answer, domain) {
    const text = answerText(answer);
    const p = parts(answer);
    if (answer && answer.isError && (/\b404\b|not found|no match|available|unregistered|non enregistré|non-enregistré|libre/.test(text))) {
      return { domain, status: 'available', detail: 'Aucun enregistrement RDAP : ce domaine semble disponible.' };
    }
    if (answer && answer.isError) return { domain, status: 'error', detail: p.prose || 'La vérification n’a pas abouti.' };
    const objects = p.parsed.flatMap(flatten);
    const record = objects.find(item => item && (item.ldhName || item.domain || item.name || item.events || item.entities));
    if (record || /registrar|registered|registration|rdap/.test(text)) {
      const registrar = record && (record.registrar || record.registrarName);
      return { domain, status: 'taken', detail: 'Domaine déjà enregistré.' + (registrar ? ' Registrar : ' + String(registrar) + '.' : '') };
    }
    if (/\b404\b|not found|no match|available|unregistered|non enregistré|non-enregistré|libre/.test(text)) {
      return { domain, status: 'available', detail: 'Aucun enregistrement RDAP : ce domaine semble disponible.' };
    }
    return { domain, status: 'error', detail: p.prose || 'Réponse inattendue du service WHOIS.' };
  }

  function serviceError(reason) {
    const text = String(reason || '').toLowerCase();
    if (text.includes('malformed')) return 'Paramètres invalides pour le service WHOIS.';
    if (text.includes('budget')) return 'La limite quotidienne du service WHOIS est atteinte. Réessayez demain.';
    return 'Le service WHOIS est momentanément indisponible.';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function card(results) {
    const rows = results.map(result => '<div style="padding:12px 0;border-bottom:1px solid #ddd"><strong>' + escapeHtml(result.domain) + '</strong><div style="color:' + (result.status === 'available' ? '#7fe0ae' : result.status === 'taken' ? '#ff8f87' : '#a7abbc') + ';font-weight:700;margin-top:4px">' + escapeHtml(result.status === 'available' ? 'DISPONIBLE' : result.status === 'taken' ? 'ENREGISTRÉ' : 'À RÉESSAYER') + '</div><div style="color:#a7abbc;font-size:13px;margin-top:3px">' + escapeHtml(result.detail) + '</div></div>').join('');
    return '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f6f3ee;padding:16px}h2{margin:0 0 8px}</style><h2>Disponibilité domaine</h2>' + rows;
  }

  creativeBoard.skills.define('rechercher_domaine', async (args) => {
    const parsed = domainsFor(args && args.saisie);
    if (!parsed.value || !validDomain(parsed.complete ? parsed.value : parsed.value + '.com')) {
      return { text: 'Saisissez un radical ou un domaine complet valide.' };
    }

    let results;
    try {
      const answer = await creativeBoard.mcp.call(SERVER, 'whois_batch_lookup', { queries: parsed.domains });
      const items = parts(answer).parsed.flatMap(flatten).filter(item => item && typeof item === 'object');
      const byDomain = new Map(items.map(item => [String(item.domain || item.query || item.ldhName || '').toLowerCase(), item]));
      if (items.length && parsed.domains.every(domain => byDomain.has(domain))) {
        results = parsed.domains.map(domain => resultFrom({ content: [{ text: JSON.stringify(byDomain.get(domain)) }] }, domain));
      } else {
        throw new Error('batch shape');
      }
    } catch (reason) {
      if (String(reason && reason.message || reason) !== 'batch shape') {
        results = [];
        for (const domain of parsed.domains) {
          try {
            results.push(resultFrom(await creativeBoard.mcp.call(SERVER, 'whois_lookup', { query: domain }), domain));
          } catch (error) {
            results.push({ domain, status: 'error', detail: serviceError(error) });
          }
        }
      } else {
        results = [];
        for (const domain of parsed.domains) {
          try {
            results.push(resultFrom(await creativeBoard.mcp.call(SERVER, 'whois_lookup', { query: domain }), domain));
          } catch (error) {
            results.push({ domain, status: 'error', detail: serviceError(error) });
          }
        }
      }
    }

    const summary = results.map(result => result.domain + ' : ' + (result.status === 'available' ? 'disponible' : result.status === 'taken' ? 'déjà enregistré' : result.detail)).join('\n');
    return { text: summary || 'Le service WHOIS n’a retourné aucun résultat.', card: { html: card(results) } };
  });
})();