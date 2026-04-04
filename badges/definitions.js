// Badge definitions — single source of truth for keys/metadata.
// Evaluation logic lives in evaluators.js (achievements) and titles.js (titles).

const BADGE_DEFS = [
  // ---- legend ----
  { key: 'century_club',    name: 'Century Club',        desc: '100 team HRs',                               tier: 'legend', type: 'achievement', sprite: 'HUNDRED' },
  { key: 'double_century',  name: 'Double Century',      desc: '200 team HRs',                               tier: 'legend', type: 'achievement', sprite: 'TWOHUNDRED' },
  { key: 'the_cycle',       name: 'The Cycle',           desc: 'A HR from every position on the same day',   tier: 'legend', type: 'achievement', sprite: 'CYCLE' },

  // ---- rare ----
  { key: 'on_fire',         name: 'On Fire',             desc: '7 straight days with at least one HR',       tier: 'rare',   type: 'achievement', sprite: 'FLAME' },
  { key: 'heater',          name: 'Heater',              desc: 'One of your players homers in 4+ straight games', tier: 'rare', type: 'achievement', sprite: 'THERMO' },
  { key: 'feast',           name: 'Feast',               desc: '5+ HRs in a single day',                     tier: 'rare',   type: 'achievement', sprite: 'MEAT' },
  { key: 'back_to_back_to_back', name: 'Back-to-Back-to-Back', desc: 'One player hits 3+ in one game',      tier: 'rare',   type: 'achievement', sprite: 'THREEBALLS' },
  { key: 'separation',      name: 'Separation',          desc: 'Lead the field by 10+',                      tier: 'rare',   type: 'achievement', sprite: 'CROWN' },
  { key: 'the_climb',       name: 'The Climb',           desc: 'From last place to top 3',                   tier: 'rare',   type: 'achievement', sprite: 'STAIRS' },
  { key: 'eleventh_round_hero', name: '11th Round Hero', desc: 'A last-round pick reaches 10+ HRs',          tier: 'rare',   type: 'achievement', sprite: 'ELEVEN' },
  { key: 'santander_special', name: 'Santander Special', desc: 'Drafted on IL, came back and delivered',     tier: 'rare',   type: 'achievement', sprite: 'MEDIC' },

  // ---- common ----
  { key: 'double_digits',   name: 'Double Digits',       desc: 'Reached 10 team HRs',                        tier: 'common', type: 'achievement', sprite: 'TEN' },
  { key: 'quarter_pounder', name: 'Quarter Pounder',     desc: 'Reached 25 team HRs',                        tier: 'common', type: 'achievement', sprite: 'TWENTYFIVE' },
  { key: 'big_50',          name: 'The Big 5-0',         desc: 'Reached 50 team HRs',                        tier: 'common', type: 'achievement', sprite: 'FIFTY' },
  { key: 'contributor',     name: 'Contributor',         desc: 'Every starting position has at least one HR', tier: 'common', type: 'achievement', sprite: 'CHECKS' },
  { key: 'backstop_bomber', name: 'Backstop Bomber',     desc: 'Most HRs from the C slot',                   tier: 'common', type: 'title',       sprite: 'MASK' },
  { key: 'middle_infield_mashers', name: 'Middle Infield Mashers', desc: 'Most combined 2B+SS HRs',          tier: 'common', type: 'title',       sprite: 'DIAMOND' },
  { key: 'designated_dinger', name: 'Designated Dinger', desc: 'Most DH HRs',                                tier: 'common', type: 'title',       sprite: 'BAT' },

  // ---- shame ----
  { key: 'the_drought',     name: 'The Drought',         desc: '5+ days with nothing',                       tier: 'shame',  type: 'achievement', sprite: 'SKULL' },
  { key: 'famine',          name: 'Famine',              desc: '0 HRs on a day every other team scored',     tier: 'shame',  type: 'achievement', sprite: 'BOWL' },
  { key: 'the_reach',       name: 'The Reach',           desc: 'Fewest HRs from a top-3-round pick',         tier: 'shame',  type: 'title',       sprite: 'REACH' },
  { key: 'carried',         name: 'Carried',             desc: '50%+ of your total from one player',         tier: 'shame',  type: 'title',       sprite: 'BARCHART' },
  { key: 'bench_genius',    name: 'Bench Genius',        desc: 'A bench player out-HRs all your starters',   tier: 'shame',  type: 'title',       sprite: 'BENCH' },
  { key: 'buried',          name: 'Buried',              desc: 'Fell from 1st to 5th or worse in a week',    tier: 'shame',  type: 'achievement', sprite: 'SHOVEL' },
  { key: 'dead_weight',     name: 'Dead Weight',         desc: 'A starter with 0 HRs through June 1',        tier: 'shame',  type: 'achievement', sprite: 'TOMBSTONE' },
  { key: 'participation_trophy', name: 'Participation Trophy', desc: 'Mathematically eliminated',            tier: 'shame',  type: 'achievement', sprite: 'SADTROPHY' },
];

const ACHIEVEMENTS = BADGE_DEFS.filter(b => b.type === 'achievement');
const TITLES = BADGE_DEFS.filter(b => b.type === 'title');

const byKey = Object.fromEntries(BADGE_DEFS.map(b => [b.key, b]));

module.exports = { BADGE_DEFS, ACHIEVEMENTS, TITLES, byKey };
