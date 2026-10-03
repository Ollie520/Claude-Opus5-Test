# Flint to Forum

A browser simulation of a small tribe advancing through technology, from a dozen people
knapping flint by a river to a walled city with laws, coinage and an aqueduct. It runs
itself; you watch, follow individual people, and can steer what the tribe studies next.

Open `index.html` in a browser. There is no build step. `sim.js` is loaded beside it and
the fonts come from Google Fonts, with system fallbacks if you are offline.

## What happens

- **A generated world.** Each seed makes a 72×48 tile landscape: sea on one side, rivers
  running downhill from the hills, forests, clay banks along the water, and ore in the
  hills. Copper is always findable; tin and iron are sometimes missing, which leaves
  traders as the only source. The camp is placed on grassland near water, wood and stone.
- **People, not percentages.** Every villager is an agent with a name, parents, an age,
  a lifespan and a job. They walk real paths to forage, hunt deer, fish, fell trees,
  quarry, dig clay, mine, farm, herd, build and teach, and carry what they gather home.
  Paths follow a cost field from the camp, so foot traffic wears visible trails that
  converge on the hearth, and forests near camp thin out as they are cut.
- **Seasons.** Berries grow in spring and summer, fields ripen and are harvested in autumn,
  and winter brings snow, firewood use and cold deaths that fire, clothing and housing
  reduce. Droughts, bitter winters, fevers, bountiful autumns, migrating herds, wanderers
  asking to join, comets and trade caravans arrive as events.
- **Knowledge.** 36 discoveries across five ages: Paleolithic, Neolithic, Bronze, Iron and
  Classical. Lore accrues from everyone, more from elders and most from lorekeepers (later
  scribes, then philosophers), so a larger tribe learns faster. Some discoveries also need
  materials (hides for clothing, clay for pottery and writing, copper and tin for bronze,
  iron and charcoal for smelting) or a feature of the land. People doing the related work
  sometimes have an idea that jumps a discovery ahead, and the chronicle remembers who.
- **A settlement that grows.** Discoveries unlock jobs and buildings. Huts become brick
  houses, then stone houses; fields, pens, a kiln, granary, standing stones, smithy, dock,
  scribe hall, market and aqueduct appear; founding the city lays out a forum and walls.
- **An economy that steers itself.** A planner reassigns work every couple of seconds: a
  feedback loop holds food stores near a seasonal target, material shortfalls for queued
  buildings and pending discoveries pull in woodcutters, quarriers and miners, and spare
  hands go to teaching, or rest once the stores are full.

## Controls

| Input | Action |
| --- | --- |
| Pause, 1×, 3×, 10×, 30× (or space and keys 1–4) | Simulation speed; 1× is one year every 40 seconds |
| Click a person, building or tile | Show who or what it is; people show parents, children, current task and deeds |
| Drag, pinch, Ctrl + scroll, or the map buttons | Pan and zoom; the target button recentres on the camp |
| Knowledge strata | Pick any discovery to read about it; **Study this next** overrides the elders |
| Chronicle filters | All, discoveries, people or events |
| New world | Asks once, then starts a new seed; `#w12345` in the URL loads a specific world |

## Files

- `sim.js` holds the whole simulation and touches no DOM, so it runs under Node too. All
  state lives in one plain object, which is what the page serialises when it hot-reloads.
- `index.html` is the page: the canvas map renderer, panels, chronicle and strata.
- `headless.js` runs worlds without a browser:

```
node tribe/headless.js 23757 120     # one world's chronicle for 120 years
node tribe/headless.js --batch 30    # outcomes and era dates across 30 seeds
node tribe/headless.js --map 23757   # the generated terrain as text
```

The batch mode is how the pacing was tuned. Across 30 seeds every tribe founded its city,
between years 79 and 127 with a median of 92. The median world reaches the Neolithic in
year 12, the Bronze Age in 53, the Iron Age in 67 and the Classical age in 80. A tribe can still die out; small
bands are fragile, which is why wanderers join struggling ones more readily.
