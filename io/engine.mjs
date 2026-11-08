// Input/output examples: runs a repo's real functions on inputs made from a fixed seed, so
// the same 200 examples come out every time. `npm run ios` writes io/ios.txt (to read) and
// io/ios.jsonl (one example a line); test/ios.test.js runs them again and checks nothing
// changed. Cases are in io/cases.mjs: { name, run(...args), make(rnd) => args }.

// A small seeded random number generator (mulberry32), with helpers.
export function seeded(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rnd = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
    some: (xs, lo, hi) => Array.from({ length: rnd.int(lo, hi) }, () => rnd.pick(xs)),
    words: (lo, hi) => rnd.some(WORDS, lo, hi).join(' '),
    sentence: () => { const w = rnd.words(3, 9); return w[0].toUpperCase() + w.slice(1) + '.'; }
  };
  return rnd;
}

export const WORDS = ['apple', 'happy', 'student', 'writes', 'reads', 'the', 'a', 'book', 'garden', 'music', 'logic', 'thinks', 'runs', 'quickly', 'green', 'tree', 'teacher', 'finds', 'idea', 'and', 'with', 'about', 'algorithm', 'prolog', 'list', 'number', 'sells', 'buys', 'meditates', 'person', 'house', 'blue', 'simple', 'proof', 'true', 'false', 'data', 'value', 'cat', 'dog'];

// Plain data for JSON: numbers kept short, no undefined, Maps/Sets as arrays, Uint8Arrays as bytes.
export function plain(x, depth = 0) {
  if (depth > 12) return '…';
  if (x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 + 0 : String(x);
  if (typeof x === 'bigint') return String(x);
  if (typeof x === 'function') return `[function ${x.name || ''}]`.trim();
  if (x === null || typeof x !== 'object') return x;
  if (x instanceof Uint8Array) return { bytes: x.length, start: [...x.slice(0, 24)] };
  if (x instanceof Map) return [...x].map(([k, v]) => [plain(k, depth + 1), plain(v, depth + 1)]);
  if (x instanceof Set) return [...x].map((v) => plain(v, depth + 1));
  if (Array.isArray(x)) return x.map((v) => plain(v, depth + 1));
  const out = {};
  for (const k of Object.keys(x)) if (x[k] !== undefined && typeof x[k] !== 'function') out[k] = plain(x[k], depth + 1);
  return out;
}

// Run each case in turn (round robin) until there are `count` examples.
export async function makeIos(cases, { count = 200, seed = 1 } = {}) {
  const rnd = seeded(seed);
  const ios = [];
  for (let n = 1; n <= count; n++) {
    const c = cases[(n - 1) % cases.length];
    const args = plain(c.make(rnd));
    let output;
    try {
      output = plain(await c.run(...structuredClone(args)));
    } catch (err) {
      output = { error: err.message };
    }
    ios.push({ n, name: c.name, input: args, output });
  }
  return ios;
}

const show = (x) => JSON.stringify(x);

export function toText(ios, title) {
  const lines = [`${title}: ${ios.length} inputs and outputs, from real runs (npm run ios writes this file; npm test checks it).`, ''];
  for (const io of ios) {
    lines.push(`${io.n}. ${io.name}(${io.input.map(show).join(', ')})`);
    lines.push(`   => ${show(io.output)}`);
  }
  return lines.join('\n') + '\n';
}

export const toJsonl = (ios) => ios.map((io) => JSON.stringify(io)).join('\n') + '\n';
