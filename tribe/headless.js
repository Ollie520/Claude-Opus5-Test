#!/usr/bin/env node
/*
 * Runs the simulation without a browser and prints how a world unfolds.
 *
 *   node tribe/headless.js [seed] [years]        one world, with its chronicle
 *   node tribe/headless.js --batch 20 [years]    summary across 20 seeds
 *   node tribe/headless.js --map [seed]          the generated terrain as text
 */
'use strict';
const Sim = require('./sim.js');

const args = process.argv.slice(2);

function run(seed, years, quiet) {
  const S = Sim.create(seed);
  const t0 = Date.now();
  let seen = 0;
  const pops = [];
  for (let y = 0; y < years && !S.over; y++) {
    for (let k = 0; k < 4; k++) Sim.advance(S, Sim.SEASON);
    pops.push(S.people.length);
    if (!quiet) {
      for (; seen < S.log.length; seen++) {
        const e = S.log[seen];
        if (e.c === 'year' && (Math.floor(e.y) % 10)) continue;
        console.log(`${String(Math.floor(e.y) + 1).padStart(4)} ${Sim.SEASONS[Math.floor((e.y % 1) * 4)].padEnd(6)} ${e.c.padEnd(6)} ${e.t}`);
      }
    }
    if (S.won && quiet) break;
  }
  return { S, ms: Date.now() - t0, pops };
}

function summary(S) {
  const eras = S.eraMarks.map(m => `${Sim.ERAS[m.era].name} y${Math.floor(m.yr) + 1}`).join(', ');
  const known = Object.keys(S.known).length;
  return `seed ${S.seed}: pop ${S.people.length} (peak ${S.peak}), ${known}/${Sim.TECHS.length} techs, ` +
    `${S.won ? 'city y' + (Math.floor(S.won) + 1) : S.over ? 'EXTINCT y' + (Math.floor(S.over) + 1) : 'running'} | ${eras}`;
}

if (args[0] === '--map') {
  const S = Sim.create(+args[1] || 1);
  const ch = ['~', '-', '=', '.', ',', 'T', 'n', 'M'];
  for (let y = 0; y < Sim.H; y++) {
    let line = '';
    for (let x = 0; x < Sim.W; x++) {
      const i = y * Sim.W + x;
      line += i === S.camp ? '@' : S.ore[i] ? 'cti'[S.ore[i] - 1] : ch[S.ter[i]];
    }
    console.log(line);
  }
} else if (args[0] === '--batch') {
  const n = +args[1] || 10, years = +args[2] || 220;
  const out = [];
  for (let s = 1; s <= n; s++) {
    const { S, ms } = run(s * 7919, years, true);
    console.log(summary(S) + `  [${ms} ms]`);
    out.push(S);
  }
  const won = out.filter(S => S.won).map(S => S.won);
  const ext = out.filter(S => S.over).length;
  console.log(`\ncities: ${won.length}/${n}, median year ${won.sort((a, b) => a - b)[won.length >> 1] | 0}; extinct: ${ext}`);
} else {
  const seed = +args[0] || 1, years = +args[1] || 200;
  const { S, ms, pops } = run(seed, years, false);
  console.log('\n' + summary(S));
  console.log('pop by decade:', pops.filter((_, i) => i % 10 === 9).join(' '));
  console.log('stock:', Object.entries(S.stock).map(([k, v]) => `${k} ${Math.round(v)}`).join(', '));
  const causes = {};
  for (const id in S.dead) causes[S.dead[id].cause] = (causes[S.dead[id].cause] || 0) + 1;
  console.log('deaths:', JSON.stringify(causes));
  console.log(`${ms} ms`);
}
