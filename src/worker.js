// 1229 Electricals — Cloudflare Worker (API + media + admin auth). Static files are served by the assets binding.
const COOKIE = 'adm';
const TTL = 60 * 60 * 12; // 12h session
const IMG = ['image/webp', 'image/jpeg', 'image/png', 'image/avif', 'image/gif'];
const VID = ['video/mp4', 'video/webm'];
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/avif': 'avif', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const MAX_BYTES = 90 * 1024 * 1024;

const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function isAuthed(req, env) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(COOKIE + '=([^;]+)'));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEq(sig, await hmac(env.AUTH_SECRET, exp));
}
const ip = req => req.headers.get('cf-connecting-ip') || 'x';

async function rateLimit(env, key, max, ttl) {
  const n = Number((await env.STORE.get(key)) || 0);
  if (n >= max) return false;
  await env.STORE.put(key, String(n + 1), { expirationTtl: ttl });
  return true;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      /* ---------- public ---------- */
      if (p === '/api/content' && req.method === 'GET') {
        const c = await env.STORE.get('content');
        if (!c) return json({ empty: true }, 404);
        return new Response(c, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=20' } });
      }

      if (p.startsWith('/media/') && req.method === 'GET') {
        const key = decodeURIComponent(p.slice(7));
        const range = req.headers.get('range');
        let obj;
        if (range) {
          const m = range.match(/bytes=(\d*)-(\d*)/);
          const head = await env.MEDIA.head(key);
          if (!head) return new Response('Not found', { status: 404 });
          let start = m[1] ? +m[1] : Math.max(0, head.size - +m[2]);
          let end = m[1] && m[2] ? Math.min(+m[2], head.size - 1) : head.size - 1;
          obj = await env.MEDIA.get(key, { range: { offset: start, length: end - start + 1 } });
          return new Response(obj.body, {
            status: 206,
            headers: {
              'content-type': head.httpMetadata?.contentType || 'application/octet-stream',
              'content-range': `bytes ${start}-${end}/${head.size}`,
              'content-length': String(end - start + 1),
              'accept-ranges': 'bytes',
              'cache-control': 'public, max-age=31536000, immutable'
            }
          });
        }
        obj = await env.MEDIA.get(key);
        if (!obj) return new Response('Not found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
            'content-length': String(obj.size),
            'accept-ranges': 'bytes',
            'cache-control': 'public, max-age=31536000, immutable',
            etag: obj.httpEtag
          }
        });
      }

      if (p === '/api/lead' && req.method === 'POST') {
        if (!(await rateLimit(env, 'rl:lead:' + ip(req), 5, 3600))) return json({ error: 'Too many requests' }, 429);
        const d = await req.json().catch(() => null);
        if (!d || d.company) return json({ ok: true }); // honeypot
        const clean = (s, n) => String(s || '').slice(0, n);
        const lead = { name: clean(d.name, 80), phone: clean(d.phone, 40), service: clean(d.service, 80), message: clean(d.message, 1000), at: new Date().toISOString() };
        if (!lead.name || !lead.phone) return json({ error: 'Missing fields' }, 400);
        await env.STORE.put(`lead:${Date.now()}:${crypto.randomUUID().slice(0, 6)}`, JSON.stringify(lead));
        return json({ ok: true });
      }

      /* ---------- admin auth ---------- */
      if (p === '/api/admin/login' && req.method === 'POST') {
        const rlk = 'rl:login:' + ip(req);
        if (Number((await env.STORE.get(rlk)) || 0) >= 8) return json({ error: 'Too many attempts. Try again in 10 minutes.' }, 429);
        const d = await req.json().catch(() => ({}));
        const ok = typeof d.password === 'string' && safeEq(await hmac(env.AUTH_SECRET, d.password), await hmac(env.AUTH_SECRET, env.ADMIN_PASSWORD));
        if (!ok) { await rateLimit(env, rlk, 99, 600); return json({ error: 'Wrong password' }, 401); }
        const exp = String(Math.floor(Date.now() / 1000) + TTL);
        const val = encodeURIComponent(exp + '.' + (await hmac(env.AUTH_SECRET, exp)));
        return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=${val}; Path=/; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Strict` });
      }
      if (p === '/api/admin/logout') return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });

      if (p.startsWith('/api/admin/')) {
        if (!(await isAuthed(req, env))) return json({ error: 'Unauthorized' }, 401);
        if (req.method !== 'GET' && req.headers.get('x-requested-with') !== 'admin') return json({ error: 'Bad request' }, 400);

        if (p === '/api/admin/me') return json({ ok: true });

        if (p === '/api/admin/content' && req.method === 'PUT') {
          const body = await req.text();
          if (body.length > 400000) return json({ error: 'Too large' }, 413);
          const d = JSON.parse(body);
          if (!d.brand || !Array.isArray(d.packages) || !d.hero) return json({ error: 'Invalid content' }, 400);
          await env.STORE.put('content', JSON.stringify(d));
          return json({ ok: true });
        }

        if (p === '/api/admin/upload' && req.method === 'POST') {
          const type = (req.headers.get('content-type') || '').split(';')[0];
          if (![...IMG, ...VID].includes(type)) return json({ error: 'Unsupported file type' }, 415);
          const len = Number(req.headers.get('content-length') || 0);
          if (!len || len > MAX_BYTES) return json({ error: 'File too large (max 90MB)' }, 413);
          const base = (url.searchParams.get('name') || 'file').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'file';
          const key = `${Date.now().toString(36)}-${base}.${EXT[type]}`;
          await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: type } });
          return json({ ok: true, key, url: '/media/' + key, type: type.startsWith('video') ? 'video' : 'image', size: len });
        }

        if (p === '/api/admin/media' && req.method === 'GET') {
          const l = await env.MEDIA.list({ limit: 500 });
          const items = l.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded, url: '/media/' + o.key, type: /\.(mp4|webm)$/.test(o.key) ? 'video' : 'image' }));
          items.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
          return json({ items });
        }
        if (p === '/api/admin/media' && req.method === 'DELETE') {
          await env.MEDIA.delete(url.searchParams.get('key') || '');
          return json({ ok: true });
        }

        if (p === '/api/admin/leads' && req.method === 'GET') {
          const l = await env.STORE.list({ prefix: 'lead:', limit: 200 });
          const items = await Promise.all(l.keys.map(async k => ({ key: k.name, ...JSON.parse((await env.STORE.get(k.name)) || '{}') })));
          items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
          return json({ items });
        }
        if (p === '/api/admin/leads' && req.method === 'DELETE') {
          const k = url.searchParams.get('key') || '';
          if (k.startsWith('lead:')) await env.STORE.delete(k);
          return json({ ok: true });
        }
        return json({ error: 'Not found' }, 404);
      }
    } catch (e) {
      return json({ error: 'Server error' }, 500);
    }
    return env.ASSETS.fetch(req);
  }
};
