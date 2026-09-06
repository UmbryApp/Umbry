// Plex account sign-in — client-only (no backend). Two flows:
//   1. "Sign in with Plex" (OAuth/PIN): request a PIN from plex.tv, open Plex's auth page, poll
//      until the user authorizes, receive their account token.
//   2. Email + password (fallback): post credentials to plex.tv, receive the token (with optional
//      2FA verification code).
// Either way we end up with the USER'S OWN Plex account token, which is then used to reach the
// shared server (addPlexServer validates address+token and registers it). This is what lets people
// you've shared libraries with connect by entering just the server address — they sign in as
// themselves, no manual token hunting.

const CLIENT_ID_KEY = 'jpx-plex-client-id';
const PRODUCT = 'Umbry';
const PLEX_API = 'https://plex.tv/api/v2';

function uuid(): string {
    const c = (globalThis.crypto || window.crypto) as Crypto | undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 'jpx-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
}

// A stable per-install identifier Plex ties the token to. Persisted so re-auth reuses it.
export function getPlexClientId(): string {
    try {
        let id = localStorage.getItem(CLIENT_ID_KEY);
        if (!id) { id = uuid(); localStorage.setItem(CLIENT_ID_KEY, id); }
        return id;
    } catch {
        return uuid();
    }
}

function plexHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
        Accept: 'application/json',
        'X-Plex-Product': PRODUCT,
        'X-Plex-Version': '1.0',
        'X-Plex-Client-Identifier': getPlexClientId(),
        ...(extra || {})
    };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ---- OAuth / "Sign in with Plex" ----
export interface PlexPin { id: number; code: string; }

export async function createPlexPin(): Promise<PlexPin> {
    const r = await fetch(PLEX_API + '/pins?strong=true', { method: 'POST', headers: plexHeaders() });
    if (!r.ok) throw new Error('Plex PIN request failed (' + r.status + ')');
    const j = await r.json();
    if (!j || !j.id || !j.code) throw new Error('Malformed Plex PIN response');
    return { id: j.id, code: j.code };
}

export function plexAuthUrl(code: string): string {
    const p = new URLSearchParams();
    p.set('clientID', getPlexClientId());
    p.set('code', code);
    p.set('context[device][product]', PRODUCT);
    return 'https://app.plex.tv/auth#?' + p.toString();
}

export async function pollPlexPin(id: number): Promise<string | null> {
    const r = await fetch(PLEX_API + '/pins/' + id, { headers: plexHeaders() });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return (j && j.authToken) || null;
}

// Open Plex's auth page and poll until authorized. Resolves the token, or null on timeout/cancel.
// `onWindow` receives the popup so the caller can detect blocked popups.
export async function signInWithPlexOAuth(onWindow?: (w: Window | null) => void): Promise<string | null> {
    const pin = await createPlexPin();
    const win = window.open(plexAuthUrl(pin.code), 'jpx-plex-auth', 'width=820,height=740');
    if (onWindow) onWindow(win);
    const deadline = Date.now() + 5 * 60 * 1000; // 5 minutes
    while (Date.now() < deadline) {
        await sleep(2000);
        const token = await pollPlexPin(pin.id).catch(() => null);
        if (token) { try { win && win.close(); } catch { /* ignore */ } return token; }
        if (win && win.closed) {
            // One final check in case they authorized just before closing.
            await sleep(800);
            return (await pollPlexPin(pin.id).catch(() => null)) || null;
        }
    }
    try { win && win.close(); } catch { /* ignore */ }
    return null;
}

// ---- Email + password fallback ----
export interface PlexSignInResult { token?: string; needs2fa?: boolean; error?: string; }

export async function signInWithPlexPassword(login: string, password: string, verificationCode?: string): Promise<PlexSignInResult> {
    const body = new URLSearchParams({ login, password });
    if (verificationCode) body.set('verificationCode', verificationCode);
    let r: Response;
    try {
        r = await fetch(PLEX_API + '/users/signin', {
            method: 'POST',
            headers: plexHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
            body: body.toString()
        });
    } catch {
        return { error: 'Could not reach Plex. Check your connection and try again.' };
    }
    const j = await r.json().catch(() => null) as { authToken?: string; errors?: Array<{ code?: number; message?: string }> } | null;
    if (r.ok && j && j.authToken) return { token: j.authToken };

    const errs = (j && j.errors) || [];
    const blob = JSON.stringify(j || {});
    // Plex signals a required 2FA code with a 401 + a verification-related error (code 1029).
    if ((r.status === 401 || r.status === 422) && (errs.some(e => e.code === 1029) || /verification|two[-\s]?factor|OTP|code/i.test(blob))) {
        if (!verificationCode) return { needs2fa: true };
    }
    const msg = errs.length ? (errs[0].message || '') : '';
    return { error: msg || 'Incorrect email or password.' };
}
