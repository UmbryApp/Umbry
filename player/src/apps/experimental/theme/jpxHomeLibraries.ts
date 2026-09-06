// Umbry — Home-screen library visibility + order (all servers, Umbry-app-only).
//
// Lets a user pick WHICH of a server's libraries appear on the Home screen, and in WHAT order,
// without touching the server. This is distinct from Kids Mode's Hidden Libraries (which hides
// content everywhere): these prefs ONLY reshape the Home screen's library-driven sections. The
// libraries are still fully reachable from the nav, search, and direct links.
//
// Applied at the single Home choke point (homesections.js), so it covers My Media, the library
// buttons, and the per-library "Recently Added in X" rows in one place. View ids are unique per
// server (Plex ids are machine-namespaced; Jellyfin/Emby are GUIDs), so one id-keyed set works
// across every connected server.

import { getPref, setPref } from './jpxPrefs';

export const HOME_HIDDEN_LIBS = 'pref_home_hidden_libs'; // string[] of view ids hidden from Home
export const HOME_LIB_ORDER = 'pref_home_lib_order';     // string[] of view ids, Home display order

export function getHiddenHomeLibs(): string[] {
    const v = getPref<string[]>(HOME_HIDDEN_LIBS, []);
    return Array.isArray(v) ? v.map(String) : [];
}
export function setHiddenHomeLibs(ids: string[]): void {
    setPref(HOME_HIDDEN_LIBS, ids.map(String));
}
export function getHomeLibOrder(): string[] {
    const v = getPref<string[]>(HOME_LIB_ORDER, []);
    return Array.isArray(v) ? v.map(String) : [];
}
export function setHomeLibOrder(ids: string[]): void {
    setPref(HOME_LIB_ORDER, ids.map(String));
}

// Filter hidden libraries out, then apply the saved order. Libraries not in the saved order (new
// ones, or before the user has ever reordered) keep their original relative order, appended after
// the explicitly-ordered ones. Never throws — on any error the input is returned untouched.
export function applyHomeLibraryPrefs<T extends { Id?: string | null }>(views: T[]): T[] {
    try {
        const list = views || [];
        const hidden = new Set(getHiddenHomeLibs());
        const visible = list.filter(v => !hidden.has(String(v.Id)));
        const order = getHomeLibOrder();
        if (!order.length) return visible;
        const pos = new Map(order.map((id, i) => [ id, i ]));
        const known = visible
            .filter(v => pos.has(String(v.Id)))
            .sort((a, b) => (pos.get(String(a.Id)) ?? 0) - (pos.get(String(b.Id)) ?? 0));
        const unknown = visible.filter(v => !pos.has(String(v.Id)));
        return [ ...known, ...unknown ];
    } catch {
        return views || [];
    }
}
