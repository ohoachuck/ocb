(function(){
  'use strict';

  // Sources, all measured on 30 September 2026:
  // - France Data `geocode_adresse`: the coordinates are inside `point`, never at the top level.
  // - IGN API Carto: the parcel under a point; the first ten characters of its `idu` are the
  //   cadastral section, a few blocks wide.
  // - data.gouv.fr, Statistiques DVF: official sales counts and prices per m² for that section
  //   and for the commune. No public source lists sales one by one.
  // France Data's `cout_foncier` is not used: within 5 km of Paris 14e it gave 5,779 €/m²,
  // half the official median of the neighbourhood (10,872). **A failing or doubtful source
  // gives no estimate rather than a wrong one** — the person's rule, and the only honest one.
  var FRANCE_DATA = 'io.github.cturkieh/france-data';
  var DATA_GOUV = 'fr.data.gouv/catalogue';
  var DVF_STATS = '851d342f-9c96-41c1-924a-11a7a7aae8a6';
  var CADASTRE = 'https://apicarto.ign.fr/api/cadastre/parcelle';
  var MIN_SALES = 10;
  var STORAGE_KEY = 'estimation-immobiliere-state';

  // Hypotheses of this app, not measurements: no public data prices a balcony or a garage.
  var CONDITION = {renover: 0.78, rafraichir: 0.9, bon: 1, excellent: 1.08};
  var AMENITIES = {
    appartement: [['balcon', 'Balcon ou terrasse', 3], ['ascenseur', 'Ascenseur', 2], ['parking', 'Parking ou box', 3], ['cave', 'Cave', 1]],
    maison: [['jardin', 'Jardin', 4], ['garage', 'Garage', 3], ['piscine', 'Piscine', 4], ['plainpied', 'Plain-pied', 2]]
  };

  var state = {history: []};
  try { var saved = localStorage.getItem(STORAGE_KEY); if (saved) state = JSON.parse(saved) || state; } catch (e) {}
  if (!Array.isArray(state.history)) state.history = [];

  var currentType = 'appartement', lastResult = null, historyResultOpen = false, salesOpen = false;
  var $ = function(s){ return document.querySelector(s); };
  var $$ = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var euro = new Intl.NumberFormat('fr-FR', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0});
  var number = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0});

  function persist(){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} }
  function show(id){
    $$('.screen').forEach(function(x){ x.classList.toggle('active', x.id === id); });
    $$('.tab').forEach(function(x){ x.classList.toggle('active', x.dataset.screen === id); });
    window.scrollTo(0, 0);
  }
  function el(tag, className, text){
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function perM2(value){ return number.format(value) + ' €/m²'; }
  function typeWord(type, plural){ return type === 'maison' ? (plural ? 'maisons' : 'maison') : (plural ? 'appartements' : 'appartement'); }
  function sold(count, type){
    var many = count > 1;
    var noun = type === 'both' ? (many ? 'logements' : 'logement') : typeWord(type, many);
    var verb = type === 'maison' ? (many ? 'vendues' : 'vendue') : (many ? 'vendus' : 'vendu');
    return number.format(count) + ' ' + noun + ' ' + verb;
  }

  // ---- Form ----

  function amenityFields(){
    var box = $('#extraFields');
    box.replaceChildren();
    var legend = el('p', 'amenities-title', currentType === 'maison' ? 'Atouts de la maison' : 'Atouts de l’appartement');
    var list = el('div', 'amenities');
    AMENITIES[currentType].forEach(function(item){
      var label = el('label', 'amenity');
      var input = document.createElement('input');
      input.type = 'checkbox'; input.value = item[0]; input.name = 'amenity';
      label.append(input, el('span', '', item[1]), el('small', '', '+' + item[2] + ' %'));
      list.append(label);
    });
    var hint = el('p', 'hint', 'Ces pourcentages sont des hypothèses de l’app : aucune donnée publique ne mesure ce qu’un balcon ou un garage ajoute au prix.');
    box.append(legend, list, hint);
  }
  $$('.segment').forEach(function(btn){
    btn.addEventListener('click', function(){
      currentType = btn.dataset.type;
      $$('.segment').forEach(function(b){ var yes = b === btn; b.classList.toggle('selected', yes); b.setAttribute('aria-pressed', yes); });
      amenityFields();
    });
  });
  amenityFields();


  function readForm(){
    var address = $('#address').value.trim(), surface = Number($('#surface').value);
    if (!address) { $('#address').setCustomValidity('Saisissez une adresse'); $('#address').reportValidity(); return null; }
    $('#address').setCustomValidity('');
    if (!surface || surface < 9) { $('#surface').focus(); return null; }
    return {
      address: address, surface: surface, rooms: Number($('#rooms').value), type: currentType,
      condition: $('#condition').value,
      amenities: $$('input[name="amenity"]:checked').map(function(x){ return x.value; }),
      status: 'loading', errors: {}, date: new Date().toISOString(), version: 4
    };
  }

  // ---- Sources ----

  function texts(answer){
    return (answer && Array.isArray(answer.content) ? answer.content : [])
      .filter(function(part){ return part && typeof part.text === 'string'; })
      .map(function(part){ return part.text; });
  }
  function callService(server, tool, args){
    return window.creativeBoard.mcp.call(server, tool, args).then(function(answer){
      if (answer && answer.isError) throw new Error(texts(answer).join(' ') || 'Le service a renvoyé une erreur');
      return answer;
    });
  }
  function jsonOf(answer){
    if (answer && answer.structuredContent && typeof answer.structuredContent === 'object') return answer.structuredContent;
    var parts = texts(answer);
    for (var i = 0; i < parts.length; i++) { try { return JSON.parse(parts[i]); } catch (e) {} }
    return null;
  }

  function geocode(address){
    return callService(FRANCE_DATA, 'geocode_adresse', {adresse: address}).then(function(answer){
      var geo = jsonOf(answer) || {};
      var point = geo.point || {};
      if (typeof point.lat !== 'number' || typeof point.lon !== 'number') throw new Error('Adresse introuvable');
      return {lat: point.lat, lon: point.lon, label: geo.label || address, score: Number(geo.score) || 0,
        codeCommune: geo.codeCommune || null, commune: geo.commune || ''};
    });
  }

  // A house number's point sometimes lands on the street, which belongs to no parcel: a small
  // square around it then finds the nearest one, in the same section in practice.
  function section(geo){
    function ask(geometry){
      var url = CADASTRE + '?geom=' + encodeURIComponent(JSON.stringify(geometry)) + '&_limit=1';
      return window.creativeBoard.http.fetch(url).then(function(reply){
        if (reply.status !== 200) throw new Error('Cadastre : HTTP ' + reply.status);
        var data = JSON.parse(reply.body);
        var feature = data && data.features && data.features[0];
        var idu = feature && feature.properties && feature.properties.idu;
        return typeof idu === 'string' && idu.length >= 10 ? idu.slice(0, 10) : null;
      });
    }
    var d = 0.0003;
    return ask({type: 'Point', coordinates: [geo.lon, geo.lat]}).then(function(code){
      return code || ask({type: 'Polygon', coordinates: [[[geo.lon - d, geo.lat - d], [geo.lon + d, geo.lat - d], [geo.lon + d, geo.lat + d], [geo.lon - d, geo.lat + d], [geo.lon - d, geo.lat - d]]]});
    });
  }

  // data.gouv.fr answers in prose: each row is a block of indented `column: value` lines.
  function dvfStats(code){
    return callService(DATA_GOUV, 'query_resource_data', {resource_id: DVF_STATS, filter_column: 'code_geo', filter_value: code, page_size: 1})
      .then(function(answer){
        var text = texts(answer).join('\n');
        var row = text.split(/Row 1:/)[1];
        if (!row) return null;
        var values = {};
        row.split('\n').forEach(function(line){
          var m = line.match(/^\s*([a-z0-9_]+):\s*(.*)$/);
          if (m) values[m[1]] = m[2].trim();
        });
        function pick(kind){
          var sales = Number(values['nb_ventes_whole_' + kind]), median = Number(values['med_prix_m2_whole_' + kind]);
          return sales && median ? {sales: sales, median: median} : null;
        }
        return {code: code, scale: values.echelle_geo || '', appartement: pick('appartement'), maison: pick('maison'), both: pick('apt_maison')};
      });
  }


  // ---- Estimate ----

  // Official figures for the same kind of property only: the neighbourhood, or the commune
  // when the neighbourhood has too few sales. Anything that failed or is doubtful refuses.
  function basis(r){
    if (r.errors.section || r.errors.commune) {
      return {refusal: 'Les ventes officielles n’ont pas pu être lues : data.gouv.fr ou le cadastre n’a pas répondu (' + (r.errors.section || r.errors.commune) + '). Plutôt qu’un prix faux, l’app n’en donne aucun : réessayez plus tard.'};
    }
    if (r.geo.score < 0.5) {
      return {refusal: 'L’adresse a été reconnue de façon incertaine (« ' + r.geo.label + ' ») : précisez-la, avec le numéro et le code postal.'};
    }
    if (!r.section) {
      return {refusal: 'Le cadastre ne situe pas cette adresse dans un quartier : pas d’estimation sans cette référence.'};
    }
    var own = function(stats){ return stats && stats[r.type]; };
    var enough = function(x){ return x && x.sales >= MIN_SALES; };
    if (enough(own(r.sectionStats))) {
      return {perM2: own(r.sectionStats).median, text: 'médiane du quartier (section cadastrale ' + r.section.slice(-2) + ', ' + sold(own(r.sectionStats).sales, r.type) + ')'};
    }
    if (enough(own(r.communeStats))) {
      return {perM2: own(r.communeStats).median, text: 'médiane de la commune (' + sold(own(r.communeStats).sales, r.type) + '), le quartier en compte moins de ' + MIN_SALES};
    }
    return {refusal: 'Trop peu de ' + typeWord(r.type, true) + (r.type === 'maison' ? ' vendues' : ' vendus') + ' dans le quartier et la commune pour estimer un prix.'};
  }

  function estimate(r){
    var base = basis(r);
    r.refusal = base.refusal || null;
    if (base.refusal) { r.estimate = null; return; }
    var rooms = 1 + (Math.min(6, r.rooms) - 3) * 0.018;
    var bonus = (r.amenities || []).reduce(function(sum, key){
      var item = AMENITIES[r.type].filter(function(a){ return a[0] === key; })[0];
      return sum + (item ? item[2] : 0);
    }, 0);
    var adjusted = base.perM2 * CONDITION[r.condition] * rooms * (1 + bonus / 100);
    var central = Math.round(adjusted * r.surface / 100) * 100;
    r.estimate = {perM2: Math.round(adjusted), central: central, low: Math.round(central * 0.94 / 100) * 100,
      high: Math.round(central * 1.07 / 100) * 100, basis: base.text, bonus: bonus};
  }

  function load(r){
    r.status = 'loading'; r.errors = {};
    render(r);
    return geocode(r.address).then(function(geo){
      r.geo = geo;
      var steps = [
        section(geo).then(function(code){
          r.section = code;
          return code ? dvfStats(code).then(function(s){ r.sectionStats = s; }) : null;
        }).catch(function(e){ r.errors.section = e.message; }),
        (geo.codeCommune ? dvfStats(geo.codeCommune).then(function(s){ r.communeStats = s; }) : Promise.resolve())
          .catch(function(e){ r.errors.commune = e.message; })
      ];
      return Promise.all(steps);
    }).catch(function(e){ r.errors.geocode = e.message; }).then(function(){
      estimate(r);
      r.status = 'ready';
      persist();
      if (lastResult === r) render(r);
    });
  }


  // ---- Result ----

  function statLine(title, stats, type, fallback){
    var row = el('div', 'source-row');
    row.append(el('h4', '', title));
    var mine = stats && stats[type], both = stats && stats.both;
    var text = mine ? sold(mine.sales, type) + ', médiane ' + perM2(mine.median)
      : both ? 'Aucune vente de ' + typeWord(type, false) + ' ; tous logements : ' + sold(both.sales, 'both') + ', médiane ' + perM2(both.median)
      : fallback;
    row.append(el('p', '', text));
    return row;
  }

  // The map and the sales list never hold up the estimate, and never change it.
  function showDistrict(r){
    var block = $('#districtBlock');
    block.hidden = !(r.version && r.status === 'ready' && r.geo && !r.errors.geocode);
    if (!block.hidden) window.District.show($('#districtData'), r, function(list){ openSales(r, list); });
  }
  function openSales(r, list){
    salesOpen = true;
    history.pushState({screen: 'sales'}, '', window.location.pathname + window.location.search + '#ventes');
    $('#salesTitle').textContent = 'Ventes du quartier';
    $('#salesAddress').textContent = (r.geo && r.geo.label) || r.address;
    window.District.fillSales($('#salesList'), list, r.type, (r.section || '').slice(-2));
    show('salesScreen');
  }

  function render(r){
    lastResult = r;
    $('#districtBlock').hidden = true;
    currentType = r.type;
    $('#resultAddress').textContent = r.geo && r.geo.label ? r.geo.label : r.address;
    var legacy = !r.version;
    var est = r.estimate || (legacy && r.central ? {central: r.central, low: r.low, high: r.high, perM2: r.perM2} : null);
    $('#priceRange').textContent = est ? euro.format(est.low) + ' – ' + euro.format(est.high) : (r.status === 'loading' ? 'Calcul…' : 'Indisponible');
    $('#pricePerM2').textContent = est ? perM2(est.perM2) : '— / m²';
    $('#centralPrice').textContent = est ? euro.format(est.central) : '—';
    $('#resultSurface').textContent = number.format(r.surface) + ' m²';
    $('#resultType').textContent = r.type === 'maison' ? 'Maison' : 'Appartement';
    $('#sectorSubtitle').textContent = 'Ventes officielles (DVF) autour du bien';

    var box = $('#sectorData');
    box.replaceChildren();

    if (legacy) {
      box.append(el('p', 'local-stats', 'Estimation faite par une version précédente de l’app, sans données publiques : son prix venait d’un barème écrit dans l’app. Refaites-la pour obtenir les ventes officielles.'));
      show('resultScreen');
      return;
    }
    if (r.status === 'loading') {
      box.append(el('p', 'local-stats', 'Recherche des ventes officielles autour du bien…'));
      show('resultScreen');
      return;
    }
    if (r.errors.geocode) {
      box.append(el('p', 'local-stats', 'L’adresse n’a pas pu être localisée (' + r.errors.geocode + '). Vérifiez-la : sans position, aucune donnée de vente ne peut être lue.'));
      show('resultScreen');
      return;
    }

    var why = el('p', 'local-stats');
    why.textContent = r.estimate
      ? 'Base du calcul : ' + r.estimate.basis + ', ajustée selon l’état' + (r.estimate.bonus ? ', le nombre de pièces et les atouts (+' + r.estimate.bonus + ' %)' : ' et le nombre de pièces') + '. Ces ajustements sont des hypothèses de l’app.'
      : (r.refusal || 'Pas d’estimation.');

    var sources = el('div', 'nearby-sales');
    sources.append(
      statLine('Quartier' + (r.section ? ' · section ' + r.section.slice(-2) : ''), r.sectionStats, r.type,
        r.errors.section ? 'Indisponible : ' + r.errors.section : r.section ? 'Aucune vente publiée dans cette section.' : 'Section cadastrale introuvable pour ce point.'),
      statLine('Commune · ' + (r.geo.commune || ''), r.communeStats, r.type,
        r.errors.commune ? 'Indisponible : ' + r.errors.commune : 'Aucune vente publiée pour cette commune.')
    );


    var note = el('p', 'sales-note', 'Les ventes ne sont publiées qu’en statistiques : aucune source publique ne donne la liste des ventes une par une. Sources : data.gouv.fr (Statistiques DVF), cadastre de l’IGN, adresse par France Data.');
    box.append(why, sources, note);
    showDistrict(r);
    show('resultScreen');
  }


  $('#estimateForm').addEventListener('submit', function(e){
    e.preventDefault();
    var r = readForm();
    if (!r) return;
    if ($('#keepHistory').checked) { state.history.unshift(r); state.history = state.history.slice(0, 20); }
    persist();
    load(r);
  });
  $('#newEstimate').addEventListener('click', function(){ if (historyResultOpen) history.back(); else show('estimateScreen'); });

  // ---- History ----

  function openFromHistory(r){
    historyResultOpen = true;
    history.pushState({screen: 'historyResult'}, '', window.location.pathname + window.location.search + '#result');
    render(r);
  }
  function renderHistory(){
    var box = $('#historyList');
    box.replaceChildren();
    if (!state.history.length) {
      var empty = el('div', 'empty-state');
      empty.append('Aucune estimation conservée pour le moment.', document.createElement('br'), 'Votre prochain repère apparaîtra ici.');
      box.append(empty);
      return;
    }
    state.history.forEach(function(r){
      var item = el('article', 'history-item'); item.setAttribute('tabindex', '0');
      var head = document.createElement('header');
      var time = el('time', '', new Date(r.date).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short', year: 'numeric'}));
      var remove = el('button', 'history-delete', 'Supprimer'); remove.type = 'button'; remove.setAttribute('aria-label', 'Supprimer cette estimation');
      head.append(el('h3', '', (r.geo && r.geo.commune) || r.commune || 'Estimation'), time, remove);
      var central = r.estimate ? r.estimate.central : r.central;
      item.append(head, el('p', 'history-address', r.address),
        el('p', '', (r.type === 'maison' ? 'Maison' : 'Appartement') + ' · ' + r.surface + ' m² · ' + r.rooms + ' pièces'),
        el('div', 'history-price', central ? euro.format(central) : 'Sans estimation'));
      item.addEventListener('click', function(e){ if (e.target === remove) return; openFromHistory(r); });
      item.addEventListener('keydown', function(e){ if ((e.key === 'Enter' || e.key === ' ') && e.target === item) { e.preventDefault(); openFromHistory(r); } });
      remove.addEventListener('click', function(e){
        e.stopPropagation();
        if (remove.dataset.confirming === 'true') {
          var position = state.history.indexOf(r);
          if (position > -1) { state.history.splice(position, 1); persist(); renderHistory(); }
          return;
        }
        remove.dataset.confirming = 'true'; remove.textContent = 'Confirmer ?'; remove.setAttribute('aria-label', 'Confirmer la suppression');
        setTimeout(function(){ if (remove.dataset.confirming === 'true') { remove.dataset.confirming = 'false'; remove.textContent = 'Supprimer'; remove.setAttribute('aria-label', 'Supprimer cette estimation'); } }, 3000);
      });
      box.append(item);
    });
  }

  // ---- Sharing ----

  $('#shareResult').addEventListener('click', async function(){
    var r = lastResult;
    var est = r && (r.estimate || (r.central ? r : null));
    if (!est) return;
    var text = 'Mon estimation immobilière pour ' + r.address + ' : ' + euro.format(est.low) + ' à ' + euro.format(est.high)
      + ' (' + perM2(est.perM2) + ')' + (r.estimate ? ', sur la base de la ' + r.estimate.basis : '') + '. Estimation indicative.';
    try { await window.creativeBoard.share.present({text: text}); }
    catch (e) { var b = this; b.textContent = 'Partage indisponible'; setTimeout(function(){ b.textContent = '↗ Partager le résultat'; }, 2200); }
  });
  $('#shareHeader').addEventListener('click', async function(){
    try { await window.creativeBoard.share.present({text: 'Estimation immobilière — un repère de valeur pour un bien en France, à partir des ventes officielles.'}); } catch (e) {}
  });

  // ---- Edge swipe back from a result opened in the history ----

  var edgeSwipe = {tracking: false, locked: false, startX: 0, startY: 0};
  function resetResultPosition(){
    var screen = $('#resultScreen');
    screen.style.transition = 'transform .24s ease-out'; screen.style.transform = 'translateX(0)';
    setTimeout(function(){ screen.style.transition = ''; screen.style.transform = ''; }, 240);
  }
  document.addEventListener('touchstart', function(e){
    if (!historyResultOpen || e.touches.length !== 1) return;
    var touch = e.touches[0];
    if (touch.clientX > 28) return;
    edgeSwipe.tracking = true; edgeSwipe.locked = false; edgeSwipe.startX = touch.clientX; edgeSwipe.startY = touch.clientY;
    $('#resultScreen').style.transition = 'none';
  }, {passive: true});
  document.addEventListener('touchmove', function(e){
    if (!edgeSwipe.tracking || e.touches.length !== 1) return;
    var touch = e.touches[0], dx = touch.clientX - edgeSwipe.startX, dy = touch.clientY - edgeSwipe.startY;
    if ((!edgeSwipe.locked && Math.abs(dy) > Math.abs(dx)) || dx < 0) { edgeSwipe.tracking = false; resetResultPosition(); return; }
    edgeSwipe.locked = true; e.preventDefault();
    $('#resultScreen').style.transform = 'translateX(' + dx + 'px)';
  }, {passive: false});
  document.addEventListener('touchend', function(){
    if (!edgeSwipe.tracking) return;
    var screen = $('#resultScreen'), distance = parseFloat(screen.style.transform.replace(/[^0-9.-]/g, '')) || 0;
    edgeSwipe.tracking = false;
    if (edgeSwipe.locked && distance > window.innerWidth * 0.5) {
      screen.style.transition = 'transform .2s ease-out'; screen.style.transform = 'translateX(100%)';
      setTimeout(function(){ history.back(); }, 180);
    } else resetResultPosition();
  });
  document.addEventListener('touchcancel', function(){ if (edgeSwipe.tracking) { edgeSwipe.tracking = false; resetResultPosition(); } });
  $('#salesBack').addEventListener('click', function(){ history.back(); });
  window.addEventListener('popstate', function(){ if (salesOpen) { salesOpen = false; show('resultScreen'); return; } if (historyResultOpen) { historyResultOpen = false; resetResultPosition(); renderHistory(); show('historyScreen'); } });

  $$('.tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      var id = tab.dataset.screen;
      salesOpen = false;
      if (historyResultOpen) { historyResultOpen = false; history.replaceState(null, '', window.location.pathname + window.location.search); }
      if (id === 'historyScreen') renderHistory();
      show(id);
    });
  });
  renderHistory();
})();
