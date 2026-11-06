// Umbry — interface language for Umbry's own screens (settings, navigation, prompts, players).
// Jellyfin's stock strings already follow the Display Language through globalize; Umbry's screens were
// English-only. This translates them into the same 10 languages as the Apple app, from the same
// English-keyed dictionaries (strings/umbry/<lang>.json), following the Display Language.
//
// jpxT(key) / jpxTf(key, ...args) translate explicitly (used where text leaves the page, e.g. the native
// player's labels). initJpxI18n() also translates Umbry's rendered screens in place: any text node or
// placeholder/title/aria-label whose whole text is a known English phrase. Media content is never
// touched — titles, names, overviews, library names and other card text are skipped (SKIP).

import { getCurrentLocale } from 'lib/globalize';

const LANGS: Record<string, string> = { de: 'de', es: 'es', fr: 'fr', it: 'it', ja: 'ja', ko: 'ko', nl: 'nl', pt: 'pt' };

let dict: Record<string, string> | null = null;
let loadedFor: string | null = null;
let started = false;

/** The dictionary for the current Display Language, or null for English (and unsupported languages). */
export function jpxLangCode(): string | null {
    let l = 'en';
    try { l = String(getCurrentLocale() || document.documentElement.lang || 'en').toLowerCase(); } catch { l = 'en'; }
    if (l.startsWith('zh')) return /tw|hk|hant/.test(l) ? null : 'zh-Hans';
    return LANGS[l.split('-')[0]] || null;
}

export function jpxT(key: string): string {
    return (dict && dict[key]) || key;
}

/** jpxT with %s / %1$s placeholders filled in. */
export function jpxTf(key: string, ...args: Array<string | number>): string {
    let i = 0;
    return jpxT(key).replace(/%(\d+\$)?s/g, (_m, pos) => String(args[pos ? parseInt(pos, 10) - 1 : i++] ?? ''));
}

async function loadDict(code: string | null): Promise<void> {
    if (code === loadedFor) return;
    loadedFor = code;
    if (!code) { dict = null; return; }
    try {
        const m = await import(/* webpackChunkName: "jpx-strings-[request]" */ `../../../strings/umbry/${code}.json`);
        if (loadedFor === code) dict = (m.default || m) as Record<string, string>;
    } catch (e) {
        console.warn('[jpxI18n] no dictionary for', code, e);
        dict = null;
    }
}

// Media content and other text that must stay as the server wrote it.
const SKIP = [
    '.material-icons', '.material-icons-outlined', '[class*="material-icons"]', 'input', 'textarea', '[contenteditable]',
    '.cardText', '.cardTextCentered', '.cardFooter', '.itemName', '.listItemBodyText', '.secondary',
    '.jpx-dh-title', '.jpx-dh-overview', '.jpx-dh-overview-card', '.jpx-dh-tagline', '.overview', '.itemOverview',
    '.jpx-alb-title', '.jpx-artist-bio-text', '.jpx-mp-title', '.jpx-mp-artist', '.jpx-mp-album', '.jpx-mp-queue',
    '.jpx-livetv-ch-name', '.jpx-livetv-now', '.jpx-guide-chcell-name', '.jpx-guide-prog-title',
    '.jpx-book-title', '.jpx-book-overview', '.jpx-hero-title', '.jpx-hero-overview', '.jpx-person-name',
    '.jpx-sub-album-title', '.jpx-sub-artist', '.jpx-search-results .cardText',
    '[data-no-i18n]', '.jpx-no-i18n', 'pre', 'code'
].join(',');

// What each translated node said in English, so a switch of language (or back to English) can redo it.
const originals = new WeakMap<Node, string>();

function translateText(t: Text): void {
    if (!dict) return;
    const raw = t.nodeValue || '';
    const k = raw.trim();
    if (!k || k.length > 240) return;
    const p = t.parentElement;
    if (!p || p.closest(SKIP)) return;
    let out: string | null = null;
    const v = dict[k];
    if (v && v !== k) out = raw.replace(k, v);
    else {
        // "3299 channels" -> "%s channels"; " channels · " (text between rendered values) -> its core phrase
        const num = k.match(/^(\d[\d.,]*)\s+(\S.*)$/);
        const pat = num && dict['%s ' + num[2]];
        if (pat) out = raw.replace(k, pat.replace('%s', num![1]));
        else {
            const core = k.replace(/^[\s\d.,:·–-]+|[\s\d.,:·–-]+$/g, '');
            const cv = core && core !== k ? dict[core] : '';
            if (cv && cv !== core) out = raw.replace(core, cv);
        }
    }
    if (out == null) return;
    originals.set(t, raw);
    t.nodeValue = out;
}

function restoreAll(): void {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = w.nextNode();
    while (n) {
        const o = originals.get(n);
        if (o != null) { n.nodeValue = o; originals.delete(n); }
        n = w.nextNode();
    }
}

const ATTRS = ['placeholder', 'title', 'aria-label'];

function translateAttrs(el: Element): void {
    if (!dict) return;
    for (const a of ATTRS) {
        const raw = el.getAttribute(a);
        if (!raw) continue;
        const v = dict[raw.trim()];
        if (v && v !== raw && !el.closest('[data-no-i18n]')) el.setAttribute(a, v);
    }
}

function walk(root: Node): void {
    if (!dict) return;
    if (root.nodeType === Node.TEXT_NODE) { translateText(root as Text); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttrs(root as Element);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n = w.nextNode();
    while (n) {
        if (n.nodeType === Node.TEXT_NODE) translateText(n as Text);
        else translateAttrs(n as Element);
        n = w.nextNode();
    }
}

/** Load the current language and keep Umbry's screens translated as they render. Idempotent. */
export async function initJpxI18n(): Promise<void> {
    await loadDict(jpxLangCode());
    if (started) { walk(document.body); return; }
    started = true;
    walk(document.body);
    new MutationObserver((muts) => {
        if (!dict) return;
        for (const m of muts) {
            if (m.type === 'childList') m.addedNodes.forEach(walk);
            else if (m.type === 'characterData') translateText(m.target as Text);
            else if (m.type === 'attributes') translateAttrs(m.target as Element);
        }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // globalize sets <html lang> whenever the Display Language changes: follow it.
    new MutationObserver(() => {
        const code = jpxLangCode();
        if (code !== loadedFor) { restoreAll(); void loadDict(code).then(() => walk(document.body)); }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

export default initJpxI18n;
