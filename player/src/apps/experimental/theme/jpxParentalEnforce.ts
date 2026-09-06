// Umbry Kids Mode enforcement for Jellyfin/Emby. Patches the ApiClient's list methods once so
// that, while Kids Mode is active, restricted items are stripped from (or, in "lock" mode, kept in
// but PIN-gated) every result the UI renders. Also injects Genres/Tags into list requests so the
// genre/tag block has the metadata it needs to match. Filtering logic is shared with the Plex shim
// wrapper in jpxParental (filterListResult / applyViewsFilter). Off = pass-through.

import { ApiClient } from 'jellyfin-apiclient';

import { filterListResult, applyViewsFilter, kidsModeActive } from './jpxParental';

type Result = unknown;

// Ensure a query-options object requests Genres + Tags (needed for genre/tag blocking).
function ensureFields(opts: unknown): void {
    if (!opts || typeof opts !== 'object') return;
    const o = opts as Record<string, unknown>;
    const need = [ 'Genres', 'Tags' ];
    const cur = o.Fields;
    if (typeof cur === 'string') {
        const have = cur.split(',').map(x => x.trim()).filter(Boolean);
        for (const f of need) if (!have.includes(f)) have.push(f);
        o.Fields = have.join(',');
    } else if (Array.isArray(cur)) {
        for (const f of need) if (!cur.includes(f)) cur.push(f);
    } else {
        o.Fields = need.join(',');
    }
}

// Wrap a list method: optionally inject fields into the options arg, then post-filter the result.
function wrapList(name: string, optsArgIndex: number): void {
    const proto = ApiClient.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    const flag = '__jpxParentalWrapped_' + name;
    if ((proto as unknown as Record<string, boolean>)[flag]) return;
    proto[name] = function patched(this: unknown, ...args: unknown[]) {
        if (kidsModeActive() && optsArgIndex >= 0) ensureFields(args[optsArgIndex]);
        const out = orig.apply(this, args);
        if (out && typeof (out as Promise<unknown>).then === 'function') {
            return (out as Promise<Result>).then(r => filterListResult(r as never));
        }
        return out;
    };
    (proto as unknown as Record<string, boolean>)[flag] = true;
}

// getUserViews needs the async view filter (it may compute the auto-hidden set on first call).
function wrapViews(): void {
    const proto = ApiClient.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const orig = proto.getUserViews;
    if (typeof orig !== 'function') return;
    const flag = '__jpxParentalWrapped_getUserViews';
    if ((proto as unknown as Record<string, boolean>)[flag]) return;
    proto.getUserViews = function patched(this: unknown, ...args: unknown[]) {
        const out = orig.apply(this, args);
        if (out && typeof (out as Promise<unknown>).then === 'function') {
            return (out as Promise<Result>).then(r => applyViewsFilter(this as Record<string, unknown>, r as never));
        }
        return out;
    };
    (proto as unknown as Record<string, boolean>)[flag] = true;
}

let installed = false;
export function installParentalEnforcement(): void {
    if (installed) return;
    installed = true;
    try {
        wrapList('getItems', 1);          // getItems(userId, options)
        wrapList('getResumeItems', 0);    // getResumeItems(options, ...)
        wrapList('getNextUpEpisodes', 0);
        wrapList('getLatestItems', 0);
        wrapViews();
    } catch (e) {
        console.error('[jpxParental] enforcement install failed', e);
    }
}
