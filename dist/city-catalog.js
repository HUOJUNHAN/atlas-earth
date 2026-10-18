// Shared presentation and search for the two geographic views.
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export const cityName=city=>city.shortName||city.name;
export const cityPlace=city=>city.province||city.country||city.region||'世界城市';
export function observeCityCard(view){
  const card=document.querySelector('.city-card');if(!card||!window.ResizeObserver)return;
  const update=()=>{const h=card.getBoundingClientRect().height;if(h>0)document.body.style.setProperty(`--${view}-city-card-height`,`${h}px`);};
  new ResizeObserver(update).observe(card);update();
}
export function findCityMatches(cities,query,limit=8){
  const q=normalize(query);if(!q)return [];
  return cities.map((city,index)=>{
    const names=[city.name,city.shortName,city.en].filter(Boolean).map(normalize);
    const countries=[city.country,city.countryEn,city.countryCode].filter(Boolean).map(normalize);
    const aliases=[city.province,city.region,...(city.aliases||[])].filter(Boolean).map(normalize);
    let score=Math.max(0,...names.map(s=>s===q?130:s.startsWith(q)?100:s.includes(q)?75:0),...countries.map(s=>s===q?100:s.includes(q)?65:0),...aliases.map(s=>s===q?105:s.includes(q)?55:0));
    if(score&&city.nationalCapital)score+=city.capitalPrimary?18:8;
    // An exact country query still leads to its capital when a different
    // country's city shares the same display name (for example Salvador).
    if(city.capitalPrimary&&countries.includes(q))score+=60;
    return{city,index,score};
  }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(item=>item.city);
}
export function updateCapitalInfo(city,prefix='city'){
  const box=document.getElementById(prefix+'-capital-meta');if(!box)return;
  box.hidden=!city.nationalCapital;
  document.getElementById(prefix+'-capital-role').textContent=city.nationalCapital?[city.country,city.capitalRole||'首都'].filter(Boolean).join(' · '):'';
  const details=document.getElementById(prefix+'-capital-notes');
  details.open=false;details.hidden=!city.capitalNote;
  document.getElementById(prefix+'-capital-note-text').textContent=city.capitalNote||'';
  box.closest('.city-card').scrollTop=0;
}
export function routeDestinations(cities,home,limit=36){
  limit=Math.max(0,Math.floor(limit));
  const eligible=cities.filter(city=>city!==home);if(eligible.length<=limit)return eligible;
  const chosen=[];
  for(const region of ['亚洲','欧洲','非洲','北美洲','南美洲','大洋洲']){
    if(chosen.length>=limit)break;
    const city=eligible.find(c=>c.region===region&&c.capitalPrimary);if(city)chosen.push(city);
  }
  for(let i=0;chosen.length<limit&&i<limit;i++){
    const city=eligible[Math.floor(i*eligible.length/limit)];if(city&&!chosen.includes(city))chosen.push(city);
  }
  for(const city of eligible){if(chosen.length>=limit)break;if(!chosen.includes(city))chosen.push(city);}
  return chosen;
}
