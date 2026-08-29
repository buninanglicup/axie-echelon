import geneDecoder from './src/geneDecoder.js';

const ids = ['12097341','2412','99300','11929586','11924408'];

async function fetchDetail(id){
  const r = await fetch(`http://127.0.0.1:8787/api/axie-detail/${id}`);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return j.axie;
}

function heuristicTags(axie){
  const tags = new Set();
  const title = String(axie.title || '').toLowerCase();
  const name = String(axie.name || '').toLowerCase();
  if(title.includes('origin')||name.includes('origin')) tags.add('Origin');
  if(title.includes('meo')||name.includes('meo')) tags.add('MEO');
  if(title.includes('agamo')||name.includes('agamo')||name.includes('agamogenesis')) tags.add('Agamogenesis');
  if(axie.genesMetamorph) tags.add('Morphed');
  const parts = Array.isArray(axie.parts)?axie.parts:[];
  for(const p of parts){
    const combined = ((p.id||'')+' '+(p.name||'')+' '+(p.type||'')+' '+(p.class||'')).toLowerCase();
    if(combined.includes('japan')) tags.add('Japan');
    if(combined.includes('mystic')) tags.add('Mystic');
    if(combined.includes('shiny')) tags.add('Shiny');
    if(combined.includes('summer')) tags.add('Summer');
    if(combined.includes('xmas')||combined.includes('christmas')) tags.add('Xmas');
    if(combined.includes('nightmare')) tags.add('Nightmare');
  }
  return Array.from(tags);
}

(async ()=>{
  for(const id of ids){
    try{
      const ax = await fetchDetail(id);
      const {tags: geneTags, reasons} = geneDecoder.detectCollectibleTags(ax);
      const heur = heuristicTags(ax);
      const merged = Array.from(new Set([...(heur||[]), ...(geneTags||[])]));
      console.log(`=== ${id} ===`);
      console.log('heuristic:', heur);
      console.log('geneTags:', geneTags, 'reasons:', reasons);
      console.log('merged:', merged);
      console.log('\n---\n');
    }catch(e){
      console.log(`=== ${id} ERROR: ${e.message} ===\n`);
    }
  }
})();