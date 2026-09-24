const SERVER = 'com.doungdoung/orange-marketplace';
const STORE_KEY = 'orange-marketplace-state-v1';
const initialState = { compare: [], recents: [], filters: {}, cache: { search: null, promos: {}, details: {} } };
let state = loadState();
let currentProducts = [];
let activeView = 'searchView';
let previousView = 'searchView';
let toastTimer;

const $ = id => document.getElementById(id);
const els = {
  title:$('headerTitle'), back:$('backBtn'), filter:$('filterBtn'), tabs:$('tabBar'),
  query:$('query'), filterPanel:$('filterPanel'), results:$('results'), searchStatus:$('searchStatus'),
  welcome:$('welcome'), resultHeading:$('resultHeading'), count:$('resultCount'), sync:$('syncLabel'),
  promos:$('promos'), promoStatus:$('promoStatus'), compareContent:$('compareContent'), compareStatus:$('compareStatus'),
  detailContent:$('detailContent'), detailStatus:$('detailStatus'), badge:$('compareBadge')
};

function loadState(){
  try { const saved = JSON.parse(localStorage.getItem(STORE_KEY)); return saved && typeof saved === 'object' ? {...initialState,...saved,cache:{...initialState.cache,...saved.cache,details:{...(saved.cache?.details||{})},promos:{...(saved.cache?.promos||{})}}} : structuredClone(initialState); }
  catch { return JSON.parse(JSON.stringify(initialState)); }
}
function saveState(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }
function esc(value){ return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function money(n){ return typeof n === 'number' ? new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n) : '—'; }
function dateText(value){ if(!value) return 'Non précisée'; const d=new Date(value); return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:d.getFullYear()!==new Date().getFullYear()?'numeric':undefined}).format(d); }
function contentText(answer){ return (answer?.content||[]).map(p=>typeof p?.text==='string'?p.text:'').filter(Boolean).join('\n'); }
function getData(answer, expectedKey){
  if(answer?.isError) throw new Error(contentText(answer) || 'Le service n’a pas pu répondre.');
  const direct=answer?.structuredContent;
  if(direct && typeof direct==='object' && (!expectedKey || expectedKey in direct)) return direct;
  for(const part of answer?.content||[]){
    if(typeof part?.text!=='string') continue;
    try { const parsed=JSON.parse(part.text); if(parsed && typeof parsed==='object' && (!expectedKey || expectedKey in parsed)) return parsed; } catch {}
  }
  throw new Error('La Marketplace a renvoyé une réponse inattendue.');
}
async function call(tool,args={},expectedKey){
  if(!window.creativeBoard?.mcp?.call) throw new Error('Le service Marketplace n’est pas disponible sur cet appareil.');
  try { return getData(await creativeBoard.mcp.call(SERVER,tool,args),expectedKey); }
  catch(err){
    const reason=String(err?.message||err||'operation_failed');
    if(reason.includes('budget_exhausted')) throw new Error('Le quota du service est atteint pour aujourd’hui. Réessayez demain.');
    if(reason.includes('malformed_parameters')) throw new Error('La recherche n’a pas pu être formulée correctement.');
    if(reason.includes('operation_failed')) throw new Error('La Marketplace Orange est momentanément inaccessible.');
    throw err instanceof Error?err:new Error(reason);
  }
}
function setStatus(el,text,type=''){ el.textContent=text; el.className='status'+(type?' '+type:''); el.classList.toggle('hidden',!text); }
function toast(text){ $('toast').textContent=text; $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),2400); }
function makeImg(url,alt){
  const img=document.createElement('img'); img.alt=alt||''; img.loading='lazy';
  img.onerror=()=>{ const fallback=document.createElement('div'); fallback.className='img-fallback'; fallback.textContent='◇'; fallback.setAttribute('aria-label','Image indisponible'); img.replaceWith(fallback); };
  if(url) img.src=url; else img.onerror(); return img;
}
function productKey(p){ return p.seoId; }
function isCompared(id){ return state.compare.some(p=>p.seoId===id); }

function productCard(p){
  const card=document.createElement('article'); card.className='product-card'; card.dataset.id=p.seoId;
  const media=document.createElement('div'); media.className='product-media'; media.append(makeImg(p.imageUrl || p.images?.[0],p.name));
  const info=document.createElement('div'); info.className='product-info';
  const sale=typeof p.discountPercent==='number'&&p.discountPercent>0?`<span class="discount">−${Math.round(p.discountPercent)}%</span>`:'';
  info.innerHTML=`<div class="eyebrow">${esc(p.brand||'Marketplace')} · ${esc(p.seller||p.seller?.name||'Vendeur')}</div><h3>${esc(p.name)}</h3><div class="price-row"><span class="price">${money(p.priceEur)}</span>${p.listPriceEur?`<span class="old-price">${money(p.listPriceEur)}</span>`:''}${sale}</div><div class="card-note">Prix catalogue · à confirmer</div><div class="card-actions"><button type="button" class="open-product">Voir la fiche</button><button type="button" class="compare-toggle ${isCompared(p.seoId)?'selected':''}" aria-label="${isCompared(p.seoId)?'Retirer de':'Ajouter à'} la comparaison">${isCompared(p.seoId)?'✓ Comparé':'＋ Comparer'}</button></div>`;
  card.append(media,info);
  card.querySelector('.open-product').addEventListener('click',()=>openDetail(p));
  card.querySelector('.compare-toggle').addEventListener('click',e=>toggleCompare(p,e.currentTarget));
  return card;
}
function renderProducts(container,products){ container.replaceChildren(...products.map(productCard)); }
function toggleCompare(p,button){
  const index=state.compare.findIndex(x=>x.seoId===p.seoId);
  if(index>=0){ state.compare.splice(index,1); toast('Retiré de la comparaison'); }
  else { if(state.compare.length>=4){ toast('La comparaison est limitée à 4 produits'); return; } state.compare.push({...p}); toast('Ajouté à la comparaison'); }
  saveState(); updateBadge();
  document.querySelectorAll(`.product-card[data-id="${CSS.escape(p.seoId)}"] .compare-toggle`).forEach(btn=>{ const selected=isCompared(p.seoId); btn.classList.toggle('selected',selected); btn.textContent=selected?'✓ Comparé':'＋ Comparer'; btn.setAttribute('aria-label',`${selected?'Retirer de':'Ajouter à'} la comparaison`); });
  if(activeView==='compareView') renderCompare();
}
function updateBadge(){ const n=state.compare.length; els.badge.textContent=n; els.badge.classList.toggle('hidden',!n); }

function filtersFromUI(){
  return {priceMin:$('priceMin').value,priceMax:$('priceMax').value,brand:$('brandFilter').value.trim(),seller:$('sellerFilter').value.trim(),category:$('categoryFilter').value,sort:$('sortFilter').value,onSale:$('saleFilter').checked,refurbished:$('refurbFilter').checked,orange:$('orangeFilter').checked};
}
function applyFiltersToUI(f){
  $('priceMin').value=f.priceMin||'';$('priceMax').value=f.priceMax||'';$('brandFilter').value=f.brand||'';$('sellerFilter').value=f.seller||'';$('sortFilter').value=f.sort||'relevance';$('saleFilter').checked=!!f.onSale;$('refurbFilter').checked=!!f.refurbished;$('orangeFilter').checked=!!f.orange;
  if(f.category) $('categoryFilter').value=f.category;
}
function buildSearchArgs(query,f){
  const args={limit:40,sort:f.sort||'relevance'};
  if(query) args.query=query;if(f.priceMin!=='')args.priceMin=Number(f.priceMin);if(f.priceMax!=='')args.priceMax=Number(f.priceMax);if(f.brand)args.brands=[f.brand];if(f.seller)args.sellers=[f.seller];if(f.category)args.category=f.category;if(f.onSale)args.onSale=true;if(f.refurbished)args.refurbished=true;if(f.orange)args.firstPartyOnly=true;return args;
}
async function search(query=els.query.value.trim()){
  const f=filtersFromUI(); state.filters=f; if(query){state.recents=[query,...state.recents.filter(x=>x.toLowerCase()!==query.toLowerCase())].slice(0,6);renderRecents();}
  saveState(); els.welcome.classList.add('hidden'); els.resultHeading.classList.add('hidden'); els.results.replaceChildren(); setStatus(els.searchStatus,'Recherche dans la Marketplace…','loading');
  try{
    const data=await call('search_products',buildSearchArgs(query,f),'products');
    currentProducts=Array.isArray(data.products)?data.products:[]; state.cache.search={query,filters:f,data,savedAt:Date.now()}; saveState();
    if(!currentProducts.length){setStatus(els.searchStatus,'Aucun produit ne correspond à cette recherche sur la Marketplace Orange.');return;}
    setStatus(els.searchStatus,''); els.count.textContent=`${data.total??currentProducts.length} produit${(data.total??currentProducts.length)>1?'s':''}`; els.sync.textContent=data.syncedAt?`Catalogue synchronisé le ${dateText(data.syncedAt)}`:'Prix à confirmer sur la fiche'; els.resultHeading.classList.remove('hidden'); populateCategories(currentProducts); renderProducts(els.results,currentProducts);
  }catch(e){setStatus(els.searchStatus,e.message);}
}
function populateCategories(products){
  const select=$('categoryFilter'), current=state.filters.category||''; const cats=[...new Set(products.flatMap(p=>Array.isArray(p.categories)?p.categories:[]).filter(Boolean))].sort();
  select.innerHTML='<option value="">Toutes les catégories</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join(''); select.value=current;
}
function renderRecents(){
  const list=$('recentList'); list.replaceChildren(); state.recents.forEach(q=>{const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=q;b.addEventListener('click',()=>{els.query.value=q;search(q)});list.append(b)});$('recentArea').classList.toggle('hidden',!state.recents.length);
}
function showCachedSearch(){ const c=state.cache.search;if(!c?.data?.products?.length)return;els.query.value=c.query||'';currentProducts=c.data.products;els.welcome.classList.add('hidden');els.count.textContent=`${c.data.total??currentProducts.length} produits`;els.sync.textContent='Derniers résultats enregistrés';els.resultHeading.classList.remove('hidden');populateCategories(currentProducts);renderProducts(els.results,currentProducts); }

async function loadPromos(force=true){
  const category=$('promoCategory').value, key=category||'all', cached=state.cache.promos[key];
  if(!force&&cached?.products?.length){renderProducts(els.promos,cached.products);return;}
  els.promos.replaceChildren();setStatus(els.promoStatus,'Chargement des promotions du moment…','loading');
  try{const args={page:1,sort:'par-defaut'};if(category)args.category=category;const data=await call('list_promotions',args,'products');const products=Array.isArray(data.products)?data.products:[];state.cache.promos[key]=data;saveState();if(!products.length){setStatus(els.promoStatus,'Aucune promotion n’est proposée dans cette catégorie pour le moment.');return;}setStatus(els.promoStatus,`Offres relevées le ${dateText(data.fetchedAt)} · prix à confirmer sur chaque fiche`);renderProducts(els.promos,products);}catch(e){setStatus(els.promoStatus,e.message);}
}

async function openDetail(summary){
  previousView=activeView; switchView('detailView',true); els.detailContent.replaceChildren();setStatus(els.detailStatus,'Vérification du prix et du stock actuels…','loading');
  try{let detail=state.cache.details[summary.seoId];const fresh=detail&&Date.now()-(detail._savedAt||0)<15*60*1000;if(!fresh){detail=await call('get_product',{seoId:summary.seoId},'seoId');detail._savedAt=Date.now();state.cache.details[summary.seoId]=detail;saveState();}setStatus(els.detailStatus,'');renderDetail(detail,summary);}catch(e){setStatus(els.detailStatus,e.message);}
}
function renderDetail(p,summary){
  els.title.textContent='Fiche produit'; const wrap=document.createElement('div');
  const imgs=(Array.isArray(p.images)&&p.images.length?p.images:[summary.imageUrl]).filter(Boolean);const hero=document.createElement('div');hero.className='detail-hero';const strip=document.createElement('div');strip.className='image-strip';strip.setAttribute('aria-label','Images du produit');imgs.forEach((url,i)=>{const s=document.createElement('div');s.className='image-slide';s.append(makeImg(url,`${p.name}, image ${i+1}`));strip.append(s)});hero.append(strip);
  const features=p.technicalFeatures&&typeof p.technicalFeatures==='object'?Object.entries(p.technicalFeatures):[];const seller=typeof p.seller==='object'?p.seller.name:p.seller;
  const body=document.createElement('div');body.className='detail-body';body.innerHTML=`<div class="detail-brand">${esc(p.brand||'Marketplace')}</div><h1>${esc(p.name)}</h1><div class="detail-price">${money(p.priceEur)}</div>${p.listPriceEur?`<div class="old-price">Prix précédent ${money(p.listPriceEur)}</div>`:''}<div class="confirmed">✓ Prix et stock vérifiés ${p.fetchedAt?'le '+dateText(p.fetchedAt):'à l’instant'}</div><div class="availability"><div><b>${p.inStock?'En stock':'Indisponible'}</b><span>${p.condition||'État non précisé'}</span></div><div><b>Livraison estimée</b><span>${dateText(p.earliestDeliveryDate)}</span></div></div><div class="detail-actions"><a class="buy-link" href="${esc(p.url)}" target="_blank" rel="noopener">Ouvrir sur Orange ↗</a><button class="detail-compare" type="button" aria-label="Ajouter ou retirer de la comparaison">⇄</button></div><p class="description">${esc(p.longDescription||p.description||'Aucune description détaillée fournie.')}</p><section class="specs"><h2>Caractéristiques</h2><dl><div class="spec-row"><dt>Vendeur</dt><dd>${esc(seller||'Non précisé')}</dd></div><div class="spec-row"><dt>État</dt><dd>${esc(p.condition||'Non précisé')}</dd></div><div class="spec-row"><dt>Couleur</dt><dd>${esc(p.color||'Non précisée')}</dd></div>${p.ean?`<div class="spec-row"><dt>EAN</dt><dd>${esc(p.ean)}</dd></div>`:''}${features.map(([k,v])=>`<div class="spec-row"><dt>${esc(k)}</dt><dd>${esc(Array.isArray(v)?v.join(', '):v)}</dd></div>`).join('')}</dl></section>`;
  body.querySelector('.detail-compare').addEventListener('click',e=>toggleCompare({...summary,...p,imageUrl:imgs[0],seller},e.currentTarget));wrap.append(hero,body);els.detailContent.replaceChildren(wrap);
}

async function renderCompare(){
  if(!state.compare.length){setStatus(els.compareStatus,'');els.compareContent.innerHTML='<div class="empty-state"><strong>Rien à comparer pour l’instant</strong><p>Ajoutez jusqu’à quatre produits depuis une recherche ou les promotions.</p><button type="button" class="primary" id="goSearch">Rechercher un produit</button></div>';$('goSearch').addEventListener('click',()=>switchView('searchView'));return;}
  els.compareContent.replaceChildren();setStatus(els.compareStatus,'Vérification des fiches produit…','loading');
  const products=[];
  await Promise.all(state.compare.map(async summary=>{try{let d=state.cache.details[summary.seoId];if(!d||Date.now()-(d._savedAt||0)>15*60*1000){d=await call('get_product',{seoId:summary.seoId},'seoId');d._savedAt=Date.now();state.cache.details[summary.seoId]=d;}products.push({...summary,...d,imageUrl:d.images?.[0]||summary.imageUrl});}catch{products.push(summary);}}));
  saveState();products.sort((a,b)=>state.compare.findIndex(x=>x.seoId===a.seoId)-state.compare.findIndex(x=>x.seoId===b.seoId));setStatus(els.compareStatus,'Faites glisser le tableau pour voir toutes les colonnes.');buildCompareTable(products);
}
function buildCompareTable(products){
  const featureNames=[...new Set(products.flatMap(p=>Object.keys(p.technicalFeatures||{})))].slice(0,8);const rows=[['Prix',p=>`<span class="compare-price">${money(p.priceEur)}</span>`],['Vendeur',p=>esc(typeof p.seller==='object'?p.seller.name:p.seller||'—')],['Stock',p=>p.inStock===true?'En stock':p.inStock===false?'Indisponible':'À vérifier'],['Livraison',p=>esc(dateText(p.earliestDeliveryDate))],['État',p=>esc(p.condition||(p.refurbished?'Reconditionné':'Neuf'))],...featureNames.map(name=>[name,p=>esc(Array.isArray(p.technicalFeatures?.[name])?p.technicalFeatures[name].join(', '):p.technicalFeatures?.[name]||'—')])];
  const scroll=document.createElement('div');scroll.className='compare-scroll';const table=document.createElement('div');table.className='compare-table';table.style.setProperty('--cols',products.length);const head=document.createElement('div');head.className='compare-row';head.innerHTML='<div class="compare-label">Produit</div>'+products.map(p=>`<div class="compare-head">${esc(p.name)}<button class="remove-compare" data-id="${esc(p.seoId)}" aria-label="Retirer ${esc(p.name)}">×</button></div>`).join('');table.append(head);rows.forEach(([label,get])=>{const row=document.createElement('div');row.className='compare-row';row.innerHTML=`<div class="compare-label">${esc(label)}</div>`+products.map(p=>`<div>${get(p)}</div>`).join('');table.append(row)});scroll.append(table);els.compareContent.replaceChildren(scroll);table.querySelectorAll('.remove-compare').forEach(b=>b.addEventListener('click',()=>{const p=state.compare.find(x=>x.seoId===b.dataset.id);if(p)toggleCompare(p,b)}));
}

function switchView(id,detail=false){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));activeView=id;window.scrollTo({top:0,behavior:'instant'});const isDetail=id==='detailView';els.back.classList.toggle('hidden',!isDetail);els.filter.classList.toggle('hidden',id!=='searchView'||isDetail);els.tabs.classList.toggle('hidden',isDetail);els.title.textContent=isDetail?'Fiche produit':id==='searchView'?'Le Marché':id==='promoView'?'Promotions':'Comparateur';document.querySelectorAll('.tab').forEach(t=>{const on=t.dataset.view===id;t.classList.toggle('active',on);on?t.setAttribute('aria-current','page'):t.removeAttribute('aria-current')});if(id==='compareView')renderCompare();if(id==='promoView'&&!els.promos.children.length){const key=$('promoCategory').value||'all';if(state.cache.promos[key]?.products?.length)renderProducts(els.promos,state.cache.promos[key].products);}
}

$('searchForm').addEventListener('submit',e=>{e.preventDefault();search()});
els.filter.addEventListener('click',()=>{const hidden=els.filterPanel.classList.toggle('hidden');els.filter.setAttribute('aria-expanded',String(!hidden));});
$('applyFilters').addEventListener('click',()=>{els.filterPanel.classList.add('hidden');els.filter.setAttribute('aria-expanded','false');search()});
$('resetFilters').addEventListener('click',()=>{applyFiltersToUI({});$('categoryFilter').value='';state.filters={};saveState();});
$('loadPromos').addEventListener('click',()=>loadPromos(true));
$('promoCategory').addEventListener('change',()=>loadPromos(false));
els.back.addEventListener('click',()=>switchView(previousView));
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchView(t.dataset.view)));
document.querySelectorAll('[data-query]').forEach(b=>b.addEventListener('click',()=>{els.query.value=b.dataset.query;search(b.dataset.query)}));

applyFiltersToUI(state.filters||{});renderRecents();showCachedSearch();updateBadge();
