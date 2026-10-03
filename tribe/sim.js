/*
 * Flint to Forum — simulation core.
 *
 * No DOM access: the same file runs in the page and under Node (see headless.js).
 * All state lives in one plain object so it can be serialised; anything derived
 * from the terrain (path costs, resource tile lists) is rebuilt by prepare().
 */
(function (root) {
  'use strict';

  const W = 72, H = 48, N = W * H;
  const YEAR = 40;               // sim seconds per year at 1x
  const SEASON = YEAR / 4;
  const TICK = 0.1;

  const DEEP = 0, SHALLOW = 1, RIVER = 2, SAND = 3, GRASS = 4, FOREST = 5, HILLS = 6, MOUNTAIN = 7;
  const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
  const MOVE_COST = [Infinity, Infinity, 2.2, 1.15, 1, 1.5, 1.9, Infinity];
  const FOOD_MAX = [0, 0, 0, 0.6, 3, 5, 0.8, 0];
  const WOOD_MAX = 24, FISH_MAX = 10;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];

  /* ------------------------------------------------------------------ data */

  const ERAS = [
    { name: 'Paleolithic', sub: 'Old Stone Age', real: 'before c. 10,000 BCE',
      intro: '' },
    { name: 'Neolithic', sub: 'New Stone Age', real: 'c. 10,000–3300 BCE',
      intro: 'The Neolithic begins. Seed is saved and sown, and the tribe stops following the herds.' },
    { name: 'Bronze Age', sub: 'Copper and tin', real: 'c. 3300–1200 BCE',
      intro: 'The Bronze Age begins. Smiths pour the first bronze, and with it come wealth and trade.' },
    { name: 'Iron Age', sub: 'Bloomery iron', real: 'c. 1200–500 BCE',
      intro: 'The Iron Age begins. Iron is common where bronze was rare, and every farmer can own a blade.' },
    { name: 'Classical', sub: 'Law and letters', real: 'c. 500 BCE onward',
      intro: 'The Classical age begins. People argue about justice and the shape of the world.' },
  ];

  // act: activities that can spark an inspiration for this tech. insp completes "<name> ...".
  const TECHS = [
    { id: 'knapping', name: 'Stone Knapping', era: 0, cost: 0, req: [],
      desc: 'Flint struck into blades and scrapers. Known from the start.' },
    { id: 'basketry', name: 'Basketry', era: 0, cost: 10, req: ['knapping'], mod: { gather: 1.5 },
      desc: 'Foragers carry half again as much.',
      act: ['forage'], insp: 'wove river reeds into a carrying basket',
      done: 'Reed baskets let foragers bring home far more.' },
    { id: 'spear', name: 'Hafted Spears', era: 0, cost: 12, req: ['knapping'], unlock: 'hunt',
      desc: 'Hunters can bring down deer for meat and hides.',
      act: ['forage'], insp: 'watched wolves corner a deer, then lashed a flint point to a pole',
      done: 'Hunters set out with flint-tipped spears.' },
    { id: 'fire', name: 'Fire Making', era: 0, cost: 15, req: ['knapping'], mod: { consume: 0.85, know: 1.1 }, builds: 'hearth',
      desc: 'Cooked food goes further, and the hearth keeps winter cold away.',
      act: ['forage', 'wood'], insp: 'struck flint over dry moss and kept the spark alive',
      done: 'The first hearth is lit. Meat is cooked and the nights are warmer.' },
    { id: 'shelter', name: 'Shelters', era: 0, cost: 22, req: ['fire'], builds: 'hut',
      desc: 'Huts of branches and hide, five people to each. Fewer die in winter.',
      act: ['wood'], insp: 'propped branches against a fallen trunk to sleep out of the wind',
      done: 'Huts rise around the hearth.' },
    { id: 'oral', name: 'Oral Tradition', era: 0, cost: 26, req: ['fire'], mod: { know: 1.25 },
      desc: 'Stories carry knowledge across generations. Lorekeepers teach the young.',
      act: ['sage'], insp: 'told the tale of the great hunt so well the children could repeat it',
      done: 'Stories by the fire carry what the old know to the young.' },
    { id: 'fishing', name: 'Fishing', era: 0, cost: 20, req: ['basketry'], cond: 'water', unlock: 'fish',
      desc: 'Fishers work the shallows with traps and spears.',
      act: ['forage'], insp: 'left a reed basket in the shallows and found it full of fish',
      done: 'Fish traps line the shallows.' },
    { id: 'hides', name: 'Hide Clothing', era: 0, cost: 24, req: ['spear'], mats: { hides: 6 }, mod: { life: 2 },
      desc: 'Sewn hides cut deaths from winter cold. Uses hides from the hunt.',
      act: ['hunt'], insp: 'scraped a deer hide clean and stitched it with sinew',
      done: 'Hide cloaks are sewn with bone needles.' },
    { id: 'herbal', name: 'Herbal Lore', era: 0, cost: 40, req: ['oral'], mod: { disease: 0.6, infant: 0.7, life: 3 },
      desc: 'Willow bark and poultices. Fewer die of sickness, and fewer infants are lost.',
      act: ['forage', 'sage'], insp: 'chewed willow bark and felt a fever lift',
      done: 'Healers learn which plants cure and which kill.' },
    { id: 'bow', name: 'Bow and Arrow', era: 0, cost: 48, req: ['spear', 'hides'], mod: { hunt: 1.5, accident: 0.4 },
      desc: 'Hunters strike from a distance: more meat and fewer injuries.',
      act: ['hunt'], insp: 'saw how a bent sapling flung a pebble when it sprang back',
      done: 'Bows replace the thrown spear.' },

    { id: 'agriculture', name: 'Cultivation', era: 1, gate: 1, cost: 80, req: ['basketry', 'oral'], unlock: 'farm', builds: 'farm',
      desc: 'Fields of wheat and barley. One farmer feeds several people.',
      act: ['forage'], insp: 'saw wild wheat sprouting where seed had spilled beside the camp',
      done: 'The first fields are cleared and sown.' },
    { id: 'pottery', name: 'Pottery', era: 1, cost: 110, req: ['fire', 'basketry'], cond: 'clay', mats: { clay: 10 }, mod: { spoil: 0.5 }, builds: 'kiln',
      desc: 'Fired clay pots keep food from spoiling. Needs clay.',
      act: ['clay', 'wood', 'sage'], insp: 'found the clay under the hearth baked hard as stone',
      done: 'A kiln is fired. Food keeps through winter in sealed pots.' },
    { id: 'polished', name: 'Polished Axes', era: 1, cost: 110, req: ['agriculture'], mod: { wood: 1.5 },
      desc: 'Ground stone axes fell trees far faster.',
      act: ['wood', 'stone'], insp: 'ground an axe head smooth on river sandstone',
      done: 'Polished axes bite deep into oak.' },
    { id: 'husbandry', name: 'Animal Husbandry', era: 1, cost: 160, req: ['agriculture', 'spear'], unlock: 'herd', builds: 'pen',
      desc: 'Penned goats and cattle give steady meat and hides.',
      act: ['hunt'], insp: 'raised an orphaned calf that followed them everywhere',
      done: 'The first animals are penned and bred.' },
    { id: 'weaving', name: 'Weaving', era: 1, cost: 150, req: ['agriculture', 'basketry'], mod: { carry: 1.1 },
      desc: 'Flax and wool cloth: warmer winters without hides, and stronger sacks.',
      act: ['farm', 'herd'], insp: 'twisted flax fibres into a thread that would not snap',
      done: 'Looms clatter in the doorways.' },
    { id: 'mudbrick', name: 'Mud Brick', era: 1, cost: 170, req: ['pottery'], mats: { clay: 15 }, builds: 'house',
      desc: 'Sun-dried brick houses hold eight. Old huts are rebuilt in brick.',
      act: ['clay', 'build'], insp: 'pressed straw into wet clay and left it to dry in the sun',
      done: 'Brick houses replace the huts one by one.' },
    { id: 'granary', name: 'Granaries', era: 1, cost: 190, req: ['pottery', 'agriculture'], mod: { spoil: 0.45 }, builds: 'granary',
      desc: 'Raised stores keep grain dry and away from mice.',
      act: ['farm'], insp: 'stored grain on stilts and found the mice could not reach it',
      done: 'A granary stands raised on stone feet.' },
    { id: 'megaliths', name: 'Standing Stones', era: 1, cost: 220, req: ['oral', 'agriculture'], mod: { farm: 1.15, know: 1.1 }, builds: 'stones',
      desc: 'A stone calendar marks the solstice and the time to sow.',
      act: ['stone', 'sage'], insp: 'noticed the midsummer sun always rose behind the same peak',
      done: 'Standing stones mark the turning of the year.' },
    { id: 'wheel', name: 'The Wheel', era: 1, cost: 280, req: ['polished', 'pottery'], mod: { carry: 1.4, build: 1.15 },
      desc: 'Carts and the potter’s wheel. Every load is larger.',
      act: ['clay', 'wood', 'build'], insp: 'rolled a heavy log over round branches and thought of a cart',
      done: 'Carts roll along the trails.' },

    { id: 'copper', name: 'Copper Working', era: 2, cost: 420, req: ['pottery'], cond: 'copper', mats: { copper: 10 },
      mod: { wood: 1.15, stone: 1.15, farm: 1.1 }, unlock: 'copper', builds: 'smithy',
      desc: 'Soft copper tools. Miners work the green-stained rock.',
      act: ['stone', 'clay'], insp: 'saw a green stone weep bright metal in the kiln',
      done: 'Copper is smelted and hammered into tools.' },
    { id: 'bronze', name: 'Bronze Casting', era: 2, gate: 2, cost: 700, req: ['copper'], cond: 'tin', mats: { copper: 20, tin: 8 }, mod: { work: 1.2 },
      desc: 'Copper and tin make a hard, keen metal. All work goes faster.',
      act: ['copper', 'tin'], insp: 'melted tin-flecked ore with copper and the blade came out harder',
      done: 'Bronze is cast in stone moulds.' },
    { id: 'irrigation', name: 'Irrigation', era: 2, cost: 650, req: ['agriculture', 'mudbrick'], mod: { farm: 1.4, drought: 0.5 },
      desc: 'Channels from the river. Fields yield more, fear drought less, and can spread from the banks.',
      act: ['farm'], insp: 'dug a ditch from the river and watched a dry field turn green',
      done: 'Ditches carry river water to the fields.' },
    { id: 'sailing', name: 'Sailing', era: 2, cost: 600, req: ['fishing', 'weaving'], cond: 'coast', mod: { fish: 1.6 }, builds: 'dock',
      desc: 'Boats with woven sails fish the open water.',
      act: ['fish'], insp: 'held up a cloak in the wind and felt the raft pull',
      done: 'Sailboats put out from a new dock.' },
    { id: 'writing', name: 'Writing', era: 2, cost: 800, req: ['oral', 'pottery'], mats: { clay: 20 }, mod: { know: 1.5 }, builds: 'hall',
      desc: 'Marks pressed into clay tablets. Scribes keep what memory loses.',
      act: ['sage', 'clay'], insp: 'pressed tally marks into wet clay to count the harvest',
      done: 'Scribes press the first words into clay.' },
    { id: 'plough', name: 'Ox Plough', era: 2, cost: 800, req: ['husbandry', 'wheel'], mod: { farm: 1.4 },
      desc: 'Oxen pull the plough. Each field yields more.',
      act: ['farm', 'herd'], insp: 'hitched an ox to a digging stick',
      done: 'Oxen drag ploughs through the fields.' },
    { id: 'trade', name: 'Trade', era: 2, cost: 800, req: ['wheel', 'pottery'], mod: { know: 1.05 }, unlock: 'caravan',
      desc: 'Caravans arrive with tin, iron and news from distant peoples.',
      act: ['build', 'sage'], insp: 'swapped pots with passing strangers for shells from a far sea',
      done: 'Paths to distant peoples are opened. Caravans will come.' },
    { id: 'math', name: 'Mathematics', era: 2, cost: 1100, req: ['writing'], mod: { know: 1.2, build: 1.25 },
      desc: 'Measures, counts and geometry for builders and stores.',
      act: ['sage', 'build'], insp: 'worked out how many bricks a wall would need before laying one',
      done: 'Scribes reckon areas, volumes and debts.' },

    { id: 'iron', name: 'Iron Smelting', era: 3, gate: 3, cost: 1700, req: ['bronze'], cond: 'iron', mats: { iron: 20, wood: 40 }, mod: { work: 1.2 },
      unlock: 'iron', desc: 'Bloomeries turn red rock into iron, harder and more common than bronze.',
      act: ['iron', 'copper', 'wood'], insp: 'found a spongy lump of metal in the ashes of a roaring fire',
      done: 'The first iron bloom is hammered out.' },
    { id: 'irontools', name: 'Iron Tools', era: 3, cost: 2000, req: ['iron', 'plough'], mod: { farm: 1.3, wood: 1.3, stone: 1.3 },
      desc: 'Iron ploughshares, axes and picks.',
      act: ['farm', 'wood', 'stone'], insp: 'fitted an iron tip to a wooden ploughshare',
      done: 'Iron tools reach every household.' },
    { id: 'masonry', name: 'Masonry', era: 3, cost: 1900, req: ['math', 'bronze'], mats: { stone: 40 }, mod: { build: 1.2 }, builds: 'villa',
      desc: 'Dressed-stone houses hold twelve.',
      act: ['stone', 'build'], insp: 'squared a block so true it needed no mortar',
      done: 'Masons dress stone for houses and walls.' },
    { id: 'medicine', name: 'Medicine', era: 3, cost: 2000, req: ['herbal', 'writing'], mod: { disease: 0.4, infant: 0.5, life: 8 },
      desc: 'Written remedies and clean wounds. People live much longer.',
      act: ['sage'], insp: 'noticed that wounds washed in boiled water healed cleanly',
      done: 'Physicians write down what heals.' },
    { id: 'coinage', name: 'Coinage', era: 3, cost: 2400, req: ['trade', 'iron'], mod: { trade: 1.6, know: 1.1 }, builds: 'market',
      desc: 'Stamped metal makes trade easy. A market opens.',
      act: ['build', 'sage'], insp: 'stamped a mark on bronze rings so no one could dispute their weight',
      done: 'Coins are struck and a market opens.' },

    { id: 'philosophy', name: 'Philosophy', era: 4, gate: 4, cost: 3600, req: ['math', 'coinage'], mod: { know: 1.4 },
      desc: 'Questions asked for their own sake. Knowledge grows faster.',
      act: ['sage'], insp: 'asked why the stars move, and would not accept the old answer',
      done: 'Philosophers gather in the market to argue.' },
    { id: 'law', name: 'Code of Law', era: 4, cost: 3600, req: ['writing', 'coinage'], mod: { work: 1.1 },
      desc: 'Written laws settle disputes. Work runs smoother.',
      act: ['sage'], insp: 'settled a quarrel over a field by reading out the old agreement',
      done: 'The laws are written and set up in public.' },
    { id: 'aqueducts', name: 'Aqueducts', era: 4, cost: 3800, req: ['masonry', 'irrigation'], mod: { disease: 0.6, life: 4, farm: 1.1 }, builds: 'aqueduct',
      desc: 'Clean water from the hills. Crowding no longer breeds sickness.',
      act: ['build', 'stone'], insp: 'traced a spring in the hills that sat higher than the village',
      done: 'An aqueduct brings clean hill water.' },
    { id: 'city', name: 'Founding of the City', era: 4, cost: 6000, req: ['philosophy', 'law', 'masonry'], mats: { stone: 120 }, builds: 'forum',
      desc: 'Walls, a forum and a name on the map. The end of the tribe and the start of a city.',
      done: 'The walls are marked out and the city is founded.' },
  ];
  const TECH = {};
  TECHS.forEach(t => { TECH[t.id] = t; });

  const COND_TEXT = {
    water: 'Needs fishable water near camp',
    coast: 'Needs open water near camp',
    clay: 'Needs a clay bank near camp',
    copper: 'Needs a copper deposit within reach',
    tin: 'Needs tin, from a deposit or traders',
    iron: 'Needs iron ore, from a deposit or traders',
  };

  const BUILD = {
    hearth:   { name: 'Hearth', cost: { wood: 4 }, work: 4 },
    hut:      { name: 'Hut', cost: { wood: 12 }, work: 10, house: 5 },
    house:    { name: 'Brick house', cost: { clay: 12, wood: 4 }, work: 16, house: 8 },
    villa:    { name: 'Stone house', cost: { stone: 18, wood: 6 }, work: 22, house: 12 },
    farm:     { name: 'Field', cost: { wood: 2 }, work: 6 },
    pen:      { name: 'Animal pen', cost: { wood: 10 }, work: 10 },
    kiln:     { name: 'Kiln', cost: { clay: 8, stone: 6 }, work: 12 },
    granary:  { name: 'Granary', cost: { clay: 12, wood: 8 }, work: 16 },
    stones:   { name: 'Standing stones', cost: { stone: 30 }, work: 30 },
    smithy:   { name: 'Smithy', cost: { stone: 15, clay: 8, wood: 8 }, work: 20 },
    dock:     { name: 'Dock', cost: { wood: 24 }, work: 16 },
    hall:     { name: 'Scribe hall', cost: { clay: 24, stone: 12 }, work: 24 },
    market:   { name: 'Market', cost: { wood: 20, stone: 24 }, work: 24 },
    aqueduct: { name: 'Aqueduct', cost: { stone: 60 }, work: 40 },
    forum:    { name: 'Forum', cost: { stone: 80, wood: 20 }, work: 60 },
  };
  const HOUSE_RANK = { hut: 1, house: 2, villa: 3 };

  const JOBS = {
    forage: { label: 'Forager', group: 'food' },
    hunt:   { label: 'Hunter', group: 'food' },
    fish:   { label: 'Fisher', group: 'food' },
    farm:   { label: 'Farmer', group: 'food' },
    herd:   { label: 'Herder', group: 'food' },
    wood:   { label: 'Woodcutter', group: 'mat' },
    stone:  { label: 'Quarrier', group: 'mat' },
    clay:   { label: 'Clay digger', group: 'mat' },
    copper: { label: 'Copper miner', group: 'mat' },
    tin:    { label: 'Tin miner', group: 'mat' },
    iron:   { label: 'Iron miner', group: 'mat' },
    build:  { label: 'Builder', group: 'build' },
    sage:   { label: 'Lorekeeper', group: 'know' },
  };
  const MATS = ['wood', 'stone', 'clay', 'copper', 'tin', 'iron'];
  const ORES = ['copper', 'tin', 'iron'];
  const FOOD_TECHS = new Set(['basketry', 'spear', 'fire', 'fishing', 'bow', 'agriculture', 'pottery', 'husbandry', 'granary', 'irrigation', 'plough', 'sailing', 'irontools']);
  const HOUSE_TECHS = new Set(['shelter', 'mudbrick', 'masonry']);

  /* ------------------------------------------------------------- utilities */

  let S = null;   // the state being stepped
  let C = null;   // its derived cache
  const caches = new WeakMap();

  function makeRng(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rnd() {
    S.rs = (S.rs + 0x6D2B79F5) | 0;
    let t = S.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const idx = (x, y) => y * W + x;
  const tx = i => i % W, ty = i => (i / W) | 0;

  function hash(ix, iy, s) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, oct) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < oct; o++) {
      sum += vnoise(x * f, y * f, s + o * 101) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }

  const ONSET = ['k', 't', 'm', 'n', 's', 'r', 'l', 'b', 'd', 'h', 'w', 'y', 'z', 'sh', 'th', 'g', 'v', 'p'];
  const VOWEL = ['a', 'a', 'e', 'i', 'o', 'u', 'ai', 'ei', 'au', 'ia', 'o', 'e'];
  const CODA = ['n', 'r', 'k', 'l', 'm', 'sh', 't', 's'];
  function makeName(r, syl) {
    for (;;) {
      const n = syl || (r() < 0.6 ? 2 : r() < 0.6 ? 3 : 1);
      let s = '';
      for (let i = 0; i < n; i++) {
        if (!(i === 0 && r() < 0.2)) s += ONSET[(r() * ONSET.length) | 0];
        s += VOWEL[(r() * VOWEL.length) | 0];
      }
      if (n === 1 || r() < 0.35) s += CODA[(r() * CODA.length) | 0];
      if (s.length >= 3 && s.length <= 8) return s[0].toUpperCase() + s.slice(1);
    }
  }

  const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  function dirName(i) {
    const a = Math.atan2(ty(i) - S.cy, tx(i) - S.cx);
    return DIRS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
  }

  /* ------------------------------------------------------------- world gen */

  function quantile(arr, q) {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }

  function dijkstra(ter, src) {
    const dist = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1);
    const hk = [], hv = [];
    const push = (k, v) => {
      let i = hk.length; hk.push(k); hv.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hk[p] <= hk[i]) break;
        [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p;
      }
    };
    const pop = () => {
      const k = hk[0], v = hv[0], lk = hk.pop(), lv = hv.pop();
      if (hk.length) {
        hk[0] = lk; hv[0] = lv;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < hk.length && hk[l] < hk[m]) m = l;
          if (r < hk.length && hk[r] < hk[m]) m = r;
          if (m === i) break;
          [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m;
        }
      }
      return [k, v];
    };
    dist[src] = 0; push(0, src);
    while (hk.length) {
      const [d, i] = pop();
      if (d > dist[i]) continue;
      const x = tx(i), y = ty(i);
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = idx(nx, ny), c = MOVE_COST[ter[j]];
        if (c === Infinity) continue;
        if (k >= 4 && (MOVE_COST[ter[idx(nx, y)]] === Infinity || MOVE_COST[ter[idx(x, ny)]] === Infinity)) continue;
        const nd = d + c * (k >= 4 ? 1.414 : 1);
        if (nd < dist[j]) { dist[j] = nd; par[j] = i; push(nd, j); }
      }
    }
    return { dist, par };
  }

  function genWorld(seed, attempt) {
    const r = makeRng(seed * 31 + attempt * 7919);
    const ns = (seed + attempt * 1013) | 0;
    const ang = r() * Math.PI * 2, sdx = Math.cos(ang), sdy = Math.sin(ang);
    const elev = new Array(N), moist = new Array(N), ter = new Array(N).fill(GRASS);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const nx = x / W - 0.5, ny = (y / H - 0.5) * (H / W);
      const proj = nx * sdx + ny * sdy;
      const e = fbm(x * 0.075, y * 0.075, ns, 5);
      elev[i] = e * 0.6 + (0.5 + proj * 1.15) * 0.4;
      moist[i] = fbm(x * 0.1 + 40, y * 0.1 + 40, ns + 77, 4);
    }
    const qDeep = quantile(elev, 0.15), qShal = quantile(elev, 0.25), qSand = quantile(elev, 0.29),
      qHill = quantile(elev, 0.84), qMtn = quantile(elev, 0.945);
    for (let i = 0; i < N; i++) {
      const e = elev[i];
      ter[i] = e < qDeep ? DEEP : e < qShal ? SHALLOW : e < qSand ? SAND : e < qHill ? GRASS : e < qMtn ? HILLS : MOUNTAIN;
    }
    const landM = [];
    for (let i = 0; i < N; i++) if (ter[i] === GRASS) landM.push(moist[i]);
    const qForest = quantile(landM, 0.55);
    for (let i = 0; i < N; i++) if (ter[i] === GRASS && moist[i] >= qForest) ter[i] = FOREST;

    // Rivers run downhill from the high ground to standing water.
    const rivers = r() < 0.45 ? 2 : 1;
    let made = 0;
    for (let tries = 0; tries < 24 && made < rivers; tries++) {
      const starts = [];
      for (let i = 0; i < N; i++) if ((ter[i] === HILLS || ter[i] === MOUNTAIN) && elev[i] > qHill) starts.push(i);
      if (!starts.length) break;
      let cur = starts[(r() * starts.length) | 0];
      const seen = new Set([cur]), course = [cur];
      let reached = false;
      for (let step = 0; step < 160; step++) {
        const x = tx(cur), y = ty(cur);
        let best = -1, be = Infinity;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], ny = y + DY[k];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = idx(nx, ny);
          if (seen.has(j)) continue;
          if (ter[j] === SHALLOW || ter[j] === DEEP || (ter[j] === RIVER)) { best = j; be = -1; break; }
          const v = elev[j] + r() * 0.015;
          if (v < be) { be = v; best = j; }
        }
        if (best < 0) break;
        if (be === -1) { reached = true; break; }
        cur = best; seen.add(cur); course.push(cur);
      }
      if (reached && course.length >= 10) {
        for (const i of course) ter[i] = RIVER;
        made++;
      }
    }

    const fertile = new Array(N).fill(0), clay = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      if (ter[i] !== RIVER) continue;
      const x = tx(i), y = ty(i);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = idx(nx, ny);
        if (ter[j] === GRASS || ter[j] === SAND || ter[j] === FOREST) fertile[j] = 1;
        if (Math.abs(dx) + Math.abs(dy) === 1 && (ter[j] === GRASS || ter[j] === SAND)) clay[j] = 1;
      }
    }
    for (let i = 0; i < N; i++) {
      if (ter[i] !== SAND) continue;
      const x = tx(i), y = ty(i);
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (ter[idx(nx, ny)] === SHALLOW && hash(x, y, ns + 5) < 0.3) clay[i] = 1;
      }
    }

    // Camp: grassland near water, wood and stone, away from the map edge.
    const near = (x, y, rad, pred) => {
      let best = Infinity;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (pred(ter[idx(nx, ny)])) { const d = Math.hypot(dx, dy); if (d < best) best = d; }
      }
      return best;
    };
    let camp = -1, bestScore = -Infinity;
    for (let y = 8; y < H - 8; y++) for (let x = 9; x < W - 9; x++) {
      const i = idx(x, y);
      if (ter[i] !== GRASS) continue;
      const dWater = near(x, y, 9, t => t === SHALLOW || t === RIVER);
      const dForest = near(x, y, 9, t => t === FOREST);
      const dHills = near(x, y, 20, t => t === HILLS);
      if (dWater < 2 || dWater === Infinity || dForest === Infinity || dHills === Infinity) continue;
      let fert = 0, open = 0;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const j = idx(x + dx, y + dy);
        if (fertile[j]) fert++;
        if (ter[j] === GRASS || ter[j] === SAND) open++;
      }
      const s = -Math.abs(dWater - 4) - Math.max(0, dForest - 4) * 1.5 - Math.max(0, dHills - 11) +
        fert * 0.06 + open * 0.03 + r() * 2;
      if (s > bestScore) { bestScore = s; camp = i; }
    }
    if (camp < 0) return null;

    const { dist } = dijkstra(ter, camp);
    let reach = 0, hillsNear = 0, forestNear = 0;
    for (let i = 0; i < N; i++) {
      if (dist[i] === Infinity) continue;
      reach++;
      if (ter[i] === HILLS && dist[i] < 30) hillsNear++;
      if (ter[i] === FOREST && dist[i] < 16) forestNear++;
    }
    if (reach < 900 || hillsNear < 8 || forestNear < 40) return null;

    // Ore deposits on reachable hills. Copper is always findable; tin and iron
    // are sometimes missing, which leaves traders as the only source.
    const ore = new Array(N).fill(0);
    const hills = [];
    for (let i = 0; i < N; i++) if (ter[i] === HILLS && dist[i] < Infinity) hills.push(i);
    const place = (kind, lo, hi, clusters, size, pred) => {
      let pool = hills.filter(i => !ore[i] && dist[i] >= lo && dist[i] <= hi && (!pred || pred(i)));
      if (!pool.length) pool = hills.filter(i => !ore[i] && (!pred || pred(i)));
      if (!pool.length) pool = hills.filter(i => !ore[i]);
      for (let c = 0; c < clusters && pool.length; c++) {
        let cur = pool[(r() * pool.length) | 0];
        const n = size + ((r() * 3) | 0);
        for (let k = 0; k < n; k++) {
          ore[cur] = kind;
          const x = tx(cur), y = ty(cur), opts = [];
          for (let d = 0; d < 8; d++) {
            const nx = x + DX[d], ny = y + DY[d];
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = idx(nx, ny);
            if (ter[j] === HILLS && !ore[j]) opts.push(j);
          }
          if (!opts.length) break;
          cur = opts[(r() * opts.length) | 0];
        }
      }
    };
    const byMountain = i => {
      const x = tx(i), y = ty(i);
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && ter[idx(nx, ny)] === MOUNTAIN) return true;
      }
      return false;
    };
    place(1, 8, 32, 2, 2);
    if (r() < 0.7) place(2, 16, 48, 1, 2);
    if (r() < 0.85) place(3, 12, 50, 2, 2, byMountain);

    const food = new Array(N).fill(0), wood = new Array(N).fill(0), woodMax = new Array(N).fill(0), fish = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      food[i] = FOOD_MAX[ter[i]] * (0.6 + 0.4 * hash(tx(i), ty(i), ns + 9));
      if (ter[i] === FOREST) { wood[i] = woodMax[i] = WOOD_MAX; }
      if (ter[i] === SHALLOW || ter[i] === RIVER) fish[i] = FISH_MAX * (ter[i] === RIVER ? 0.6 : 1);
    }
    return { ter, elev, fertile, clay, ore, food, wood, woodMax, fish, camp };
  }

  /* ----------------------------------------------------------- derived data */

  function prepare(state) {
    const c = {};
    const { dist, par } = dijkstra(state.ter, state.camp);
    c.dist = dist; c.par = par;
    const reach = i => dist[i] < Infinity;
    const isWater = t => t === SHALLOW || t === RIVER;
    const sortByDist = arr => arr.sort((a, b) => dist[a] - dist[b]);
    c.forage = []; c.forest = []; c.hills = []; c.clay = []; c.shore = []; c.coast = []; c.edge = [];
    c.ore = { copper: [], tin: [], iron: [] };
    c.shoreWater = {};
    for (let i = 0; i < N; i++) {
      if (!reach(i)) continue;
      const t = state.ter[i], x = tx(i), y = ty(i);
      if (FOOD_MAX[t] >= 2) c.forage.push(i);
      if (state.woodMax[i] > 0) c.forest.push(i);
      if (t === HILLS) c.hills.push(i);
      if (state.clay[i]) c.clay.push(i);
      if (state.ore[i]) c.ore[ORES[state.ore[i] - 1]].push(i);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.edge.push(i);
      if (t === RIVER) continue;
      const water = [];
      let sea = false;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = idx(nx, ny);
        if (isWater(state.ter[j])) water.push(j);
        if (state.ter[j] === SHALLOW) sea = true;
      }
      if (water.length) { c.shore.push(i); c.shoreWater[i] = water; }
      if (sea) c.coast.push(i);
    }
    [c.forage, c.forest, c.hills, c.clay, c.shore, c.coast, c.edge, c.ore.copper, c.ore.tin, c.ore.iron].forEach(sortByDist);
    caches.set(state, c);
    return c;
  }

  function bind(state) {
    S = state;
    C = caches.get(state) || prepare(state);
    if (!S.M) computeMods();
  }

  /* -------------------------------------------------------------- creation */

  function create(seed) {
    seed = (seed >>> 0) || 1;
    let world = null;
    for (let a = 0; a < 40 && !world; a++) world = genWorld(seed, a);
    const r = makeRng(seed ^ 0x5bd1e995);
    S = {
      v: 1, seed, W, H,
      ter: world.ter, elev: world.elev, fertile: world.fertile, clay: world.clay, ore: world.ore,
      food: world.food, wood: world.wood, woodMax: world.woodMax, fish: world.fish,
      occ: new Array(N).fill(0), wear: new Array(N).fill(0),
      camp: world.camp, cx: tx(world.camp), cy: ty(world.camp),
      tribe: makeName(r, 2), cityName: null,
      t: 0, yr: 0, si: 0, season: 0, acc: 0, slow: 0, slowN: 0,
      rs: (seed ^ 0x9e3779b9) | 0, nextId: 1,
      people: [], animals: [], buildings: [], traders: [], dead: {},
      known: { knapping: 0 }, by: {}, progress: {}, inspired: {},
      focus: null, auto: true, side: null, waiting: null,
      stock: { food: 36, wood: 0, stone: 0, clay: 0, hides: 0, copper: 0, tin: 0, iron: 0 },
      foodShare: 0.7, hunger: 0, kRate: 0,
      era: 0, eraMarks: [{ era: 0, yr: 0 }],
      log: [], hist: [], fx: [],
      ev: { drought: false, harsh: false, bounty: false },
      yearBirths: 0, yearDeaths: 0, births: 0, deathsTotal: 0, peak: 0,
      reveal: { copper: false, tin: false, iron: false },
      won: null, over: null, M: null,
    };
    caches.delete(S);
    bind(S);

    const ages = [56, 49, 37, 33, 30, 28, 25, 22, 19, 16, 8, 4];
    for (const age of ages) {
      const p = newPerson(makeName(rnd), -age - rnd() * 0.9, []);
      p.life = Math.max(p.life, age + 4 + rnd() * 8 - S.M.life);
      p.founder = true;
      p.deeds.push('One of the founders');
      S.people.push(p);
    }
    const spots = C.forage.filter(i => C.dist[i] > 8 && (S.ter[i] === GRASS || S.ter[i] === FOREST));
    for (let k = 0; k < 34 && spots.length; k++) {
      const i = spots[(rnd() * spots.length) | 0];
      S.animals.push(newAnimal(tx(i) + 0.5, ty(i) + 0.5));
    }
    S.peak = S.people.length;
    log('people', `${S.people.length} people of the ${S.tribe} make camp by the ${nearWaterWord()}.`);
    S.hist.push({ y: 0, pop: S.people.length, food: S.stock.food });
    planJobs();
    return S;
  }

  function nearWaterWord() {
    const s = C.shore[0];
    if (s === undefined) return 'water';
    return C.shoreWater[s].some(j => S.ter[j] === RIVER) ? 'river' : 'shore';
  }

  function lifespan() {
    const g = (rnd() + rnd() + rnd() - 1.5) * 10;
    return Math.max(28, 50 + g);   // the tribe's medicine is added on top as it improves
  }

  function newPerson(name, born, par) {
    return {
      id: S.nextId++, name, born, life: lifespan(), par, kids: 0, job: null,
      x: S.cx + 0.5, y: S.cy + 0.5, ox: (rnd() - 0.5) * 0.5, oy: (rnd() - 0.5) * 0.5,
      task: null, carry: null, deeds: [], founder: false, skin: (rnd() * 4) | 0,
    };
  }

  function newAnimal(x, y) {
    return { id: S.nextId++, x, y, tx: x, ty: y, w: rnd() * 3, claim: 0, frozen: false };
  }

  /* ------------------------------------------------------------------ mods */

  function computeMods() {
    const M = { consume: 1, know: 1, gather: 1, carry: 1, hunt: 1, fish: 1, farm: 1, wood: 1, stone: 1, work: 1, build: 1,
      spoil: 1, disease: 1, infant: 1, life: 0, accident: 1, drought: 1, trade: 1 };
    for (const id in S.known) {
      const m = TECH[id].mod;
      if (!m) continue;
      for (const k in m) { if (k === 'life') M.life += m[k]; else M[k] *= m[k]; }
    }
    S.M = M;
  }
  const has = id => S.known[id] !== undefined;
  const ageOf = p => S.yr - p.born;
  const elderAge = () => Math.min(58, 45 + S.M.life * 0.4);
  function isAvailable(id) {
    const t = TECH[id];
    return !has(id) && t.req.every(has);
  }
  function condMet(id) {
    switch (TECH[id].cond) {
      case 'water': return C.shore.some(i => C.dist[i] < 25);
      case 'coast': return C.coast.some(i => C.dist[i] < 32);
      case 'clay': return C.clay.some(i => C.dist[i] < 30);
      case 'copper': return C.ore.copper.length > 0;
      case 'tin': return C.ore.tin.length > 0 || has('trade');
      case 'iron': return C.ore.iron.length > 0 || has('trade');
      default: return true;
    }
  }

  /* ------------------------------------------------------------------- log */

  function log(c, text) {
    S.logN = (S.logN || 0) + 1;
    S.log.push({ y: S.yr, c, t: text, n: S.logN });
    if (S.log.length > 500) S.log.splice(0, S.log.length - 500);
  }

  /* ---------------------------------------------------------------- paths */

  function chain(i) {
    const out = [i];
    while (i !== S.camp && C.par[i] >= 0) { i = C.par[i]; out.push(i); }
    return out;
  }
  function tilePath(a, b) {
    if (a === b) return [];
    const ca = chain(a), cb = chain(b);
    const pos = new Map();
    ca.forEach((t, k) => pos.set(t, k));
    let k = 0;
    while (k < cb.length && !pos.has(cb[k])) k++;
    if (k >= cb.length) return [b];
    const out = ca.slice(1, pos.get(cb[k]) + 1);
    for (let j = k - 1; j >= 0; j--) out.push(cb[j]);
    return out;
  }
  const tileOf = o => idx(clamp(Math.floor(o.x), 0, W - 1), clamp(Math.floor(o.y), 0, H - 1));
  function setPath(o, to) {
    const tiles = tilePath(tileOf(o), to);
    const pts = [];
    for (const i of tiles) pts.push(tx(i) + 0.5 + (o.ox || 0), ty(i) + 0.5 + (o.oy || 0));
    if (!tiles.length) pts.push(tx(to) + 0.5 + (o.ox || 0), ty(to) + 0.5 + (o.oy || 0));
    o.path = pts; o.pi = 0;
  }
  function follow(o, dist) {
    while (dist > 0 && o.pi < o.path.length) {
      const px = o.path[o.pi], py = o.path[o.pi + 1];
      const dx = px - o.x, dy = py - o.y, d = Math.hypot(dx, dy);
      if (d <= dist) {
        o.x = px; o.y = py; dist -= d; o.pi += 2;
        S.wear[idx(Math.floor(px), Math.floor(py))] += 1;
      } else {
        o.x += dx / d * dist; o.y += dy / d * dist; dist = 0;
      }
    }
    return o.pi >= o.path.length;
  }

  /* --------------------------------------------------------------- economy */

  function consumption() {
    let c = 0;
    for (const p of S.people) c += ageOf(p) < 12 ? 0.6 : 1;
    return c * 4 * S.M.consume;
  }
  function housing() {
    let cap = 16;   // caves and windbreaks
    for (const b of S.buildings) if (b.done && BUILD[b.kind].house) cap += BUILD[b.kind].house;
    return cap;
  }
  function housedFraction() {
    let c = 0;
    for (const b of S.buildings) if (b.done && BUILD[b.kind].house) c += BUILD[b.kind].house;
    return S.people.length ? Math.min(1, c / S.people.length) : 1;
  }
  const count = kind => S.buildings.reduce((n, b) => n + (b.kind === kind || b.up === kind ? 1 : 0), 0);
  const built = kind => S.buildings.filter(b => b.kind === kind && b.done);

  function knowledgeRate() {
    let w = 0, e = 0, s = 0, c = 0;
    const ea = elderAge();
    for (const p of S.people) {
      const a = ageOf(p);
      if (a < 12) c++;
      else if (a >= ea) e++;
      else if (p.job === 'sage') s++;
      else w++;
    }
    return (w * 0.55 + e * 1.4 + s * 2.6 + c * 0.1) * S.M.know;
  }

  function economy(dt) {
    const f = dt / YEAR;
    const st = S.stock;
    st.food -= consumption() * f;
    if (st.food < 0) { st.food = 0; S.hunger += dt / SEASON; } else S.hunger = Math.max(0, S.hunger - 2 * dt / SEASON);
    st.food *= 1 - 0.3 * S.M.spoil * f;
    // Beyond what pots and granaries can hold, food rots quickly.
    const store = consumption() * (1.5 + (has('pottery') ? 0.5 : 0) + built('granary').length);
    if (st.food > store) st.food -= (st.food - store) * 1.5 * f;
    if (S.season === 3 && has('fire')) st.wood = Math.max(0, st.wood - S.people.length * 0.25 * dt / SEASON);
    if (S.season === 3 && has('hides') && !has('weaving')) st.hides = Math.max(0, st.hides - S.people.length * 0.04 * dt / SEASON);
  }

  function slowTick() {
    const dt = 1, M = S.M;
    // regrowth
    const grow = S.season !== 3;
    const dm = S.ev.drought ? 0.45 + 0.55 * (1 - M.drought) : 1;
    for (let i = 0; i < N; i++) {
      const t = S.ter[i];
      if (grow && FOOD_MAX[t] > 0 && !S.occ[i]) S.food[i] = Math.min(FOOD_MAX[t], S.food[i] + FOOD_MAX[t] / (0.75 * YEAR) * dm * dt);
      if (S.woodMax[i] > 0 && S.wood[i] < S.woodMax[i] && !S.occ[i]) S.wood[i] = Math.min(S.woodMax[i], S.wood[i] + 2.5 / YEAR * dt);
      if (t === SHALLOW || t === RIVER) {
        const mx = FISH_MAX * (t === RIVER ? 0.6 : 1);
        if (S.fish[i] < mx) S.fish[i] = Math.min(mx, S.fish[i] + mx * 0.9 / YEAR * dt);
      }
    }
    if (S.season < 2) for (const b of S.buildings) if (b.kind === 'farm' && b.done) b.growth = Math.min(1, b.growth + 0.022 * dm);
    // food workforce follows the stores
    const Cn = Math.max(consumption(), 1);
    const target = Cn * (S.season === 2 ? 0.95 : S.season === 3 ? 0.45 : 0.7);
    const err = (target - S.stock.food) / Cn;
    S.foodShare = clamp(S.foodShare + clamp(err * 0.05, -0.012, 0.05) * dt, 0.15, 0.95);
    if (S.hunger > 0) S.foodShare = Math.max(S.foodShare, 0.85);
    S.kRate = knowledgeRate();
    S.slowN++;
    if (S.slowN % 2 === 0) { planBuildings(); planJobs(); }
    S.peak = Math.max(S.peak, S.people.length);
  }

  /* ------------------------------------------------------------- research */

  function chooseAuto(exclude) {
    let best = null, bs = Infinity;
    const Cn = consumption();
    const short = S.hunger > 0 || S.stock.food < Cn * 0.25;
    const crowded = S.people.length + 2 >= housing();
    for (const t of TECHS) {
      if (t.id === exclude || !isAvailable(t.id) || !condMet(t.id)) continue;
      const pr = S.progress[t.id] || 0;
      if (pr >= t.cost) continue;
      let s = t.cost - pr * 0.8;
      if (t.gate) s *= 0.45;
      if (short && FOOD_TECHS.has(t.id)) s *= 0.5;
      if (crowded && HOUSE_TECHS.has(t.id)) s *= 0.6;
      if (s < bs) { bs = s; best = t.id; }
    }
    return best;
  }

  function matsShort(id) {
    const m = TECH[id].mats;
    if (!m) return null;
    const out = {};
    let any = false;
    for (const k in m) if (S.stock[k] < m[k]) { out[k] = Math.ceil(m[k] - S.stock[k]); any = true; }
    return any ? out : null;
  }

  function research(dt) {
    let k = S.kRate * dt / YEAR;
    let id = S.focus;
    if (!id || has(id) || !isAvailable(id) || !condMet(id)) {
      id = chooseAuto(null);
      S.focus = id; S.auto = true;
    }
    if (!id) { S.side = null; S.waiting = null; return; }
    const t = TECH[id];
    const pr = S.progress[id] || 0;
    if (pr < t.cost) {
      S.progress[id] = Math.min(t.cost, pr + k);
      S.waiting = null; S.side = null;
    } else {
      S.waiting = id;
      const side = chooseAuto(id);
      S.side = side;
      if (side) S.progress[side] = Math.min(TECH[side].cost, (S.progress[side] || 0) + k);
    }
    for (const cand of [id, S.side]) {
      if (!cand || has(cand)) continue;
      if ((S.progress[cand] || 0) >= TECH[cand].cost && !matsShort(cand)) learn(cand);
    }
  }

  function learn(id) {
    const t = TECH[id];
    if (t.mats) for (const k in t.mats) S.stock[k] -= t.mats[k];
    S.known[id] = S.yr;
    computeMods();
    const by = S.by[id];
    log('tech', `${t.name}. ${t.done}${by ? ` First sparked by ${by}.` : ''}`);
    S.fx.push({ k: 'tech', id });
    if (t.gate) {
      S.era = t.gate;
      S.eraMarks.push({ era: t.gate, yr: S.yr });
      log('era', ERAS[t.gate].intro);
      S.fx.push({ k: 'era', era: t.gate });
    }
    if (id === 'city') {
      S.cityName = S.tribe + (/[aeiou]$/.test(S.tribe) ? 'ria' : 'ion');
      S.won = S.yr;
      log('era', `The city of ${S.cityName} is founded in year ${Math.floor(S.yr) + 1}, ${S.people.length} people strong.`);
      S.fx.push({ k: 'won' });
    }
    if (S.focus === id) { S.focus = null; S.auto = true; }
    if (S.waiting === id) S.waiting = null;
    checkReveal();
  }

  function inspire(p, act) {
    if (rnd() > 0.045) return;
    const opts = TECHS.filter(t => t.act && t.act.includes(act) && isAvailable(t.id) && condMet(t.id) &&
      (S.inspired[t.id] || 0) < 2 && (S.progress[t.id] || 0) < t.cost);
    if (!opts.length) return;
    const t = opts[(rnd() * opts.length) | 0];
    S.inspired[t.id] = (S.inspired[t.id] || 0) + 1;
    S.progress[t.id] = Math.min(t.cost, (S.progress[t.id] || 0) + t.cost * 0.3);
    if (!S.by[t.id]) S.by[t.id] = p.name;
    p.deeds.push(`Inspired ${t.name} (year ${Math.floor(S.yr) + 1})`);
    log('idea', `${p.name} ${t.insp}. Work on ${t.name} leaps ahead.`);
  }

  function checkReveal() {
    const go = (kind, text) => {
      S.reveal[kind] = true;
      const list = C.ore[kind];
      if (list.length) log('event', `Prospectors found ${text} in the hills to the ${dirName(list[0])}.`);
      else log('event', `Prospectors searched every hill for ${kind} and found none. It will have to come from traders.`);
    };
    if (!S.reveal.copper && has('pottery')) go('copper', 'green-stained copper ore');
    if (!S.reveal.tin && has('copper')) go('tin', 'heavy dark pebbles of tin ore');
    if (!S.reveal.iron && has('bronze')) go('iron', 'rust-red iron ore');
  }

  /* ----------------------------------------------------------- job planner */

  function materialNeeds() {
    const need = { wood: 0, stone: 0, clay: 0, copper: 0, tin: 0, iron: 0, hides: 0 };
    for (const b of S.buildings) {
      if (b.paid) continue;
      const c = BUILD[b.up || b.kind].cost;
      for (const k in c) need[k] += c[k];
    }
    for (const id of [S.focus, S.waiting, S.side]) {
      if (!id || has(id)) continue;
      const t = TECH[id];
      if (t.mats && (S.progress[id] || 0) >= t.cost * 0.35) for (const k in t.mats) need[k] += t.mats[k];
    }
    const pop = S.people.length;
    if (has('fire')) need.wood += pop * 0.3 + 6;
    if (has('shelter')) need.wood += 12;
    if (has('mudbrick')) need.clay += 12;
    if (has('masonry')) need.stone += 18;
    const out = {};
    for (const k of MATS) out[k] = Math.max(0, need[k] - S.stock[k]);
    return out;
  }
  function canGather(r) {
    if (r === 'wood') return C.forest.length > 0;
    if (r === 'stone') return C.hills.length > 0;
    if (r === 'clay') return C.clay.length > 0;
    return S.reveal[r] && C.ore[r].length > 0;
  }

  function planJobs() {
    const ad = [];
    const ea = elderAge();
    for (const p of S.people) {
      const a = ageOf(p);
      if (a < 12 || a >= ea) p.job = null;
      else ad.push(p);
    }
    const n = ad.length;
    if (!n) return;
    const want = {};
    const add = (j, k) => { if (k > 0) want[j] = (want[j] || 0) + k; };

    let sage = n >= 5 ? 1 : 0;
    if (has('oral')) sage += Math.floor(n / 14);
    if (has('writing')) sage += Math.floor(n / 12);
    if (has('philosophy')) sage += Math.floor(n / 16);
    const Cn = consumption();
    if (S.hunger > 0 || S.stock.food < Cn * 0.3) sage = Math.min(sage, n >= 8 ? 1 : 0);
    sage = Math.min(sage, Math.ceil(n * 0.25));

    const sites = S.buildings.filter(b => b.paid && (!b.done || b.up)).length;
    const build = sites ? Math.max(1, Math.min(Math.ceil(n * 0.3), sites * 2)) : 0;
    const avail = Math.max(0, n - sage - build);
    const floor = Math.ceil(n * (S.stock.food > Cn ? 0.15 : 0.45));
    let food = Math.min(avail, Math.max(floor, Math.round(avail * S.foodShare)));

    const need = materialNeeds();
    let mat = 0;
    const matWant = {};
    for (const r of MATS) {
      if (need[r] <= 0 || !canGather(r)) continue;
      const k = Math.min(Math.ceil(need[r] / 18), 3 + Math.floor(n / 12));
      matWant[r] = k; mat += k;
    }
    let room = avail - food;
    if (mat > room) {
      if (S.hunger <= 0 && room < 1 && mat > 0 && food > 2) { food--; room++; }
      let scale = room / mat;
      mat = 0;
      for (const r in matWant) { matWant[r] = Math.floor(matWant[r] * scale); mat += matWant[r]; }
      // hand out the remainder to the largest needs
      const order = Object.keys(matWant).sort((a, b) => need[b] - need[a]);
      for (const r of order) if (mat < room) { matWant[r]++; mat++; }
    }
    for (const r in matWant) add(r, matWant[r]);
    let rest = avail - food - mat;
    if (rest > 0 && S.hunger <= 0) {
      const comfy = S.stock.food > consumption() * 0.8;
      const extra = Math.min(rest, Math.ceil(rest * (comfy ? 0.4 : 0.25)), Math.max(0, Math.ceil(n * 0.28) - sage));
      sage += extra; rest -= extra;
      const pop = S.people.length;
      // With the stores full, spare hands cut timber, quarry and dig rather than forage.
      const stockUp = [['wood', 25 + pop * 0.5, true], ['stone', 15 + pop * 0.4, has('shelter')], ['clay', 10 + pop * 0.3, has('pottery')]]
        .filter(([r, , ok]) => ok && canGather(r));
      for (const [r, lvl] of stockUp) {
        if (rest <= 0 || S.stock[r] >= (comfy ? lvl * 3 : lvl)) continue;
        const k = Math.min(rest, comfy ? Math.ceil(rest / stockUp.length) + 1 : 1);
        add(r, k); rest -= k;
      }
      // Anyone still spare joins the teachers, up to a third of the workforce.
      const more = Math.min(rest, Math.max(0, Math.ceil(n * 0.34) - sage));
      sage += more; rest -= more;
    }
    // When the stores are already full, the rest are left free: they rest, mend and mind children.
    if (S.stock.food < consumption() * 1.5 || S.hunger > 0) food += Math.max(0, rest);
    add('sage', sage);
    add('build', build);

    let f = food;
    if (has('agriculture')) { const k = Math.min(f, Math.ceil(built('farm').length * 0.5)); add('farm', k); f -= k; }
    if (has('husbandry')) { const k = Math.min(f, built('pen').length); add('herd', k); f -= k; }
    let hunt = 0, fish = 0;
    if (has('spear')) {
      const wild = S.animals.filter(a => C.dist[tileOf(a)] < 40).length;
      hunt = Math.min(Math.round(f * 0.4), Math.floor(wild / 4));
    }
    if (has('fishing')) {
      const cap = Math.min(10, Math.floor(C.shore.filter(i => C.dist[i] < 25).length / 3)) + (built('dock').length ? 8 : 0);
      fish = Math.min(Math.round(f * 0.35), cap);
    }
    add('hunt', hunt); add('fish', fish);
    add('forage', f - hunt - fish);

    const cur = {};
    for (const p of ad) if (p.job) cur[p.job] = (cur[p.job] || 0) + 1;
    const pool = [];
    for (const p of ad) {
      if (!p.job || cur[p.job] > (want[p.job] || 0)) {
        if (p.job) cur[p.job]--;
        pool.push(p); p.job = null;
      }
    }
    for (const j in want) {
      while ((cur[j] || 0) < want[j] && pool.length) {
        const p = pool.pop();
        p.job = j; cur[j] = (cur[j] || 0) + 1;
      }
    }
    for (const p of pool) p.job = null;
  }

  /* ------------------------------------------------------ building planner */

  function findSpot(kind) {
    const cx = S.cx, cy = S.cy;
    let best = -1, bs = Infinity;
    const open = t => t === GRASS || t === SAND || t === FOREST;
    if (kind === 'hearth') return S.occ[S.camp] ? -1 : S.camp;
    if (kind === 'dock') {
      for (const i of C.coast) if (!S.occ[i] && C.dist[i] < 32 && i !== S.camp) return i;
      return -1;
    }
    const irrigated = has('irrigation');
    for (let y = Math.max(0, cy - 17); y <= Math.min(H - 1, cy + 17); y++) {
      for (let x = Math.max(0, cx - 17); x <= Math.min(W - 1, cx + 17); x++) {
        const i = idx(x, y);
        if (i === S.camp || S.occ[i] || C.dist[i] === Infinity) continue;
        const t = S.ter[i];
        const e = Math.hypot(x - cx, y - cy);
        const j = hash(x, y, S.seed + kind.length * 17) * 0.9;
        let s;
        if (kind === 'hut' || kind === 'house' || kind === 'villa') {
          if (!open(t) || e < 1 || e > 8.5) continue;
          s = e + (S.fertile[i] ? 1.5 : 0) + j;
        } else if (kind === 'farm') {
          if (!open(t) || e < 2.5 || e > 16) continue;
          if (t === FOREST && S.wood[i] > 6) continue;
          if (!S.fertile[i] && !irrigated && e > 6) continue;
          s = e * 0.6 + (S.fertile[i] ? 0 : 3) + j;
        } else if (kind === 'pen') {
          if (t !== GRASS || e < 3 || e > 11) continue;
          s = e + (S.fertile[i] ? 2 : 0) + j;
        } else if (kind === 'stones') {
          if (!(open(t) || t === HILLS) || e < 4 || e > 10) continue;
          s = Math.abs(e - 6) + j;
        } else if (kind === 'forum') {
          if (!open(t) || e > 3.5) continue;
          s = e + j * 0.5;
        } else {
          if (!open(t) || e < 1 || e > 6.5) continue;
          s = e + (S.fertile[i] ? 1 : 0) + j * 1.3;
        }
        if (s < bs) { bs = s; best = i; }
      }
    }
    return best;
  }

  function site(kind) {
    const i = findSpot(kind);
    if (i < 0) return null;
    if (S.ter[i] === FOREST) { S.ter[i] = GRASS; S.woodMax[i] = 0; S.wood[i] = 0; }
    const b = { id: S.nextId++, kind, i, x: tx(i), y: ty(i), done: false, up: null, prog: 0, need: BUILD[kind].work, paid: false, t0: S.yr };
    if (kind === 'farm') { b.growth = 0.05; b.pile = 0; b.harv = false; }
    if (kind === 'pen') {
      b.n = 1; b.pile = 0;
      const wild = S.animals.filter(a => C.dist[tileOf(a)] < 40 && !a.claim)
        .sort((a, c) => Math.hypot(a.x - S.cx, a.y - S.cy) - Math.hypot(c.x - S.cx, c.y - S.cy));
      for (let k = 0; k < 2 && k < wild.length; k++) { S.animals.splice(S.animals.indexOf(wild[k]), 1); b.n++; }
    }
    if (kind === 'aqueduct') {
      let src = -1, bd = Infinity;
      for (const h of C.hills) {
        const d = Math.hypot(tx(h) - b.x, ty(h) - b.y);
        if (d < bd) { bd = d; src = h; }
      }
      b.src = src >= 0 ? [tx(src), ty(src)] : [b.x, b.y];
    }
    S.occ[i] = b.id;
    S.buildings.push(b);
    return b;
  }

  function bestHouse() { return has('masonry') ? 'villa' : has('mudbrick') ? 'house' : 'hut'; }

  function planBuildings() {
    const pop = S.people.length;
    const pending = S.buildings.filter(b => !b.done || b.up);
    const limit = 3 + Math.floor(pop / 40);
    const want = [];
    if (has('fire') && !count('hearth')) want.push('hearth');
    if (has('shelter') && pop < 260) {
      let capPending = 0;
      for (const b of pending) if (!b.done && BUILD[b.kind].house) capPending += BUILD[b.kind].house;
      if (pop + 4 > housing() + capPending) want.push(bestHouse());
    }
    if (has('agriculture')) {
      const target = Math.ceil(consumption() * 0.9 / (16 * S.M.farm * S.M.work)) + 1;
      if (count('farm') < Math.min(target, 44)) want.push('farm');
    }
    if (has('husbandry') && count('pen') < Math.min(5, 1 + Math.floor(pop / 35))) want.push('pen');
    for (const id in TECH) {
      const t = TECH[id];
      if (!t.builds || !has(id) || ['hearth', 'hut', 'house', 'villa', 'farm', 'pen'].includes(t.builds)) continue;
      if (!count(t.builds)) want.push(t.builds);
    }
    if (has('granary') && pop > 90 && count('granary') < 2) want.push('granary');

    let room = limit - pending.length;
    for (const k of want) {
      if (room <= 0) break;
      if (site(k)) room--;
    }
    // Rebuild old houses in the newest style once nothing else is waiting.
    const best = bestHouse();
    if (room > 0 && !pending.length && HOUSE_RANK[best] > 1) {
      const old = S.buildings.find(b => b.done && !b.up && HOUSE_RANK[b.kind] && HOUSE_RANK[b.kind] < HOUSE_RANK[best]);
      if (old) { old.up = best; old.prog = 0; old.need = BUILD[best].work; old.paid = false; }
    }
    // Pay for whatever can be afforded, oldest first.
    for (const b of S.buildings) {
      if (b.paid || (b.done && !b.up)) continue;
      const c = BUILD[b.up || b.kind].cost;
      let ok = true;
      for (const k in c) if (S.stock[k] < c[k]) ok = false;
      if (!ok) continue;
      for (const k in c) S.stock[k] -= c[k];
      b.paid = true;
    }
  }

  const FIRSTS = {
    hearth: 'A hearth is built at the centre of the camp.',
    hut: 'The first hut is finished.',
    house: 'The first brick house is finished.',
    villa: 'The first stone house is finished.',
    farm: 'The first field is cleared beside the camp.',
    pen: 'The first animal pen is fenced.',
    kiln: 'A kiln is built for firing pots.',
    granary: 'The granary is finished.',
    stones: 'The standing stones are raised.',
    smithy: 'A smithy is built. Its fire never goes out.',
    dock: 'A wooden dock is built out into the water.',
    hall: 'A hall for scribes and their tablets is finished.',
    market: 'The market square opens.',
    aqueduct: 'Water flows down the aqueduct for the first time.',
    forum: 'The forum is paved. The walls of the city are traced around it.',
  };

  function completeBuilding(b) {
    if (b.up) { b.kind = b.up; b.up = null; b.done = true; b.paid = true; return; }
    b.done = true;
    S.built = S.built || {};
    if (!S.built[b.kind]) { S.built[b.kind] = S.yr; log('build', FIRSTS[b.kind]); }
  }

  /* --------------------------------------------------------------- people */

  function speedOf(p) {
    const a = ageOf(p);
    const base = a < 12 ? 2.0 : a >= elderAge() ? 1.5 : 2.5;
    return base * (p.carry ? 0.9 : 1);
  }

  function pickTile(list, avail, claimKey) {
    const claims = S._claims || (S._claims = {});
    for (const i of list) {
      if (C.dist[i] > 60) break;
      if (!avail(i)) continue;
      const key = claimKey + i;
      if ((claims[key] || 0) >= 2) continue;
      if (rnd() < 0.25) continue;
      claims[key] = (claims[key] || 0) + 1;
      return i;
    }
    return -1;
  }
  function release(p) {
    const t = p.task;
    if (!t) return;
    if (t.claim && S._claims) S._claims[t.claim] = Math.max(0, (S._claims[t.claim] || 1) - 1);
    if (t.act === 'hunt' && t.ref) {
      const a = S.animals.find(x => x.id === t.ref);
      if (a) { a.claim = 0; a.frozen = false; }
    }
  }

  function goTo(p, act, tile, work, extra) {
    p.task = Object.assign({ act, ph: 'out', tile, work, t: 0 }, extra || {});
    setPath(p, tile);
  }
  function goHome(p) {
    release(p);
    p.task = { act: 'home', ph: 'home' };
    setPath(p, S.camp);
  }
  function wander(p, rad, rest) {
    const x = clamp(S.cx + Math.round((rnd() * 2 - 1) * rad), 0, W - 1);
    const y = clamp(S.cy + Math.round((rnd() * 2 - 1) * rad), 0, H - 1);
    let i = idx(x, y);
    if (C.dist[i] === Infinity) i = S.camp;
    p.task = { act: 'idle', ph: 'out', tile: i, work: rest, t: 0 };
    setPath(p, i);
  }

  function sageSpot() {
    const hall = built('hall')[0];
    if (hall) return hall.i;
    const h = built('hearth')[0];
    return h ? h.i : S.camp;
  }

  // Children and people with no work drift between the hearth and the houses.
  function idleAbout(p, rest) {
    const homes = S.buildings.filter(b => b.done && BUILD[b.kind].house);
    if (homes.length && rnd() < 0.65) {
      const h = homes[(rnd() * homes.length) | 0];
      p.task = { act: 'idle', ph: 'out', tile: h.i, work: rest, t: 0 };
      return setPath(p, h.i);
    }
    return wander(p, 3, rest);
  }

  function assignTask(p) {
    const a = ageOf(p);
    if (a < 12) return idleAbout(p, 1.5 + rnd() * 3);
    if (!p.job) return a >= elderAge() ? wander(p, 2, 4 + rnd() * 5) : idleAbout(p, 4 + rnd() * 5);
    const job = p.job;
    const season = S.season;
    switch (job) {
      case 'forage': {
        const i = pickTile(C.forage, j => S.food[j] >= 0.8 && !S.occ[j], 'f');
        if (i < 0) return wander(p, 3, 2);
        return goTo(p, 'forage', i, 3, { claim: 'f' + i });
      }
      case 'wood': {
        const i = pickTile(C.forest, j => S.wood[j] >= 3 && !S.occ[j], 'w');
        if (i < 0) return wander(p, 3, 2);
        return goTo(p, 'wood', i, 4, { claim: 'w' + i });
      }
      case 'stone': {
        const i = pickTile(C.hills, () => true, 's');
        if (i < 0) return wander(p, 3, 2);
        return goTo(p, 'stone', i, 4, { claim: 's' + i });
      }
      case 'clay': {
        const i = pickTile(C.clay, j => !S.occ[j], 'c');
        if (i < 0) return wander(p, 3, 2);
        return goTo(p, 'clay', i, 3.5, { claim: 'c' + i });
      }
      case 'copper': case 'tin': case 'iron': {
        const i = pickTile(C.ore[job], () => true, 'o');
        if (i < 0) return wander(p, 3, 2);
        return goTo(p, job, i, 5, { claim: 'o' + i });
      }
      case 'hunt': {
        let best = null, bd = Infinity;
        for (const an of S.animals) {
          if (an.claim) continue;
          const d = C.dist[tileOf(an)];
          if (d < bd && d < 45) { bd = d; best = an; }
        }
        if (!best) { p.job = 'forage'; return assignTask(p); }
        best.claim = p.id;
        return goTo(p, 'hunt', tileOf(best), 2.5, { ref: best.id, chase: 0 });
      }
      case 'fish': {
        const dock = built('dock')[0];
        if (dock && has('sailing') && rnd() < 0.6) return goTo(p, 'fish', dock.i, 6, { boat: true });
        const i = pickTile(C.shore, j => C.shoreWater[j].some(w => S.fish[w] >= 1) && !S.occ[j], 'h');
        if (i < 0) return wander(p, 3, 2);
        return goTo(p, 'fish', i, 4, { claim: 'h' + i });
      }
      case 'farm': {
        const farms = built('farm');
        if (!farms.length) { p.job = 'forage'; return assignTask(p); }
        let target = null, bs = Infinity;
        for (const b of farms) {
          const busy = S.people.some(q => q !== p && q.task && q.task.ref === b.id);
          const d = Math.hypot(b.x - p.x, b.y - p.y) * 0.02;
          const s = season === 2 ? (b.harv ? 9 : 1 - b.growth) + d + (busy ? 2 : 0)
            : season < 2 ? b.growth + d + (busy ? 0.5 : 0) : 9;
          if (s < bs) { bs = s; target = b; }
        }
        if (season === 3 || (season === 2 && target.harv)) {
          if (S.stock.wood > 60 + S.people.length) return wander(p, 3, 4 + rnd() * 4);
          const i = pickTile(C.forest, j => S.wood[j] >= 3 && !S.occ[j], 'w');
          if (i >= 0) return goTo(p, 'wood', i, 4, { claim: 'w' + i });
          return wander(p, 2, 3);
        }
        return goTo(p, 'farm', target.i, 4, { ref: target.id });
      }
      case 'herd': {
        const pens = built('pen');
        if (!pens.length) { p.job = 'forage'; return assignTask(p); }
        const pen = pens[p.id % pens.length];
        return goTo(p, 'herd', pen.i, 4, { ref: pen.id });
      }
      case 'build': {
        const sites = S.buildings.filter(b => b.paid && (!b.done || b.up));
        if (!sites.length) {
          const i = pickTile(C.forest, j => S.wood[j] >= 3 && !S.occ[j], 'w');
          if (i >= 0) return goTo(p, 'wood', i, 4, { claim: 'w' + i });
          return wander(p, 2, 2);
        }
        const b = sites[p.id % sites.length];
        return goTo(p, 'build', b.i, 5, { ref: b.id });
      }
      case 'sage':
        return goTo(p, 'sage', sageSpot(), 10);
    }
    return wander(p, 2, 3);
  }

  function arrive(p) {
    const t = p.task;
    if (t.ph === 'home') {
      if (p.carry) {
        for (const k in p.carry) S.stock[k] += p.carry[k];
        p.carry = null;
      }
      p.task = null;
      return;
    }
    if (t.act === 'hunt') {
      const an = S.animals.find(x => x.id === t.ref);
      if (!an) return goHome(p);
      if (Math.hypot(an.x - p.x, an.y - p.y) < 1.6) {
        an.frozen = true;
        t.ph = 'work'; t.t = t.work;
        return;
      }
      if (++t.chase > 3) return goHome(p);
      t.tile = tileOf(an);
      setPath(p, t.tile);
      return;
    }
    t.ph = 'work';
    t.t = t.work;
  }

  function seasonMul(kind) {
    const s = S.season;
    let m = 1;
    if (kind === 'forage') m = [0.9, 1.2, 1.35, 0.45][s] * (S.ev.bounty && s === 2 ? 1.5 : 1) * (S.ev.drought && s !== 3 ? 0.6 : 1);
    if (kind === 'fish') m = [1, 1.1, 1, 0.6][s];
    return m;
  }

  function finishWork(p) {
    const t = p.task, M = S.M, i = t.tile;
    const carry = M.carry * M.work;
    switch (t.act) {
      case 'idle':
        p.task = null; return;
      case 'forage': {
        const u = Math.min(S.food[i], 2.5 * M.gather);
        S.food[i] -= u;
        p.carry = { food: u * seasonMul('forage') * M.carry };
        inspire(p, 'forage');
        return goHome(p);
      }
      case 'wood': {
        const u = Math.min(S.wood[i], 3);
        S.wood[i] -= u;
        p.carry = { wood: u * M.wood * carry };
        inspire(p, 'wood');
        return goHome(p);
      }
      case 'stone':
        p.carry = { stone: 3 * M.stone * carry };
        inspire(p, 'stone');
        return goHome(p);
      case 'clay':
        p.carry = { clay: 3 * M.stone * carry };
        inspire(p, 'clay');
        return goHome(p);
      case 'copper': case 'tin': case 'iron':
        p.carry = { [t.act]: 1.6 * carry * (has('irontools') ? 1.3 : 1) };
        inspire(p, t.act);
        return goHome(p);
      case 'hunt': {
        const an = S.animals.find(x => x.id === t.ref);
        if (!an) return goHome(p);
        const chance = Math.min(0.92, 0.55 * (has('bow') ? 1.3 : 1) * (S.season === 3 ? 0.85 : 1));
        if (rnd() < chance) {
          S.animals.splice(S.animals.indexOf(an), 1);
          p.carry = { food: 8 * M.hunt * M.carry, hides: 1 };
          t.ref = 0;
        } else { an.frozen = false; an.claim = 0; t.ref = 0; }
        inspire(p, 'hunt');
        if (rnd() < 0.012 * M.accident) { p.dead = 'was gored on a hunt'; return; }
        return goHome(p);
      }
      case 'fish': {
        let u;
        if (t.boat) u = 3.2;
        else {
          const w = C.shoreWater[i].reduce((a, b) => (S.fish[b] > S.fish[a] ? b : a));
          u = Math.min(S.fish[w], 3);
          S.fish[w] -= u;
        }
        p.carry = { food: u * M.fish * seasonMul('fish') * M.carry };
        inspire(p, 'fish');
        return goHome(p);
      }
      case 'farm': {
        const b = S.buildings.find(x => x.id === t.ref);
        if (!b) { p.task = null; return; }
        if (S.season === 2 && !b.harv) {
          // The harvest goes straight into the stores; the farmer carries the last sheaves home.
          const y = 16 * b.growth * M.farm * M.work * (S.ev.drought ? 0.45 + 0.55 * (1 - M.drought) : 1) * (S.ev.bounty ? 1.2 : 1);
          const take = Math.min(y, 6 * M.carry);
          S.stock.food += y - take;
          S.harvest = (S.harvest || 0) + y;
          b.growth = 0; b.harv = true;
          inspire(p, 'farm');
          p.carry = { food: take };
          return goHome(p);
        }
        if (S.season < 2) b.growth = Math.min(1, b.growth + 0.22 * M.work);
        inspire(p, 'farm');
        p.task = { act: 'idle', ph: 'work', t: 1 + rnd() * 2, work: 2 };
        return;
      }
      case 'herd': {
        const b = S.buildings.find(x => x.id === t.ref);
        if (!b) { p.task = null; return; }
        b.pile += 0.75 * b.n * M.work;
        b.tend = S.yr;
        inspire(p, 'herd');
        if (b.pile >= 3) {
          const take = Math.min(b.pile, 6 * M.carry);
          b.pile -= take;
          p.carry = { food: take, hides: 0.15 * b.n };
          return goHome(p);
        }
        p.task = { act: 'idle', ph: 'work', t: 1 + rnd() * 2, work: 2 };
        return;
      }
      case 'build': {
        const b = S.buildings.find(x => x.id === t.ref);
        if (b && b.paid && (!b.done || b.up)) {
          b.prog += t.work * M.build * M.work;
          if (b.prog >= b.need) completeBuilding(b);
        }
        inspire(p, 'build');
        p.task = null;
        return;
      }
      case 'sage':
        inspire(p, 'sage');
        p.task = null;
        return;
    }
    p.task = null;
  }

  function stepPerson(p, dt) {
    if (!p.task) assignTask(p);
    const t = p.task;
    if (!t) return;
    if (t.ph === 'out' || t.ph === 'home') {
      if (follow(p, speedOf(p) * dt)) arrive(p);
    } else if (t.ph === 'work') {
      t.t -= dt;
      if (t.t <= 0) finishWork(p);
    }
  }

  /* ---------------------------------------------------------- life & death */

  function vital(dt) {
    const f = dt / YEAR, M = S.M;
    const pop = S.people.length;
    // births
    let fertile = 0;
    for (const p of S.people) { const a = ageOf(p); if (a >= 16 && a <= 42) fertile++; }
    const Cn = Math.max(consumption(), 1);
    const ff = clamp(S.stock.food / (Cn * 0.5), 0, 1) * (S.hunger > 0 ? 0 : 1);
    const free = housing() - pop;
    const hf = free >= 2 ? 1 : free > 0 ? 0.5 : 0;
    const rate = fertile / 2 * (pop < 30 ? 0.4 : 0.26) * ff * hf * (pop >= 280 ? 0 : 1);
    if (rnd() < rate * f) birth();

    // deaths
    let cold = 0;
    if (S.season === 3) {
      cold = 0.1;
      if (has('fire') && S.stock.wood > 0) cold *= 0.5;
      if (has('weaving')) cold *= 0.55;
      else if (has('hides') && S.stock.hides > 0) cold *= 0.55;
      cold *= 1 - 0.45 * housedFraction();
      if (S.ev.harsh) cold *= 2.2;
    }
    const crowd = 1 + Math.max(0, pop - 60) / 120 * (has('aqueducts') ? 0.25 : 1);
    const disease = 0.006 * M.disease * crowd;
    const ea = elderAge();
    for (const p of S.people) {
      if (p.dead) continue;
      const a = ageOf(p);
      const frail = a < 5 || a >= ea ? 2.5 : 1;
      const causes = [
        [disease * frail, 'died of a fever'],
        [cold * frail, 'died in the winter cold'],
        [a > p.life + M.life ? 0.6 + (a - p.life - M.life) * 0.4 : 0, 'died of old age'],
        [a < 5 ? 0.04 * M.infant : 0, 'died in infancy'],
        [S.hunger > 0 ? 0.8 * Math.min(2, S.hunger) * (frail > 1 ? 1.6 : 1) : 0, 'starved'],
      ];
      let h = 0;
      for (const c of causes) h += c[0];
      if (rnd() >= h * f) continue;
      let pick = rnd() * h;
      for (const c of causes) { pick -= c[0]; if (pick <= 0) { p.dead = c[1]; break; } }
      if (!p.dead) p.dead = 'died of a fever';
    }
  }

  function birth() {
    const adults = S.people.filter(p => { const a = ageOf(p); return a >= 16 && a <= 42 && !p.dead; });
    if (adults.length < 2) return;
    const a = adults[(rnd() * adults.length) | 0];
    let b = adults[(rnd() * adults.length) | 0];
    if (b === a) b = adults[(adults.indexOf(a) + 1) % adults.length];
    const name = rnd() < 0.3 ? a.name.slice(0, 2 + ((rnd() * 2) | 0)) + makeName(rnd, 1).toLowerCase() : makeName(rnd);
    const p = newPerson(name[0].toUpperCase() + name.slice(1), S.yr, [a.id, b.id]);
    p.x = a.x; p.y = a.y;
    a.kids++; b.kids++;
    S.people.push(p);
    S.yearBirths++; S.births++;
    if (S.people.length < 25) log('people', `${p.name} is born to ${a.name} and ${b.name}.`);
  }

  function bury(p) {
    release(p);
    const age = ageOf(p);
    const rec = { name: p.name, born: p.born, died: S.yr, cause: p.dead, deeds: p.deeds.slice(), kids: p.kids, par: p.par };
    S.dead[p.id] = rec;
    if (age >= 65) rec.deeds.push(`Lived to ${Math.floor(age)}`);
    if (p.kids >= 6) rec.deeds.push(`Parent of ${p.kids}`);
    S.yearDeaths++; S.deathsTotal++;
    const notable = p.deeds.length > 0 || age >= 65 || p.kids >= 6;
    if (S.people.length < 25 || notable) {
      log('death', `${p.name} ${p.dead} at ${Math.floor(age)}.${p.deeds.length && !p.founder ? ' ' + p.deeds[p.deeds.length - 1] + '.' : ''}`);
    }
  }

  /* ---------------------------------------------------------------- events */

  function onSeason() {
    const s = S.season;
    S.hist.push({ y: S.yr, pop: S.people.length, food: Math.round(S.stock.food) });
    for (let i = 0; i < N; i++) S.wear[i] *= 0.8;
    S._claims = {};
    for (const p of S.people) if (p.task && p.task.claim) S._claims[p.task.claim] = (S._claims[p.task.claim] || 0) + 1;
    if (s === 0) {
      if (S.yr >= 1) {
        log('year', `Year ${Math.floor(S.yr)} ends: ${S.yearBirths} born, ${S.yearDeaths} died. ${S.people.length} people.`);
      }
      S.yearBirths = 0; S.yearDeaths = 0;
      S.ev = { drought: false, harsh: false, bounty: false };
      for (const b of S.buildings) {
        if (b.kind === 'farm') { b.harv = false; b.growth = 0.05; }
        if (b.kind === 'pen' && b.done && b.n < 6 && b.tend !== undefined && S.yr - b.tend < 1) b.n++;
      }
      breedAnimals();
      const wild = S.animals.length;
      if (rnd() < (wild < 8 ? 0.35 : 0.08)) {
        const k = 6 + ((rnd() * 6) | 0);
        const edge = C.edge.length ? C.edge[(rnd() * C.edge.length) | 0] : S.camp;
        for (let j = 0; j < k; j++) S.animals.push(newAnimal(tx(edge) + 0.5 + rnd() * 2 - 1, ty(edge) + 0.5 + rnd() * 2 - 1));
        log('event', `A herd of ${k} red deer wanders in from the ${dirName(edge)}.`);
      }
      const free = housing() - S.people.length;
      const struggling = S.people.length < 10;
      if (rnd() < (struggling ? 0.3 : 0.07) && free >= 2 && (struggling || S.stock.food > consumption() * 0.4) && S.people.length < 240) {
        const k = 2 + ((rnd() * 2) | 0);
        const names = [];
        for (let j = 0; j < k; j++) {
          const p = newPerson(makeName(rnd), S.yr - 18 - rnd() * 12, []);
          p.deeds.push(`Arrived as a wanderer (year ${Math.floor(S.yr) + 1})`);
          S.people.push(p); names.push(p.name);
        }
        log('people', `Wanderers ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} ask to join the tribe and are taken in.`);
      }
    }
    if (s === 1 && rnd() < 0.1) { S.ev.drought = true; log('event', has('irrigation') ? 'A dry summer, but the channels keep the fields alive.' : 'Drought. The berries shrivel and the fields wilt.'); }
    if (s === 2 && !S.ev.drought && rnd() < 0.12) { S.ev.bounty = true; log('event', 'A bountiful autumn: nuts, berries and grain in plenty.'); }
    if (s === 3 && rnd() < 0.14) { S.ev.harsh = true; log('event', 'A bitter winter sets in. Snow lies deep around the camp.'); }
    const crowd = Math.max(0, S.people.length - 70) / 1500 * (has('aqueducts') ? 0.2 : 1);
    if (rnd() < 0.025 + crowd) outbreak();
    if (rnd() < 0.012) {
      const id = S.focus;
      if (id) S.progress[id] = Math.min(TECH[id].cost, (S.progress[id] || 0) + TECH[id].cost * 0.1);
      log('event', 'A comet hangs in the sky for a month. The lorekeepers argue over its meaning.');
    }
    if (has('trade') && s === 1 && rnd() < 0.75) caravan();
  }

  function breedAnimals() {
    const n = S.animals.length, cap = 70;
    if (!n) return;
    const k = Math.max(0, Math.round(n * 0.3 * (1 - n / cap))) + (n >= 2 && n < 6 ? 1 : 0);
    for (let j = 0; j < k; j++) {
      const m = S.animals[(rnd() * n) | 0];
      S.animals.push(newAnimal(m.x + rnd() - 0.5, m.y + rnd() - 0.5));
    }
  }

  function outbreak() {
    let k = 0;
    const ea = elderAge();
    for (const p of S.people) {
      const a = ageOf(p);
      const risk = 0.07 * S.M.disease * (a < 5 || a >= ea ? 1.6 : 1);
      if (rnd() < risk) { p.dead = 'died of a fever'; k++; }
    }
    log('event', k ? `A fever spreads through the camp. ${k} ${k === 1 ? 'dies' : 'die'}.` : 'A fever spreads through the camp, but everyone recovers.');
  }

  function caravan() {
    if (!C.edge.length) return;
    const edge = C.edge[(rnd() * Math.ceil(C.edge.length / 3)) | 0];
    const tr = { id: S.nextId++, x: tx(edge) + 0.5, y: ty(edge) + 0.5, ox: 0, oy: 0, ph: 'in', t: 0, home: edge, from: dirName(edge) };
    setPath(tr, S.camp);
    S.traders.push(tr);
  }

  function trade(tr) {
    const mul = S.M.trade;
    const goods = {};
    // Metals the tribe cannot dig for itself come first.
    if (has('copper') && !has('bronze') && S.stock.tin < 8) goods.tin = 10;
    if (has('bronze') && !has('iron') && S.stock.iron < 20) goods.iron = 14;
    const Cn = consumption();
    const parts = [];
    let price = 0;
    for (const k in goods) {
      const n = Math.round(goods[k] * mul);
      S.stock[k] += n; price += n;
      parts.push(`${n} ${k}`);
    }
    if (!parts.length) {
      const lux = ['amber from the cold north', 'salt in sealed jars', 'black obsidian blades', 'sea shells and coral beads',
        'blue lapis stone', 'dyed wool', 'olive oil', 'cedar logs', 'copper ingots', 'painted pottery'];
      parts.push(lux[(rnd() * lux.length) | 0]);
      price = 8;
    }
    let paid;
    if (S.stock.food > Cn * 0.6) { const f = Math.round(price * 1.2); S.stock.food -= f; paid = `${f} food`; }
    else if (S.stock.wood > 30) { const w = Math.round(price * 1.5); S.stock.wood = Math.max(0, S.stock.wood - w); paid = `${w} wood`; }
    else paid = 'promises';
    const id = S.focus;
    if (id && (S.progress[id] || 0) < TECH[id].cost) S.progress[id] = Math.min(TECH[id].cost, (S.progress[id] || 0) + TECH[id].cost * 0.05 * mul);
    log('trade', `A caravan from the ${tr.from} trades ${parts.join(' and ')} for ${paid}, and brings news of distant peoples.`);
  }

  function stepTrader(tr, dt) {
    if (tr.ph === 'stay') {
      tr.t -= dt;
      if (tr.t <= 0) { trade(tr); tr.ph = 'out'; setPath(tr, tr.home); }
      return;
    }
    if (follow(tr, 3.2 * dt)) {
      if (tr.ph === 'in') { tr.ph = 'stay'; tr.t = 4; } else tr.gone = true;
    }
  }

  function stepAnimal(an, dt) {
    if (an.frozen) return;
    if (an.w > 0) { an.w -= dt; return; }
    const dx = an.tx - an.x, dy = an.ty - an.y, d = Math.hypot(dx, dy);
    const sp = 1.1 * dt;
    if (d > sp) { an.x += dx / d * sp; an.y += dy / d * sp; return; }
    an.x = an.tx; an.y = an.ty;
    an.w = 1 + rnd() * 4;
    for (let k = 0; k < 4; k++) {
      const nx = an.x + (rnd() * 2 - 1) * 3, ny = an.y + (rnd() * 2 - 1) * 3;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const t = S.ter[idx(Math.floor(nx), Math.floor(ny))];
      const mt = S.ter[idx(Math.floor((nx + an.x) / 2), Math.floor((ny + an.y) / 2))];
      if ((t !== GRASS && t !== FOREST) || MOVE_COST[mt] === Infinity) continue;
      if (Math.hypot(nx - S.cx, ny - S.cy) < 5) continue;
      if (S.occ[idx(Math.floor(nx), Math.floor(ny))]) continue;
      an.tx = nx; an.ty = ny;
      break;
    }
  }

  /* ------------------------------------------------------------------ tick */

  function tick(dt) {
    S.t += dt;
    S.yr = S.t / YEAR;
    const si = Math.floor(S.t / SEASON);
    if (si !== S.si) { S.si = si; S.season = si % 4; onSeason(); }
    economy(dt);
    research(dt);
    vital(dt);
    for (const p of S.people) if (!p.dead) stepPerson(p, dt);
    for (const an of S.animals) stepAnimal(an, dt);
    for (const tr of S.traders) stepTrader(tr, dt);
    if (S.traders.some(t => t.gone)) S.traders = S.traders.filter(t => !t.gone);
    if (S.people.some(p => p.dead)) {
      for (const p of S.people) if (p.dead) bury(p);
      S.people = S.people.filter(p => !p.dead);
    }
    S.slow += dt;
    if (S.slow >= 1) { S.slow -= 1; slowTick(); }
    if (!S.people.length && !S.over) {
      S.over = S.yr;
      log('era', `The last of the ${S.tribe} is gone. Their hearth goes cold in year ${Math.floor(S.yr) + 1}.`);
      S.fx.push({ k: 'over' });
    }
  }

  function advance(state, sec) {
    bind(state);
    if (S.over) return;
    S.acc += sec;
    let n = 0;
    while (S.acc >= TICK && n < 4000 && !S.over) { tick(TICK); S.acc -= TICK; n++; }
    if (n >= 4000) S.acc = 0;
  }

  /* ------------------------------------------------------------ public API */

  function setFocus(state, id) {
    bind(state);
    if (!TECH[id] || !isAvailable(id) || !condMet(id)) return false;
    S.focus = id; S.auto = false;
    return true;
  }
  function setAuto(state) {
    bind(state);
    S.auto = true;
    S.focus = chooseAuto(null);
  }

  // Read-only views for the interface.
  function view(state) {
    bind(state);
    const ea = elderAge();
    let kids = 0, elders = 0;
    const jobs = {};
    for (const p of S.people) {
      const a = ageOf(p);
      if (a < 12) kids++;
      else if (a >= ea) elders++;
      else if (p.job) jobs[p.job] = (jobs[p.job] || 0) + 1;
    }
    return {
      pop: S.people.length, kids, elders, jobs, cap: housing(), consumption: consumption(),
      sageLabel: has('philosophy') ? 'Philosopher' : has('writing') ? 'Scribe' : 'Lorekeeper',
      elderAge: ea,
    };
  }
  function techState(state, id) {
    bind(state);
    const t = TECH[id];
    if (has(id)) return { s: 'known', yr: S.known[id] };
    const pr = S.progress[id] || 0;
    if (!isAvailable(id)) return { s: 'locked', pr };
    if (!condMet(id)) return { s: 'blocked', pr, why: COND_TEXT[t.cond] };
    return { s: 'open', pr, short: pr >= t.cost ? matsShort(id) : null };
  }
  function personInfo(state, p) {
    bind(state);
    const a = ageOf(p);
    const ea = elderAge();
    const role = a < 12 ? 'Child' : a >= ea ? 'Elder' : p.job === 'sage' ? view(state).sageLabel : p.job ? JOBS[p.job].label : 'Idle';
    let doing = '';
    const t = p.task;
    if (p.carry) {
      const k = Object.keys(p.carry)[0];
      doing = `Carrying ${Math.max(1, Math.round(p.carry[k]))} ${k} home`;
    } else if (t) {
      const map = {
        forage: ['Walking out to forage', 'Gathering berries and roots'],
        wood: ['Heading to the woods', 'Felling timber'],
        stone: ['Walking to the hills', 'Quarrying stone'],
        clay: ['Going to the clay bank', 'Digging clay'],
        copper: ['Walking to the copper diggings', 'Mining copper ore'],
        tin: ['Walking to the tin diggings', 'Mining tin ore'],
        iron: ['Walking to the iron diggings', 'Mining iron ore'],
        hunt: ['Stalking a deer', 'Closing in for the kill'],
        fish: ['Heading to the water', t.boat ? 'Fishing from a boat' : 'Fishing the shallows'],
        farm: ['Walking to the fields', 'Working the field'],
        herd: ['Going to the pens', 'Tending the herd'],
        build: ['Walking to a building site', 'Building'],
        sage: ['Going to teach', has('writing') ? 'Writing on clay tablets' : 'Telling the old stories'],
        idle: [a < 12 ? 'Playing' : 'Wandering', a < 12 ? 'Playing' : 'Resting'],
        home: ['Walking home', 'Walking home'],
      };
      const m = map[t.act] || ['Busy', 'Busy'];
      doing = t.ph === 'work' ? m[1] : m[0];
    }
    const nameOf = id => {
      const q = S.people.find(x => x.id === id);
      return q ? q.name : S.dead[id] ? S.dead[id].name + ' (dead)' : '?';
    };
    return { age: a, role, doing, parents: p.par.map(nameOf) };
  }

  const api = {
    W, H, N, YEAR, SEASON, TICK, SEASONS, ERAS, TECHS, TECH, BUILD, JOBS, COND_TEXT, ORES,
    T: { DEEP, SHALLOW, RIVER, SAND, GRASS, FOREST, HILLS, MOUNTAIN },
    FOOD_MAX, WOOD_MAX, FISH_MAX,
    create, advance, setFocus, setAuto, view, techState, personInfo, prepare,
    hash, dist: state => { bind(state); return C.dist; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TribeSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
