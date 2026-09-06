// Umbry — custom Moonfin-style detail header (mobile).
//
// The stock Jellyfin detail header hard-centers its layout and uses icon-only buttons. Rather than
// fight it with CSS, this builds a purpose-made header (left-aligned logo/title, metadata line with
// middots + "Ends at", a community-rating badge, tagline, a frosted overview card with Read More, a
// big white Play button, and a row of circular labeled action buttons) and inserts it above the
// stock content. The stock header block is hidden via the `.jpx-custom-detail` page class.
//
// The action buttons DELEGATE their clicks to the stock (hidden) buttons, so all the real playback /
// watched / favorite / download / more-commands logic is reused untouched. Runs on mobile AND
// desktop layouts (TV keeps the stock focus-driven layout).

import layoutManager from 'components/layoutManager';
import cardBuilder from 'components/cardbuilder/cardBuilder';
import { isInWatchlist, toggleWatchlist } from './jpxWatchlist';
import { getPref, setPref } from './jpxPrefs';

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Dark-logo scrim detection. Some title logos are near-black transparent PNGs; on a dark
// backdrop they all but vanish (e.g. "Midnight Special" — a black logo on a night sky). Sample the
// logo's OPAQUE-pixel luminance off a canvas and, when it's genuinely dark, tag the img so the CSS
// backs it with a subtle frosted panel. Canvas sampling reads cross-origin pixels: it works in the
// Player (Electron, webSecurity off) but throws a SecurityError (tainted canvas) in a plain browser,
// so the whole thing is wrapped in try/catch and does NOTHING on any failure (never breaks detail).
function jpxTagDarkLogo(imgEl) {
    if (!imgEl) return;
    const src = imgEl.getAttribute("src");
    if (!src) return;
    imgEl.classList.remove("jpx-logo-dark"); // reset for the new item before re-evaluating
    // Sample from a SEPARATE anonymous-CORS image so the visible logo is never disturbed.
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
        try {
            const w = probe.naturalWidth, hgt = probe.naturalHeight;
            if (!w || !hgt) return;
            const scale = Math.min(1, 128 / Math.max(w, hgt)); // downscale for a cheap sample
            const cw = Math.max(1, Math.round(w * scale));
            const ch = Math.max(1, Math.round(hgt * scale));
            const canvas = document.createElement("canvas");
            canvas.width = cw; canvas.height = ch;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(probe, 0, 0, cw, ch);
            const data = ctx.getImageData(0, 0, cw, ch).data; // throws on a tainted canvas
            let lumSum = 0, alphaSum = 0;
            for (let i = 0; i < data.length; i += 4) {
                const a = data[i + 3];
                if (a < 8) continue; // ignore (near-)transparent margin pixels — logo art only
                const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
                lumSum += lum * a; alphaSum += a; // weight by alpha
            }
            if (alphaSum <= 0) return;
            const avg = lumSum / alphaSum; // alpha-weighted avg luminance of opaque pixels (0..255)
            if (avg < 60 && imgEl.isConnected) imgEl.classList.add("jpx-logo-dark");
        } catch (e) { /* tainted canvas / anything -> leave the logo untouched */ }
    };
    probe.onerror = () => { /* cannot load a sampling copy -> do nothing */ };
    try { probe.src = src; } catch (e) { /* ignore */ }
}

// ---- Shared action-button wiring (Favorite / Watched / Playlist) used by EVERY detail variant.
// Direct apiClient calls with optimistic UI + rollback — the old approach (a synthetic .click()
// on a hidden stock button) toggled server state but never updated our custom circle, so the
// buttons felt dead across the whole app. Works on Jellyfin/Emby; the Plex shim now implements
// updateFavoriteStatus/markPlayed/markUnplayed too (see jpxPlexClient), and any missing method
// degrades to a cosmetic toggle rather than throwing.
function jpxBtnIcon(btn) { return btn.querySelector('.material-icons'); }
function jpxBtnLabel(btn) { return btn.querySelector('.jpx-dh-abtn-lb'); }
function jpxWireFavorite(btn, item, apiClient) {
    const paint = (fav) => {
        const ic = jpxBtnIcon(btn); const lb = jpxBtnLabel(btn);
        if (ic) ic.textContent = fav ? 'favorite' : 'favorite_border';
        if (lb) lb.textContent = fav ? 'Favorited' : 'Favorite';
        btn.classList.toggle('jpx-dh-abtn-accent', fav);
    };
    paint(!!(item.UserData && item.UserData.IsFavorite));
    btn.addEventListener('click', () => {
        const cur = !!(item.UserData && item.UserData.IsFavorite);
        const next = !cur;
        item.UserData = item.UserData || {}; item.UserData.IsFavorite = next; paint(next);
        try {
            if (typeof apiClient.updateFavoriteStatus === 'function') {
                Promise.resolve(apiClient.updateFavoriteStatus(apiClient.getCurrentUserId(), item.Id, next))
                    .catch(() => { item.UserData.IsFavorite = cur; paint(cur); });
            }
        } catch (e) { item.UserData.IsFavorite = cur; paint(cur); }
    });
}
function jpxWirePlayed(btn, item, apiClient, readMode) {
    const onWord = readMode ? 'Read' : 'Watched';
    const offWord = readMode ? 'Unread' : 'Unwatched';
    const paint = (played) => {
        const ic = jpxBtnIcon(btn); const lb = jpxBtnLabel(btn);
        // Icon shows current STATE (filled check = watched); label shows the ACTION a tap performs,
        // so a WATCHED item offers an "Unwatched" button (tap to unwatch) — Sean's expectation.
        if (ic) ic.textContent = played ? 'check_circle' : 'check_circle_outline';
        if (lb) lb.textContent = played ? offWord : onWord;
        btn.classList.toggle('jpx-dh-abtn-accent', played);
    };
    paint(!!(item.UserData && item.UserData.Played));
    btn.addEventListener('click', () => {
        const cur = !!(item.UserData && item.UserData.Played);
        const next = !cur;
        item.UserData = item.UserData || {}; item.UserData.Played = next; paint(next);
        try {
            const fn = next ? 'markPlayed' : 'markUnplayed';
            if (typeof apiClient[fn] === 'function') {
                // No DatePlayed arg — Emby's PlayedItems endpoint 500s on the ISO-8601 date the
                // apiClient sends (Jellyfin tolerates it); omitting it works on both (server = now).
                Promise.resolve(apiClient[fn](apiClient.getCurrentUserId(), item.Id))
                    .catch(() => { item.UserData.Played = cur; paint(cur); });
            }
        } catch (e) { item.UserData.Played = cur; paint(cur); }
    });
}
function jpxOpenPlaylist(item, apiClient) {
    import('components/playlisteditor/playlisteditor').then((mod) => {
        const Editor = mod.PlaylistEditor || mod.default;
        new Editor().show({ items: [item.Id], serverId: item.ServerId || (apiClient.serverId && apiClient.serverId()) });
    }).catch((e) => { console.error('[jpx] playlist editor failed', e); });
}
function runtimeMins(ticks) { return Math.round((ticks || 0) / 600000000); }
function fmtRuntime(ticks) {
    const m = runtimeMins(ticks);
    if (m <= 0) return null;
    return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function endsAt(ticks) {
    const m = runtimeMins(ticks);
    if (m <= 0) return null;
    const d = new Date(Date.now() + m * 60000);
    try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return null; }
}
// In-progress detection for the Play button: a leaf item with a saved playback position becomes a
// "Resume" button with a progress fill (à la Moonfin). Series/season resume is derived later from
// the Next Up episode, since the container item itself carries no position.
function resumeInfo(item) {
    const ud = (item && item.UserData) || {};
    const pos = ud.PlaybackPositionTicks || 0;
    if (pos > 0 && item.RunTimeTicks && item.RunTimeTicks > 0) {
        return { resume: true, pct: Math.max(0, Math.min(100, (pos / item.RunTimeTicks) * 100)) };
    }
    return { resume: false, pct: 0 };
}

// Technical quality badges (resolution / HDR type / spatial audio) for a media source's streams,
// à la Moonfin: 4K · Dolby Vision · Atmos. Returns badge <span>s (or '' when nothing notable).
function qualityBadges(ms) {
    if (!ms) return '';
    const streams = ms.MediaStreams || [];
    const v = streams.find(s => s.Type === 'Video');
    const a = streams.find(s => s.Type === 'Audio' && s.IsDefault) || streams.find(s => s.Type === 'Audio');
    const out = [];
    if (v && v.Height) {
        const h = v.Height, w = v.Width || 0;
        let res = null;
        if (h >= 2000 || w >= 3800) res = '4K';
        else if (h >= 1400 || w >= 2400) res = '2K';
        else if (h >= 1000) res = '1080p';
        else if (h >= 700) res = '720p';
        else if (h >= 400) res = '480p';
        if (res) out.push({ t: res });
    }
    if (v) {
        const dovi = v.VideoDoViTitle && v.VideoDoViTitle !== 'None';
        const vrt = String(v.VideoRangeType || '');
        const vr = String(v.VideoRange || '');
        if (dovi || /DOVI|DoVi/i.test(vrt)) out.push({ t: 'Dolby Vision', c: 'dv' });
        else if (/HDR10\+|HDR10Plus/i.test(vrt)) out.push({ t: 'HDR10+', c: 'hdr' });
        else if (/HDR10/i.test(vrt)) out.push({ t: 'HDR10', c: 'hdr' });
        else if (/HLG/i.test(vrt)) out.push({ t: 'HLG', c: 'hdr' });
        else if (vr && vr !== 'SDR') out.push({ t: 'HDR', c: 'hdr' });
    }
    if (a) {
        const sf = String(a.AudioSpatialFormat || '');
        const prof = String(a.Profile || '');
        if (/Atmos/i.test(sf) || /Atmos/i.test(prof)) out.push({ t: 'Atmos', c: 'atmos' });
        else if (/DTS[\s:_-]?X/i.test(sf) || /DTS[\s:_-]?X/i.test(prof)) out.push({ t: 'DTS:X', c: 'atmos' });
    }
    return out.map(b => '<span class="jpx-dh-badge' + (b.c ? ' jpx-dh-badge-' + b.c : '') + '">' + b.t + '</span>').join('');
}

export function renderJpxDetailHeader(page, item, apiClient) {
    try {
        const prev = page.querySelector('.jpx-detail-header');
        if (prev) prev.remove();
        page.classList.remove('jpx-person-page');

        // Custom header is the MOBILE experience; desktop keeps the stock layout.
        // The custom Moonfin header is for LEAF, playable items (Movie / Episode / Video). Container
        // types (collections/boxsets, series, seasons, albums, playlists, folders, etc.) render their
        // CHILDREN inside the stock .detailPageWrapperContainer, which the desktop layout hides — so
        // for those, keep the stock detail layout or their contents vanish (blank collection page).
        // "Details Screen Style = Classic" -> skip the custom Moonfin header and show the stock
        // Jellyfin detail layout (which the .jpx-custom-detail class otherwise hides).
        if (getPref('pref_detail_screen_style', 'modern') === 'classic') {
            page.classList.remove('jpx-custom-detail');
            page.classList.remove('jpx-custom-tabs');
            return;
        }
        // People (cast/crew) get a purpose-built Moonfin-style page — handled here, before the
        // container-type gate below routes everything else to the stock layout.
        if (item && item.Type === 'Person') { renderJpxPerson(page, item, apiClient); return; }
        // Studios & Genres are "grouping" pages — Moonfin renders them as a scoped library grid
        // (title + count, search-this-library, Sort & Filter + Display sheets, poster grid).
        if (item && (item.Type === 'Studio' || item.Type === 'Genre' || item.Type === 'MusicGenre')) {
            renderJpxGrouping(page, item, apiClient); return;
        }
        // Content folders (book series / per-book download folders that Jellyfin indexes as a
        // Folder) used to dump to the stock #/list page (single card + A-Z rail + "1-1 of 1").
        // Render them as the same scoped grid instead — the folder's children as poster cards.
        if (item && item.Type === 'Folder') { renderJpxGrouping(page, item, apiClient); return; }
        // Books & comics get the Moonfin book detail (centered cover, Read pill, circle actions).
        if (item && item.Type === 'Book') { renderJpxBook(page, item, apiClient); return; }
        // Albums & playlists get the Umbry music detail (art + glow, meta, Play pill, frosted tracks).
        if (item && (item.Type === 'MusicAlbum' || item.Type === 'Playlist')) { renderJpxAlbum(page, item, apiClient); return; }
        if (item && item.Type === 'MusicArtist') { renderJpxArtist(page, item, apiClient); return; }
        var JPX_NON_LEAF_TYPES = ['CollectionFolder', 'Folder', 'UserView',
            'Channel', 'PhotoAlbum'];
        if (!item || JPX_NON_LEAF_TYPES.indexOf(item.Type) !== -1) {
            page.classList.remove('jpx-custom-detail');
            page.classList.remove('jpx-custom-tabs');
            return;
        }
        // Collections (BoxSet) get the Moonfin layout too, but with group-appropriate controls:
        // no runtime / ratings / tagline / subtitles / trailer; a Shuffle button; and a "Movies"
        // tab listing the collection's films instead of Details / Similar / Chapters.
        const isCollection = item.Type === 'BoxSet';
        // Series (TV shows) get the Moonfin layout too — same header as movies, plus Seasons/Episodes
        // tabs (built in buildDetailTabs) instead of Details/Similar, and a Shuffle control.
        const isSeries = item.Type === 'Series';
        // Seasons get the same treatment as a series, but the tabbed area leads with this season's
        // Episodes (no Seasons tab, no Next Up card). The series logo/backdrop carry over via the
        // Parent* image tags, so the header still reads as the show.
        const isSeason = item.Type === 'Season';

        const h = document.createElement('div');
        h.className = 'jpx-detail-header';

        // ---- heading: logo if present, else the title ----
        const logoTag = item.ImageTags && item.ImageTags.Logo;
        const parentLogo = item.ParentLogoImageTag && item.ParentLogoItemId;
        let headInner;
        if (logoTag) {
            const url = apiClient.getScaledImageUrl(item.Id, { type: 'Logo', maxWidth: 600, tag: logoTag });
            headInner = '<img class="jpx-dh-logo" src="' + url + '" alt="' + esc(item.Name) + '" />';
        } else if (parentLogo) {
            const url = apiClient.getScaledImageUrl(item.ParentLogoItemId, { type: 'Logo', maxWidth: 600, tag: item.ParentLogoImageTag });
            headInner = '<img class="jpx-dh-logo" src="' + url + '" alt="' + esc(item.Name) + '" />';
        } else {
            headInner = '<h1 class="jpx-dh-title">' + esc(item.Name) + '</h1>';
        }
        // Multi-version affordance (Moonfin): a small THEME-ACCENT tag beside the title showing the
        // current version's name/year. It shares the accent colour with the Version button below, so
        // the two read as linked — the coloured tag draws the eye and points you to the version picker.
        const multiVersion = !isCollection && item.MediaSources && item.MediaSources.length > 1;
        const curSource = multiVersion ? item.MediaSources[0] : null;
        const vtagLabel = curSource ? (curSource.Name || item.Name) : '';
        const versionTag = multiVersion
            ? '<button type="button" class="jpx-dh-vtag">' + esc(vtagLabel) + '</button>' : '';
        const head = '<div class="jpx-dh-head">' + headInner + versionTag + '</div>';

        // ---- metadata line ----
        const sep = '<span class="jpx-dh-sep">·</span>';
        const meta = [];
        if (!isCollection && item.ProductionYear) meta.push(esc(item.ProductionYear));
        if (item.OfficialRating) meta.push('<span class="jpx-dh-cert">' + esc(item.OfficialRating) + '</span>');
        if (!isCollection && !isSeries && !isSeason) {
            const rt = fmtRuntime(item.RunTimeTicks);
            if (rt) meta.push('<span class="jpx-dh-rt"><span class="material-icons" aria-hidden="true">schedule</span>' + rt + '</span>');
            const ends = endsAt(item.RunTimeTicks);
            if (ends) meta.push('<span class="jpx-dh-ends">Ends at ' + ends + '</span>');
        }
        if (isSeries) {
            const sc = item.ChildCount || item.SeasonCount || 0;
            if (sc) meta.push(sc + ' Season' + (sc > 1 ? 's' : ''));
            if (item.Status) meta.push('<span class="jpx-dh-status jpx-dh-status-' + (item.Status === 'Continuing' ? 'on' : 'off') + '">' + esc(item.Status) + '</span>');
        }
        if (isSeason) {
            // when a logo is present the header shows the SERIES logo, so surface the season's own
            // name in the meta line; otherwise the <h1> already shows it.
            const hasLogo = (item.ImageTags && item.ImageTags.Logo) || (item.ParentLogoImageTag && item.ParentLogoItemId);
            if (hasLogo && item.Name) meta.push(esc(item.Name));
            const ec = item.ChildCount || item.RecursiveItemCount || 0;
            if (ec) meta.push(ec + ' Episode' + (ec > 1 ? 's' : ''));
        }
        const allGenres = (item.Genres || []).slice(0, 3);
        // Collections fold their genres into the metadata line (PG · Adventure · Comedy · …).
        if (isCollection) allGenres.forEach(g => meta.push(esc(g)));
        const metaLine = meta.length ? '<div class="jpx-dh-meta">' + meta.join(sep) + '</div>' : '';

        // ---- genres (movies keep a separate row; collections put them in the meta line above) ----
        const genres = isCollection ? [] : allGenres;
        const genreLine = genres.length
            ? '<div class="jpx-dh-genres">' + genres.map(esc).join(sep) + '</div>' : '';

        // ---- quality badges (4K / HDR / Dolby Vision / Atmos) from the current media source ----
        const badgesHtml = isCollection ? '' : qualityBadges((item.MediaSources || [])[0]);
        const badgesLine = '<div class="jpx-dh-badges">' + badgesHtml + '</div>';

        // ---- rating badges: Community Rating + Rotten Tomatoes (critic) ----
        const ratingBadges = [];
        if (!isCollection && item.CommunityRating) {
            ratingBadges.push('<div class="jpx-dh-rate"><span class="material-icons jpx-dh-rate-star" aria-hidden="true">star</span>'
                + '<span class="jpx-dh-rate-txt"><b>' + item.CommunityRating.toFixed(1) + '</b><small>Community Rating</small></span></div>');
        }
        if (!isCollection && typeof item.CriticRating === 'number') {
            const fresh = item.CriticRating >= 60;
            ratingBadges.push('<div class="jpx-dh-rate"><span class="jpx-dh-rate-rt">' + (fresh ? '🍅' : '🤢') + '</span>'
                + '<span class="jpx-dh-rate-txt"><b>' + Math.round(item.CriticRating) + '%</b><small>Rotten Tomatoes</small></span></div>');
        }
        const cr = ratingBadges.length ? '<div class="jpx-dh-ratings">' + ratingBadges.join('') + '</div>' : '';

        // ---- tagline ----
        const tagline = (!isCollection && item.Taglines && item.Taglines[0])
            ? '<div class="jpx-dh-tagline">' + esc(item.Taglines[0]) + '</div>' : '';

        // ---- overview + Read More ----
        const overview = item.Overview
            ? '<div class="jpx-dh-overview-card"><p class="jpx-dh-overview">' + esc(item.Overview) + '</p>'
              + '<a class="jpx-dh-readmore" href="#">Read More</a></div>'
            : '';

        const ri = resumeInfo(item);
        const playBtnHtml = '<button type="button" class="jpx-dh-play' + (ri.resume ? ' jpx-dh-play-resume' : '') + '">'
            + '<span class="material-icons" aria-hidden="true">play_arrow</span>'
            + '<span class="jpx-dh-play-lb">' + (ri.resume ? 'Resume' : 'Play') + '</span>'
            + '<span class="jpx-dh-play-prog"><span class="jpx-dh-play-prog-fill" style="width:' + ri.pct.toFixed(1) + '%"></span></span>'
            + '</button>';
        h.innerHTML = head + metaLine + genreLine + badgesLine + cr + tagline + overview
            + playBtnHtml
            + '<div class="jpx-dh-actions"></div>';

        const wrap = page.querySelector('.detailPageWrapperContainer');
        if (!wrap || !wrap.parentNode) return;
        wrap.parentNode.insertBefore(h, wrap);
        page.classList.add('jpx-custom-detail');

        // Dark-logo scrim: if the title logo is a near-black PNG, tag it so the CSS backs it with a
        // subtle frosted panel (dark logos only — a light logo on a nice backdrop is left alone).
        // Fresh header per item means a brand-new img each time, so this re-evaluates every page.
        jpxTagDarkLogo(h.querySelector(".jpx-dh-logo"));

        // ---- wire Play -> stock play/resume button ----
        h.querySelector('.jpx-dh-play').addEventListener('click', () => {
            const b = page.querySelector('.btnPlay:not(.hide)') || page.querySelector('.btnReplay:not(.hide)');
            if (b) b.click();
        });

        // TV/10-foot layout: the stable app paints no page backdrop, so supply the item's own
        // backdrop as a fixed layer behind the header scrim (via a CSS var on the header). Also seed
        // remote focus onto Play, since the stock .btnPlay focus target is hidden.
        if (layoutManager.tv) {
            const bdTag = item.BackdropImageTags && item.BackdropImageTags[0];
            let bdUrl = null;
            if (bdTag) {
                bdUrl = apiClient.getScaledImageUrl(item.Id, { type: 'Backdrop', maxWidth: 1920, tag: bdTag });
            } else if (item.ParentBackdropImageTags && item.ParentBackdropItemId) {
                bdUrl = apiClient.getScaledImageUrl(item.ParentBackdropItemId, { type: 'Backdrop', maxWidth: 1920, tag: item.ParentBackdropImageTags[0] });
            }
            if (bdUrl) h.style.setProperty('--jpx-tv-bd', "url('" + bdUrl + "')");
            const pb = h.querySelector('.jpx-dh-play');
            setTimeout(() => { try { pb.focus(); } catch (e) { /* ignore */ } }, 220);
        }

        // Collections: paint the collection's own art (backdrop, else poster) as a fixed backdrop
        // behind the header scrim — Jellyfin/Emby/Plex may not set a page backdrop for a BoxSet.
        if (isCollection) {
            let bd = null;
            if (item.BackdropImageTags && item.BackdropImageTags[0]) {
                bd = apiClient.getScaledImageUrl(item.Id, { type: 'Backdrop', maxWidth: 1920, tag: item.BackdropImageTags[0] });
            } else if (item.__backdropUrl) {
                bd = item.__backdropUrl;
            } else if (item.ImageTags && item.ImageTags.Primary) {
                bd = apiClient.getScaledImageUrl(item.Id, { type: 'Primary', maxWidth: 1280, tag: item.ImageTags.Primary });
            } else if (item.__primaryImageUrl) {
                bd = item.__primaryImageUrl;
            }
            if (bd) { h.style.setProperty('--jpx-tv-bd', "url('" + bd + "')"); h.classList.add('jpx-dh-coll'); page.classList.add('jpx-coll-bd'); }
        }

        // Leaf items (movies / episodes / series): use the SAME fixed full-viewport backdrop as
        // collections/albums (jpx-dh-coll::before) instead of the stock #itemBackdrop/.backdropContainer.
        // The stock element rides inside the (nav-shifted) content, so it rendered off-centre with a
        // right-edge strip and stopped short of the bottom; the pseudo-element is viewport-fixed and
        // immune to that. TV keeps its own --jpx-tv-bd layer.
        if (!isCollection && !layoutManager.tv) {
            let bd = null;
            const bdTag = item.BackdropImageTags && item.BackdropImageTags[0];
            if (bdTag) {
                bd = apiClient.getScaledImageUrl(item.Id, { type: 'Backdrop', maxWidth: 1920, tag: bdTag });
            } else if (item.ParentBackdropImageTags && item.ParentBackdropItemId) {
                bd = apiClient.getScaledImageUrl(item.ParentBackdropItemId, { type: 'Backdrop', maxWidth: 1920, tag: item.ParentBackdropImageTags[0] });
            } else if (item.ImageTags && item.ImageTags.Primary) {
                bd = apiClient.getScaledImageUrl(item.Id, { type: 'Primary', maxWidth: 1280, tag: item.ImageTags.Primary });
            }
            if (bd) { h.style.setProperty('--jpx-tv-bd', "url('" + bd + "')"); h.classList.add('jpx-dh-coll'); page.classList.add('jpx-coll-bd'); }
        }

        // ---- Read More toggle ----
        const rm = h.querySelector('.jpx-dh-readmore');
        if (rm) {
            const ov = h.querySelector('.jpx-dh-overview');
            const card = h.querySelector('.jpx-dh-overview-card');
            // Only show Read More when the synopsis is actually clamped (overflows its line-clamp).
            // A -webkit-line-clamp element that fits has scrollHeight ~= clientHeight; when truncated,
            // scrollHeight (full content) exceeds clientHeight (clamped). Measure AFTER layout + fonts.
            const syncReadMore = () => {
                if (!ov || !card) return;
                if (card.classList.contains('expanded')) { rm.style.display = ''; return; }
                const overflowing = (ov.scrollHeight - ov.clientHeight) > 4;
                rm.style.display = overflowing ? '' : 'none';
            };
            rm.style.display = 'none'; // hide until measured, so it never flashes on short synopses
            requestAnimationFrame(() => requestAnimationFrame(syncReadMore));
            if (document.fonts && document.fonts.ready) { document.fonts.ready.then(syncReadMore).catch(() => {}); }
            const onResize = () => { if (!h.isConnected) { window.removeEventListener('resize', onResize); return; } syncReadMore(); };
            window.addEventListener('resize', onResize);
            rm.addEventListener('click', (e) => {
                e.preventDefault();
                const expanded = card.classList.toggle('expanded');
                rm.textContent = expanded ? 'Read Less' : 'Read More';
            });
        }

        // ---- action buttons (Moonfin set): Subtitles, Cast, Trailer collapsed; More reveals
        //      Unwatched, Favorite, Playlist, Download. Each delegates to a stock action. ----
        const actions = h.querySelector('.jpx-dh-actions');

        const makeBtn = (icon, label, onClick, extraClass) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'jpx-dh-abtn' + (extraClass ? ' ' + extraClass : '');
            btn.innerHTML = '<span class="jpx-dh-abtn-ic"><span class="material-icons" aria-hidden="true">' + icon
                + '</span></span><span class="jpx-dh-abtn-lb">' + label + '</span>';
            btn.addEventListener('click', onClick);
            return btn;
        };
        const clickStock = (sel) => () => { const t = page.querySelector(sel); if (t) { try { t.click(); } catch (e) { /* ignore */ } } };
        const hasStock = (sel) => { const t = page.querySelector(sel); return t && !t.classList.contains('hide'); };

        // Subtitles -> our own picker dialog (a programmatic click can't open a native <select>).
        const subsFn = () => openSubtitleDialog(page, item);
        // Cast -> the global Cast/remote button, if this build exposes one.
        const castSel = '.headerCastButton, .btnCast, button[is="emby-button"][title="Cast"]';
        const castFn = () => { const c = document.querySelector(castSel); if (c) c.click(); };

        // collapsed row — collections, series & seasons get Shuffle; leaf items get Subtitles (when present).
        if (isCollection || isSeries || isSeason) {
            if (page.querySelector('.btnShuffle')) actions.appendChild(makeBtn('shuffle', 'Shuffle', clickStock('.btnShuffle')));
        } else {
            const subEl = page.querySelector('.selectSubtitles');
            const hasSubs = subEl && subEl.querySelectorAll('option').length > 1;
            if (hasSubs) actions.appendChild(makeBtn('closed_caption', 'Subtitles', subsFn));
            // Version -> Select Version dialog, shown only when the item has multiple media versions
            // (multiple files/sources). Mirrors Moonfin: a "Version" button that lists each version
            // as "<name>" + "<CONTAINER> | <bitrate> Mbps" and switches the source used for playback.
            const srcEl = page.querySelector('.selectSource');
            const hasVersions = (item.MediaSources && item.MediaSources.length > 1)
                || (srcEl && srcEl.querySelectorAll('option').length > 1);
            if (hasVersions) {
                actions.appendChild(makeBtn('video_file', 'Version', () => openVersionDialog(page, item), 'jpx-dh-abtn-accent'));
                // the accent title tag opens the same picker
                const vtagEl = h.querySelector('.jpx-dh-vtag');
                if (vtagEl) vtagEl.addEventListener('click', () => openVersionDialog(page, item));
            }
        }
        // Watchlist — Umbry-native, stored in a synced pref so it behaves identically on
        // Jellyfin/Emby/Plex and follows the account to every device. Toggles in place.
        {
            const wlIn = () => isInWatchlist(item.ServerId, item.Id);
            const wlBtn = makeBtn(
                wlIn() ? 'bookmark_added' : 'bookmark_add',
                wlIn() ? 'Watchlisted' : 'Watchlist',
                () => {
                    const now = toggleWatchlist(item);
                    wlBtn.classList.toggle('jpx-dh-abtn-accent', now);
                    const ic = wlBtn.querySelector('.material-icons');
                    const lb = wlBtn.querySelector('.jpx-dh-abtn-lb');
                    if (ic) ic.textContent = now ? 'bookmark_added' : 'bookmark_add';
                    if (lb) lb.textContent = now ? 'Watchlisted' : 'Watchlist';
                },
                wlIn() ? 'jpx-dh-abtn-accent' : ''
            );
            actions.appendChild(wlBtn);
        }

        if (document.querySelector(castSel)) actions.appendChild(makeBtn('cast', 'Cast', castFn));
        if (!isCollection && hasStock('.btnPlayTrailer')) actions.appendChild(makeBtn('theaters', 'Trailer', clickStock('.btnPlayTrailer')));

        // secondary (revealed by More). Playstate/rating/more-commands are set up asynchronously by
        // the controller, so gate them on EXISTENCE (they're effectively always present); trailer and
        // download are genuinely conditional so keep their hide-state gate.
        const exists = (sel) => !!page.querySelector(sel);
        const secondary = [];
        // Directly wired now (real state + feedback), not delegated to hidden stock buttons.
        if (!isCollection) {
            const playedBtn = makeBtn('check_circle_outline', 'Unwatched', null, 'jpx-dh-abtn-more');
            jpxWirePlayed(playedBtn, item, apiClient, item.Type === 'Book' || item.MediaType === 'Book');
            secondary.push(playedBtn);
        }
        const favBtn = makeBtn('favorite_border', 'Favorite', null, 'jpx-dh-abtn-more');
        jpxWireFavorite(favBtn, item, apiClient);
        secondary.push(favBtn);
        secondary.push(makeBtn('playlist_add', 'Playlist', () => jpxOpenPlaylist(item, apiClient), 'jpx-dh-abtn-more'));
        if (hasStock('.btnDownload')) secondary.push(makeBtn('get_app', 'Download', clickStock('.btnDownload'), 'jpx-dh-abtn-more'));

        if (secondary.length) {
            const moreBtn = makeBtn('expand_more', 'More', () => {
                const open = h.classList.toggle('jpx-dh-expanded');
                moreBtn.querySelector('.material-icons').textContent = open ? 'expand_less' : 'expand_more';
                moreBtn.querySelector('.jpx-dh-abtn-lb').textContent = open ? 'Less' : 'More';
            }, 'jpx-dh-abtn-toggle');
            actions.appendChild(moreBtn);
            secondary.forEach(b => actions.appendChild(b));
        }

        // ---- Series: a Moonfin-style "Next Up" episode card, between the actions and the tabs ----
        if (isSeries) {
            const nu = document.createElement('div');
            nu.className = 'jpx-dh-nextup';
            h.appendChild(nu);
            try {
                apiClient.getNextUpEpisodes({ SeriesId: item.Id, UserId: apiClient.getCurrentUserId(), Limit: 1, Fields: 'Overview,PrimaryImageAspectRatio' }).then(res => {
                    const ep = ((res && res.Items) || [])[0];
                    if (!ep) { nu.remove(); return; }
                    const tag = ep.ImageTags && ep.ImageTags.Primary;
                    const thumb = tag ? apiClient.getScaledImageUrl(ep.Id, { type: 'Primary', maxWidth: 500, tag: tag }) : '';
                    const sxe = 'S' + (ep.ParentIndexNumber != null ? ep.ParentIndexNumber : 1) + ':E' + (ep.IndexNumber != null ? ep.IndexNumber : 1);
                    let rem = '';
                    const pos = ep.UserData && ep.UserData.PlaybackPositionTicks;
                    if (pos && ep.RunTimeTicks) { const m = Math.round((ep.RunTimeTicks - pos) / 600000000); if (m > 0) rem = m + 'm remaining'; }
                    else if (ep.RunTimeTicks) { rem = Math.round(ep.RunTimeTicks / 600000000) + 'm'; }
                    // The series Play button plays the Next Up episode — if that episode is partly
                    // watched, reflect Resume + its progress on the header Play button.
                    if (pos && ep.RunTimeTicks) {
                        const pb = h.querySelector('.jpx-dh-play');
                        if (pb && !pb.classList.contains('jpx-dh-play-resume')) {
                            pb.classList.add('jpx-dh-play-resume');
                            const lb = pb.querySelector('.jpx-dh-play-lb'); if (lb) lb.textContent = 'Resume';
                            const fill = pb.querySelector('.jpx-dh-play-prog-fill');
                            if (fill) fill.style.width = Math.max(0, Math.min(100, (pos / ep.RunTimeTicks) * 100)).toFixed(1) + '%';
                        }
                    }
                    nu.innerHTML = '<div class="jpx-dh-nextup-label">Next Up</div>'
                        + '<a class="jpx-dh-nextup-card" href="#/details?id=' + ep.Id + '">'
                        + '<div class="jpx-dh-nextup-info">'
                        + '<div class="jpx-dh-nextup-title">' + esc(sxe + ' - ' + (ep.Name || '')) + '</div>'
                        + (ep.Overview ? '<div class="jpx-dh-nextup-syn">' + esc(ep.Overview) + '</div>' : '')
                        + (rem ? '<div class="jpx-dh-nextup-rem">' + esc(rem) + '</div>' : '')
                        + '</div>'
                        + '<div class="jpx-dh-nextup-thumb"' + (thumb ? ' style="background-image:url(\'' + thumb + '\')"' : '') + '>'
                        + '<span class="material-icons" aria-hidden="true">play_circle_filled</span></div></a>';
                }).catch(() => { nu.remove(); });
            } catch (e) { nu.remove(); }
        }

        // ---- Moonfin-style tabbed area (Cast / Crew / Studios / Chapters / Details / Similar) ----
        buildDetailTabs(h, page, item, apiClient);
    } catch (e) {
        console.error('[jpxDetailHeader] failed', e);
        try { page.classList.remove('jpx-custom-detail'); } catch (err) { /* ignore */ }
    }
}

// =====================================================================================
// Moonfin-style tabbed content area. A pill tab bar swaps the content below it between
// Cast / Crew / Studios / Chapters / Details / Similar, built from the item data (Similar
// is fetched lazily). Replaces the stock stacked cast/similar/chapters/media-info sections,
// which are hidden via the `.jpx-custom-tabs` page class.
// =====================================================================================
function personAvatar(apiClient, p, sub) {
    const url = p.PrimaryImageTag
        ? apiClient.getScaledImageUrl(p.Id, { type: 'Primary', maxHeight: 220, tag: p.PrimaryImageTag })
        : null;
    const av = url
        ? '<div class="jpx-tab-avatar" style="background-image:url(\'' + url + '\')"></div>'
        : '<div class="jpx-tab-avatar jpx-tab-avatar-none"><span class="material-icons" aria-hidden="true">person</span></div>';
    return '<a class="jpx-tab-person" href="#/details?id=' + p.Id + '">' + av
        + '<div class="jpx-tab-pname">' + esc(p.Name) + '</div>'
        + (sub ? '<div class="jpx-tab-psub">' + esc(sub) + '</div>' : '') + '</a>';
}
function bytesToSize(b) {
    if (!b) return null;
    const gb = b / 1073741824;
    if (gb >= 1) return gb.toFixed(2) + ' GB';
    return Math.round(b / 1048576) + ' MB';
}
function fmtFps(v) {
    const f = v.RealFrameRate || v.AverageFrameRate;
    if (!f) return null;
    return (Math.round(f * 1000) / 1000) + ' fps';
}
function detailsPanel(item, ms) {
    const streams = (ms && ms.MediaStreams) || [];
    const v = streams.find(s => s.Type === 'Video');
    const a = streams.find(s => s.Type === 'Audio' && s.IsDefault) || streams.find(s => s.Type === 'Audio');
    const sub = streams.find(s => s.Type === 'Subtitle' && s.IsDefault) || streams.find(s => s.Type === 'Subtitle');
    const fname = ms
        ? (ms.Path ? ms.Path.split(/[\\/]/).pop() : (item.Name + (ms.Container ? ('.' + ms.Container) : '')))
        : item.Name;
    const size = ms ? bytesToSize(ms.Size) : null;
    const fiSub = [size ? ('Size: ' + size) : null, ms && ms.Container ? ('Format: ' + ms.Container.toUpperCase()) : null]
        .filter(Boolean).join('  ·  ');
    const rows = [];
    if (v) {
        const bits = [];
        if (v.Codec) bits.push(v.Codec.toUpperCase());
        if (v.Width && v.Height) bits.push(v.Width + ' x ' + v.Height);
        const fps = fmtFps(v); if (fps) bits.push(fps);
        if (v.BitDepth) bits.push(v.BitDepth + '-bit');
        if (v.VideoRange) bits.push(v.VideoRange);
        rows.push(['Video', bits.join('  ·  ')]);
    }
    if (a) rows.push(['Audio', a.DisplayTitle || [a.Language, a.Codec, a.ChannelLayout].filter(Boolean).join(' ')]);
    if (sub) rows.push(['Subtitles', sub.DisplayTitle || [sub.Language, sub.Codec].filter(Boolean).join(' ')]);
    return '<div class="jpx-tab-details">'
        + '<div class="jpx-tab-fi-title">File Information</div>'
        + '<div class="jpx-tab-fi-card"><div class="jpx-tab-fi-name">' + esc(fname) + '</div>'
        + (fiSub ? '<div class="jpx-tab-fi-sub">' + esc(fiSub) + '</div>' : '') + '</div>'
        + rows.map(r => '<div class="jpx-tab-fi-row"><span class="jpx-tab-fi-k">' + r[0]
            + '</span><span class="jpx-tab-fi-v">' + esc(r[1]) + '</span></div>').join('')
        + '</div>';
}
function loadSimilar(item, apiClient, el) {
    if (!el) return;
    try {
        apiClient.getSimilarItems(item.Id, {
            userId: apiClient.getCurrentUserId(), limit: 12, fields: 'PrimaryImageAspectRatio'
        }).then(res => {
            const items = (res && res.Items) || res || [];
            el.classList.remove('jpx-tab-loading');
            if (!items.length) { el.innerHTML = '<div class="jpx-tab-empty">No similar titles.</div>'; return; }
            el.innerHTML = items.map(s => {
                const tag = s.ImageTags && s.ImageTags.Primary;
                const url = tag ? apiClient.getScaledImageUrl(s.Id, { type: 'Primary', maxHeight: 400, tag: tag }) : null;
                return '<a class="jpx-tab-simcard" href="#/details?id=' + s.Id + '">'
                    + '<div class="jpx-tab-simposter"' + (url ? ' style="background-image:url(\'' + url + '\')"' : '') + '></div>'
                    + '<div class="jpx-tab-simname">' + esc(s.Name) + '</div></a>';
            }).join('');
        }).catch(() => { el.classList.remove('jpx-tab-loading'); el.innerHTML = '<div class="jpx-tab-empty">Could not load similar titles.</div>'; });
    } catch (e) { el.classList.remove('jpx-tab-loading'); }
}
function loadCollectionMovies(item, apiClient, el) {
    if (!el) return;
    try {
        apiClient.getItems(apiClient.getCurrentUserId(), {
            ParentId: item.Id, SortBy: 'SortName', SortOrder: 'Ascending',
            Fields: 'PrimaryImageAspectRatio', Recursive: false
        }).then(res => {
            const items = (res && res.Items) || res || [];
            el.classList.remove('jpx-tab-loading');
            if (!items.length) { el.innerHTML = '<div class="jpx-tab-empty">No items in this collection.</div>'; return; }
            // Standard Jellyfin cards so they inherit the same hover-morph + behaviour as every other
            // movie poster in the app (a custom card element would not get the morph).
            cardBuilder.buildCards(items, {
                itemsContainer: el,
                shape: 'portrait',
                scalable: true,
                showTitle: true,
                overlayText: false,
                centerText: true,
                includeParentInfoInTitle: false,
                allowBottomPadding: false
            });
        }).catch(() => { el.classList.remove('jpx-tab-loading'); el.innerHTML = '<div class="jpx-tab-empty">Could not load this collection.</div>'; });
    } catch (e) { el.classList.remove('jpx-tab-loading'); }
}
function loadSeriesSeasons(item, apiClient, el) {
    if (!el) return;
    try {
        apiClient.getItems(apiClient.getCurrentUserId(), {
            ParentId: item.Id, IncludeItemTypes: 'Season', SortBy: 'SortName', SortOrder: 'Ascending',
            Fields: 'PrimaryImageAspectRatio,ChildCount', Recursive: false
        }).then(res => {
            const items = (res && res.Items) || res || [];
            el.classList.remove('jpx-tab-loading');
            if (!items.length) { el.innerHTML = '<div class="jpx-tab-empty">No seasons.</div>'; return; }
            cardBuilder.buildCards(items, {
                itemsContainer: el, shape: 'portrait', scalable: true, showTitle: true,
                overlayText: false, centerText: true, showItemCounts: true, allowBottomPadding: false
            });
        }).catch(() => { el.classList.remove('jpx-tab-loading'); el.innerHTML = '<div class="jpx-tab-empty">Could not load seasons.</div>'; });
    } catch (e) { el.classList.remove('jpx-tab-loading'); }
}
function loadSeriesEpisodes(item, apiClient, el) {
    if (!el) return;
    try {
        apiClient.getItems(apiClient.getCurrentUserId(), {
            ParentId: item.Id, IncludeItemTypes: 'Episode', Recursive: true,
            SortBy: 'ParentIndexNumber,IndexNumber', SortOrder: 'Ascending',
            Fields: 'PrimaryImageAspectRatio,Overview', Limit: 200
        }).then(res => {
            const items = (res && res.Items) || res || [];
            el.classList.remove('jpx-tab-loading');
            if (!items.length) { el.innerHTML = '<div class="jpx-tab-empty">No episodes.</div>'; return; }
            cardBuilder.buildCards(items, {
                itemsContainer: el, shape: 'backdrop', scalable: true, showTitle: true,
                overlayText: false, showParentTitle: false, centerText: false, allowBottomPadding: false
            });
        }).catch(() => { el.classList.remove('jpx-tab-loading'); el.innerHTML = '<div class="jpx-tab-empty">Could not load episodes.</div>'; });
    } catch (e) { el.classList.remove('jpx-tab-loading'); }
}
function buildDetailTabs(container, page, item, apiClient) {
    try {
        const people = item.People || [];
        const cast = people.filter(p => p.Type === 'Actor' || p.Type === 'GuestStar');
        const crew = people.filter(p => p.Type && p.Type !== 'Actor' && p.Type !== 'GuestStar');
        const studios = item.Studios || [];
        const chapters = item.Chapters || [];
        const ms = (item.MediaSources || [])[0];

        const isCollection = item.Type === 'BoxSet';
        const isSeries = item.Type === 'Series';
        const isSeason = item.Type === 'Season';
        const tabs = [];
        if (isCollection) {
            tabs.push({ id: 'movies', label: 'Movies' });
            if (cast.length) tabs.push({ id: 'cast', label: 'Cast' });
            if (crew.length) tabs.push({ id: 'crew', label: 'Crew' });
        } else if (isSeries) {
            tabs.push({ id: 'seasons', label: 'Seasons' });
            tabs.push({ id: 'episodes', label: 'Episodes' });
            if (cast.length) tabs.push({ id: 'cast', label: 'Cast' });
            if (crew.length) tabs.push({ id: 'crew', label: 'Crew' });
            if (studios.length) tabs.push({ id: 'studios', label: 'Studios' });
        } else if (isSeason) {
            tabs.push({ id: 'episodes', label: 'Episodes' });
            if (cast.length) tabs.push({ id: 'cast', label: 'Cast' });
            if (crew.length) tabs.push({ id: 'crew', label: 'Crew' });
            if (studios.length) tabs.push({ id: 'studios', label: 'Studios' });
        } else {
            if (cast.length) tabs.push({ id: 'cast', label: 'Cast' });
            if (crew.length) tabs.push({ id: 'crew', label: 'Crew' });
            if (studios.length) tabs.push({ id: 'studios', label: 'Studios' });
            if (chapters.length) tabs.push({ id: 'chapters', label: 'Chapters' });
            // "Show Technical Details" off -> drop the Details tab (codec/bitrate/file info).
            if (ms && getPref('pref_detail_show_technical_details', true)) tabs.push({ id: 'details', label: 'Details' });
            tabs.push({ id: 'similar', label: 'Similar' });
        }
        if (tabs.length < 1) return;

        const root = document.createElement('div');
        root.className = 'jpx-tabs';
        root.innerHTML = '<div class="jpx-tabbar">'
            + tabs.map((t, i) => '<button type="button" class="jpx-tab' + (i === 0 ? ' active' : '')
                + '" data-tab="' + t.id + '">' + t.label + '</button>').join('')
            + '</div><div class="jpx-tab-panels"></div>';
        container.appendChild(root);
        const panels = root.querySelector('.jpx-tab-panels');

        const buildPanel = (id) => {
            if (id === 'cast') return '<div class="jpx-tab-people">' + cast.map(p => personAvatar(apiClient, p, p.Role)).join('') + '</div>';
            if (id === 'crew') return '<div class="jpx-tab-people">' + crew.map(p => personAvatar(apiClient, p, p.Role || p.Type)).join('') + '</div>';
            if (id === 'studios') return '<div class="jpx-tab-studios">' + studios.map(s => '<div class="jpx-tab-studio">' + esc(s.Name) + '</div>').join('') + '</div>';
            if (id === 'chapters') {
                return '<div class="jpx-tab-chapters">' + chapters.map((c, i) => {
                    const url = c.ImageTag ? apiClient.getScaledImageUrl(item.Id, { type: 'Chapter', maxWidth: 320, tag: c.ImageTag, index: i }) : null;
                    const secs = Math.round((c.StartPositionTicks || 0) / 600000000);
                    const time = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
                    return '<div class="jpx-tab-chapter"><div class="jpx-tab-chapter-img"'
                        + (url ? ' style="background-image:url(\'' + url + '\')"' : '')
                        + '>' + (url ? '' : '<span class="material-icons" aria-hidden="true">movie</span>') + '</div>'
                        + '<div class="jpx-tab-chapter-name">' + esc(c.Name || ('Chapter ' + (i + 1))) + '</div>'
                        + '<div class="jpx-tab-chapter-time">' + time + '</div></div>';
                }).join('') + '</div>';
            }
            if (id === 'details') {
                // reflect the currently-selected version (the Version picker changes .selectSource)
                const cs = page && page.querySelector('.selectSource');
                const curMs = cs ? (item.MediaSources || []).find(s => String(s.Id) === String(cs.value)) : null;
                return detailsPanel(item, curMs || ms);
            }
            if (id === 'similar') return '<div class="jpx-tab-similar-grid jpx-tab-loading">Loading…</div>';
            if (id === 'movies') return '<div class="itemsContainer vertical-wrap jpx-coll-movies jpx-tab-loading">Loading…</div>';
            if (id === 'seasons') return '<div class="itemsContainer vertical-wrap jpx-series-seasons jpx-tab-loading">Loading…</div>';
            if (id === 'episodes') return '<div class="itemsContainer vertical-wrap jpx-series-episodes jpx-tab-loading">Loading…</div>';
            return '';
        };

        const show = (id) => {
            Array.from(root.querySelectorAll('.jpx-tab')).forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === id));
            panels.innerHTML = '<div class="jpx-tab-panel jpx-tab-panel-' + id + '">' + buildPanel(id) + '</div>';
            if (id === 'similar') loadSimilar(item, apiClient, panels.querySelector('.jpx-tab-similar-grid'));
            if (id === 'movies') loadCollectionMovies(item, apiClient, panels.querySelector('.jpx-coll-movies'));
            if (id === 'seasons') loadSeriesSeasons(item, apiClient, panels.querySelector('.jpx-series-seasons'));
            if (id === 'episodes') loadSeriesEpisodes(item, apiClient, panels.querySelector('.jpx-series-episodes'));
            const active = root.querySelector('.jpx-tab.active');
            if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        };
        root.querySelectorAll('.jpx-tab').forEach(b => b.addEventListener('click', () => show(b.getAttribute('data-tab'))));
        show(tabs[0].id);

        if (page) page.classList.add('jpx-custom-tabs');
    } catch (e) {
        console.error('[jpxDetailHeader] tabs failed', e);
    }
}

// Our own subtitle-track picker (reads the options from the stock <select is="emby-select">, since a
// programmatic click can't open a native select). Selecting one sets the select's value + fires
// change, so playback picks it up exactly as if the user used the stock control.
function openSubtitleDialog(page, item) {
    try {
        const sel = page.querySelector('.selectSubtitles');
        if (!sel) return;
        // Build the list from the item's subtitle streams so it reads like Moonfin
        // ("None" / "1 - English (SUBRIP)" with a "SUBRIP · Internal" sub-line).
        const streams = (((item && item.MediaSources) || [])[0] || {}).MediaStreams || [];
        const subs = streams.filter(s => s.Type === 'Subtitle');
        const curVal = String(sel.value);
        const rows = [];
        rows.push({ main: 'None', sub: '', value: '-1', selected: curVal === '-1' || curVal === '' });
        subs.forEach((s, i) => {
            const lang = s.DisplayLanguage || s.Language || s.Title || 'Unknown';
            const codec = (s.Codec ? s.Codec.toUpperCase() : '');
            const codecPart = ((s.IsHearingImpaired ? 'SDH ' : '') + codec).trim();
            const main = (i + 1) + ' - ' + lang + (codecPart ? ' (' + codecPart + ')' : '');
            const sub = [codec, s.IsExternal ? 'External' : 'Internal'].filter(Boolean).join(' · ');
            rows.push({ main: main, sub: sub, value: String(s.Index), selected: curVal === String(s.Index) });
        });
        // Fall back to the raw <option>s if the streams weren't available.
        if (rows.length === 1) {
            Array.from(sel.querySelectorAll('option')).forEach(o => {
                rows.push({ main: (o.textContent || '').trim(), sub: '', value: o.value, selected: o.selected });
            });
        }
        const host = document.createElement('div');
        host.className = 'jpx-sub-overlay';
        host.innerHTML = '<div class="jpx-sub-card"><div class="jpx-sub-title">Subtitle Track</div>'
            + '<div class="jpx-sub-list">'
            + rows.map(r => '<button type="button" class="jpx-sub-item' + (r.selected ? ' selected' : '')
                + '" data-v="' + esc(r.value) + '"><span class="jpx-sub-radio"></span>'
                + '<span class="jpx-sub-body"><span class="jpx-sub-main">' + esc(r.main) + '</span>'
                + (r.sub ? '<span class="jpx-sub-note">' + esc(r.sub) + '</span>' : '') + '</span></button>').join('')
            + '</div><button type="button" class="jpx-sub-item jpx-sub-cancel"><span class="jpx-sub-radio"></span><span class="jpx-sub-body"><span class="jpx-sub-main">Cancel</span></span></button></div>';
        document.body.appendChild(host);
        const close = () => { try { host.remove(); } catch (e) { /* ignore */ } };
        host.addEventListener('click', (e) => { if (e.target === host) close(); });
        host.querySelector('.jpx-sub-cancel').addEventListener('click', close);
        host.querySelectorAll('.jpx-sub-item[data-v]').forEach(b => b.addEventListener('click', () => {
            try { sel.value = b.getAttribute('data-v'); sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ignore */ }
            close();
        }));
    } catch (e) { console.error('[jpxDetailHeader] subtitle dialog failed', e); }
}

// Select Version dialog — lists the item's media versions (multiple files/sources) as
// "<name>" + "<CONTAINER> | <bitrate> Mbps", and on pick switches the stock .selectSource (which
// the Play button reads) so playback uses the chosen version. Reuses the .jpx-sub-* dialog styles.
function openVersionDialog(page, item) {
    try {
        const sel = page.querySelector('.selectSource');
        if (!sel) return;
        const sources = (item && item.MediaSources) || [];
        const curVal = String(sel.value);
        const fmtBitrate = (bps) => bps ? (bps / 1000000).toFixed(1) + ' Mbps' : '';
        let rows = sources.map(s => {
            const note = [s.Container ? s.Container.toUpperCase() : '', fmtBitrate(s.Bitrate)].filter(Boolean).join(' | ');
            return { main: s.Name || item.Name, sub: note, value: String(s.Id), selected: curVal === String(s.Id) };
        });
        // Fall back to the raw <option>s if MediaSources weren't populated.
        if (!rows.length) {
            rows = Array.from(sel.querySelectorAll('option')).map(o => ({ main: (o.textContent || '').trim(), sub: '', value: o.value, selected: o.selected }));
        }
        if (rows.length && !rows.some(r => r.selected)) rows[0].selected = true;

        const host = document.createElement('div');
        host.className = 'jpx-sub-overlay';
        host.innerHTML = '<div class="jpx-sub-card"><div class="jpx-sub-title">Select Version</div>'
            + '<div class="jpx-sub-list">'
            + rows.map(r => '<button type="button" class="jpx-sub-item' + (r.selected ? ' selected' : '')
                + '" data-v="' + esc(r.value) + '"><span class="jpx-sub-radio"></span>'
                + '<span class="jpx-sub-body"><span class="jpx-sub-main">' + esc(r.main) + '</span>'
                + (r.sub ? '<span class="jpx-sub-note">' + esc(r.sub) + '</span>' : '') + '</span></button>').join('')
            + '</div><button type="button" class="jpx-sub-item jpx-sub-cancel"><span class="jpx-sub-radio"></span><span class="jpx-sub-body"><span class="jpx-sub-main">Cancel</span></span></button></div>';
        document.body.appendChild(host);
        const close = () => { try { host.remove(); } catch (e) { /* ignore */ } };
        host.addEventListener('click', (e) => { if (e.target === host) close(); });
        host.querySelector('.jpx-sub-cancel').addEventListener('click', close);
        host.querySelectorAll('.jpx-sub-item[data-v]').forEach(b => b.addEventListener('click', () => {
            try {
                const vid = b.getAttribute('data-v');
                sel.value = vid;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                // keep the accent title tag in sync with the chosen version
                const tag = document.querySelector('.jpx-dh-vtag');
                const main = b.querySelector('.jpx-sub-main');
                if (tag && main) tag.textContent = main.textContent;
                // if this version differs in runtime, update the header runtime + "Ends at"
                const src = ((item && item.MediaSources) || []).find(s => String(s.Id) === String(vid));
                if (src && src.RunTimeTicks) {
                    const rtEl = document.querySelector('.jpx-dh-rt');
                    const nrt = fmtRuntime(src.RunTimeTicks);
                    if (rtEl && nrt) rtEl.innerHTML = '<span class="material-icons" aria-hidden="true">schedule</span>' + nrt;
                    const endsEl = document.querySelector('.jpx-dh-ends');
                    const nends = endsAt(src.RunTimeTicks);
                    if (endsEl && nends) endsEl.textContent = 'Ends at ' + nends;
                }
                // quality badges reflect the chosen version too (mp4 1080p vs mkv 4K, etc.)
                const badgesEl = document.querySelector('.jpx-dh-badges');
                if (badgesEl && src) badgesEl.innerHTML = qualityBadges(src);
                // if the Details tab is open, re-render it so its file info reflects the new version
                const activeTab = document.querySelector('.jpx-tab.active');
                if (activeTab && activeTab.getAttribute('data-tab') === 'details') activeTab.click();
            } catch (e) { /* ignore */ }
            close();
        }));
    } catch (e) { console.error('[jpxDetailHeader] version dialog failed', e); }
}

// =====================================================================================
// Studio / Genre "grouping" page — Moonfin style: a scoped library grid with a centered
// title + item count, a Search-this-library bar, Sort & Filter + Display sheets, and a
// poster grid filtered by StudioIds / GenreIds. Replaces the stock grouping detail page.
// =====================================================================================
var GRP_SORTS = [
    { by: 'SortName', label: 'Name' }, { by: 'DateCreated', label: 'Date Added' },
    { by: 'PremiereDate', label: 'Premiere Date' }, { by: 'CommunityRating', label: 'Rating' },
    { by: 'DatePlayed', label: 'Last Played' }, { by: 'PlayCount', label: 'Play Count' },
    { by: 'CriticRating', label: 'Critic Rating' }, { by: 'CommunityRating', label: 'Community Rating' },
    { by: 'Runtime', label: 'Runtime' }, { by: 'Random', label: 'Random' }
];

function renderJpxGrouping(page, item, apiClient) {
    try {
        const prev = page.querySelector('.jpx-detail-header');
        if (prev) prev.remove();
        const h = document.createElement('div');
        h.className = 'jpx-detail-header jpx-grouping';
        // Frosted-glass look (Sean): black ground + a dim Umbry aurora glow the panel can blur.
        // Inline styles on a real element — pseudo/class approaches kept losing the cascade.
        const glow = document.createElement('div');
        glow.className = 'jpx-grp-glow';
        glow.style.cssText = 'position:fixed;top:-12%;left:-12%;right:-12%;bottom:-12%;z-index:0;pointer-events:none;'
            + 'background-color:#000;background-image:'
            + 'radial-gradient(46% 34% at 18% 12%, rgba(255,154,75,0.38), transparent 70%),'
            + 'radial-gradient(52% 40% at 84% 30%, rgba(147,133,245,0.36), transparent 72%),'
            + 'radial-gradient(50% 38% at 40% 86%, rgba(199,123,216,0.30), transparent 72%);'
            + 'filter:blur(46px) saturate(1.15);';
        h.innerHTML =
            '<div class="jpx-grp-head"><span class="jpx-grp-title">' + esc(item.Name) + '</span><span class="jpx-grp-count"></span></div>'
            + '<div class="jpx-grp-searchwrap"><span class="material-icons" aria-hidden="true">search</span>'
            + '<input class="jpx-grp-search" type="search" placeholder="Search this library…"></div>'
            + '<div class="jpx-grp-toolbar">'
            + '<button type="button" class="jpx-grp-tbtn jpx-grp-back"><span class="material-icons" aria-hidden="true">arrow_back</span></button>'
            + '<button type="button" class="jpx-grp-tbtn jpx-grp-sort"><span class="material-icons" aria-hidden="true">sort</span></button>'
            + '<button type="button" class="jpx-grp-tbtn jpx-grp-display"><span class="material-icons" aria-hidden="true">tune</span></button>'
            + '</div>'
            + '<div class="jpx-grp-grid itemsContainer vertical-wrap jpx-tab-loading"></div>';
        h.insertBefore(glow, h.firstChild);
        // everything else paints above the glow
        Array.from(h.children).forEach(ch => {
            if (ch === glow) return;
            ch.style.position = 'relative';
            ch.style.zIndex = '1';
        });
        // the frosted panel the cards sit on (inline for the same cascade-proof reason)
        const gridPanel = h.querySelector('.jpx-grp-grid');
        gridPanel.style.cssText += ';position:relative;z-index:1;background-color:rgba(255,255,255,0.07);'
            + '-webkit-backdrop-filter:blur(28px) saturate(1.25);backdrop-filter:blur(28px) saturate(1.25);'
            + 'border:1px solid rgba(255,255,255,0.14);border-radius:20px;'
            + 'padding:1.1em 0.85em 1.4em;box-shadow:0 10px 40px rgba(0,0,0,0.55);';
        const wrap = page.querySelector('.detailPageWrapperContainer');
        if (!wrap || !wrap.parentNode) return;
        wrap.parentNode.insertBefore(h, wrap);
        page.classList.add('jpx-custom-detail');
        page.classList.add('jpx-custom-tabs');
        page.classList.add('jpx-grouping-page');

        const gridEl = h.querySelector('.jpx-grp-grid');
        const countEl = h.querySelector('.jpx-grp-count');
        const searchEl = h.querySelector('.jpx-grp-search');
        let searchTerm = '';
        const reload = () => loadGroupingGrid(item, apiClient, gridEl, countEl, searchTerm);
        let deb;
        searchEl.addEventListener('input', () => { searchTerm = searchEl.value.trim(); clearTimeout(deb); deb = setTimeout(reload, 300); });
        h.querySelector('.jpx-grp-back').addEventListener('click', () => { try { history.back(); } catch (e) { /* ignore */ } });
        // Self-clean on navigation: this legacy-page header (and its fixed glow) can linger over a
        // React route (e.g. Back to /jpxgenres), leaving the old screen painted. HIDE (not remove)
        // while the hash points elsewhere — the cached page is reshown without a controller reload
        // when the user taps the same genre again, so the header must survive for revisits.
        const myHash = location.hash.split('&')[0];
        const onNav = () => {
            if (!h.isConnected) { window.removeEventListener('hashchange', onNav); return; }
            // Hide the WHOLE stale page (header + stock content) while the hash points elsewhere;
            // restore it when the user returns to this same URL (cached reshow, no controller reload).
            page.style.display = (location.hash.split('&')[0] === myHash) ? '' : 'none';
        };
        window.addEventListener('hashchange', onNav);
        h.querySelector('.jpx-grp-sort').addEventListener('click', () => openGroupingSortDialog(reload));
        h.querySelector('.jpx-grp-display').addEventListener('click', () => openGroupingDisplayDialog(reload));
        reload();
    } catch (e) {
        console.error('[jpxDetailHeader] grouping page failed', e);
        try { page.classList.remove('jpx-custom-detail'); page.classList.remove('jpx-custom-tabs'); } catch (err) { /* ignore */ }
    }
}

function loadGroupingGrid(item, apiClient, el, countEl, searchTerm) {
    if (!el) return;
    el.classList.add('jpx-tab-loading'); el.innerHTML = '';
    const s = GRP_SORTS[Math.min(getPref('pref_grp_sortidx', 0), GRP_SORTS.length - 1)] || GRP_SORTS[0];
    const imgType = getPref('pref_grp_imgtype', 'poster');
    const shape = imgType === 'thumb' ? 'backdrop' : (imgType === 'banner' ? 'banner' : 'portrait');
    // grid size class (image type + poster size) drives the column width via CSS
    el.className = 'jpx-grp-grid itemsContainer vertical-wrap jpx-tab-loading jpx-grp-' + imgType
        + ' jpx-grp-' + ({ small: 's', medium: 'm', large: 'l', xl: 'xl' }[getPref('pref_grp_size', 'medium')] || 'm');
    const q = { SortBy: s.by, SortOrder: getPref('pref_grp_sortdir', 'Ascending'),
        Fields: 'PrimaryImageAspectRatio,ProductionYear', Limit: 400 };
    if (item.Type === 'Folder') {
        // a content folder: show its direct children (the books/files inside)
        q.ParentId = item.Id;
    } else {
        q.Recursive = true;
        q.IncludeItemTypes = 'Movie,Series';
        q[item.Type === 'Studio' ? 'StudioIds' : 'GenreIds'] = item.Id;
    }
    if (searchTerm) q.SearchTerm = searchTerm;
    try {
        apiClient.getItems(apiClient.getCurrentUserId(), q).then(res => {
            const items = (res && res.Items) || [];
            const total = (res && typeof res.TotalRecordCount === 'number') ? res.TotalRecordCount : items.length;
            el.classList.remove('jpx-tab-loading');
            if (countEl) countEl.textContent = total + ' Item' + (total === 1 ? '' : 's');
            if (!items.length) { el.innerHTML = '<div class="jpx-tab-empty">Nothing here.</div>'; return; }
            // Hand-rolled cards: cardBuilder.buildCards silently produces NOTHING on a second call
            // into the same container (reload after a Display/Sort change), so build our own —
            // deterministic, and matches Moonfin's poster + title + year anyway.
            const wide = shape !== 'portrait';
            el.innerHTML = items.map(it => {
                const tag = it.ImageTags && it.ImageTags.Primary;
                const url = tag ? apiClient.getScaledImageUrl(it.Id, { type: 'Primary', maxWidth: wide ? 500 : 320, tag: tag }) : null;
                return '<a class="jpx-grpcard' + (wide ? ' jpx-grpcard-wide' : '') + '" href="#/details?id=' + it.Id + '">'
                    + '<div class="jpx-grpcard-img"' + (url ? ' style="background-image:url(\'' + url + '\')"' : '') + '>'
                    + (url ? '' : '<span class="material-icons" aria-hidden="true">movie</span>') + '</div>'
                    + '<div class="jpx-grpcard-t">' + esc(it.Name || '') + '</div>'
                    + (it.ProductionYear ? '<div class="jpx-grpcard-y">' + it.ProductionYear + '</div>' : '')
                    + '</a>';
            }).join('');
        }).catch(() => { el.classList.remove('jpx-tab-loading'); el.innerHTML = '<div class="jpx-tab-empty">Could not load.</div>'; });
    } catch (e) { el.classList.remove('jpx-tab-loading'); }
}

function openGroupingSortDialog(onChange) {
    try {
        const curIdx = getPref('pref_grp_sortidx', 0);
        const dirIcon = () => getPref('pref_grp_sortdir', 'Ascending') === 'Ascending' ? 'arrow_upward' : 'arrow_downward';
        const host = document.createElement('div'); host.className = 'jpx-sub-overlay';
        host.innerHTML = '<div class="jpx-sub-card jpx-disp-card"><div class="jpx-sub-title">Sort &amp; Filter</div>'
            + '<button type="button" class="jpx-sub-item jpx-disp-check jpx-grp-alpha' + (getPref('pref_grp_alphabet', false) ? ' selected' : '') + '">'
            + '<span class="jpx-disp-box"><span class="material-icons" aria-hidden="true">check</span></span>'
            + '<span class="jpx-sub-body"><span class="jpx-sub-main">Show Alphabet</span></span></button>'
            + '<div class="jpx-disp-group">Sort By</div><div class="jpx-sub-list">'
            + GRP_SORTS.map((so, i) => '<button type="button" class="jpx-sub-item jpx-grp-sortopt' + (i === curIdx ? ' selected' : '') + '" data-i="' + i + '">'
                + '<span class="jpx-sub-radio"></span><span class="jpx-sub-body"><span class="jpx-sub-main">' + so.label + '</span></span>'
                + (i === curIdx ? '<span class="jpx-grp-dir material-icons">' + dirIcon() + '</span>' : '') + '</button>').join('')
            + '</div><button type="button" class="jpx-sub-item jpx-sub-cancel"><span class="jpx-sub-radio"></span><span class="jpx-sub-body"><span class="jpx-sub-main">Done</span></span></button></div>';
        document.body.appendChild(host);
        const close = () => { try { host.remove(); } catch (e) { /* ignore */ } };
        host.addEventListener('click', e => { if (e.target === host) close(); });
        host.querySelector('.jpx-sub-cancel').addEventListener('click', close);
        host.querySelector('.jpx-grp-alpha').addEventListener('click', function () {
            const on = !this.classList.contains('selected'); this.classList.toggle('selected', on);
            setPref('pref_grp_alphabet', on); if (onChange) onChange();
        });
        host.querySelectorAll('.jpx-grp-sortopt').forEach(b => b.addEventListener('click', () => {
            const i = parseInt(b.getAttribute('data-i'), 10);
            if (i === getPref('pref_grp_sortidx', 0)) {
                setPref('pref_grp_sortdir', getPref('pref_grp_sortdir', 'Ascending') === 'Ascending' ? 'Descending' : 'Ascending');
            } else { setPref('pref_grp_sortidx', i); }
            host.querySelectorAll('.jpx-grp-sortopt').forEach(x => { x.classList.remove('selected'); const d = x.querySelector('.jpx-grp-dir'); if (d) d.remove(); });
            b.classList.add('selected');
            const ar = document.createElement('span'); ar.className = 'jpx-grp-dir material-icons'; ar.textContent = dirIcon(); b.appendChild(ar);
            if (onChange) onChange();
        }));
    } catch (e) { console.error('[jpxDetailHeader] grouping sort dialog failed', e); }
}

function openGroupingDisplayDialog(onChange) {
    try {
        const section = (title, key, opts, def) => {
            const cur = getPref(key, def);
            return '<div class="jpx-disp-group">' + title + '</div><div class="jpx-sub-list">'
                + opts.map(o => '<button type="button" class="jpx-sub-item jpx-grp-dopt' + (cur === o.v ? ' selected' : '') + '" data-key="' + key + '" data-v="' + o.v + '">'
                    + '<span class="jpx-sub-radio"></span><span class="jpx-sub-body"><span class="jpx-sub-main">' + o.label + '</span></span></button>').join('') + '</div>';
        };
        const host = document.createElement('div'); host.className = 'jpx-sub-overlay';
        host.innerHTML = '<div class="jpx-sub-card jpx-disp-card"><div class="jpx-sub-title">Display</div>'
            + section('Image Type', 'pref_grp_imgtype', [{ v: 'poster', label: 'Poster' }, { v: 'thumb', label: 'Thumb' }, { v: 'banner', label: 'Banner' }], 'poster')
            + section('Poster Size', 'pref_grp_size', [{ v: 'small', label: 'Small' }, { v: 'medium', label: 'Medium' }, { v: 'large', label: 'Large' }, { v: 'xl', label: 'Extra Large' }], 'medium')
            + '<button type="button" class="jpx-sub-item jpx-sub-cancel"><span class="jpx-sub-radio"></span><span class="jpx-sub-body"><span class="jpx-sub-main">Done</span></span></button></div>';
        document.body.appendChild(host);
        const close = () => { try { host.remove(); } catch (e) { /* ignore */ } };
        host.addEventListener('click', e => { if (e.target === host) close(); });
        host.querySelector('.jpx-sub-cancel').addEventListener('click', close);
        host.querySelectorAll('.jpx-grp-dopt').forEach(b => b.addEventListener('click', () => {
            const key = b.getAttribute('data-key'); setPref(key, b.getAttribute('data-v'));
            host.querySelectorAll('.jpx-grp-dopt[data-key="' + key + '"]').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected'); if (onChange) onChange();
        }));
    } catch (e) { console.error('[jpxDetailHeader] grouping display dialog failed', e); }
}

// =====================================================================================
// Book / comic detail — Moonfin style: centered cover, big title, "Year • Books", an
// accent Read pill, circular Unread/Favorite/Download actions, and a Details pill that
// expands the file-info panel. Actions delegate to the stock (hidden) buttons.
// =====================================================================================
function renderJpxBook(page, item, apiClient) {
    try {
        const prev = page.querySelector('.jpx-detail-header');
        if (prev) prev.remove();
        const h = document.createElement('div');
        h.className = 'jpx-detail-header jpx-book';
        const tag = item.ImageTags && item.ImageTags.Primary;
        const cover = tag ? apiClient.getScaledImageUrl(item.Id, { type: 'Primary', maxHeight: 600, tag: tag }) : null;
        const sub = [item.ProductionYear, 'Books'].filter(Boolean).join(' \u2022 ');
        const overview = (item.Overview || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        h.innerHTML =
            (cover ? '<div class="jpx-book-bd" style="background-image:url(\'' + cover + '\')"></div>' : '')
            + '<div class="jpx-book-cover"' + (cover ? ' style="background-image:url(\'' + cover + '\')"' : '') + '>'
            + (cover ? '' : '<span class="material-icons" aria-hidden="true">menu_book</span>') + '</div>'
            + '<div class="jpx-book-main">'
            + '<h1 class="jpx-book-title">' + esc(item.Name) + '</h1>'
            + '<div class="jpx-book-sub">' + esc(sub) + '</div>'
            + (overview ? '<div class="jpx-book-overview">' + esc(overview) + '</div>' : '')
            + '<div class="jpx-book-readrow">'
            + '<button type="button" class="jpx-book-read"><span class="material-icons" aria-hidden="true">menu_book</span><span>Read</span></button>'
            + '<div class="jpx-dh-actions jpx-book-actions"></div>'
            + '</div>'
            + '<button type="button" class="jpx-book-details-btn">Details</button>'
            + '<div class="jpx-book-details hide"></div>'
            + '</div>';
        const wrap = page.querySelector('.detailPageWrapperContainer');
        if (!wrap || !wrap.parentNode) return;
        wrap.parentNode.insertBefore(h, wrap);
        page.classList.add('jpx-custom-detail');
        page.classList.add('jpx-custom-tabs');
        page.classList.add('jpx-book-page');

        h.querySelector('.jpx-book-read').addEventListener('click', () => {
            const b = page.querySelector('.btnPlay:not(.hide)') || page.querySelector('.btnReplay:not(.hide)');
            if (b) b.click();
        });

        const actions = h.querySelector('.jpx-book-actions');
        const mk = (icon, label, onClick) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'jpx-dh-abtn';
            btn.innerHTML = '<span class="jpx-dh-abtn-ic"><span class="material-icons" aria-hidden="true">' + icon
                + '</span></span><span class="jpx-dh-abtn-lb">' + label + '</span>';
            btn.addEventListener('click', onClick);
            actions.appendChild(btn);
            return btn;
        };
        const clickStock = (sel) => () => { const t = page.querySelector(sel); if (t) { try { t.click(); } catch (e) { /* ignore */ } } };
        jpxWirePlayed(mk('check_circle_outline', 'Unread', null), item, apiClient, true);
        jpxWireFavorite(mk('favorite_border', 'Favorite', null), item, apiClient);
        const dl = page.querySelector('.btnDownload');
        if (dl && !dl.classList.contains('hide')) mk('file_download', 'Download', clickStock('.btnDownload'));

        // Details pill -> expands the same file-info panel the movie Details tab uses.
        const dBtn = h.querySelector('.jpx-book-details-btn');
        const dPanel = h.querySelector('.jpx-book-details');
        dBtn.addEventListener('click', () => {
            const open = dPanel.classList.toggle('hide');
            if (!open && !dPanel.innerHTML) {
                dPanel.innerHTML = detailsPanel(item, (item.MediaSources || [])[0]);
            }
        });
    } catch (e) {
        console.error('[jpxDetailHeader] book detail failed', e);
        try { page.classList.remove('jpx-custom-detail'); page.classList.remove('jpx-custom-tabs'); page.classList.remove('jpx-book-page'); } catch (err) { /* ignore */ }
    }
}

// =====================================================================================
// Album / Playlist detail — Umbry original (stock was artist-backdrop soup with no album art
// or even the album name). Square art over an ambient blurred-art glow, title/artist/meta,
// an accent Play pill, Shuffle/Instant Mix/Favorite circles, and a frosted track list with a
// live playing indicator. Track taps start playback from that position.
// =====================================================================================
function fmtSecs(s2) {
    if (!isFinite(s2) || s2 < 0) s2 = 0;
    const m = Math.floor(s2 / 60), x = Math.floor(s2 % 60);
    return m + ':' + String(x).padStart(2, '0');
}

// =====================================================================================
// MusicArtist detail — Umbry: backdrop hero (Sean's rule), name, Play/Shuffle/Instant Mix/
// Favorite, bio with Read more, and an albums grid. Play delegates to the stock button
// (whose Plex ArtistIds path is now fixed). Same backdrop mechanism as the album page.
// =====================================================================================
function renderJpxArtist(page, item, apiClient) {
    try {
        const prev = page.querySelector('.jpx-detail-header');
        if (prev) prev.remove();
        const h = document.createElement('div');
        h.className = 'jpx-detail-header jpx-album jpx-artist';

        const primaryTag = item.ImageTags && item.ImageTags.Primary;
        const primary = primaryTag ? apiClient.getScaledImageUrl(item.Id, { type: 'Primary', maxWidth: 640, tag: primaryTag }) : null;
        const hasBackdrop = item.BackdropImageTags && item.BackdropImageTags.length;
        const glow = document.createElement('div');
        glow.className = 'jpx-alb-glow';
        if (!hasBackdrop) {
            glow.style.cssText = 'position:fixed;top:-15%;left:-15%;right:-15%;bottom:-15%;z-index:0;pointer-events:none;'
                + 'background-color:#000;background-size:cover;background-position:center;'
                + (primary ? 'background-image:url(\'' + primary + '\');' : '')
                + 'filter:blur(70px) saturate(1.3) brightness(0.42);';
        } else {
            glow.style.cssText = 'display:none;';
        }

        const genre = (item.Genres && item.Genres[0]) || '';
        h.innerHTML =
            '<h1 class="jpx-alb-title">' + esc(item.Name) + '</h1>'
            + (genre ? '<div class="jpx-alb-meta jpx-artist-meta">' + esc(genre) + '</div>' : '')
            + '<button type="button" class="jpx-alb-play"><span class="material-icons" aria-hidden="true">play_arrow</span><span>Play</span></button>'
            + '<div class="jpx-dh-actions jpx-alb-actions"></div>'
            + (item.Overview ? '<div class="jpx-artist-bio"><div class="jpx-artist-bio-text">' + esc(item.Overview) + '</div><button type="button" class="jpx-artist-more">Read more</button></div>' : '')
            + '<div class="jpx-artist-albums-title hide">Albums</div>'
            + '<div class="jpx-artist-albums jpx-tab-loading"></div>';
        h.insertBefore(glow, h.firstChild);
        Array.from(h.children).forEach(ch => { if (ch !== glow) { ch.style.position = 'relative'; ch.style.zIndex = '1'; } });

        const wrap = page.querySelector('.detailPageWrapperContainer');
        if (!wrap || !wrap.parentNode) return;
        wrap.parentNode.insertBefore(h, wrap);
        page.classList.add('jpx-custom-detail');
        page.classList.add('jpx-custom-tabs');
        page.classList.add('jpx-album-page');
        page.classList.toggle('jpx-album-nobd', !hasBackdrop);
        if (hasBackdrop) {
            const bd = apiClient.getScaledImageUrl(item.Id, { type: 'Backdrop', maxWidth: 1920, tag: item.BackdropImageTags[0] });
            if (bd) { h.style.setProperty('--jpx-tv-bd', "url('" + bd + "')"); h.classList.add('jpx-dh-coll'); }
        }

        h.querySelector('.jpx-alb-play').addEventListener('click', () => {
            const b = page.querySelector('.btnPlay:not(.hide)') || page.querySelector('.btnReplay:not(.hide)');
            if (b) b.click();
        });
        const actions = h.querySelector('.jpx-alb-actions');
        const mk = (icon, label, onClick) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'jpx-dh-abtn';
            btn.innerHTML = '<span class="jpx-dh-abtn-ic"><span class="material-icons" aria-hidden="true">' + icon
                + '</span></span><span class="jpx-dh-abtn-lb">' + label + '</span>';
            if (onClick) btn.addEventListener('click', onClick);
            actions.appendChild(btn);
            return btn;
        };
        const clickStock = (sel) => () => { const t = page.querySelector(sel); if (t) { try { t.click(); } catch (e) { /* ignore */ } } };
        if (page.querySelector('.btnShuffle')) mk('shuffle', 'Shuffle', clickStock('.btnShuffle'));
        if (page.querySelector('.btnInstantMix')) mk('explore', 'Instant Mix', clickStock('.btnInstantMix'));
        jpxWireFavorite(mk('favorite_border', 'Favorite', null), item, apiClient);

        const bio = h.querySelector('.jpx-artist-bio');
        if (bio) {
            const txt = bio.querySelector('.jpx-artist-bio-text');
            const moreBtn = bio.querySelector('.jpx-artist-more');
            setTimeout(() => { if (txt.scrollHeight <= txt.clientHeight + 4) moreBtn.classList.add('hide'); }, 80);
            moreBtn.addEventListener('click', () => {
                const expanded = txt.classList.toggle('expanded');
                moreBtn.textContent = expanded ? 'Read less' : 'Read more';
            });
        }

        const grid = h.querySelector('.jpx-artist-albums');
        apiClient.getItems(apiClient.getCurrentUserId(), {
            ParentId: item.Id, IncludeItemTypes: 'MusicAlbum', SortBy: 'ProductionYear,SortName', SortOrder: 'Descending'
        }).then(res => {
            const albums = (res && res.Items) || [];
            grid.classList.remove('jpx-tab-loading');
            if (!albums.length) { grid.innerHTML = ''; return; }
            const titleEl = h.querySelector('.jpx-artist-albums-title');
            if (titleEl) titleEl.classList.remove('hide');
            grid.innerHTML = albums.map(a => {
                const at = a.ImageTags && a.ImageTags.Primary;
                const au = at ? apiClient.getScaledImageUrl(a.Id, { type: 'Primary', maxWidth: 320, tag: at }) : null;
                return '<a class="jpx-grpcard" href="#/details?id=' + a.Id + '">'
                    + '<div class="jpx-grpcard-img"' + (au ? ' style="background-image:url(\'' + au + '\')"' : '') + '>'
                    + (au ? '' : '<span class="material-icons" aria-hidden="true">album</span>') + '</div>'
                    + '<div class="jpx-grpcard-t">' + esc(a.Name) + '</div>'
                    + (a.ProductionYear ? '<div class="jpx-grpcard-y">' + a.ProductionYear + '</div>' : '')
                    + '</a>';
            }).join('');
        }).catch(() => { grid.classList.remove('jpx-tab-loading'); grid.innerHTML = ''; });
    } catch (e) {
        console.error('[jpxDetailHeader] artist detail failed', e);
        try { page.classList.remove('jpx-custom-detail'); page.classList.remove('jpx-custom-tabs'); page.classList.remove('jpx-album-page'); } catch (err) { /* ignore */ }
    }
}

function renderJpxAlbum(page, item, apiClient) {
    try {
        const prev = page.querySelector('.jpx-detail-header');
        if (prev) prev.remove();
        const isPlaylist = item.Type === 'Playlist';
        const h = document.createElement('div');
        h.className = 'jpx-detail-header jpx-album';

        const tag = item.ImageTags && item.ImageTags.Primary;
        const art = tag ? apiClient.getScaledImageUrl(item.Id, { type: 'Primary', maxWidth: 640, tag: tag }) : null;
        // Moonfin layout (Sean): the full-bleed BACKDROP is the hero — album art waits for the
        // Player. Blurred-art glow is only the fallback ground when no backdrop exists.
        const hasBackdrop = (item.BackdropImageTags && item.BackdropImageTags.length)
            || (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length);
        const glow = document.createElement('div');
        glow.className = 'jpx-alb-glow';
        if (!hasBackdrop) {
            glow.style.cssText = 'position:fixed;top:-15%;left:-15%;right:-15%;bottom:-15%;z-index:0;pointer-events:none;'
                + 'background-color:#000;background-size:cover;background-position:center;'
                + (art ? 'background-image:url(\'' + art + '\');' : '')
                + 'filter:blur(70px) saturate(1.3) brightness(0.42);';
        } else {
            glow.style.cssText = 'display:none;';
        }

        const mins = item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600000000) : 0;
        const meta = [item.ProductionYear,
            (item.ChildCount || 0) ? (item.ChildCount + (item.ChildCount === 1 ? ' track' : ' tracks')) : null,
            mins ? (mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm') : null,
            (item.Genres && item.Genres[0]) || null].filter(Boolean).join(' \u2022 ');
        const artist = item.AlbumArtist || (item.AlbumArtists && item.AlbumArtists[0] && item.AlbumArtists[0].Name) || '';
        const artistId = item.AlbumArtists && item.AlbumArtists[0] && item.AlbumArtists[0].Id;

        h.innerHTML =
            '<h1 class="jpx-alb-title">' + esc(item.Name) + '</h1>'
            + (artist ? '<a class="jpx-alb-artist"' + (artistId ? ' href="#/details?id=' + artistId + '"' : '') + '>' + esc(artist) + '</a>' : '')
            + (meta ? '<div class="jpx-alb-meta">' + esc(meta) + '</div>' : '')
            + '<button type="button" class="jpx-alb-play"><span class="material-icons" aria-hidden="true">play_arrow</span><span>Play</span></button>'
            + '<div class="jpx-dh-actions jpx-alb-actions"></div>'
            + '<div class="jpx-alb-tracks jpx-tab-loading"></div>';
        h.insertBefore(glow, h.firstChild);
        Array.from(h.children).forEach(ch => { if (ch !== glow) { ch.style.position = 'relative'; ch.style.zIndex = '1'; } });

        const wrap = page.querySelector('.detailPageWrapperContainer');
        if (!wrap || !wrap.parentNode) return;
        wrap.parentNode.insertBefore(h, wrap);
        page.classList.add('jpx-custom-detail');
        page.classList.add('jpx-custom-tabs');
        page.classList.add('jpx-album-page');
        page.classList.toggle('jpx-album-nobd', !hasBackdrop);
        // Paint the backdrop ourselves via the proven fixed-layer+scrim mechanism — the stock
        // element doesn't populate for albums (their backdrops ride on the ARTIST via Parent tags).
        if (hasBackdrop) {
            let bd = null;
            if (item.BackdropImageTags && item.BackdropImageTags[0]) {
                bd = apiClient.getScaledImageUrl(item.Id, { type: 'Backdrop', maxWidth: 1920, tag: item.BackdropImageTags[0] });
            } else if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags[0]) {
                bd = apiClient.getScaledImageUrl(item.ParentBackdropItemId, { type: 'Backdrop', maxWidth: 1920, tag: item.ParentBackdropImageTags[0] });
            }
            if (bd) { h.style.setProperty('--jpx-tv-bd', "url('" + bd + "')"); h.classList.add('jpx-dh-coll'); }
        }

        h.querySelector('.jpx-alb-play').addEventListener('click', () => {
            const b = page.querySelector('.btnPlay:not(.hide)') || page.querySelector('.btnReplay:not(.hide)');
            if (b) b.click();
        });
        const actions = h.querySelector('.jpx-alb-actions');
        const mk = (icon, label, onClick, cls) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'jpx-dh-abtn' + (cls ? ' ' + cls : '');
            btn.innerHTML = '<span class="jpx-dh-abtn-ic"><span class="material-icons" aria-hidden="true">' + icon
                + '</span></span><span class="jpx-dh-abtn-lb">' + label + '</span>';
            if (onClick) btn.addEventListener('click', onClick);
            actions.appendChild(btn);
            return btn;
        };
        const clickStock = (sel) => () => { const t = page.querySelector(sel); if (t) { try { t.click(); } catch (e) { /* ignore */ } } };
        if (page.querySelector('.btnShuffle')) mk('shuffle', 'Shuffle', clickStock('.btnShuffle'));
        if (page.querySelector('.btnInstantMix')) mk('explore', 'Instant Mix', clickStock('.btnInstantMix'));
        jpxWireFavorite(mk('favorite_border', 'Favorite', null), item, apiClient);
        mk('playlist_add', 'Playlist', () => jpxOpenPlaylist(item, apiClient));
        const dl = page.querySelector('.btnDownload');
        if (dl && !dl.classList.contains('hide')) mk('file_download', 'Download', clickStock('.btnDownload'));

        // ---- frosted track list ----
        const list = h.querySelector('.jpx-alb-tracks');
        const q = isPlaylist
            ? { ParentId: item.Id, Fields: 'MediaSources' }
            : { ParentId: item.Id, SortBy: 'ParentIndexNumber,IndexNumber,SortName', Fields: 'MediaSources' };
        apiClient.getItems(apiClient.getCurrentUserId(), q).then(res => {
            const tracks = (res && res.Items) || [];
            list.classList.remove('jpx-tab-loading');
            if (!tracks.length) { list.innerHTML = '<div class="jpx-tab-empty">No tracks.</div>'; return; }
            list.innerHTML = '<div class="jpx-alb-tracks-title">Track List</div>' + tracks.map((t, i) => {
                const dur = t.RunTimeTicks ? fmtSecs(t.RunTimeTicks / 10000000) : '';
                const tArtist = (t.Artists && t.Artists.join(', ')) || '';
                const sub = (tArtist && tArtist !== artist) ? tArtist : '';
                return '<button type="button" class="jpx-alb-row" data-i="' + i + '" data-id="' + t.Id + '">'
                    + '<span class="jpx-alb-num">' + (t.IndexNumber != null ? t.IndexNumber : (i + 1)) + '</span>'
                    + '<span class="jpx-alb-row-body"><span class="jpx-alb-row-name">' + esc(t.Name) + '</span>'
                    + (sub ? '<span class="jpx-alb-row-sub">' + esc(sub) + '</span>' : '') + '</span>'
                    + '<span class="jpx-alb-dur">' + dur + '</span></button>';
            }).join('');
            const ids = tracks.map(t => t.Id);
            list.querySelectorAll('.jpx-alb-row').forEach(row => row.addEventListener('click', () => {
                const i = parseInt(row.getAttribute('data-i'), 10);
                import(/* webpackChunkName: "playbackmanager" */ 'components/playback/playbackmanager').then(({ playbackManager }) => {
                    playbackManager.play({ ids: ids, startIndex: i, serverId: item.ServerId });
                }).catch(() => { /* ignore */ });
            }));
            // live playing indicator (ember equalizer on the current row)
            const sync = () => {
                if (!list.isConnected) { clearInterval(t2); return; }
                import('components/playback/playbackmanager').then(({ playbackManager }) => {
                    let cur = null;
                    try { const p2 = playbackManager.getCurrentPlayer(); cur = p2 && playbackManager.getPlayerState(p2).NowPlayingItem; } catch (e) { /* ignore */ }
                    list.querySelectorAll('.jpx-alb-row').forEach(row => {
                        const on = cur && row.getAttribute('data-id') === cur.Id;
                        row.classList.toggle('playing', !!on);
                        const num = row.querySelector('.jpx-alb-num');
                        if (on && !num.querySelector('.jpx-mp-eq')) num.innerHTML = '<span class="jpx-mp-eq"><i></i><i></i><i></i></span>';
                        else if (!on && num.querySelector('.jpx-mp-eq')) num.textContent = row.getAttribute('data-i') === null ? '' : (parseInt(row.getAttribute('data-i'), 10) + 1);
                    });
                }).catch(() => { /* ignore */ });
            };
            const t2 = setInterval(sync, 1200);
            sync();
        }).catch(() => { list.classList.remove('jpx-tab-loading'); list.innerHTML = '<div class="jpx-tab-empty">Could not load tracks.</div>'; });
    } catch (e) {
        console.error('[jpxDetailHeader] album detail failed', e);
        try { page.classList.remove('jpx-custom-detail'); page.classList.remove('jpx-custom-tabs'); page.classList.remove('jpx-album-page'); } catch (err) { /* ignore */ }
    }
}

// =====================================================================================
// Person (cast/crew) page — Moonfin style. A ringed headshot + name / born·age / birthplace,
// a bio card with Read More, a white Favorite pill, a Display (sort + group) control, a
// Movies/Series toggle, and a filmography poster grid. Replaces the stock Jellyfin/Emby/Plex
// person page. People carry no art of their own, so the page backdrop is a random title from
// the person's filmography (same fixed-backdrop treatment collections use).
// =====================================================================================
function personAge(premiere, end) {
    try {
        const b = new Date(premiere);
        const e = end ? new Date(end) : new Date();
        let a = e.getFullYear() - b.getFullYear();
        const m = e.getMonth() - b.getMonth();
        if (m < 0 || (m === 0 && e.getDate() < b.getDate())) a--;
        return a >= 0 ? a : null;
    } catch (e) { return null; }
}

function wirePersonReadMore(h) {
    const rm = h.querySelector('.jpx-dh-readmore');
    if (!rm || rm.__wired) return;
    rm.__wired = true;
    const ov = h.querySelector('.jpx-dh-overview');
    const card = h.querySelector('.jpx-dh-overview-card');
    const sync = () => {
        if (!ov || !card) return;
        if (card.classList.contains('expanded')) { rm.style.display = ''; return; }
        rm.style.display = (ov.scrollHeight - ov.clientHeight) > 4 ? '' : 'none';
    };
    rm.style.display = 'none';
    requestAnimationFrame(() => requestAnimationFrame(sync));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync).catch(() => {});
    rm.addEventListener('click', (e) => { e.preventDefault(); const ex = card.classList.toggle('expanded'); rm.textContent = ex ? 'Read Less' : 'Read More'; });
}

// Media servers rarely store a person's bio/birthday/birthplace, so pull them from TMDB (the app
// already uses this key for login backdrops). Uses the person's TMDB id when the server has one
// (ProviderIds.Tmdb), else a name search. Fills the meta/place lines, creates the bio card when the
// server had none, and supplies a headshot when the person has no primary image.
function enrichPersonFromTmdb(h, item) {
    const KEY = '43843453a040275ba615fe17cd272797';
    const idBlock = h.querySelector('.jpx-person-id');
    const apply = (d) => {
        if (!d || d.success === false) return;
        if (d.birthday) {
            const bd = new Date(d.birthday + 'T00:00:00');
            const age = personAge(d.birthday, d.deathday);
            const txt = 'Born ' + bd.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
                + (age != null ? '  ·  ' + (d.deathday ? 'Died at ' + age : 'Age ' + age) : '');
            let el = h.querySelector('.jpx-person-meta');
            if (!el) { el = document.createElement('div'); el.className = 'jpx-person-meta'; idBlock.appendChild(el); }
            el.textContent = txt;
        }
        if (d.place_of_birth) {
            let el = h.querySelector('.jpx-person-place');
            if (!el) { el = document.createElement('div'); el.className = 'jpx-person-place'; idBlock.appendChild(el); }
            el.textContent = d.place_of_birth;
        }
        const bio = d.biography ? d.biography.replace(/^From Wikipedia, the free encyclopedia\.?\s*/i, '').trim() : '';
        if (bio && !h.querySelector('.jpx-dh-overview-card')) {
            const card = document.createElement('div');
            card.className = 'jpx-dh-overview-card';
            card.innerHTML = '<p class="jpx-dh-overview">' + esc(bio) + '</p><a class="jpx-dh-readmore" href="#">Read More</a>';
            const top = h.querySelector('.jpx-person-top');
            if (top) top.insertAdjacentElement('afterend', card);
            wirePersonReadMore(h);
        }
        if (d.profile_path) {
            const av = h.querySelector('.jpx-person-avatar.jpx-person-avatar-none');
            if (av) { av.classList.remove('jpx-person-avatar-none'); av.innerHTML = ''; av.style.backgroundImage = "url('https://image.tmdb.org/t/p/h632" + d.profile_path + "')"; }
        }
    };
    try {
        const tid = item.ProviderIds && (item.ProviderIds.Tmdb || item.ProviderIds.tmdb);
        const get = (id) => fetch('https://api.themoviedb.org/3/person/' + id + '?api_key=' + KEY).then(r => r.json());
        if (tid) { get(tid).then(apply).catch(() => {}); }
        else {
            fetch('https://api.themoviedb.org/3/search/person?api_key=' + KEY + '&query=' + encodeURIComponent(item.Name || ''))
                .then(r => r.json()).then(s => { const f = (s.results || [])[0]; if (f) get(f.id).then(apply).catch(() => {}); }).catch(() => {});
        }
    } catch (e) { /* ignore */ }
}

function renderJpxPerson(page, item, apiClient) {
    try {
        const prev = page.querySelector('.jpx-detail-header');
        if (prev) prev.remove();

        const h = document.createElement('div');
        h.className = 'jpx-detail-header jpx-person jpx-dh-coll';

        const imgTag = item.PrimaryImageTag || (item.ImageTags && item.ImageTags.Primary);
        const imgUrl = imgTag ? apiClient.getScaledImageUrl(item.Id, { type: 'Primary', maxHeight: 400, tag: imgTag }) : null;
        const avatar = '<div class="jpx-person-avatar' + (imgUrl ? '' : ' jpx-person-avatar-none') + '"'
            + (imgUrl ? ' style="background-image:url(\'' + imgUrl + '\')"' : '') + '>'
            + (imgUrl ? '' : '<span class="material-icons" aria-hidden="true">person</span>') + '</div>';

        const metaLines = [];
        if (item.PremiereDate) {
            const d = new Date(item.PremiereDate);
            const born = 'Born ' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
            const age = personAge(item.PremiereDate, item.EndDate);
            metaLines.push(born + (age != null ? '  ·  ' + (item.EndDate ? 'Died at ' + age : 'Age ' + age) : ''));
        } else if (item.EndDate) {
            const dd = new Date(item.EndDate);
            metaLines.push('Died ' + dd.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
        }
        const place = (item.ProductionLocations && item.ProductionLocations[0]) || '';

        const idBlock = '<div class="jpx-person-id">'
            + '<h1 class="jpx-person-name">' + esc(item.Name) + '</h1>'
            + (metaLines.length ? '<div class="jpx-person-meta">' + esc(metaLines[0]) + '</div>' : '')
            + (place ? '<div class="jpx-person-place">' + esc(place) + '</div>' : '')
            + '</div>';

        const overview = item.Overview
            ? '<div class="jpx-dh-overview-card"><p class="jpx-dh-overview">' + esc(item.Overview) + '</p>'
              + '<a class="jpx-dh-readmore" href="#">Read More</a></div>'
            : '';

        const isFav = !!(item.UserData && item.UserData.IsFavorite);
        const favBtn = '<button type="button" class="jpx-person-fav' + (isFav ? ' is-fav' : '') + '">'
            + '<span class="material-icons" aria-hidden="true">favorite</span>'
            + '<span class="jpx-person-fav-lb">' + (isFav ? 'Favorited' : 'Favorite') + '</span></button>';

        const display = '<div class="jpx-person-controls"><button type="button" class="jpx-person-display">'
            + '<span class="jpx-person-display-ic"><span class="material-icons" aria-hidden="true">tune</span></span>'
            + '<span class="jpx-person-display-lb">Display</span></button></div>';

        const seg = '<div class="jpx-person-seg">'
            + '<button type="button" class="jpx-person-seg-btn is-active" data-kind="Movie">Movies</button>'
            + '<button type="button" class="jpx-person-seg-btn" data-kind="Series">Series</button></div>';

        h.innerHTML = '<div class="jpx-person-top">' + avatar + idBlock + '</div>'
            + overview + favBtn + display + seg
            + '<div class="jpx-person-grid itemsContainer vertical-wrap jpx-tab-loading"></div>';

        const wrap = page.querySelector('.detailPageWrapperContainer');
        if (!wrap || !wrap.parentNode) return;
        wrap.parentNode.insertBefore(h, wrap);
        page.classList.add('jpx-custom-detail');
        page.classList.add('jpx-custom-tabs');
        page.classList.add('jpx-person-page');

        wirePersonReadMore(h);
        // People carry little metadata on the media server (usually just a photo + filmography),
        // so enrich born/age/birthplace/bio (and a headshot fallback) from TMDB.
        enrichPersonFromTmdb(h, item);

        // ---- Favorite -> server favorite status (identical on Jellyfin/Emby/Plex) ----
        const fav = h.querySelector('.jpx-person-fav');
        fav.addEventListener('click', () => {
            const cur = fav.classList.contains('is-fav');
            Promise.resolve(apiClient.updateFavoriteStatus(apiClient.getCurrentUserId(), item.Id, !cur)).then(() => {
                fav.classList.toggle('is-fav', !cur);
                fav.querySelector('.jpx-person-fav-lb').textContent = !cur ? 'Favorited' : 'Favorite';
            }).catch(() => {});
        });

        // ---- Movies / Series toggle + filmography grid ----
        let kind = 'Movie';
        let bdSet = false;
        const gridEl = h.querySelector('.jpx-person-grid');
        const reload = () => loadPersonFilmography(item, apiClient, gridEl, kind, (url) => {
            if (url && !bdSet) { bdSet = true; h.style.setProperty('--jpx-tv-bd', "url('" + url + "')"); }
        });
        h.querySelectorAll('.jpx-person-seg-btn').forEach(b => b.addEventListener('click', () => {
            const k = b.getAttribute('data-kind');
            if (k === kind) return;
            kind = k;
            h.querySelectorAll('.jpx-person-seg-btn').forEach(x => x.classList.toggle('is-active', x === b));
            reload();
        }));

        // ---- Display options (sort + group) ----
        h.querySelector('.jpx-person-display').addEventListener('click', () => openPersonDisplayDialog(reload));

        reload();
    } catch (e) {
        console.error('[jpxDetailHeader] person page failed', e);
        try { page.classList.remove('jpx-custom-detail'); page.classList.remove('jpx-custom-tabs'); } catch (err) { /* ignore */ }
    }
}

function loadPersonFilmography(item, apiClient, el, kind, onBackdrop) {
    if (!el) return;
    el.classList.add('jpx-tab-loading');
    el.innerHTML = '';
    const sort = getPref('pref_person_sort', 'name');
    const group = getPref('pref_person_group', true);
    let sortBy = 'SortName', sortOrder = 'Ascending';
    if (sort === 'dateAsc') { sortBy = 'PremiereDate,ProductionYear,SortName'; sortOrder = 'Ascending'; }
    else if (sort === 'dateDesc') { sortBy = 'PremiereDate,ProductionYear,SortName'; sortOrder = 'Descending'; }
    try {
        apiClient.getItems(apiClient.getCurrentUserId(), {
            PersonIds: item.Id, Recursive: true, IncludeItemTypes: kind,
            SortBy: sortBy, SortOrder: sortOrder,
            Fields: 'PrimaryImageAspectRatio,ProductionYear,BackdropImageTags',
            Limit: 300
        }).then(res => {
            let items = (res && res.Items) || [];
            el.classList.remove('jpx-tab-loading');
            if (onBackdrop) {
                const withBd = items.filter(i => i.BackdropImageTags && i.BackdropImageTags[0]);
                if (withBd.length) {
                    const p = withBd[Math.floor(Math.random() * withBd.length)];
                    onBackdrop(apiClient.getScaledImageUrl(p.Id, { type: 'Backdrop', maxWidth: 1920, tag: p.BackdropImageTags[0] }));
                }
            }
            // "Group multiple roles" — collapse a title the person appears in more than once
            // (multiple characters / actor+crew) to a single card.
            if (group) { const seen = {}; items = items.filter(i => (seen[i.Id] ? false : (seen[i.Id] = true))); }
            if (!items.length) { el.innerHTML = '<div class="jpx-tab-empty">No ' + (kind === 'Series' ? 'series' : 'movies') + ' found.</div>'; return; }
            cardBuilder.buildCards(items, {
                itemsContainer: el, shape: 'portrait', scalable: true, showTitle: true,
                overlayText: false, centerText: true, includeParentInfoInTitle: false, allowBottomPadding: false
            });
        }).catch(() => { el.classList.remove('jpx-tab-loading'); el.innerHTML = '<div class="jpx-tab-empty">Could not load titles.</div>'; });
    } catch (e) { el.classList.remove('jpx-tab-loading'); }
}

// Display Options sheet — Sort By (Alphabetical / Release Date Asc / Desc) + a "Group multiple
// roles" checkbox. Persists to synced prefs so the choice follows the account. Reuses the
// .jpx-sub-* dialog shell. Each change re-renders the grid live (onChange).
function openPersonDisplayDialog(onChange) {
    try {
        const curSort = getPref('pref_person_sort', 'name');
        const curGroup = getPref('pref_person_group', true);
        const sorts = [
            { v: 'name', label: 'Alphabetical' },
            { v: 'dateAsc', label: 'Release Date (Ascending)' },
            { v: 'dateDesc', label: 'Release Date (Descending)' }
        ];
        const host = document.createElement('div');
        host.className = 'jpx-sub-overlay';
        host.innerHTML = '<div class="jpx-sub-card jpx-disp-card"><div class="jpx-sub-title">Display Options</div>'
            + '<div class="jpx-disp-group">Sort By</div>'
            + '<div class="jpx-sub-list">'
            + sorts.map(s => '<button type="button" class="jpx-sub-item jpx-disp-sort' + (curSort === s.v ? ' selected' : '')
                + '" data-v="' + s.v + '"><span class="jpx-sub-radio"></span>'
                + '<span class="jpx-sub-body"><span class="jpx-sub-main">' + s.label + '</span></span></button>').join('')
            + '</div>'
            + '<div class="jpx-disp-group">Group Contributions</div>'
            + '<button type="button" class="jpx-sub-item jpx-disp-check' + (curGroup ? ' selected' : '') + '">'
            + '<span class="jpx-disp-box"><span class="material-icons" aria-hidden="true">check</span></span>'
            + '<span class="jpx-sub-body"><span class="jpx-sub-main">Group multiple roles</span></span></button>'
            + '<button type="button" class="jpx-sub-item jpx-sub-cancel"><span class="jpx-sub-radio"></span><span class="jpx-sub-body"><span class="jpx-sub-main">Done</span></span></button>'
            + '</div>';
        document.body.appendChild(host);
        const close = () => { try { host.remove(); } catch (e) { /* ignore */ } };
        host.addEventListener('click', (e) => { if (e.target === host) close(); });
        host.querySelector('.jpx-sub-cancel').addEventListener('click', close);
        host.querySelectorAll('.jpx-disp-sort').forEach(b => b.addEventListener('click', () => {
            host.querySelectorAll('.jpx-disp-sort').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            setPref('pref_person_sort', b.getAttribute('data-v'));
            if (onChange) onChange();
        }));
        const chk = host.querySelector('.jpx-disp-check');
        chk.addEventListener('click', () => {
            const on = !chk.classList.contains('selected');
            chk.classList.toggle('selected', on);
            setPref('pref_person_group', on);
            if (onChange) onChange();
        });
    } catch (e) { console.error('[jpxDetailHeader] display dialog failed', e); }
}

export default renderJpxDetailHeader;
