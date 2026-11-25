// Table pictures sent WITH the reply instead of as a link Discord has to fetch afterwards.
// Before: the bot answered with an embed pointing at /api/bjcards?…, then Discord's image proxy went back to Vercel for it,
// often waking up a cold copy of that function, and the picture popped in a second or more after the text.
// Now the picture is drawn here, inside the same call (about 50 ms once warm), and uploaded with the message as table.png.
// If drawing ever takes too long for Discord's 3-second answer window, the reply keeps the old link, so nothing breaks.
const SITE = 'https://www.thepoker.study';
const NAME = 'table.png';
// Old host kept too: buttons on messages sent before the move to thepoker.study (Nov 2026) still carry the old links.
const PICTURE = /^https:\/\/(?:www\.thepoker\.study|thepoker\.study|renpokernight\.vercel\.app)\/api\/(bjcards|roulette)\?/;

let libs;
/** Starts loading the drawing code (satori, resvg, fonts) in the background. Call it early so it overlaps the chip storage calls. */
export function warmPictures() {
  return libs || (libs = Promise.all([import('./_bjcards.js'), import('./_wheel.js')]).catch(e => { libs = null; throw e; }));
}

async function draw(url) {
  const [bj, ro] = await warmPictures();
  const u = new URL(url);
  if (u.pathname === '/api/roulette') {
    const n = +u.searchParams.get('n');
    if (!Number.isInteger(n) || n < 0 || n > 36) throw new Error('bad roulette number');
    return ro.render(n);
  }
  return bj.render(u.searchParams);
}


/** Message data (embeds, components, …) with its table picture drawn and attached. Returns { data, png } or null when there's no picture.
 *  When drawing fails or runs past ms, the embed keeps the link (and old attachments are cleared, so an edited message doesn't keep a stale picture). */
export async function attachPicture(data, ms) {
  const e = data && Array.isArray(data.embeds) ? data.embeds.find(x => x && x.image && PICTURE.test(String(x.image.url))) : null;
  if (!e) return null;
  try {
    if (!(ms > 100)) throw new Error('no time left to draw');
    let timer;
    const png = await Promise.race([draw(e.image.url), new Promise((_, no) => { timer = setTimeout(() => no(new Error('picture took too long')), ms); })]).finally(() => clearTimeout(timer));
    return { data: { ...data, embeds: data.embeds.map(x => x === e ? { ...x, image: { url: 'attachment://' + NAME } } : x), attachments: [{ id: 0, filename: NAME }] }, png };
  } catch (err) {
    console.error('table picture', err.message);
    return { data: { ...data, attachments: [] }, png: null };
  }
}

/** A body for Discord: plain JSON, or multipart with the picture as files[0] when there is one. */
export function discordBody(payload, png) {
  if (!png) return { body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } };
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), NAME);
  return { body: form, headers: {} }; // fetch/Response set the multipart boundary themselves
}

/** Wraps an interaction reply (a JSON Response of type 4 = new message or 7 = edit the clicked message) so its table picture rides along. */
export async function withPicture(res, startedAt) {
  if (!res || !(res.headers.get('content-type') || '').includes('application/json')) return res;
  const text = await res.clone().text();
  if (!text.includes(SITE + '/api/bjcards?') && !text.includes(SITE + '/api/roulette?')) return res;
  let msg; try { msg = JSON.parse(text); } catch (e) { return res; }
  if (msg.type !== 4 && msg.type !== 7) return res;
  // Discord wants the answer within 3 s of the tap; leave room for the upload
  const out = await attachPicture(msg.data, Math.min(1800, 2300 - (Date.now() - startedAt)));
  if (!out) return res;
  const { body, headers } = discordBody({ ...msg, data: out.data }, out.png);
  return new Response(body, { status: res.status, headers });
}
