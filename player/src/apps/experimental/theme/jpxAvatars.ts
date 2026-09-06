// Umbry profile avatars — a built-in set (playful emoji-on-gradient + sleek Umbry gradient marks)
// plus user uploads. An avatar value is either 'preset:<id>' or 'upload:<data-uri>'.
// renderAvatar() turns either into an <img>-able src (an inline SVG data-URI for presets).

interface Preset { id: string; kind: 'emoji' | 'mark'; emoji?: string; c1?: string; c2?: string; svg?: string; }

// Umbry gradient endpoints (used for the sleek marks + as the emoji-tile fallback).
const UG1 = '#FF9A4B';
const UG2 = '#9385F5';

export const AVATAR_PRESETS: Preset[] = [
    // — playful: an emoji on a colorful gradient disc —
    { id: 'fox', kind: 'emoji', emoji: '🦊', c1: '#FFC670', c2: '#FF7A45' },
    { id: 'octopus', kind: 'emoji', emoji: '🐙', c1: '#C77BD8', c2: '#7A5CF5' },
    { id: 'moon', kind: 'emoji', emoji: '🌙', c1: '#5E6BF5', c2: '#241F44' },
    { id: 'robot', kind: 'emoji', emoji: '🤖', c1: '#6EE7F5', c2: '#4B7BF5' },
    { id: 'cat', kind: 'emoji', emoji: '🐈', c1: '#FFB86B', c2: '#C77BD8' },
    { id: 'headphones', kind: 'emoji', emoji: '🎧', c1: '#9385F5', c2: '#4B3BA8' },
    { id: 'alien', kind: 'emoji', emoji: '👾', c1: '#7BE8A0', c2: '#3BA88A' },
    { id: 'mushroom', kind: 'emoji', emoji: '🍄', c1: '#FF7A8A', c2: '#C74B6B' },
    { id: 'ghost', kind: 'emoji', emoji: '👻', c1: '#B9C0FF', c2: '#6B72C7' },
    { id: 'star', kind: 'emoji', emoji: '⭐', c1: '#FFD86B', c2: '#FF9A4B' },
    { id: 'popcorn', kind: 'emoji', emoji: '🍿', c1: '#FFC670', c2: '#C77BD8' },
    { id: 'wave', kind: 'emoji', emoji: '🌊', c1: '#4BC7F5', c2: '#4B6BF5' },
    // — sleek: Umbry gradient marks on a dark disc —
    { id: 'eclipse', kind: 'mark', svg: `<circle cx='50' cy='50' r='28' fill='url(#g)'/><circle cx='60' cy='41' r='24' fill='#151228'/>` },
    { id: 'disc', kind: 'mark', svg: `<circle cx='50' cy='50' r='32' fill='url(#g)'/>` },
    { id: 'ring', kind: 'mark', svg: `<circle cx='50' cy='50' r='27' fill='none' stroke='url(#g)' stroke-width='11'/>` },
    { id: 'wedge', kind: 'mark', svg: `<path d='M22 74 L50 24 L78 74 Z' fill='url(#g)'/>` },
    { id: 'orbit', kind: 'mark', svg: `<circle cx='50' cy='50' r='9' fill='url(#g)'/><ellipse cx='50' cy='50' rx='32' ry='13' fill='none' stroke='url(#g)' stroke-width='4' transform='rotate(-25 50 50)'/>` },
    { id: 'bars', kind: 'mark', svg: `<rect x='24' y='40' width='11' height='36' rx='4' fill='url(#g)'/><rect x='44' y='26' width='11' height='50' rx='4' fill='url(#g)'/><rect x='64' y='48' width='11' height='28' rx='4' fill='url(#g)'/>` }
];

function presetSvg(p: Preset): string {
    const c1 = p.c1 || UG1, c2 = p.c2 || UG2;
    const defs = `<defs>`
        + `<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${UG1}'/><stop offset='1' stop-color='${UG2}'/></linearGradient>`
        + `<linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient>`
        + `</defs>`;
    const body = p.kind === 'emoji'
        ? `<rect width='100' height='100' rx='50' fill='url(#bg)'/><text x='50' y='55' font-size='50' text-anchor='middle' dominant-baseline='central'>${p.emoji}</text>`
        : `<rect width='100' height='100' rx='50' fill='#151228'/>${p.svg || ''}`;
    return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>${defs}${body}</svg>`;
}

/** An <img>-able src for any avatar value ('preset:<id>' | 'upload:<data-uri>' | bare preset id). */
export function renderAvatar(avatar: string | undefined): string {
    const a = avatar || '';
    if (a.startsWith('upload:')) return a.slice('upload:'.length);
    const id = a.startsWith('preset:') ? a.slice('preset:'.length) : a;
    const p = AVATAR_PRESETS.find(x => x.id === id) || AVATAR_PRESETS.find(x => x.id === 'eclipse') || AVATAR_PRESETS[0];
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(presetSvg(p));
}
export function presetValue(id: string): string { return 'preset:' + id; }
