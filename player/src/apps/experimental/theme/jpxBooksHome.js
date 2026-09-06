// =====================================================================================
// Umbry — Books library home (Moonfin-style). Replaces the stock LibraryPage for the
// Books collection with: a Continue Reading hero, Books/Audiobooks stat cards, an
// All/Books/Audiobooks filter, a Library/Discover toggle, "Latest Books / Latest
// Audiobooks / Books" rows, a See-All grid, and a Discover tab (trending titles by
// subject from Open Library + a subject picker). Mounted by routes/books/index.tsx into
// a plain container so React does not fight the DOM we build.
// =====================================================================================
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { loadReadingProgress } from 'apps/experimental/theme/jpxReadingProgress';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const OL_SUBJECTS_DEFAULT = ['fantasy', 'romance', 'science_fiction'];
const OL_SUBJECTS_ALL = [
    'ancient_civilization', 'anthropology', 'archaeology', 'architecture', 'art_history',
    'art_instruction', 'autobiography', 'bears', 'bedtime', 'biography', 'business',
    'children', 'cooking', 'crime', 'fantasy', 'fiction', 'history', 'horror', 'humor',
    'mystery', 'philosophy', 'poetry', 'politics', 'psychology', 'religion', 'romance',
    'science', 'science_fiction', 'self_help', 'thriller', 'travel', 'war', 'young_adult'
];

function prettySubject(s) {
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function injectStyles() {
    if (document.getElementById('jpx-books-home-style')) return;
    const st = document.createElement('style');
    st.id = 'jpx-books-home-style';
    st.textContent = `
    .jpx-bh { position: relative; min-height: 100%; padding: calc(0.8em + env(safe-area-inset-top)) 0 6em; color: #fff; }
    .jpx-bh-glow { position: fixed; inset: -12% -12% -12% -12%; z-index: 0; pointer-events: none;
        background-color: #0b0817;
        background-image:
          radial-gradient(46% 34% at 16% 10%, rgba(255,154,75,0.30), transparent 70%),
          radial-gradient(52% 40% at 86% 26%, rgba(147,133,245,0.30), transparent 72%),
          radial-gradient(50% 40% at 42% 92%, rgba(199,123,216,0.24), transparent 72%);
        filter: blur(50px) saturate(1.12); }
    .jpx-bh > * { position: relative; z-index: 1; }
    .jpx-bh-inner { max-width: 1100px; margin: 0 auto; padding: 0 1em; }

    /* Continue Reading hero */
    .jpx-bh-hero { display: flex; align-items: center; gap: 1em; margin: 0.4em 0 1.1em;
        padding: 0.8em; border-radius: 18px;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
        -webkit-backdrop-filter: blur(24px) saturate(1.2); backdrop-filter: blur(24px) saturate(1.2);
        box-shadow: 0 10px 34px rgba(0,0,0,0.45); text-decoration: none; color: #fff; }
    .jpx-bh-hero-cover { flex: 0 0 auto; width: 78px; height: 118px; border-radius: 10px; overflow: hidden;
        background: #16161c center/cover no-repeat; box-shadow: 0 6px 18px rgba(0,0,0,0.5); }
    .jpx-bh-hero-body { flex: 1 1 auto; min-width: 0; }
    .jpx-bh-hero-label { font-size: 0.72rem; letter-spacing: 0.14em; font-weight: 700; text-transform: uppercase;
        color: var(--jpx-t-accent, #9385F5); margin-bottom: 0.2em; }
    .jpx-bh-hero-title { font-size: 1.22rem; font-weight: 700; line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .jpx-bh-hero-sub { font-size: 0.82rem; color: rgba(255,255,255,0.6); margin-top: 0.25em; }
    .jpx-bh-hero-play { flex: 0 0 auto; width: 52px; height: 52px; border-radius: 50%; border: 0; cursor: pointer;
        display: flex; align-items: center; justify-content: center; color: #160E2A;
        background: var(--jpx-t-accent, #9385F5); box-shadow: 0 6px 18px rgba(147,133,245,0.5); }
    .jpx-bh-hero-play .material-icons { font-size: 1.7em; }

    /* stat cards */
    .jpx-bh-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8em; margin-bottom: 1.1em; }
    .jpx-bh-stat { border: 0; cursor: pointer; text-align: center; padding: 1em 0.6em; border-radius: 16px;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10); color: #fff;
        -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); transition: background .15s, border-color .15s; }
    .jpx-bh-stat.on { background: rgba(147,133,245,0.16); border-color: rgba(147,133,245,0.5); }
    .jpx-bh-stat-n { font-size: 2rem; font-weight: 800; font-variant-numeric: tabular-nums; }
    .jpx-bh-stat-l { font-size: 0.74rem; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.62); margin-top: 0.2em; }

    /* segmented + toggle pills */
    .jpx-bh-seg { display: inline-flex; gap: 0.2em; padding: 0.25em; border-radius: 999px;
        background: rgba(255,255,255,0.08); margin: 0 0.5em 0.9em 0; }
    .jpx-bh-seg button { border: 0; background: none; color: rgba(255,255,255,0.75); cursor: pointer;
        font-size: 0.92rem; font-weight: 600; padding: 0.45em 1.05em; border-radius: 999px; white-space: nowrap; }
    .jpx-bh-seg button.on { background: #fff; color: #16161c; }
    .jpx-bh-seg.jpx-bh-tabs button.on { background: var(--jpx-t-accent, #9385F5); color: #160E2A; }
    .jpx-bh-controls { display: flex; flex-wrap: wrap; align-items: center; }

    /* rows */
    .jpx-bh-row { margin: 0.4em 0 1.4em; }
    .jpx-bh-row-head { display: flex; align-items: baseline; justify-content: space-between; margin: 0 0.1em 0.6em; }
    .jpx-bh-row-title { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.01em; }
    .jpx-bh-row-see { background: none; border: 0; color: rgba(255,255,255,0.7); font-size: 0.9rem; font-weight: 600; cursor: pointer; }
    .jpx-bh-strip { display: flex; gap: 0.9em; overflow-x: auto; overflow-y: hidden; padding: 0.55em 0.1em 0.6em; scrollbar-width: none; scroll-snap-type: x proximity; }
    .jpx-bh-strip::-webkit-scrollbar { display: none; }
    .jpx-bh-card { flex: 0 0 auto; width: 122px; text-decoration: none; color: #fff; scroll-snap-align: start; }
    .jpx-bh-card-img { width: 122px; height: 183px; border-radius: 12px; overflow: hidden; background: #16161c center/cover no-repeat;
        box-shadow: 0 6px 18px rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; position: relative; }
    .jpx-bh-card-img .material-icons { font-size: 2.2em; color: rgba(255,255,255,0.28); }
    .jpx-bh-card-badge { position: absolute; top: 6px; left: 6px; width: 24px; height: 24px; border-radius: 7px;
        background: rgba(20,18,30,0.7); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center; }
    .jpx-bh-card-badge .material-icons { font-size: 0.95em; color: #fff; }
    .jpx-bh-card-t { font-size: 0.86rem; font-weight: 600; line-height: 1.25; margin-top: 0.5em;
        overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .jpx-bh-card-sub { font-size: 0.76rem; color: rgba(255,255,255,0.55); margin-top: 0.1em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* real-library card carries the stock cardBox/cardImageContainer structure for jpxCardMorph */
    .jpx-bh-card .cardBox { display: block; margin: 0 !important; padding: 0 !important; border: 0; contain: none; }
    .jpx-bh-card.card { width: 122px; padding: 0; }
    .jpx-bh-grid .jpx-bh-card.card { width: 100%; }
    .jpx-bh-card-t, .jpx-bh-card-sub { display: block; }

    /* Non-morph cards (Discover / authors — no data-id) keep a scale + accent-ring hover. */
    .jpx-bh-card { transition: transform 0.16s ease; }
    .jpx-bh-card-img { transition: box-shadow 0.16s ease; }
    @media (hover: hover) and (pointer: fine) {
        .jpx-bh-card:not(.card):hover { transform: scale(1.055); position: relative; z-index: 3; }
        .jpx-bh-card:not(.card):hover .jpx-bh-card-img { box-shadow: 0 0 0 2px var(--jpx-t-accent, #9385F5), 0 14px 32px rgba(0, 0, 0, 0.55); }
        .jpx-bh-grid .jpx-bh-card:not(.card):hover { transform: translateY(-4px) scale(1.04); }
    }

    /* jpxCardMorph on real-library book cards: the stock rules assume a flex-wrap grid (width:22%
       + cardPadder aspect); our cards live in strips/grid with no cardPadder, so pin the expanded
       size + landscape image here (the accent border + info panel come from the stock morph CSS). */
    .jpx-bh-card.jpx-morph { width: 300px !important; z-index: 8; }
    .jpx-bh-card.jpx-morph .cardBox { margin: 0 !important; }
    .jpx-bh-card.jpx-morph .jpx-bh-card-img { width: 100% !important; height: 169px !important; border-radius: 14px 14px 0 0 !important; }
    .jpx-bh-card.jpx-morph .jpx-bh-card-t,
    .jpx-bh-card.jpx-morph .jpx-bh-card-sub,
    .jpx-bh-card.jpx-morph .jpx-bh-card-badge { display: none !important; }

    .jpx-bh-empty { color: rgba(255,255,255,0.5); font-size: 0.9rem; padding: 0.6em 0.2em; }
    .jpx-bh-loading { min-height: 40vh; }

    /* See-All / grid sub-view */
    .jpx-bh-gridwrap { padding-top: 0.4em; }
    .jpx-bh-gridhead { display: flex; align-items: baseline; gap: 0.6em; margin: 0.2em 0.1em 0.8em; }
    .jpx-bh-gridhead h2 { font-size: 1.9rem; font-weight: 800; margin: 0; }
    .jpx-bh-gridhead .c { color: rgba(255,255,255,0.55); font-size: 0.95rem; }
    .jpx-bh-search { display: flex; align-items: center; gap: 0.5em; width: 100%; margin-bottom: 0.9em;
        padding: 0.7em 0.9em; border-radius: 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }
    .jpx-bh-search .material-icons { color: rgba(255,255,255,0.6); }
    .jpx-bh-search input { flex: 1; border: 0; background: none; outline: none; color: #fff; font-size: 1rem; }
    .jpx-bh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(108px, 1fr)); gap: 1em 0.8em; }
    .jpx-bh-grid .jpx-bh-card { width: 100%; }
    .jpx-bh-grid .jpx-bh-card-img { width: 100%; height: auto; aspect-ratio: 2/3; }
    .jpx-bh-backbtn { background: rgba(255,255,255,0.08); border: 0; color: #fff; cursor: pointer;
        width: 2.5em; height: 2.5em; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 0.6em; }

    /* Discover */
    .jpx-bh-disc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1em; margin: 0.2em 0.1em 0.9em; }
    .jpx-bh-disc-head h2 { font-size: 2rem; font-weight: 800; margin: 0 0 0.15em; }
    .jpx-bh-disc-head p { color: rgba(255,255,255,0.6); font-size: 0.92rem; margin: 0; max-width: 26ch; }
    .jpx-bh-disc-cfg { flex: 0 0 auto; width: 2.7em; height: 2.7em; border-radius: 14px; border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .jpx-bh-chips { display: flex; gap: 0.5em; flex-wrap: wrap; margin-bottom: 0.4em; }
    .jpx-bh-chip { border: 0; cursor: pointer; padding: 0.5em 1em; border-radius: 999px; font-size: 0.9rem; font-weight: 600;
        background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); }

    /* Discovery Subjects modal */
    .jpx-bh-modal { position: fixed; inset: 0; z-index: 2000; display: flex; flex-direction: column;
        background: rgba(11,8,23,0.72); -webkit-backdrop-filter: blur(26px) saturate(1.2); backdrop-filter: blur(26px) saturate(1.2); }
    .jpx-bh-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1em;
        padding: calc(1.1em + env(safe-area-inset-top)) 1.2em 0.4em; }
    .jpx-bh-modal-head h2 { font-size: 1.7rem; font-weight: 800; margin: 0; }
    .jpx-bh-modal-head p { color: rgba(255,255,255,0.62); font-size: 0.9rem; margin: 0.3em 0 0; }
    .jpx-bh-modal-x { background: none; border: 0; color: var(--jpx-t-accent, #9385F5); cursor: pointer; font-size: 1.6rem; line-height: 1; padding: 0.1em; }
    .jpx-bh-modal-list { flex: 1; overflow-y: auto; padding: 0.6em 1.2em 1em; }
    .jpx-bh-modal-row { display: flex; align-items: center; gap: 0.9em; padding: 0.7em 0.2em; cursor: pointer; font-size: 1.15rem; font-weight: 700; }
    .jpx-bh-modal-box { width: 26px; height: 26px; border-radius: 6px; border: 2px solid rgba(255,255,255,0.4);
        flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }
    .jpx-bh-modal-row.on .jpx-bh-modal-box { background: var(--jpx-t-accent, #9385F5); border-color: var(--jpx-t-accent, #9385F5); }
    .jpx-bh-modal-box .material-icons { font-size: 1em; color: #160E2A; opacity: 0; }
    .jpx-bh-modal-row.on .jpx-bh-modal-box .material-icons { opacity: 1; }
    .jpx-bh-modal-foot { padding: 0.8em 1.2em calc(1em + env(safe-area-inset-bottom)); }
    .jpx-bh-modal-apply { width: 100%; border: 0; cursor: pointer; padding: 1em; border-radius: 999px; font-size: 1.05rem; font-weight: 700;
        background: var(--jpx-t-accent, #9385F5); color: #160E2A; }

    /* ---- DESKTOP: fill the width (no narrow centred column) + full-bleed backdrop hero ---- */
    @media (min-width: 960px) {
        .jpx-bh { padding-top: calc(1.4em + env(safe-area-inset-top)); }
        .jpx-bh-inner { max-width: 1680px; padding: 0 3vw; }
        .jpx-bh-controls { margin-top: 0.2em; }
        .jpx-bh-hero {
            position: relative;
            min-height: 270px;
            padding: 2.2em 2.4em;
            gap: 2em;
            align-items: flex-end;
            overflow: hidden;
        }
        .jpx-bh-hero::before {
            content: '';
            position: absolute;
            inset: 0;
            z-index: 0;
            background-image: var(--jpx-hero-cover, none);
            background-size: cover;
            background-position: center 22%;
            filter: blur(34px) brightness(0.55);
            transform: scale(1.18);
        }
        .jpx-bh-hero::after {
            content: '';
            position: absolute;
            inset: 0;
            z-index: 0;
            background: linear-gradient(0deg, rgba(11, 8, 23, 0.9) 0%, rgba(11, 8, 23, 0.4) 55%, rgba(11, 8, 23, 0.15) 100%);
        }
        .jpx-bh-hero > * { position: relative; z-index: 1; }
        .jpx-bh-hero-cover { width: 122px; height: 184px; }
        .jpx-bh-hero-label { font-size: 0.78rem; }
        .jpx-bh-hero-title { font-size: 1.95rem; }
        .jpx-bh-hero-sub { font-size: 0.95rem; }
        .jpx-bh-hero-play { width: 62px; height: 62px; }
        .jpx-bh-stat { padding: 1.4em 0.6em; }
        .jpx-bh-stat-n { font-size: 2.4rem; }
        .jpx-bh-row-title { font-size: 1.8rem; }
        .jpx-bh-disc-head h2 { font-size: 2.4rem; }
        .jpx-bh-gridhead h2 { font-size: 2.2rem; }
    }

    /* Discover cards are buttons — reset native button chrome */
    button.jpx-bh-card { border: 0; background: none; padding: 0; margin: 0; text-align: left; font: inherit; cursor: pointer; }

    /* Discover book detail sheet */
    .jpx-bh-bookmodal-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 1.4em; padding: 0.4em 1.2em calc(1.4em + env(safe-area-inset-bottom)); }
    .jpx-bh-bookmodal-cover { flex: 0 0 auto; width: 190px; height: 285px; border-radius: 12px; background: #16161c center/cover no-repeat;
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55); display: flex; align-items: center; justify-content: center; }
    .jpx-bh-bookmodal-cover .material-icons { font-size: 3em; color: rgba(255, 255, 255, 0.3); }
    .jpx-bh-bookmodal-info { width: 100%; max-width: 640px; }
    .jpx-bh-bookmodal-meta { color: rgba(255, 255, 255, 0.6); font-size: 0.85rem; margin-bottom: 0.9em; }
    .jpx-bh-bookmodal-desc { color: rgba(255, 255, 255, 0.86); font-size: 1rem; line-height: 1.6; margin-bottom: 1.5em; white-space: pre-wrap; }
    .jpx-bh-bookmodal-actions { display: flex; flex-direction: column; gap: 0.7em; max-width: 420px; }
    .jpx-bh-bookmodal-read { display: flex; align-items: center; justify-content: center; gap: 0.55em; padding: 0.95em 1em; border-radius: 999px;
        background: var(--jpx-t-accent, #9385F5); font-weight: 700; text-decoration: none; box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); }
    .jpx-bh-bookmodal-read, .jpx-bh-bookmodal-read span { color: var(--jpx-t-on-accent, #160E2A) !important; }
    .jpx-bh-bookmodal-find { text-align: center; padding: 0.75em; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.22);
        text-decoration: none; font-weight: 600; }
    .jpx-bh-bookmodal-find, .jpx-bh-bookmodal-find:link, .jpx-bh-bookmodal-find:visited { color: #fff !important; }
    @media (min-width: 700px) {
        .jpx-bh-bookmodal-body { flex-direction: row; align-items: flex-start; gap: 2em; padding-top: 1em; }
        .jpx-bh-bookmodal-cover { width: 220px; height: 330px; }
    }

    `;
    document.head.appendChild(st);
}

// -------- data helpers --------
function api() {
    return ServerConnections.currentApiClient();
}
function uid(ac) { return ac.getCurrentUserId(); }

function imgUrl(ac, item, w) {
    const tag = item.ImageTags && item.ImageTags.Primary;
    if (tag) return ac.getScaledImageUrl(item.Id, { type: 'Primary', maxWidth: w || 300, tag });
    if (item.AlbumId && item.AlbumPrimaryImageTag) return ac.getScaledImageUrl(item.AlbumId, { type: 'Primary', maxWidth: w || 300, tag: item.AlbumPrimaryImageTag });
    return null;
}

async function findBooksLib(ac) {
    const views = await ac.getUserViews({}, uid(ac));
    return (views.Items || []).find(v => v.CollectionType === 'books');
}

async function countOf(ac, parentId, type) {
    const r = await ac.getItems(uid(ac), { ParentId: parentId, IncludeItemTypes: type, Recursive: true, Limit: 0, EnableTotalRecordCount: true });
    return (r && r.TotalRecordCount) || 0;
}

async function latestOf(ac, parentId, type, limit) {
    const r = await ac.getItems(uid(ac), {
        ParentId: parentId, IncludeItemTypes: type, Recursive: true, Limit: limit || 16,
        SortBy: 'DateCreated', SortOrder: 'Descending', Fields: 'PrimaryImageAspectRatio',
        ImageTypeLimit: 1, EnableImageTypes: 'Primary'
    });
    return (r && r.Items) || [];
}

async function allOf(ac, parentId, type, limit, sortBy, searchTerm) {
    const q = {
        ParentId: parentId, IncludeItemTypes: type, Recursive: true, Limit: limit || 300,
        SortBy: sortBy || 'SortName', SortOrder: 'Ascending', Fields: 'PrimaryImageAspectRatio',
        ImageTypeLimit: 1, EnableImageTypes: 'Primary', EnableTotalRecordCount: true
    };
    if (searchTerm) q.SearchTerm = searchTerm;
    const r = await ac.getItems(uid(ac), q);
    return { items: (r && r.Items) || [], total: (r && r.TotalRecordCount) || 0 };
}

async function resumable(ac, parentId) {
    try {
        const { items } = await resumableList(ac, parentId, 1);
        return items[0] || null;
    } catch (e) { return null; }
}

async function resumableList(ac, parentId, limit) {
    let serverItems = [];
    try {
        const r = await ac.getResumableItems(uid(ac), {
            ParentId: parentId, Limit: 30, Fields: 'PrimaryImageAspectRatio',
            ImageTypeLimit: 1, EnableImageTypes: 'Primary'
        });
        serverItems = (r && r.Items) || [];
    } catch (e) { /* ignore */ }
    // Merge locally-tracked reading progress for THIS server. Emby (and Plex) don't persist a book
    // resume position server-side, so the server list is empty there — the local store fills it.
    let sid = null;
    try { sid = ac.serverId ? ac.serverId() : null; } catch (e) { /* ignore */ }
    const seen = new Set(serverItems.map(i => i.Id));
    const localItems = loadReadingProgress(sid)
        .filter(e => e && e.id && !seen.has(e.id))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .map(e => ({ Id: e.id, Name: e.name, Type: e.type || 'Book', ImageTags: e.tag ? { Primary: e.tag } : {}, ServerId: sid }));
    const merged = serverItems.concat(localItems);
    return { items: merged.slice(0, limit || 16), total: merged.length };
}

async function favoritesOf(ac, parentId, types, limit, searchTerm) {
    const q = {
        ParentId: parentId, IncludeItemTypes: types, Recursive: true, Filters: 'IsFavorite',
        SortBy: 'SortName', SortOrder: 'Ascending', Limit: limit || 16,
        Fields: 'PrimaryImageAspectRatio', ImageTypeLimit: 1, EnableImageTypes: 'Primary', EnableTotalRecordCount: true
    };
    if (searchTerm) q.SearchTerm = searchTerm;
    const r = await ac.getItems(uid(ac), q);
    return { items: (r && r.Items) || [], total: (r && r.TotalRecordCount) || 0 };
}

// -------- card rendering --------
function cardHtml(ac, item) {
    const url = imgUrl(ac, item, 300);
    const isAudio = item.Type === 'AudioBook';
    const sub = item.Type === 'AudioBook' ? (item.AlbumArtist || '') : (item.Artists ? item.Artists[0] : '');
    // Real library items carry `.card` + data-id + the stock cardBox/cardImageContainer structure so
    // the global jpxCardMorph hover-expand applies (same effect as the other libraries). Discover
    // (Open Library) and author cards have no data-id, so the morph skips them.
    return '<a class="card jpx-bh-card" data-id="' + esc(item.Id) + '" href="#/details?id=' + item.Id + '">'
        + '<span class="cardBox">'
        + '<span class="cardImageContainer jpx-bh-card-img"' + (url ? ' style="background-image:url(\'' + url.replace(/'/g, "%27") + '\')"' : '') + '>'
        + (url ? '' : '<span class="material-icons" aria-hidden="true">' + (isAudio ? 'headphones' : 'menu_book') + '</span>')
        + '<span class="jpx-bh-card-badge"><span class="material-icons" aria-hidden="true">' + (isAudio ? 'headphones' : 'menu_book') + '</span></span>'
        + '</span></span>'
        + '<span class="jpx-bh-card-t">' + esc(item.Name || '') + '</span>'
        + (sub ? '<span class="jpx-bh-card-sub">' + esc(sub) + '</span>' : '')
        + '</a>';
}

function stripHtml(ac, items) {
    if (!items.length) return '<div class="jpx-bh-empty">Nothing here yet.</div>';
    return '<div class="jpx-bh-strip">' + items.map(it => cardHtml(ac, it)).join('') + '</div>';
}

export function renderBooksHome(container) {
    if (!container) return;
    injectStyles();
    const ac = api();
    const state = { tab: 'library', filter: 'all', libId: null, bookCount: 0, audioCount: 0 };

    container.innerHTML = '<div class="jpx-bh jpx-bh-loading"><div class="jpx-bh-glow"></div></div>';
    const root = container.querySelector('.jpx-bh');

    (async () => {
        const lib = await findBooksLib(ac);
        if (!lib) { root.innerHTML = '<div class="jpx-bh-glow"></div><div class="jpx-bh-inner"><div class="jpx-bh-empty">No Books library found.</div></div>'; return; }
        state.libId = lib.Id;
        const [bc, ac2] = await Promise.all([countOf(ac, lib.Id, 'Book'), countOf(ac, lib.Id, 'AudioBook')]);
        state.bookCount = bc; state.audioCount = ac2;
        root.classList.remove('jpx-bh-loading');
        renderShell();
    })();

    function renderShell() {
        root.innerHTML = '<div class="jpx-bh-glow"></div>'
            + '<div class="jpx-bh-inner">'
            + '<div class="jpx-bh-controls">'
            + '<div class="jpx-bh-seg jpx-bh-tabs">'
            + '<button data-tab="library">Library</button>'
            + '<button data-tab="discover">Discover</button>'
            + '</div></div>'
            + '<div class="jpx-bh-body"></div>'
            + '</div>';
        root.querySelectorAll('.jpx-bh-tabs button').forEach(b => {
            b.classList.toggle('on', b.dataset.tab === state.tab);
            b.addEventListener('click', () => { state.tab = b.dataset.tab; renderShell(); });
        });
        const body = root.querySelector('.jpx-bh-body');
        if (state.tab === 'library') renderLibrary(body);
        else renderDiscover(body);
    }

    // ---------------- LIBRARY ----------------
    async function renderLibrary(body) {
        const hasAudio = state.audioCount > 0;
        body.innerHTML = '<div class="jpx-bh-hero-slot"></div>'
            + '<div class="jpx-bh-stats">'
            + '<button class="jpx-bh-stat" data-f="books"><div class="jpx-bh-stat-n">' + state.bookCount.toLocaleString() + '</div><div class="jpx-bh-stat-l">Books</div></button>'
            + '<button class="jpx-bh-stat" data-f="audiobooks"><div class="jpx-bh-stat-n">' + state.audioCount.toLocaleString() + '</div><div class="jpx-bh-stat-l">Audiobooks</div></button>'
            + '</div>'
            + (hasAudio ? '<div class="jpx-bh-controls"><div class="jpx-bh-seg jpx-bh-filter">'
                + '<button data-f="all">All</button><button data-f="books">Books</button><button data-f="audiobooks">Audiobooks</button>'
                + '</div></div>' : '')
            + '<div class="jpx-bh-rows"></div>';

        body.querySelectorAll('.jpx-bh-stat').forEach(b => {
            b.classList.toggle('on', state.filter === b.dataset.f);
            b.addEventListener('click', () => { state.filter = state.filter === b.dataset.f ? 'all' : b.dataset.f; renderLibrary(body); });
        });
        body.querySelectorAll('.jpx-bh-filter button').forEach(b => {
            b.classList.toggle('on', state.filter === b.dataset.f);
            b.addEventListener('click', () => { state.filter = b.dataset.f; renderLibrary(body); });
        });

        // Continue Reading hero
        const res = await resumable(ac, state.libId);
        const slot = body.querySelector('.jpx-bh-hero-slot');
        if (res && slot) {
            const url = imgUrl(ac, res, 240);
            const pct = res.UserData && res.UserData.PlayedPercentage;
            slot.outerHTML = '<a class="jpx-bh-hero" href="#/details?id=' + res.Id + '"'
                + (url ? ' style="--jpx-hero-cover:url(\'' + url.replace(/'/g, '%27') + '\')"' : '') + '>'
                + '<div class="jpx-bh-hero-cover"' + (url ? ' style="background-image:url(\'' + url.replace(/'/g, '%27') + '\')"' : '') + '></div>'
                + '<div class="jpx-bh-hero-body">'
                + '<div class="jpx-bh-hero-label">Continue Reading</div>'
                + '<div class="jpx-bh-hero-title">' + esc(res.Name || '') + '</div>'
                + (pct ? '<div class="jpx-bh-hero-sub">' + Math.round(pct) + '% · tap to resume</div>' : '')
                + '</div>'
                + '<span class="jpx-bh-hero-play"><span class="material-icons" aria-hidden="true">play_arrow</span></span>'
                + '</a>';
        } else if (slot) { slot.remove(); }

        const rows = body.querySelector('.jpx-bh-rows');
        const wantBooks = state.filter === 'all' || state.filter === 'books';
        const wantAudio = (state.filter === 'all' || state.filter === 'audiobooks') && hasAudio;
        const favTypes = state.filter === 'audiobooks' ? 'AudioBook' : (state.filter === 'books' ? 'Book' : 'Book,AudioBook');
        const specs = [];
        specs.push({ title: 'Continue Reading', kind: 'resume' });
        if (wantBooks) specs.push({ title: 'Latest Books', kind: 'items', type: 'Book' });
        if (wantAudio) specs.push({ title: 'Latest Audiobooks', kind: 'items', type: 'AudioBook' });
        specs.push({ title: 'Favorites', kind: 'favorites', types: favTypes });
        if (wantBooks) specs.push({ title: 'Books', kind: 'items', type: 'Book' });
        if (wantAudio) specs.push({ title: 'Audiobooks', kind: 'items', type: 'AudioBook' });

        rows.innerHTML = specs.map((s, i) =>
            '<div class="jpx-bh-row" data-i="' + i + '"><div class="jpx-bh-row-head"><span class="jpx-bh-row-title">' + esc(s.title) + '</span>'
            + '<button class="jpx-bh-row-see">See All</button>'
            + '</div><div class="jpx-bh-strip jpx-bh-loading"></div></div>').join('');

        specs.forEach(async (s, i) => {
            const rowEl = rows.querySelector('.jpx-bh-row[data-i="' + i + '"]');
            if (!rowEl) return;
            const strip = rowEl.querySelector('.jpx-bh-strip');
            const bindSee = (opts) => { const see = rowEl.querySelector('.jpx-bh-row-see'); if (see) see.addEventListener('click', () => showGrid(opts)); };
            if (s.kind === 'favorites') {
                const { items } = await favoritesOf(ac, state.libId, s.types, 16);
                if (!items.length) { rowEl.remove(); return; }
                strip.classList.remove('jpx-bh-loading');
                strip.outerHTML = stripHtml(ac, items);
                bindSee({ favorite: true, types: s.types, title: 'Favorites' });
                return;
            }
            if (s.kind === 'resume') {
                const { items } = await resumableList(ac, state.libId, 16);
                if (!items.length) { rowEl.remove(); return; }
                strip.classList.remove('jpx-bh-loading');
                strip.outerHTML = stripHtml(ac, items);
                bindSee({ resume: true, title: 'Continue Reading' });
                return;
            }
            const items = await latestOf(ac, state.libId, s.type, 16);
            strip.classList.remove('jpx-bh-loading');
            strip.outerHTML = stripHtml(ac, items);
            bindSee({ type: s.type, title: s.title });
        });
    }

    // ---------------- SEE-ALL GRID ----------------
    async function showGrid(opts) {
        const body = root.querySelector('.jpx-bh-body');
        if (!body) return;
        body.innerHTML = '<div class="jpx-bh-gridwrap">'
            + '<button class="jpx-bh-backbtn"><span class="material-icons" aria-hidden="true">arrow_back</span></button>'
            + '<div class="jpx-bh-gridhead"><h2>' + esc(opts.title) + '</h2><span class="c"></span></div>'
            + '<div class="jpx-bh-search"><span class="material-icons" aria-hidden="true">search</span><input type="search" placeholder="Search this library…"></div>'
            + '<div class="jpx-bh-grid jpx-bh-loading"></div></div>';
        body.querySelector('.jpx-bh-backbtn').addEventListener('click', () => renderShell());
        const gridEl = body.querySelector('.jpx-bh-grid');
        const countEl = body.querySelector('.jpx-bh-gridhead .c');
        const input = body.querySelector('.jpx-bh-search input');
        let deb;
        const load = async (term) => {
            gridEl.classList.add('jpx-bh-loading');
            let res;
            if (opts.resume) {
                res = await resumableList(ac, state.libId, 100);
                if (term) { const t = term.toLowerCase(); res = { items: res.items.filter(i => (i.Name || '').toLowerCase().includes(t)), total: res.total }; res.total = res.items.length; }
            } else if (opts.favorite) {
                res = await favoritesOf(ac, state.libId, opts.types, 400, term);
            } else {
                res = await allOf(ac, state.libId, opts.type, 400, 'SortName', term);
            }
            gridEl.classList.remove('jpx-bh-loading');
            if (countEl) countEl.textContent = res.total.toLocaleString() + ' Item' + (res.total === 1 ? '' : 's');
            gridEl.innerHTML = res.items.length ? res.items.map(it => cardHtml(ac, it)).join('') : '<div class="jpx-bh-empty">Nothing here.</div>';
        };
        input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => load(input.value.trim()), 300); });
        load('');
    }

    // ---------------- DISCOVER ----------------
    function getSubjects() {
        try {
            const raw = localStorage.getItem('jpx-discover-subjects');
            if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) return a; }
        } catch (e) { /* ignore */ }
        return OL_SUBJECTS_DEFAULT.slice();
    }
    function setSubjects(list) {
        try { localStorage.setItem('jpx-discover-subjects', JSON.stringify(list)); } catch (e) { /* ignore */ }
    }
    const olCache = {};
    async function fetchSubject(subject) {
        if (olCache[subject]) return olCache[subject];
        try {
            const r = await fetch('https://openlibrary.org/subjects/' + encodeURIComponent(subject) + '.json?limit=16');
            const j = await r.json();
            const works = (j.works || []).map(w => ({
                title: w.title,
                author: (w.authors && w.authors[0] && w.authors[0].name) || '',
                cover: w.cover_id ? ('https://covers.openlibrary.org/b/id/' + w.cover_id + '-M.jpg')
                    : (w.cover_edition_key ? ('https://covers.openlibrary.org/b/olid/' + w.cover_edition_key + '-M.jpg') : null),
                key: w.key
            }));
            olCache[subject] = { count: j.work_count || works.length, works };
            return olCache[subject];
        } catch (e) { return { count: 0, works: [], error: true }; }
    }
    function discoverCardHtml(w) {
        return '<button type="button" class="jpx-bh-card jpx-bh-disccard"'
            + ' data-key="' + esc(w.key || '') + '" data-title="' + esc(w.title || '') + '"'
            + ' data-author="' + esc(w.author || '') + '" data-cover="' + esc(w.cover || '') + '">'
            + '<div class="jpx-bh-card-img"' + (w.cover ? ' style="background-image:url(\'' + w.cover.replace(/'/g, '%27') + '\')"' : '') + '>'
            + (w.cover ? '' : '<span class="material-icons" aria-hidden="true">menu_book</span>') + '</div>'
            + '<div class="jpx-bh-card-t">' + esc(w.title || '') + '</div>'
            + (w.author ? '<div class="jpx-bh-card-sub">' + esc(w.author) + '</div>' : '')
            + '</button>';
    }

    // A Discover book opens a detail sheet: big cover, synopsis (fetched from the Open Library
    // work), and a link back to Open Library to read or borrow — plus a "find in my library".
    async function openDiscoverBook(work) {
        if (!work || !work.key) return;
        const olUrl = 'https://openlibrary.org' + work.key;
        const bigCover = work.cover ? work.cover.replace('-M.jpg', '-L.jpg') : null;
        const modal = document.createElement('div');
        modal.className = 'jpx-bh-modal jpx-bh-bookmodal';
        modal.innerHTML = '<div class="jpx-bh-modal-head">'
            + '<div><h2>' + esc(work.title || '') + '</h2>' + (work.author ? '<p>' + esc(work.author) + '</p>' : '') + '</div>'
            + '<button class="jpx-bh-modal-x" aria-label="Close">&times;</button></div>'
            + '<div class="jpx-bh-bookmodal-body">'
            + '<div class="jpx-bh-bookmodal-cover"' + (bigCover ? ' style="background-image:url(\'' + bigCover.replace(/'/g, '%27') + '\')"' : '') + '>'
            + (bigCover ? '' : '<span class="material-icons" aria-hidden="true">menu_book</span>') + '</div>'
            + '<div class="jpx-bh-bookmodal-info">'
            + '<div class="jpx-bh-bookmodal-meta"></div>'
            + '<div class="jpx-bh-bookmodal-desc jpx-bh-loading">Loading synopsis…</div>'
            + '<div class="jpx-bh-bookmodal-actions">'
            + '<a class="jpx-bh-bookmodal-read" href="' + esc(olUrl) + '" target="_blank" rel="noopener noreferrer">'
            + '<span class="material-icons" aria-hidden="true">auto_stories</span><span>Read or Borrow on Open Library</span></a>'
            + '<a class="jpx-bh-bookmodal-find" href="#/search?query=' + encodeURIComponent(work.title || '') + '">Find in my library</a>'
            + '</div></div></div>';
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelector('.jpx-bh-modal-x').addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        // navigating to local search would leave the modal lingering over it — close first
        modal.querySelector('.jpx-bh-bookmodal-find').addEventListener('click', close);

        try {
            const j = await fetch(olUrl + '.json').then(r => r.json());
            let desc = j.description;
            if (desc && typeof desc === 'object') desc = desc.value;
            desc = (desc || '').replace(/\r/g, '').trim();
            const descEl = modal.querySelector('.jpx-bh-bookmodal-desc');
            if (descEl) { descEl.classList.remove('jpx-bh-loading'); descEl.textContent = desc || 'No synopsis available.'; }
            const bits = [];
            if (j.first_publish_date) bits.push('First published ' + j.first_publish_date);
            const subs = (j.subjects || []).slice(0, 5).map(prettySubject);
            if (subs.length) bits.push(subs.join(' · '));
            const metaEl = modal.querySelector('.jpx-bh-bookmodal-meta');
            if (metaEl) metaEl.textContent = bits.join('  —  ');
        } catch (e) {
            const descEl = modal.querySelector('.jpx-bh-bookmodal-desc');
            if (descEl) { descEl.classList.remove('jpx-bh-loading'); descEl.textContent = 'Could not load details from Open Library.'; }
        }
    }

    function renderDiscover(body) {
        const subjects = getSubjects();
        body.innerHTML = '<div class="jpx-bh-disc-head">'
            + '<div><h2>Discover</h2><p>Trending titles by subject from Open Library.</p></div>'
            + '<button class="jpx-bh-disc-cfg" title="Choose subjects"><span class="material-icons" aria-hidden="true">tune</span></button>'
            + '</div>'
            + '<div class="jpx-bh-chips">' + subjects.map(s => '<button class="jpx-bh-chip" data-s="' + esc(s) + '">' + esc(prettySubject(s)) + '</button>').join('') + '</div>'
            + '<div class="jpx-bh-disc-rows"></div>';
        body.querySelector('.jpx-bh-disc-cfg').addEventListener('click', openSubjectPicker);
        body.querySelectorAll('.jpx-bh-chip').forEach(ch => ch.addEventListener('click', () => {
            const rowEl = body.querySelector('.jpx-bh-row[data-s="' + ch.dataset.s + '"]');
            if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
        const rows = body.querySelector('.jpx-bh-disc-rows');
        rows.addEventListener('click', (e) => {
            const card = e.target.closest('.jpx-bh-disccard');
            if (!card) return;
            openDiscoverBook({ key: card.dataset.key, title: card.dataset.title, author: card.dataset.author, cover: card.dataset.cover });
        });
        rows.innerHTML = subjects.map(s =>
            '<div class="jpx-bh-row" data-s="' + esc(s) + '"><div class="jpx-bh-row-head"><span class="jpx-bh-row-title">' + esc(prettySubject(s)) + '</span>'
            + '<span class="jpx-bh-row-see jpx-bh-row-count"></span></div><div class="jpx-bh-strip jpx-bh-loading"></div></div>').join('');
        subjects.forEach(async s => {
            const rowEl = rows.querySelector('.jpx-bh-row[data-s="' + s + '"]');
            if (!rowEl) return;
            const data = await fetchSubject(s);
            const strip = rowEl.querySelector('.jpx-bh-strip');
            strip.classList.remove('jpx-bh-loading');
            const cnt = rowEl.querySelector('.jpx-bh-row-count');
            if (cnt) cnt.textContent = data.works.length ? (data.count ? data.count.toLocaleString() + ' books' : '') : '';
            strip.outerHTML = data.works.length
                ? '<div class="jpx-bh-strip">' + data.works.map(discoverCardHtml).join('') + '</div>'
                : '<div class="jpx-bh-empty">' + (data.error ? 'Could not reach Open Library.' : 'No titles found.') + '</div>';
        });
    }

    function openSubjectPicker() {
        const selected = new Set(getSubjects());
        const modal = document.createElement('div');
        modal.className = 'jpx-bh-modal';
        modal.innerHTML = '<div class="jpx-bh-modal-head">'
            + '<div><h2>Discovery Subjects</h2><p>Pick which subject feeds to show in Discover.</p></div>'
            + '<button class="jpx-bh-modal-x" aria-label="Close">&times;</button></div>'
            + '<div class="jpx-bh-modal-list">' + OL_SUBJECTS_ALL.map(s =>
                '<div class="jpx-bh-modal-row' + (selected.has(s) ? ' on' : '') + '" data-s="' + esc(s) + '">'
                + '<span class="jpx-bh-modal-box"><span class="material-icons" aria-hidden="true">check</span></span>'
                + '<span>' + esc(prettySubject(s)) + '</span></div>').join('') + '</div>'
            + '<div class="jpx-bh-modal-foot"><button class="jpx-bh-modal-apply">Apply</button></div>';
        document.body.appendChild(modal);
        const close = () => { modal.remove(); };
        modal.querySelector('.jpx-bh-modal-x').addEventListener('click', close);
        modal.querySelectorAll('.jpx-bh-modal-row').forEach(row => row.addEventListener('click', () => {
            const s = row.dataset.s;
            if (selected.has(s)) { selected.delete(s); row.classList.remove('on'); }
            else { selected.add(s); row.classList.add('on'); }
        }));
        modal.querySelector('.jpx-bh-modal-apply').addEventListener('click', () => {
            const list = OL_SUBJECTS_ALL.filter(s => selected.has(s));
            setSubjects(list.length ? list : OL_SUBJECTS_DEFAULT.slice());
            close();
            const body = root.querySelector('.jpx-bh-body');
            if (body && state.tab === 'discover') renderDiscover(body);
        });
    }
}

export default renderBooksHome;
