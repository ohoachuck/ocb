(function(){
  'use strict';
  if (!window.creativeBoard || !creativeBoard.skills || typeof creativeBoard.skills.define !== 'function') return;

  var FRANCE_DATA = 'io.github.cturkieh/france-data';
  var DATA_GOUV = 'fr.data.gouv/catalogue';
  var DVF_STATS = '851d342f-9c96-41c1-924a-11a7a7aae8a6';
  var CADASTRE = 'https://apicarto.ign.fr/api/cadastre/parcelle';
  var STORAGE_KEY = 'estimation-immobiliere-state';
  var MIN_SALES = 10;
  var CONDITION = {renover: 0.78, rafraichir: 0.9, bon: 1, excellent: 1.08};
  var AMENITIES = {
    appartement: {balcon: 3, ascenseur: 2, parking: 3, cave: 1},
    maison: {jardin: 4, garage: 3, piscine: 4, plainpied: 2}
  };

  function parts(answer){
    return answer && Array.isArray(answer.content) ? answer.content.filter(function(part){
      return part && typeof part.text === 'string';
    }).map(function(part){ return part.text; }) : [];
  }
  function service(server, tool, args){
    return creativeBoard.mcp.call(server, tool, args).then(function(answer){
      if (answer && answer.isError) throw new Error(parts(answer).join(' ') || 'Le service a renvoyé une erreur');
      return answer;
    });
  }
  function json(answer){
    if (answer && answer.structuredContent && typeof answer.structuredContent === 'object') return answer.structuredContent;
    var list = parts(answer);
    for (var i = 0; i < list.length; i++) {
      try { return JSON.parse(list[i]); } catch (e) {}
    }
    return null;
  }
  function geocode(address){
    return service(FRANCE_DATA, 'geocode_adresse', {adresse: address}).then(function(answer){
      var data = json(answer) || {}, point = data.point || {};
      if (typeof point.lat !== 'number' || typeof point.lon !== 'number') throw new Error('Adresse introuvable');
      if (Number(data.score) < 0.5) throw new Error('Adresse reconnue de façon incertaine');
      if (!data.codeCommune) throw new Error('Commune introuvable');
      return {lat: point.lat, lon: point.lon, score: Number(data.score), label: data.label || address,
        codeCommune: data.codeCommune, commune: data.commune || ''};
    });
  }
  function section(geo){
    var point = {type: 'Point', coordinates: [geo.lon, geo.lat]};
    var url = CADASTRE + '?geom=' + encodeURIComponent(JSON.stringify(point)) + '&_limit=1';
    return creativeBoard.http.fetch(url).then(function(reply){
      if (reply.status !== 200) throw new Error('Cadastre : HTTP ' + reply.status);
      var data = JSON.parse(reply.body), feature = data && data.features && data.features[0];
      var idu = feature && feature.properties && feature.properties.idu;
      if (typeof idu !== 'string' || idu.length < 10) throw new Error('Le cadastre ne situe pas cette adresse');
      return idu.slice(0, 10);
    });
  }
  function stats(code){
    return service(DATA_GOUV, 'query_resource_data', {resource_id: DVF_STATS, filter_column: 'code_geo', filter_value: code, page_size: 1}).then(function(answer){
      var row = parts(answer).join('\n').split(/Row 1:/)[1];
      if (!row) throw new Error('Statistiques DVF absentes pour ' + code);
      var values = {};
      row.split('\n').forEach(function(line){
        var match = line.match(/^\s*([a-z0-9_]+):\s*(.*)$/);
        if (match) values[match[1]] = match[2].trim();
      });
      function pick(kind){
        var sales = Number(values['nb_ventes_whole_' + kind]);
        var median = Number(values['med_prix_m2_whole_' + kind]);
        return sales && median ? {sales: sales, median: median} : null;
      }
      return {appartement: pick('appartement'), maison: pick('maison')};
    });
  }
  function euro(value){ return new Intl.NumberFormat('fr-FR', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0}).format(value); }
  function save(result){
    var state = {history: []};
    try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || state; } catch (e) {}
    if (!Array.isArray(state.history)) state.history = [];
    state.history.unshift(result);
    state.history = state.history.slice(0, 20);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function fail(message){ return {text: 'Estimation impossible : ' + message + '.'}; }

  var skillSchema = {
    type: 'object',
    properties: {
      adresse: {type: 'string', title: 'Adresse en France', description: 'Numéro, rue, code postal et commune.'},
      type_bien: {type: 'string', title: 'Type de bien', enum: ['appartement', 'maison'], enumNames: ['Appartement', 'Maison']},
      surface: {type: 'number', title: 'Surface habitable (m²)', minimum: 1},
      pieces: {type: 'integer', title: 'Nombre de pièces', minimum: 1, maximum: 20},
      etat: {type: 'string', title: 'État général', enum: ['renover', 'rafraichir', 'bon', 'excellent'], enumNames: ['À rénover', 'À rafraîchir', 'Bon état', 'Très bon état / rénové']},
      atouts: {type: 'string', title: 'Atouts', description: 'Balcon, ascenseur, parking ou cave pour un appartement ; jardin, garage, piscine ou plain-pied pour une maison.'},
      rayon_m: {type: 'integer', title: 'Rayon des ventes proches (m)', minimum: 50, maximum: 1000, default: 100},
      confirmations: {type: 'boolean', title: 'Confirmer les hypothèses', description: 'Les coefficients de l’état, des pièces et les pourcentages des atouts sont des hypothèses de l’application, sans mesure publique.'}
    },
    required: ['adresse', 'type_bien', 'surface', 'pieces', 'etat', 'confirmations']
  };

  creativeBoard.skills.define('estimer_un_bien', {
    description: 'Estimer indicativement le prix d’un appartement ou d’une maison en France à partir des ventes DVF officielles.',
    parameters: skillSchema
  }, async function(args){
    args = args || {};
    var address = String(args.adresse || '').trim();
    var surface = Number(args.surface);
    var type = args.type_bien === 'maison' ? 'maison' : args.type_bien === 'appartement' ? 'appartement' : null;
    var rooms = Number(args.pieces);
    var condition = args.etat;
    var amenities = Array.isArray(args.atouts) ? args.atouts.join(' ') : String(args.atouts || '').trim();
    var radius = args.rayon_m === undefined ? 100 : Number(args.rayon_m);
    if (!address || !type || !surface || surface < 1 || !isFinite(surface)) return fail('indiquez une adresse, un type de bien et une surface valide');
    if (!Number.isInteger(rooms) || rooms < 1) return fail('indiquez un nombre entier de pièces valide');
    if (!Object.prototype.hasOwnProperty.call(CONDITION, condition)) return fail('indiquez un état général valide');
    if (args.confirmations !== true) return fail('confirmez que les ajustements sont des hypothèses de l’application');
    if (!Number.isInteger(radius) || radius < 50 || radius > 1000) return fail('indiquez un rayon compris entre 50 et 1000 mètres');
    var selected = [];
    var words = amenities.toLowerCase();
    Object.keys(AMENITIES[type]).forEach(function(key){ if (words.indexOf(key) !== -1) selected.push(key); });
    try {
      var geo = await geocode(address);
      var code = await section(geo);
      var sectionStats = await stats(code);
      var communeStats = await stats(geo.codeCommune);
      var own = sectionStats[type], commune = communeStats[type], basis;
      var basisText;
      if (own && own.sales >= MIN_SALES) { basis = own; basisText = 'la médiane de la section cadastrale ' + code; }
      else if (commune && commune.sales >= MIN_SALES) { basis = commune; basisText = 'la médiane de la commune, car la section compte moins de 10 ventes'; }
      else return fail('il y a moins de 10 ventes du même type dans le quartier et la commune');
      var roomsFactor = 1 + (Math.min(6, rooms) - 3) * 0.018;
      var bonus = selected.reduce(function(sum, key){ return sum + AMENITIES[type][key]; }, 0);
      var perM2 = Math.round(basis.median * CONDITION[condition] * roomsFactor * (1 + bonus / 100));
      var central = Math.round(perM2 * surface / 100) * 100;
      var result = {address: address, surface: surface, rooms: rooms, type: type, condition: condition,
        amenities: selected, atouts: amenities, geo: geo, section: code, sectionStats: sectionStats, communeStats: communeStats,
        estimate: {perM2: perM2, central: central, low: Math.round(central * .94 / 100) * 100, high: Math.round(central * 1.07 / 100) * 100,
          basis: basisText, bonus: bonus}, status: 'ready', errors: {}, date: new Date().toISOString(), version: 4, nearbyRadius: radius};
      save(result);
      var text = 'Estimation enregistrée pour ' + (geo.label || address) + ' : ' + euro(result.estimate.low) + ' à ' + euro(result.estimate.high) + ', valeur centrale ' + euro(central) + ' (' + perM2 + ' €/m²). Base : ' + basisText + '. Les coefficients de l’état, des pièces et les pourcentages des atouts sont des hypothèses de l’application, non mesurées par une source publique. Les statistiques DVF ne publient pas la liste des ventes une par une.';
      return {text: text, card: {html: '<style>body{font-family:-apple-system,sans-serif;color:#20211e;padding:16px}h2{margin:0 0 8px;color:#d75b3f}p{line-height:1.45}.price{font-size:24px;font-weight:700}</style><h2>Estimation enregistrée</h2><p>' + String(geo.label || address).replace(/[<>]/g, '') + '</p><p class="price">' + euro(result.estimate.low) + ' – ' + euro(result.estimate.high) + '</p><p>Valeur centrale : ' + euro(central) + '<br>Base : ' + basisText + '</p>', images: []}, suggestions: ['Refaire une estimation']};
    } catch (error) {
      return fail(error && error.message ? error.message : 'une source publique a échoué');
    }
  });
})();