// The neighbourhood around an estimate: a map of cadastral sections coloured by their
// official median price per m², and the list of sales of the address's own section.
//
// Sources, measured on 30 September 2026:
// - IGN API Carto `cadastre/division`: the cadastral sheets inside a small box around the
//   point, with their section letters — about 25 sections in 24 KB, whatever the size of
//   the commune (the commune-wide outline file of Toulouse is 1.2 MB, over the 1 MiB that
//   `http.fetch` accepts).
// - dvf-api.data.gouv.fr, the API behind data.gouv.fr's own property explorer: per-section
//   counts and medians (`/commune/<code>/sections`) and the sales of one section, line by
//   line (`/dvf/csv/?section=<code>`). Same figures as the official statistics used for the
//   price: section 75114000AI has 127 flats and a median of 10,872 €/m² in both.
// - OpenStreetMap tiles for the streets underneath.
//
// Nothing here changes the estimate. When a source fails, the map or the list says so and
// shows nothing rather than something partial passed off as complete.
(function(){
  'use strict';

  var CADASTRE = 'https://apicarto.ign.fr/api/cadastre/division';
  var DVF_API = 'https://dvf-api.data.gouv.fr';
  var TILES = 'https://tile.openstreetmap.org';
  var ZOOM = 15;
  var TILE = 256;
  var MAP_HEIGHT = 300;
  // About 1.3 km by 1.2 km: a little more than the map shows at zoom 15, so its edges are filled.
  var HALF_LON = 0.009, HALF_LAT = 0.0055;
  var MAX_COMMUNES = 4;
  var DWELLINGS = ['Appartement', 'Maison'];

  var number = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0});
  var euro = new Intl.NumberFormat('fr-FR', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0});

  function el(tag, className, text){
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svg(tag, attrs){
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function(k){ node.setAttribute(k, attrs[k]); });
    return node;
  }
  // Creative Board refuses a fifth simultaneous read from one mini-app rather than queue it
  // (`too_many_requests`) — measured on the iPhone, where the map started six at once and
  // lost the sales list. The queue lives here: three at a time, and a refused read waits a
  // moment and tries again.
  var MAX_IN_FLIGHT = 3, RETRIES = 3, RETRY_MS = 400;
  var inFlight = 0, waiting = [];
  // The slot is counted when it is handed out, not when the waiting promise resumes: counted
  // later, the loop below would hand out every slot before the first was taken.
  function next(){
    while (inFlight < MAX_IN_FLIGHT && waiting.length) { inFlight++; waiting.shift()(); }
  }
  function slot(){
    return new Promise(function(resolve){ waiting.push(resolve); next(); });
  }
  function release(){ inFlight--; next(); }
  function attempt(url, left){
    return window.creativeBoard.http.fetch(url).catch(function(e){
      var busy = e && /too_many_requests/.test(String(e.message || e.code || e));
      if (!busy || left <= 0) throw e;
      return new Promise(function(r){ setTimeout(r, RETRY_MS); }).then(function(){ return attempt(url, left - 1); });
    });
  }
  function fetchText(url){
    return slot().then(function(){ return attempt(url, RETRIES); }).then(function(reply){
      release();
      if (reply.status !== 200) throw new Error('HTTP ' + reply.status);
      return reply.body;
    }, function(e){ release(); throw e; });
  }

  // ---- Sources ----

  // A section's code in the DVF files: the commune — the arrondissement's in Paris, Lyon and
  // Marseille, where the cadastre names the whole city — then the absorbed-commune prefix and
  // the section letters.
  function sectionCode(p){
    var commune = p.code_arr && p.code_arr !== '000' ? p.code_dep + p.code_arr : p.code_insee;
    return {commune: commune, code: commune + (p.com_abs || '000') + p.section};
  }

  function sheets(geo){
    var dLon = HALF_LON, dLat = HALF_LAT;
    var box = {type: 'Polygon', coordinates: [[[geo.lon - dLon, geo.lat - dLat], [geo.lon + dLon, geo.lat - dLat],
      [geo.lon + dLon, geo.lat + dLat], [geo.lon - dLon, geo.lat + dLat], [geo.lon - dLon, geo.lat - dLat]]]};
    return fetchText(CADASTRE + '?geom=' + encodeURIComponent(JSON.stringify(box))).then(function(body){
      var data = JSON.parse(body);
      if (!data || !Array.isArray(data.features)) throw new Error('réponse du cadastre illisible');
      return data.features.map(function(f){
        var ids = sectionCode(f.properties || {});
        return {code: ids.code, commune: ids.commune, letters: (f.properties || {}).section, geometry: f.geometry};
      });
    });
  }

  function sectionStats(communes){
    return Promise.all(communes.slice(0, MAX_COMMUNES).map(function(code){
      return fetchText(DVF_API + '/commune/' + encodeURIComponent(code) + '/sections').then(function(body){
        return (JSON.parse(body).data || []);
      });
    })).then(function(lists){
      var byCode = {};
      lists.forEach(function(list){ list.forEach(function(s){ byCode[s.c] = s; }); });
      return byCode;
    });
  }

  // RFC 4180 enough for these files: quoted fields may hold commas and doubled quotes.
  function parseCSV(text){
    var rows = [], row = [], field = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    var head = rows[0];
    return rows.slice(1).map(function(r){
      var o = {};
      head.forEach(function(h, k){ o[h] = r[k] === undefined ? '' : r[k]; });
      return o;
    });
  }

  // One sale can span several lines — a flat and its cellar, two flats sold together — all
  // carrying the same total price. Grouped by mutation, so a price is counted once, and a
  // price per m² is given only when a single dwelling was sold.
  function sales(section){
    return fetchText(DVF_API + '/dvf/csv/?section=' + encodeURIComponent(section)).then(function(body){
      var byMutation = {};
      parseCSV(body).forEach(function(line){
        var id = line.id_mutation;
        if (!id) return;
        (byMutation[id] = byMutation[id] || []).push(line);
      });
      return Object.keys(byMutation).map(function(id){
        var lines = byMutation[id], first = lines[0];
        var homes = lines.filter(function(l){ return DWELLINGS.indexOf(l.type_local) !== -1; });
        var price = Number(first.valeur_fonciere) || null;
        var surface = homes.reduce(function(sum, l){ return sum + (Number(l.surface_reelle_bati) || 0); }, 0);
        var single = homes.length === 1 && surface > 0;
        return {
          id: id, date: first.date_mutation, nature: first.nature_mutation, price: price,
          address: [first.adresse_numero, first.adresse_suffixe, first.adresse_nom_voie].filter(Boolean).join(' ').toLowerCase(),
          type: homes.length ? homes[0].type_local : (lines.find(function(l){ return l.type_local; }) || {}).type_local || 'Terrain',
          homes: homes.length, surface: surface || null,
          rooms: single ? Number(homes[0].nombre_pieces_principales) || null : null,
          extras: lines.filter(function(l){ return l.type_local === 'Dépendance'; }).length,
          perM2: single && price ? Math.round(price / surface) : null,
          lon: Number(first.longitude) || null, lat: Number(first.latitude) || null
        };
      }).filter(function(s){ return s.homes > 0; })
        .sort(function(a, b){ return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    });
  }

  // ---- Map ----

  function project(lon, lat){
    var scale = TILE * Math.pow(2, ZOOM);
    var s = Math.sin(lat * Math.PI / 180);
    return {x: (lon + 180) / 360 * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale};
  }

  // Five shades by rank, not by value: most sections sit close together and one expensive
  // outlier would otherwise leave the whole map the same pale colour — measured on the 14e,
  // where medians run from 9,218 to 15,583 €/m² with most between 10 and 11 thousand.
  var SHADES = ['#fde7d4', '#f9c39b', '#f29a63', '#e46f34', '#b9471a'];
  function thresholds(values){
    var sorted = values.slice().sort(function(a, b){ return a - b; });
    return [1, 2, 3, 4].map(function(k){ return sorted[Math.floor(sorted.length * k / 5)]; });
  }
  function shade(value, limits){
    var k = 0;
    while (k < limits.length && value >= limits[k]) k++;
    return SHADES[k];
  }

  function rings(geometry){
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
  }

  function drawMap(box, r, pieces, stats, salesList, onPick){
    var width = box.clientWidth || 360;
    var centre = project(r.geo.lon, r.geo.lat);
    var left = centre.x - width / 2, top = centre.y - MAP_HEIGHT / 2;
    var frame = el('div', 'district-map');
    frame.style.height = MAP_HEIGHT + 'px';

    for (var tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      for (var ty = Math.floor(top / TILE); ty <= Math.floor((top + MAP_HEIGHT) / TILE); ty++) {
        var img = document.createElement('img');
        img.alt = ''; img.className = 'district-tile';
        img.src = TILES + '/' + ZOOM + '/' + tx + '/' + ty + '.png';
        img.style.left = (tx * TILE - left) + 'px';
        img.style.top = (ty * TILE - top) + 'px';
        frame.append(img);
      }
    }

    var key = r.type === 'maison' ? 'm_m' : 'm_a';
    var countKey = r.type === 'maison' ? 'm' : 'a';
    var values = pieces.map(function(p){ var s = stats[p.code]; return s && s[countKey] >= 5 ? s[key] : null; })
      .filter(function(v){ return v; });
    var low = Math.min.apply(null, values), high = Math.max.apply(null, values);
    var limits = thresholds(values);

    var layer = svg('svg', {viewBox: '0 0 ' + width + ' ' + MAP_HEIGHT, width: width, height: MAP_HEIGHT, 'class': 'district-layer'});
    var labelled = {};
    pieces.forEach(function(p){
      var s = stats[p.code];
      var value = s && s[countKey] >= 5 ? s[key] : null;
      var mine = p.code === r.section;
      rings(p.geometry).forEach(function(polygon){
        var d = polygon.map(function(ring){
          return ring.map(function(pt, i){ var q = project(pt[0], pt[1]); return (i ? 'L' : 'M') + (q.x - left).toFixed(1) + ' ' + (q.y - top).toFixed(1); }).join(' ') + ' Z';
        }).join(' ');
        var path = svg('path', {d: d, fill: value ? shade(value, limits) : '#bdbdbd', 'fill-opacity': value ? 0.55 : 0.25,
          stroke: mine ? '#20211e' : '#ffffff', 'stroke-width': mine ? 2.5 : 1});
        path.addEventListener('click', function(){ onPick(p, s, value); });
        layer.append(path);
      });
      if (!labelled[p.code] && value) {
        labelled[p.code] = true;
        var ring = rings(p.geometry)[0] && rings(p.geometry)[0][0];
        if (ring && ring.length) {
          var sx = 0, sy = 0;
          ring.forEach(function(pt){ var q = project(pt[0], pt[1]); sx += q.x; sy += q.y; });
          var x = sx / ring.length - left, y = sy / ring.length - top;
          if (x > 18 && x < width - 18 && y > 10 && y < MAP_HEIGHT - 10) {
            var label = svg('text', {x: x.toFixed(1), y: y.toFixed(1), 'text-anchor': 'middle', 'class': 'district-label'});
            label.textContent = (value / 1000).toLocaleString('fr-FR', {maximumFractionDigits: 1}) + ' k€';
            layer.append(label);
          }
        }
      }
    });

    (salesList || []).forEach(function(sale){
      if (!sale.lon || !sale.lat || !sale.perM2) return;
      var q = project(sale.lon, sale.lat);
      layer.append(svg('circle', {cx: (q.x - left).toFixed(1), cy: (q.y - top).toFixed(1), r: 3.5,
        fill: shade(sale.perM2, limits), stroke: '#20211e', 'stroke-width': 0.8}));
    });

    var home = project(r.geo.lon, r.geo.lat);
    layer.append(svg('circle', {cx: (home.x - left).toFixed(1), cy: (home.y - top).toFixed(1), r: 7, fill: '#2b6cb0', stroke: '#ffffff', 'stroke-width': 2.5}));
    frame.append(layer);

    var credit = el('a', 'district-credit', '© contributeurs OpenStreetMap');
    credit.href = 'https://www.openstreetmap.org/copyright';
    frame.append(credit);

    var legend = el('div', 'district-legend');
    if (values.length) {
      legend.append(el('span', '', 'moins cher'));
      var scale = el('span', 'district-scale');
      SHADES.forEach(function(c){ var b = el('i'); b.style.background = c; scale.append(b); });
      legend.append(scale, el('span', '', 'plus cher'));
    }
    return {frame: frame, legend: legend};
  }

  // ---- Public ----

  // Fills `box` with the map, a caption for the tapped section and a button to the sales.
  function show(box, r, openSales){
    // A placeholder the size of the map, with a spinner and the step under way: the three
    // sources take a few seconds, and an empty block reads as "nothing is happening".
    var placeholder = el('div', 'district-loading');
    placeholder.style.height = MAP_HEIGHT + 'px';
    placeholder.setAttribute('role', 'status');
    var steps = {cadastre: 'Contours du quartier', prices: 'Prix par section', sales: 'Ventes du quartier'};
    var done = {};
    var spinner = el('span', 'district-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    var progress = el('ul', 'district-steps');
    function paint(){
      progress.replaceChildren.apply(progress, Object.keys(steps).map(function(k){
        return el('li', done[k] ? 'done' : '', (done[k] ? '✓ ' : '… ') + steps[k]);
      }));
    }
    function mark(k){ return function(v){ done[k] = true; paint(); return v; }; }
    paint();
    placeholder.append(spinner, el('p', 'district-loading-title', 'Chargement de la carte du quartier'), progress);
    box.replaceChildren(placeholder);
    if (!r.geo || !r.section) { box.replaceChildren(el('p', 'district-note', 'Carte indisponible : l’adresse n’a pas été située dans un quartier.')); return; }

    var failed = function(what){ return function(e){ throw new Error(what + ' : ' + (e && e.message ? e.message : e)); }; };
    var gotSheets = sheets(r.geo).then(mark('cadastre')).catch(failed('cadastre de l’IGN'));
    var gotStats = gotSheets.then(function(pieces){
      var communes = [];
      pieces.forEach(function(p){ if (communes.indexOf(p.commune) === -1) communes.push(p.commune); });
      return sectionStats(communes);
    }).then(mark('prices')).catch(failed('prix par section'));
    var gotSales = sales(r.section).then(mark('sales')).catch(function(e){ return {error: e && e.message ? e.message : String(e)}; });

    Promise.all([gotSheets, gotStats, gotSales]).then(function(all){
      var pieces = all[0], stats = all[1], list = Array.isArray(all[2]) ? all[2] : null;
      var caption = el('p', 'district-note', 'Chaque teinte regroupe un cinquième des sections affichées, des moins chères aux plus chères. Touchez une section pour voir son prix. En bleu, le bien ; les points sont les ventes de son quartier, de la même couleur que leur prix au m².');
      var drawn = drawMap(box, r, pieces, stats, list, function(p, s, value){
        var count = s ? s[r.type === 'maison' ? 'm' : 'a'] : 0;
        caption.textContent = 'Section ' + p.letters + ' : ' + (value
          ? number.format(count) + ' ' + (r.type === 'maison' ? 'maisons vendues' : 'appartements vendus') + ', médiane ' + number.format(value) + ' €/m²'
          : 'moins de 5 ventes de ce type, pas de prix affiché') + '.';
      });
      var button = el('button', 'secondary-button district-sales');
      button.type = 'button';
      if (list) {
        button.textContent = 'Voir les ' + list.length + ' ventes du quartier';
        button.addEventListener('click', function(){ openSales(list); });
      } else {
        button.textContent = 'Liste des ventes indisponible';
        button.disabled = true;
      }
      var parts = [drawn.frame, drawn.legend, caption, button];
      if (!list) parts.push(el('p', 'district-note', 'La liste des ventes n’a pas pu être lue (' + all[2].error + ').'));
      box.replaceChildren.apply(box, parts);
    }).catch(function(e){
      box.replaceChildren(el('p', 'district-note', 'Carte indisponible : ' + (e && e.message ? e.message : e) + '. L’estimation, elle, ne dépend pas de la carte.'));
    });
  }

  function formatDate(iso){
    var parts = String(iso || '').split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : iso;
  }

  // The sales of the section, newest first, as a table the person can read line by line.
  function fillSales(box, list, type, sectionLetters){
    var wanted = type === 'maison' ? 'Maison' : 'Appartement';
    var mine = list.filter(function(s){ return s.type === wanted; });
    var years = list.map(function(s){ return s.date.slice(0, 4); }).sort();
    box.replaceChildren();
    var span = years.length ? ', de ' + years[0] + ' à ' + years[years.length - 1] : '';
    var what = mine.length === list.length
      ? list.length + ' ventes ' + (type === 'maison' ? 'de maisons' : 'd’appartements') + ' dans la section ' + sectionLetters + span + '.'
      : list.length + ' ventes de logements dans la section ' + sectionLetters + span + ', dont ' + mine.length + ' ' + (type === 'maison' ? 'maisons' : 'appartements') + ' ; les autres sont en gris.';
    box.append(el('p', 'sales-summary', what + ' Un prix au m² n’est donné que pour la vente d’un seul logement : une vente groupée n’en a pas. Ce décompte peut différer de celui des statistiques officielles qui fondent l’estimation : les deux ne retiennent pas exactement les mêmes ventes.'));

    var wrap = el('div', 'sales-table-wrap');
    var table = el('table', 'sales-table');
    var head = el('tr');
    ['Date', 'Bien', 'Prix', '€/m²'].forEach(function(h){ head.append(el('th', h === 'Prix' || h === '€/m²' ? 'num' : '', h)); });
    var thead = el('thead'); thead.append(head);
    var tbody = el('tbody');
    list.forEach(function(s){
      var tr = el('tr', s.type === wanted ? '' : 'other-type');
      var what = (s.type === 'Maison' ? 'Maison' : 'Appart.') + (s.homes > 1 ? ' ×' + s.homes : '')
        + (s.surface ? ' · ' + number.format(s.surface) + ' m²' : '') + (s.rooms ? ' · ' + s.rooms + ' p.' : '')
        + (s.extras ? ' + ' + s.extras + ' dép.' : '') + (s.nature && s.nature !== 'Vente' ? ' (' + s.nature + ')' : '');
      var cell = el('td');
      cell.append(el('span', 'sale-what', what), el('span', 'sale-address', s.address));
      tr.append(el('td', 'sale-date', formatDate(s.date)), cell,
        el('td', 'num', s.price ? euro.format(s.price) : '—'), el('td', 'num', s.perM2 ? number.format(s.perM2) : '—'));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    wrap.append(table);
    box.append(wrap);
    box.append(el('p', 'district-note', 'Source : demandes de valeurs foncières (DGFiP), via dvf-api.data.gouv.fr. Les ventes récentes peuvent manquer : la publication a plusieurs mois de retard.'));
  }

  window.District = {show: show, fillSales: fillSales, parseCSV: parseCSV};
})();
