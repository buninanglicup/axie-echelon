// Ported, lightweight subset of agp-npm's gene decoding to detect collectible tags.
// Focused: parse hex genes (256/512) for tag/region/part skins and map to collectible tags.

const Tag = {
  Default: '',
  Origin: 'Origin',
  Meo1: 'MEO',
  Meo2: 'MEO',
  Agamogenesis: 'Agamogenesis',
};

const PartSkin = {
  Global: 'global',
  Mystic: 'mystic',
  Japan: 'japan',
  Xmas1: 'xmas1',
  Xmas2: 'xmas2',
  Bionic: 'bionic',
  Summer: 'summer',
  StrawberrySummer: 'strawberrySummer',
  VanillaSummer: 'vanillaSummer',
  Shiny: 'shiny',
  StrawberryShiny: 'strawberryShiny',
  VanillaShiny: 'vanillaShiny',
};

const SpecialGene = {
  Nightmare: 'Nightmare',
  NightmareShiny: 'NightmareShiny',
};

const Region = {
  Global: 'global',
  Mystic: 'mystic',
  Japan: 'japan',
  Xmas: 'xmas',
  Summer: 'summer',
  StrawberrySummer: 'strawberrySummer',
  VanillaSummer: 'vanillaSummer',
  Shiny: 'shiny',
  StrawberryShiny: 'strawberryShiny',
  VanillaShiny: 'vanillaShiny',
};

const binTagMap = new Map([
  ['00000', Tag.Default],
  ['00001', Tag.Origin],
  ['00010', Tag.Agamogenesis],
  ['00011', Tag.Meo1],
  ['00100', Tag.Meo2],
  ['000000000000000', Tag.Default],
  ['000000000000001', Tag.Origin],
  ['000000000000010', Tag.Meo1],
  ['000000000000011', Tag.Meo2],
]);

const binPartSkinMap = new Map([
  ['00000', PartSkin.Global],
  ['00001', PartSkin.Japan],
  ['010101010101', PartSkin.Xmas1],
  ['01', PartSkin.Bionic],
  ['10', PartSkin.Xmas2],
  ['11', PartSkin.Mystic],
  ['0000', PartSkin.Global],
  ['0001', PartSkin.Mystic],
  ['0011', PartSkin.Japan],
  ['0100', PartSkin.Xmas1],
  ['0101', PartSkin.Xmas2],
  ['0010', PartSkin.Bionic],
  ['0110', PartSkin.Summer],
  ['0111', PartSkin.StrawberrySummer],
  ['1000', PartSkin.VanillaSummer],
  ['1001', PartSkin.Shiny],
  ['1010', PartSkin.StrawberryShiny],
  ['1011', PartSkin.VanillaShiny],
]);

const binSpecialGeneMap = new Map([
  ['1100', SpecialGene.Nightmare],
  ['1101', SpecialGene.NightmareShiny],
]);

const binRegionMap = new Map([
  ['00000', Region.Global],
  ['00001', Region.Japan],
  ['0000', Region.Global],
  ['0001', Region.Mystic],
  ['0011', Region.Japan],
  ['0101', Region.Xmas],
  ['0110', Region.Summer],
  ['0111', Region.StrawberrySummer],
  ['1000', Region.VanillaSummer],
  ['1001', Region.Shiny],
  ['1010', Region.StrawberryShiny],
  ['1011', Region.VanillaShiny],
]);

function hexToBin(hex) {
  hex = String(hex || '');
  hex = hex.replace(/^0x/i, '');
  let hexBin = '';
  for (const c of hex) {
    const v = parseInt(c, 16);
    if (Number.isNaN(v)) return null;
    hexBin += v.toString(2).padStart(4, '0');
  }
  return hexBin;
}

function parseGeneBinGroup(hex, hexType = 256) {
  const hexBin = hexToBin(hex);
  if (!hexBin) return null;
  const padded = hexBin.padStart(hexType, '0');
  if (hexType === 256) {
    return {
      cls: padded.slice(0, 4),
      region: padded.slice(8, 13),
      tag: padded.slice(13, 18),
      bodySkin: padded.slice(18, 22),
      xMas: padded.slice(22, 34),
      pattern: padded.slice(34, 52),
      color: padded.slice(52, 64),
      eyes: padded.slice(64, 96),
      mouth: padded.slice(96, 128),
      ears: padded.slice(128, 160),
      horn: padded.slice(160, 192),
      back: padded.slice(192, 224),
      tail: padded.slice(224, 256),
      specialGenes: [],
    };
  } else {
    // 512
    return {
      cls: padded.slice(0, 5),
      region: padded.slice(22, 40),
      tag: padded.slice(40, 55),
      bodySkin: padded.slice(61, 65),
      xMas: '',
      pattern: padded.slice(65, 92),
      color: padded.slice(92, 110),
      eyes: padded.slice(149, 192),
      mouth: padded.slice(213, 256),
      ears: padded.slice(277, 320),
      horn: padded.slice(341, 384),
      back: padded.slice(405, 448),
      tail: padded.slice(469, 512),
      specialGenes: [
        padded.slice(149, 153),
        padded.slice(213, 217),
        padded.slice(277, 281),
        padded.slice(341, 345),
        padded.slice(405, 409),
        padded.slice(469, 473),
      ],
    };
  }
}

function detectHexType(hex) {
  const s = String(hex || '').replace(/^0x/i, '');
  return s.length > 64 ? 512 : 256;
}

function parsePartSkin(regionBin, skinBin, xMas) {
  if (skinBin === '00' || skinBin === '0000') {
    if (xMas === '010101010101') return PartSkin.Xmas1;
    return binPartSkinMap.get(regionBin) || PartSkin.Global;
  }
  const ret = binPartSkinMap.get(skinBin);
  if (ret) return ret;
  return PartSkin.Global;
}

export function decodeGenes(hex) {
  try {
    const hexType = detectHexType(hex);
    const g = parseGeneBinGroup(hex, hexType);
    if (!g) return null;
    const tagVal = binTagMap.get(g.tag) || '';
    const regionVal = binRegionMap.get(g.region) || Region.Global;

    // extract part skin bins for each part (dominant skin bits)
    const partBins = [];
    if (hexType === 256) {
      partBins.push(g.eyes.slice(0, 2));
      partBins.push(g.ears.slice(0, 2));
      partBins.push(g.horn.slice(0, 2));
      partBins.push(g.mouth.slice(0, 2));
      partBins.push(g.back.slice(0, 2));
      partBins.push(g.tail.slice(0, 2));
    } else {
      partBins.push(g.eyes.slice(0, 4));
      partBins.push(g.ears.slice(0, 4));
      partBins.push(g.horn.slice(0, 4));
      partBins.push(g.mouth.slice(0, 4));
      partBins.push(g.back.slice(0, 4));
      partBins.push(g.tail.slice(0, 4));
    }

    const partSkins = partBins.map((b) => parsePartSkin(g.region, b, g.xMas));
    const specialGenes = g.specialGenes.map((bits) => binSpecialGeneMap.get(bits) || null);

    return {
      tag: tagVal,
      region: regionVal,
      bodySkin: (binRegionMap.get(g.bodySkin) || '').toString(),
      partSkins,
      specialGenes,
      hexType,
    };
  } catch (e) {
    return null;
  }
}

export function detectCollectibleTags(fighter) {
  const tags = new Set();
  const reasons = [];

  const title = String(fighter.title || '').toLowerCase();
  const collectibleText = (value) => {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(collectibleText).join(' ');
    if (typeof value === 'object') return Object.values(value).map(collectibleText).join(' ');
    return String(value).toLowerCase();
  };
  const genes = String(
    fighter.genesMetamorph ||
    fighter.genes_metamorph ||
    fighter.genesmetamorph ||
    fighter.metamorphed_genes ||
    fighter.genes ||
    fighter.gene ||
    fighter.genesHex ||
    ''
  ).toLowerCase();

  // prefer gene decoding when available
  const decoded = decodeGenes(genes);
  if (decoded) {
    if (decoded.tag === Tag.Origin) { tags.add('Origin'); reasons.push('origin (genes)'); }
    if (decoded.tag === Tag.Agamogenesis) { tags.add('Agamogenesis'); reasons.push('agamogenesis (genes)'); }
    // MEO via tag mapping
    if (decoded.tag === Tag.Meo1 || decoded.tag === Tag.Meo2) { tags.add('MEO'); reasons.push('meo (genes)'); }

    // region / partSkins
    if (decoded.region === Region.Japan) { tags.add('Japan'); reasons.push('region'); }
    if (decoded.region === Region.Shiny) { tags.add('Shiny'); reasons.push('region'); }
    if (decoded.region === Region.Xmas) { tags.add('Xmas'); reasons.push('region'); }
    if (decoded.region === Region.Summer || decoded.region === Region.StrawberrySummer || decoded.region === Region.VanillaSummer) { tags.add('Summer'); reasons.push('region'); }

    for (const ps of (decoded.partSkins || [])) {
      if (!ps) continue;
      if (ps === PartSkin.Shiny || ps === PartSkin.StrawberryShiny || ps === PartSkin.VanillaShiny) { tags.add('Shiny'); reasons.push('partSkin'); }
      if (ps === PartSkin.Summer || ps === PartSkin.StrawberrySummer || ps === PartSkin.VanillaSummer) { tags.add('Summer'); reasons.push('partSkin'); }
      if (ps === PartSkin.Japan) { tags.add('Japan'); reasons.push('partSkin'); }
      if (ps === PartSkin.Xmas1 || ps === PartSkin.Xmas2) { tags.add('Xmas'); reasons.push('partSkin'); }
      if (ps === PartSkin.Bionic) { tags.add('Agamogenesis'); reasons.push('bionic part'); }
      if (ps === PartSkin.Mystic) { tags.add('Mystic'); reasons.push('mystic part'); }
    }

    for (const special of (decoded.specialGenes || [])) {
      if (special === SpecialGene.Nightmare || special === SpecialGene.NightmareShiny) {
        tags.add('Nightmare');
        reasons.push('nightmare specialGene');
      }
      if (special === SpecialGene.NightmareShiny) {
        tags.add('Shiny');
        reasons.push('nightmare shiny specialGene');
      }
    }
  }

  // fallback heuristics from title/name/parts
  if (title.includes('origin')) { tags.add('Origin'); reasons.push('origin (title)'); }
  if (title.includes('meo')) { tags.add('MEO'); reasons.push('meo (title)'); }
  if (title.includes('agamo') || title.includes('agamogenesis')) { tags.add('Agamogenesis'); reasons.push('agamogenesis (title)'); }

  const collection = collectibleText(fighter.collection);
  if (collection.includes('agamogenesis') || collection.includes('agamo')) { tags.add('Agamogenesis'); reasons.push('collection'); }
  if (collection.includes('mystic')) { tags.add('Mystic'); reasons.push('collection'); }
  if (collection.includes('christmas') || collection.includes('xmas')) { tags.add('Xmas'); reasons.push('collection'); }
  if (collection.includes('summer')) { tags.add('Summer'); reasons.push('collection'); }

  const parts = Array.isArray(fighter.parts) ? fighter.parts : [];
  for (const p of parts) {
    const combined = ((p.id || '') + ' ' + (p.name || '') + ' ' + (p.type || '') + ' ' + (p.class || '') + ' ' + collectibleText(p.specialGenes)).toLowerCase();
    const partSkin = Number(p.part_skin ?? p.partSkin ?? -1);
    if (partSkin === 12 || partSkin === 13) { tags.add('Nightmare'); reasons.push(`partSkin:${p.id}`); }
    if (partSkin === 13) { tags.add('Shiny'); reasons.push(`partSkin:${p.id}`); }
    if (combined.includes('japan')) { tags.add('Japan'); reasons.push(`part:${p.id}`); }
    if (combined.includes('mystic')) { tags.add('Mystic'); reasons.push(`part:${p.id}`); }
    if (combined.includes('shiny')) { tags.add('Shiny'); reasons.push(`part:${p.id}`); }
    if (combined.includes('summer')) { tags.add('Summer'); reasons.push(`part:${p.id}`); }
    if (combined.includes('xmas') || combined.includes('christmas')) { tags.add('Xmas'); reasons.push(`part:${p.id}`); }
    if (combined.includes('nightmare')) { tags.add('Nightmare'); reasons.push(`part:${p.id}`); }
  }

  return { tags: Array.from(tags), reasons };
}

export default { decodeGenes, detectCollectibleTags };
