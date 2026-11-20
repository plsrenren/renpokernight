// One function for every PNG card, instead of one function each.
// Why: every Vercel deployment keeps its own copy of each function, and each picture function carried its own copy of
// satori + resvg (about 3-5 MB zipped). Eight of them per deployment filled the free plan's 10 GB "Function Storage".
// The public links don't change: vercel.json rewrites /api/recap, /api/card, /api/hall, /api/h2h, /api/wrap,
// /api/bjcards, /api/seats and /api/roulette to /api/img?fn=<name> (the original query string comes along).
// The drawing code itself lives in the matching _<name>.js file, unchanged.
const CARDS = {
  recap: () => import('./_recap.js'),
  card: () => import('./_card.js'),
  hall: () => import('./_hall.js'),
  h2h: () => import('./_h2h.js'),
  wrap: () => import('./_wrap.js'),
  bjcards: () => import('./_bjcards.js'),
  seats: () => import('./_seatsimg.js'),
  roulette: () => import('./_wheel.js'),
};

export default async function handler(req, res) {
  const fn = new URL(req.url, 'http://x').searchParams.get('fn');
  const load = Object.hasOwn(CARDS, fn) ? CARDS[fn] : null;
  if (!load) { res.status(404).send('no such picture'); return; }
  return (await load()).default(req, res);
}
