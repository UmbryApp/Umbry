// Umbry — animated ambient background. A fixed, click-through layer of four softly-drifting brand
// blobs (ember / magenta / indigo / pink) behind all content, matching the native app's ambient.
// Motion is pure CSS (jpxAmbient.scss) and disabled under prefers-reduced-motion.
let el: HTMLElement | null = null;

export function ensureAmbient(): void {
    if (el && document.body.contains(el)) return;
    el = document.createElement('div');
    el.id = 'jpx-ambient';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="jpx-amb-b1"></span><span class="jpx-amb-b2"></span>'
        + '<span class="jpx-amb-b3"></span><span class="jpx-amb-b4"></span>';
    document.body.insertBefore(el, document.body.firstChild);
}
