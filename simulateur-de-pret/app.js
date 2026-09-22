const KEY='simulateur-pret-state-v1';
const form=document.getElementById('loan-form');
const result=document.getElementById('result');
const amountEl=document.getElementById('amount'), rateEl=document.getElementById('rate'), insuranceEl=document.getElementById('insurance'), durationEl=document.getElementById('duration'), unitEl=document.getElementById('unit');
const euro=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'});
const number=new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
let state=null;
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
function load(){try{const raw=localStorage.getItem(KEY);return raw?JSON.parse(raw):null}catch(e){return null}}
function money(v){return euro.format(v)}
function calculate(values){
  const amount=Number(values.amount), annualRate=Number(values.rate)/100, annualInsurance=Number(values.insurance)/100;
  const months=values.unit==='years'?Number(values.duration)*12:Number(values.duration);
  const monthlyRate=annualRate/12, insurance=amount*annualInsurance/12;
  const base=monthlyRate===0?amount/months:amount*monthlyRate/(1-Math.pow(1+monthlyRate,-months));
  let balance=amount, rows=[], interestTotal=0, capitalTotal=0;
  for(let i=1;i<=months;i++){
    const interest=monthlyRate===0?0:balance*monthlyRate;
    let capital=base-interest;
    if(i===months)capital=balance;
    const payment=capital+interest+insurance;
    balance=Math.max(0,balance-capital); interestTotal+=interest; capitalTotal+=capital;
    rows.push({i,capital,interest,insurance,total:payment});
  }
  return {values,months,monthly:base+insurance,total:capitalTotal+interestTotal+insurance*months,interestTotal,insuranceTotal:insurance*months,rows};
}
function render(data){
  state=data; save();
  result.hidden=false;
  document.getElementById('monthly').textContent=money(data.monthly)+' / mois';
  document.getElementById('summary-note').textContent=`Sur ${data.months} mensualités · assurance incluse`;
  document.getElementById('total-cost').textContent=money(data.total);
  document.getElementById('total-interest').textContent=money(data.interestTotal);
  document.getElementById('total-insurance').textContent=money(data.insuranceTotal);
  document.getElementById('schedule-count').textContent=`${data.months} mensualités détaillées`;
  document.getElementById('schedule-body').innerHTML=data.rows.map(r=>`<tr><td>${r.i}</td><td>${money(r.capital)}</td><td>${money(r.interest)}</td><td>${money(r.insurance)}</td><td>${money(r.total)}</td></tr>`).join('');
}
function values(){return{amount:amountEl.value,rate:rateEl.value,insurance:insuranceEl.value,duration:durationEl.value,unit:unitEl.value}}
form.addEventListener('submit',e=>{e.preventDefault();const v=values();const error=document.getElementById('form-error');if(!v.amount||Number(v.amount)<=0||!v.rate||Number(v.rate)<0||!v.insurance||Number(v.insurance)<0||!v.duration||Number(v.duration)<=0){error.textContent='Vérifiez les champs pour lancer la simulation.';error.hidden=false;return}error.hidden=true;render(calculate(v));result.scrollIntoView({behavior:'smooth',block:'start'})});
document.getElementById('share').addEventListener('click',async()=>{const status=document.getElementById('share-status');if(!state)return;const lines=[`ÉCHÉANCIER — SIMULATEUR DE PRÊT`,`Montant : ${money(Number(state.values.amount))}`,`Taux : ${number.format(Number(state.values.rate))} % · Assurance : ${number.format(Number(state.values.insurance))} %`,`Durée : ${state.months} mois`,`Mensualité : ${money(state.monthly)}`,`Coût total : ${money(state.total)}`,``,`N° | Capital | Intérêts | Assurance | Total`,...state.rows.map(r=>`${r.i} | ${money(r.capital)} | ${money(r.interest)} | ${money(r.insurance)} | ${money(r.total)}`)];try{if(!window.creativeBoard||!creativeBoard.share)throw new Error('share.present');const fileText=lines.join('\n');const fileUrl='data:text/plain;charset=utf-8,'+encodeURIComponent(fileText);await creativeBoard.share.present({text:'Échéancier du simulateur de prêt',url:fileUrl});status.textContent='Échéancier prêt à être partagé ou enregistré dans Fichiers.';status.hidden=false}catch(e){status.textContent='Le partage natif est indisponible. Vous pouvez consulter l’échéancier ci-dessus.';status.hidden=false}});
const saved=load();if(saved&&saved.values){amountEl.value=saved.values.amount;rateEl.value=saved.values.rate;insuranceEl.value=saved.values.insurance;durationEl.value=saved.values.duration;unitEl.value=saved.values.unit||'years';render(saved)}else{amountEl.value='250000';rateEl.value='3.5';insuranceEl.value='0.3';durationEl.value='20'}