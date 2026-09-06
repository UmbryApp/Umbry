import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import Screenfull from 'screenfull';

import { PluginType } from 'constants/pluginType';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import browser from 'scripts/browser';
import TouchHelper from 'scripts/touchHelper';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { saveReadingProgress } from 'apps/experimental/theme/jpxReadingProgress';

import loading from '../../components/loading/loading';
import keyboardnavigation from '../../scripts/keyboardNavigation';
import dialogHelper from '../../components/dialogHelper/dialogHelper';
import TableOfContents from './tableOfContents';
import BookOsd from './BookOsd/BookOsd';
import { translateHtml } from '../../lib/globalize';
import * as userSettings from '../../scripts/settings/userSettings';
import Events from '../../utils/events.ts';
import { renderComponent } from '../../utils/reactUtils';

import 'material-design-icons-iconfont';
import '../../elements/emby-button/paper-icon-button-light';

import html from './template.html';
import './style.scss';

const THEMES = {
    'dark': { 'body': { 'color': '#d8dadc', 'background': '#000', 'font-size': 'medium' } },
    'sepia': { 'body': { 'color': '#d8a262', 'background': '#000', 'font-size': 'medium' } },
    'light': { 'body': { 'color': '#000', 'background': '#fff', 'font-size': 'medium' } }
};
const THEME_ORDER = ['dark', 'sepia', 'light'];
const FONT_SIZES = ['x-small', 'small', 'medium', 'large', 'x-large'];

export class BookPlayer {
    constructor() {
        this.name = 'Book Player';
        this.type = PluginType.MediaPlayer;
        this.id = 'bookplayer';
        this.priority = 1;
        this.THEMES = THEMES;
        if (!userSettings.theme() || userSettings.theme() === 'dark') {
            this.theme = 'dark';
        } else {
            this.theme = 'light';
        }
        this.fontSize = 'medium';
        this.onDialogClosed = this.onDialogClosed.bind(this);
        this.openTableOfContents = this.openTableOfContents.bind(this);
        this.rotateTheme = this.rotateTheme.bind(this);
        this.increaseFontSize = this.increaseFontSize.bind(this);
        this.decreaseFontSize = this.decreaseFontSize.bind(this);
        this.previous = this.previous.bind(this);
        this.next = this.next.bind(this);
        this.onWindowKeyDown = this.onWindowKeyDown.bind(this);
        this.addSwipeGestures = this.addSwipeGestures.bind(this);
        this.toggleFullscreen = this.toggleFullscreen.bind(this);
        this.fullscreen = false;
    }

    play(options) {
        this.progress = 0;
        this.cancellationToken = false;
        this.loaded = false;
        // Umbry: a client PlaySessionId so progress reports carry a non-null session key —
        // Emby 400s ("Value cannot be null (key)") without it, so reading progress never saved.
        this.playSession = (Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).replace(/[^a-f0-9]/g, '').slice(0, 32).padEnd(32, '0');

        loading.show();
        const elem = this.createMediaElement(options);
        return this.setCurrentSrc(elem, options);
    }

    stop() {
        this.unbindEvents();
        this.unmountBookOsd();

        const stopInfo = {
            src: this.item
        };

        try { saveReadingProgress(this.item, this.progress); } catch (e) { /* ignore */ }

        Events.trigger(this, 'stopped', [stopInfo]);

        const elem = this.mediaElement;
        const tocElement = this.tocElement;
        const rendition = this.rendition;

        if (elem) {
            dialogHelper.close(elem);
            this.mediaElement = null;
        }

        if (tocElement) {
            tocElement.destroy();
            this.tocElement = null;
        }

        if (rendition) {
            rendition.destroy();
        }

        if (this.fullscreen) {
            this.toggleFullscreen();
        }

        // hide loader in case player was not fully loaded yet
        loading.hide();
        this.cancellationToken = true;
    }

    destroy() {
        // Nothing to do here
    }

    currentItem() {
        return this.item;
    }

    currentTime() {
        return this.progress * 1000;
    }

    playSessionId() {
        return this.playSession;
    }

    duration() {
        return 1000;
    }

    getBufferedRanges() {
        return [{
            start: 0,
            end: 10000000
        }];
    }

    volume() {
        return 100;
    }

    isMuted() {
        return false;
    }

    paused() {
        return false;
    }

    seekable() {
        return true;
    }

    onWindowKeyDown(e) {
        // Skip modified keys
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

        const key = keyboardnavigation.getKeyName(e);

        if (!this.loaded) return;
        switch (key) {
            case 'KeyL':
            case 'ArrowRight':
            case 'Right':
                e.preventDefault();
                this.next();
                break;
            case 'KeyJ':
            case 'ArrowLeft':
            case 'Left':
                e.preventDefault();
                this.previous();
                break;
            case 'Escape':
                e.preventDefault();
                if (this.tocElement) {
                    // Close table of contents on ESC if it is open
                    this.tocElement.destroy();
                } else {
                    // Otherwise stop the entire book player
                    this.stop();
                }
                break;
        }
    }

    // Cap every image to ONE page (the true page size = the #bookPlayerContainer box,
    // which is reliable; epub.js sizes image-only spine iframes to their content, so vw/%
    // don't map to a page). Injected via the content hook BEFORE epub.js measures the
    // spine, so a wide graphic-novel spread paginates as a single fitted page instead of
    // spilling across several black/offset columns.
    fitImages(doc) {
        if (!doc) return;
        try {
            const cont = document.getElementById('bookPlayerContainer');
            const w = cont ? cont.clientWidth : 0;
            const h = cont ? cont.clientHeight : 0;
            if (!w || !h) return;
            let style = doc.getElementById('jpx-img-fit');
            if (!style) {
                style = doc.createElement('style');
                style.id = 'jpx-img-fit';
                (doc.head || doc.documentElement).appendChild(style);
            }
            // Fixed-layout (pre-paginated) epubs — comics / graphic novels — hard-code page and
            // wrapper widths in px (e.g. 1988px pages). Those oversized wrappers, not the image,
            // make epub.js paginate one page into ~8 blank columns. For fixed layout each spine IS
            // one page, so it is safe to clamp every element to the page box and hide the overflow.
            // NEVER do this for reflowable text books: overflow:hidden there would clip every
            // chapter to its first page.
            const book = this.rendition && this.rendition.book;
            // Only the aggressive single-page clamp (overflow:hidden etc.) is unsafe for reflowable
            // text — it would clip a chapter to its first screen. So gate it on the spine being
            // IMAGE-DOMINATED: it holds an image but almost no DOM text (a comic/graphic-novel page
            // rasterises its words INTO the image, so innerText is nearly empty). A prose chapter
            // has thousands of characters of real text and is never treated as fixed. (A numeric
            // viewport meta is NOT a reliable signal — reflowable epubs carry one too.)
            const metaFixed = !!(book && book.packaging && book.packaging.metadata && book.packaging.metadata.layout === 'pre-paginated');
            const hasImg = !!doc.querySelector('img, image, svg');
            const textLen = (doc.body && doc.body.innerText) ? doc.body.innerText.trim().length : 0;
            const imageDominated = hasImg && textLen < 200;
            const fixed = imageDominated || (metaFixed && textLen < 200);
            const imgRule = 'img,image,svg,.cover,.coverimage{max-width:' + w + 'px !important;max-height:' + h + 'px !important;width:auto !important;height:auto !important;object-fit:contain !important;display:block !important;margin:0 auto !important;page-break-inside:avoid !important;break-inside:avoid !important}';
            if (fixed) {
                // Fixed comic pages pin the image with position:absolute/left offsets and pad the
                // body — leaving a ~17px spill that becomes a sliver 2nd page. Neutralise position
                // so the (capped) image sits in normal flow, centered, filling exactly one page.
                const fixedImg = 'img,image,svg,.cover,.coverimage{position:static !important;left:auto !important;top:auto !important;right:auto !important;bottom:auto !important;max-width:' + w + 'px !important;max-height:' + h + 'px !important;width:auto !important;height:auto !important;object-fit:contain !important;display:block !important;margin:0 auto !important;page-break-inside:avoid !important;break-inside:avoid !important}';
                style.textContent =
                    'html,body{width:' + w + 'px !important;max-width:' + w + 'px !important;height:' + h + 'px !important;max-height:' + h + 'px !important;margin:0 !important;padding:0 !important;overflow:hidden !important;column-width:auto !important;columns:auto !important}' +
                    'body *{max-width:' + w + 'px !important;max-height:' + h + 'px !important}' +
                    fixedImg;
                // The 17px spill is epub.js's own column gutter (gap/2), applied to <body> via a
                // stylesheet rule it injects AFTER ours. An INLINE style with importance beats any
                // stylesheet, so set it inline — deferred through rAF so it runs once <body> exists
                // and after epub's layout pass (the content hook fires before <body> is parsed).
                const resetBody = () => {
                    try {
                        [doc.documentElement, doc.body].forEach((el) => {
                            if (!el) return;
                            el.style.setProperty('margin', '0', 'important');
                            el.style.setProperty('padding', '0', 'important');
                            el.style.setProperty('width', w + 'px', 'important');
                            el.style.setProperty('overflow', 'hidden', 'important');
                        });
                    } catch (e) { /* ignore */ }
                };
                resetBody();
                const raf = (doc.defaultView && doc.defaultView.requestAnimationFrame) || (typeof window !== 'undefined' && window.requestAnimationFrame);
                if (raf) { raf(() => { resetBody(); raf(resetBody); }); }
            } else {
                // Reflowable text: kill justify rivers (books default to text-align:justify with no
                // hyphenation, which on a narrow phone column opens big whitespace gaps between
                // words). Left-align BODY PARAGRAPHS only (so centered chapter titles keep their
                // alignment) and enable auto-hyphenation.
                style.textContent = imgRule +
                    'p{text-align:left !important;-webkit-hyphens:auto !important;hyphens:auto !important}';
            }
        } catch (e) { /* ignore */ }
    }

    addSwipeGestures(element) {
        this.touchHelper = new TouchHelper(element);
        Events.on(this.touchHelper, 'swipeleft', () => this.next());
        Events.on(this.touchHelper, 'swiperight', () => this.previous());
    }

    onDialogClosed() {
        this.stop();
    }

    bindEvents() {
        this.mediaElement?.addEventListener('close', this.onDialogClosed, { once: true });

        document.addEventListener('keydown', this.onWindowKeyDown);
        this.rendition?.on('keydown', this.onWindowKeyDown);

        if (browser.safari) {
            const player = document.querySelector('.bookOsd');
            this.addSwipeGestures(player);
        } else {
            this.rendition?.on('rendered', (e, i) => this.addSwipeGestures(i.document.documentElement));
        }

        // Re-fit images once each spine view is actually rendered (its <body> exists now, so the
        // inline body-reset for fixed-layout comics can win over the book's own inline styles).
        this._fitOnRender = (e, i) => this.fitImages(i && i.document);
        this.rendition?.on('rendered', this._fitOnRender);
    }

    unbindEvents() {
        document.removeEventListener('keydown', this.onWindowKeyDown);
        this.rendition?.off('keydown', this.onWindowKeyDown);
        this.mediaElement?.removeEventListener('close', this.onDialogClosed);

        if (!browser.safari) {
            this.rendition?.off('rendered', (e, i) => this.addSwipeGestures(i.document.documentElement));
        }
        if (this._fitOnRender) {
            this.rendition?.off('rendered', this._fitOnRender);
        }

        this.touchHelper?.destroy();
    }

    openTableOfContents() {
        if (this.loaded) {
            this.tocElement = new TableOfContents(this);
        }
    }

    toggleFullscreen() {
        const player = document.querySelector('#bookPlayerContainer');

        player.classList.toggle('fullscreen', !this.fullscreen);
        if (Screenfull.isEnabled) {
            Screenfull.toggle();
        } else if (window.NativeShell) {
            this.fullscreen ? window.NativeShell.disableFullscreen() : window.NativeShell.enableFullscreen();
        }

        // needs to be executed with a slight delay to give NativeShell time to process the request
        setTimeout(() => this.rendition.resize(player.clientWidth, player.clientHeight), 200);

        // required for mobile apps without browser fullscreen support
        this.fullscreen = !this.fullscreen;
    }

    rotateTheme() {
        if (this.loaded) {
            const newTheme = THEME_ORDER[(THEME_ORDER.indexOf(this.theme) + 1) % THEME_ORDER.length];
            this.rendition.themes.register('default', THEMES[newTheme]);
            this.rendition.themes.update('default');
            this.theme = newTheme;
        }
    }

    increaseFontSize() {
        if (this.loaded && this.fontSize !== FONT_SIZES[FONT_SIZES.length - 1]) {
            const newFontSize = FONT_SIZES[(FONT_SIZES.indexOf(this.fontSize) + 1)];
            this.rendition.themes.fontSize(newFontSize);
            this.fontSize = newFontSize;
        }
    }

    decreaseFontSize() {
        if (this.loaded && this.fontSize !== FONT_SIZES[0]) {
            const newFontSize = FONT_SIZES[(FONT_SIZES.indexOf(this.fontSize) - 1)];
            this.rendition.themes.fontSize(newFontSize);
            this.fontSize = newFontSize;
        }
    }

    previous(e) {
        e?.preventDefault();
        if (this.rendition) {
            this.rendition.book.package.metadata.direction === 'rtl' ? this.rendition.next() : this.rendition.prev();
        }
    }

    next(e) {
        e?.preventDefault();
        if (this.rendition) {
            this.rendition.book.package.metadata.direction === 'rtl' ? this.rendition.prev() : this.rendition.next();
        }
    }

    createMediaElement(options) {
        let elem = this.mediaElement;
        if (elem) {
            return elem;
        }

        elem = document.getElementById('bookPlayer');
        if (!elem) {
            elem = dialogHelper.createDialog({
                exitAnimationDuration: 400,
                size: 'fullscreen',
                autoFocus: false,
                scrollY: false,
                exitAnimation: 'fadeout',
                removeOnClose: true
            });

            elem.id = 'bookPlayer';
            elem.innerHTML = translateHtml(html);

            dialogHelper.open(elem);
        }

        this.mediaElement = elem;
        this.unmountBookOsd = renderComponent(BookOsd, {
            title: options.items[0].Name,
            getProgress: () => this.progress,
            onExit: this.onDialogClosed,
            onPrevious: this.previous,
            onNext: this.next,
            onOpenTableOfContents: this.openTableOfContents,
            onRotateTheme: this.rotateTheme,
            onDecreaseFontSize: this.decreaseFontSize,
            onIncreaseFontSize: this.increaseFontSize,
            onToggleFullscreen: Screenfull.isEnabled || window.NativeShell ? this.toggleFullscreen : null
        }, elem.querySelector('#bookOsdMount'));

        return elem;
    }

    setCurrentSrc(elem, options) {
        const item = options.items[0];
        this.item = item;
        this.streamInfo = {
            started: true,
            ended: false,
            item: this.item,
            mediaSource: {
                Id: item.Id
            }
        };

        return new Promise((resolve, reject) => {
            import('epubjs').then(({ default: epubjs }) => {
                const api = toApi(ServerConnections.getApiClient(item));
                const downloadHref = getLibraryApi(api).getDownloadUrl({ itemId: item.Id }).replace(/([?&])ApiKey=/gi, '$1api_key=');
                const book = epubjs(downloadHref, { openAs: 'epub' });

                const rendition = book.renderTo('bookPlayerContainer', {
                    width: '100%',
                    height: '100%',
                    // TODO: Add option for scrolled-doc
                    flow: 'paginated'
                });

                this.currentSrc = downloadHref;
                this.rendition = rendition;

                // Fit images to a single page before each spine item is measured.
                try {
                    rendition.hooks.content.register((contents) => {
                        this.fitImages(contents && contents.document);
                    });
                } catch (e) { /* ignore */ }

                rendition.themes.register('default', THEMES[this.theme]);
                rendition.themes.select('default');

                return rendition.display().then(() => {
                    const epubElem = document.querySelector('.epub-container');

                    // Umbry: reveal the page IMMEDIATELY. The stock flow hid it (opacity 0) until
                    // book.locations.generate() finished — a full-book parse that stalls on large
                    // books / slower devices, leaving the reader BLANK. Show the page now, build the
                    // location index in the BACKGROUND (only needed for the % + resume), and jump to
                    // the saved position once it is ready.
                    if (epubElem) epubElem.style.opacity = '';
                    this.loaded = true;
                    this.bindEvents();
                    try { rendition.getContents().forEach((c) => this.fitImages(c && c.document)); } catch (e) { /* ignore */ }
                    rendition.on('relocated', (location) => {
                        // Spine-based progress: smooth, immediate and monotonic on forward turns, and
                        // needs no full-book char index — so the bar moves on EVERY page turn from the
                        // very first one (the char index is heavy, finishes late, and reads ~0% through
                        // front matter, which made page turns feel dead / like nothing happened).
                        try {
                            const total = (book.spine && book.spine.length) || 1;
                            const idx = (location.start && location.start.index) || 0;
                            const disp = location.start && location.start.displayed;
                            const within = disp && disp.total ? (disp.page - 1) / Math.max(disp.total, 1) : 0;
                            this.progress = Math.min(0.999, (idx + within) / total);
                        } catch (e) { /* ignore */ }
                        try { rendition.getContents().forEach((c) => this.fitImages(c && c.document)); } catch (e) { /* ignore */ }
                        Events.trigger(this, 'pause');
                        try { saveReadingProgress(this.item, this.progress); } catch (e) { /* ignore */ }
                    });
                    loading.hide();
                    resolve();

                    this.rendition.book.locations.generate(1024).then(async () => {
                        if (this.cancellationToken) return;
                        const percentageTicks = options.startPositionTicks / 10000000;
                        if (percentageTicks !== 0.0) {
                            const resumeLocation = book.locations.cfiFromPercentage(percentageTicks);
                            try { await rendition.display(resumeLocation); } catch (e) { /* ignore */ }
                        }
                    }).catch(() => { /* progress index unavailable; the page still reads fine */ });
                }, () => {
                    console.error('failed to display epub');
                    return reject();
                });
            });
        });
    }

    canPlayMediaType(mediaType) {
        return (mediaType || '').toLowerCase() === 'book';
    }

    canPlayItem(item) {
        return item.Path?.endsWith('epub');
    }
}

export default BookPlayer;
