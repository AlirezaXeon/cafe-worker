// ─── JWT with native Web Crypto API (no npm packages needed) ───────────────

const enc = (s) => new TextEncoder().encode(s);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

export async function signToken(payload, secret) {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = btoa(JSON.stringify(payload));
  const data    = `${header}.${body}`;
  const key     = await importKey(secret);
  const sig     = await crypto.subtle.sign('HMAC', key, enc(data));
  return `${data}.${b64(sig)}`;
}

export async function verifyToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const key   = await importKey(secret);
    const valid = await crypto.subtle.verify('HMAC', key, unb64(sig), enc(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Middleware: returns payload if valid, null otherwise
export async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return verifyToken(auth.slice(7), env.JWT_SECRET);
}
