import DOMPurify from 'dompurify';
import markdownIt from 'markdown-it';

import { AppFeature } from 'constants/appFeature';
import { ConnectionState, ServerConnections } from 'lib/jellyfin-apiclient';

import jellyfinLogoUrl from '../../../assets/img/jellyfin-logo.png';
import embyLogoUrl from '../../../assets/img/emby-logo.png';
import plexLogoUrl from '../../../assets/img/plex-logo.svg';
import { getPlexServers, removePlexServer } from '../../../apps/experimental/theme/jpxPlex';
import confirm from '../../../components/confirm/confirm';
import { makePlexApiClient } from '../../../apps/experimental/theme/jpxPlexClient';
import Events from 'utils/events';

import { appHost } from '../../../components/apphost';
import appSettings from '../../../scripts/settings/appSettings';
import dom from '../../../utils/dom';
import loading from '../../../components/loading/loading';
import layoutManager from '../../../components/layoutManager';
import libraryMenu from '../../../scripts/libraryMenu';
import browser from '../../../scripts/browser';
import globalize from '../../../lib/globalize';
import '../../../components/cardbuilder/card.scss';
import '../../../elements/emby-checkbox/emby-checkbox';
import Dashboard from '../../../utils/dashboard';
import toast from '../../../components/toast/toast';
import dialogHelper from '../../../components/dialogHelper/dialogHelper';
import baseAlert from '../../../components/alert';
import { getDefaultBackgroundClass } from '../../../components/cardbuilder/utils/builder';

import './login.scss';
import { startLoginBackdrop } from './umbry-backdrop';

const enableFocusTransform = !browser.slow && !browser.edge;

function authenticateUserByName(page, apiClient, url, username, password) {
    loading.show();
    apiClient.authenticateUserByName(username, password).then(function (result) {
        const user = result.User;
        loading.hide();

        onLoginSuccessful(user.Id, result.AccessToken, apiClient, url);
    }, function (response) {
        page.querySelector('#txtManualPassword').value = '';
        loading.hide();

        const UnauthorizedOrForbidden = [401, 403];
        if (UnauthorizedOrForbidden.includes(response.status)) {
            const messageKey = response.status === 401 ? 'MessageInvalidUser' : 'MessageUnauthorizedUser';
            toast(globalize.translate(messageKey));
        } else {
            Dashboard.alert({
                message: globalize.translate('MessageUnableToConnectToServer'),
                title: globalize.translate('HeaderConnectionFailure')
            });
        }
    });
}

function authenticateQuickConnect(apiClient, targetUrl) {
    const url = apiClient.getUrl('/QuickConnect/Initiate');
    apiClient.ajax({ type: 'POST', url }, true).then(res => res.json()).then(function (json) {
        if (!json.Secret || !json.Code) {
            console.error('Malformed quick connect response', json);
            return false;
        }

        baseAlert({
            dialogOptions: {
                id: 'quickConnectAlert'
            },
            title: globalize.translate('QuickConnect'),
            text: globalize.translate('QuickConnectAuthorizeCode', json.Code)
        });

        const connectUrl = apiClient.getUrl('/QuickConnect/Connect?Secret=' + json.Secret);

        const interval = setInterval(function() {
            apiClient.getJSON(connectUrl).then(async function(data) {
                if (!data.Authenticated) {
                    return;
                }

                clearInterval(interval);

                // Close the QuickConnect dialog
                const dlg = document.getElementById('quickConnectAlert');
                if (dlg) {
                    dialogHelper.close(dlg);
                }

                const result = await apiClient.quickConnect(data.Secret);
                onLoginSuccessful(result.User.Id, result.AccessToken, apiClient, targetUrl);
            }, function (e) {
                clearInterval(interval);

                // Close the QuickConnect dialog
                const dlg = document.getElementById('quickConnectAlert');
                if (dlg) {
                    dialogHelper.close(dlg);
                }

                Dashboard.alert({
                    message: globalize.translate('QuickConnectDeactivated'),
                    title: globalize.translate('HeaderError')
                });

                console.error('Unable to login with quick connect', e);
            });
        }, 5000, connectUrl);

        return true;
    }, function(e) {
        Dashboard.alert({
            message: globalize.translate('QuickConnectNotActive'),
            title: globalize.translate('HeaderError')
        });

        console.error('Quick connect error: ', e);
        return false;
    });
}

function onLoginSuccessful(id, accessToken, apiClient, url) {
    Dashboard.onServerChanged(id, accessToken, apiClient);
    // Umbry: pin THIS server as the active one and HARD-RELOAD Home instead of an in-app navigate.
    // An SPA navigate reuses the home controller's cached apiClient from the previously-viewed server,
    // so logging into one server (e.g. Emby) showed the other server's home (e.g. Jellyfin) — and with
    // matching credentials it never errored. Writing jpx-active-jf + reloading re-arms Home on THIS server.
    try {
        if (apiClient && !apiClient.__plex && apiClient.accessToken && apiClient.accessToken()) {
            localStorage.setItem('jpx-active-jf', JSON.stringify({
                id: apiClient.serverId(), url: apiClient.serverAddress(), userId: apiClient.getCurrentUserId(),
                token: apiClient.accessToken(), name: (apiClient.serverInfo && apiClient.serverInfo().Name) || ''
            }));
            localStorage.removeItem('jpx-active-plex');
        }
    } catch (e) { /* ignore */ }
    // Mark that a session is active for THIS window/session so the post-login reload restores it even
    // when "Remember Me" (auto-login) is off — otherwise the reload bounces back to the login screen and
    // forces a second sign-in. sessionStorage clears when the app window closes, so a fresh launch still
    // honors the auto-login setting.
    try { sessionStorage.setItem('jpx-session-active', '1'); } catch (e) { /* ignore */ }
    try {
        const dest = (url && url !== 'home' && url !== '/home') ? ('#/' + String(url).replace(/^[#/]+/, '')) : '#/home';
        window.location.hash = dest;
    } catch (e) { /* ignore */ }
    import('apps/experimental/theme/jpxParental')
        .then(function (m) { return m.purgeQueryCaches ? m.purgeQueryCaches() : null; })
        .catch(function () { /* ignore */ })
        .then(function () { try { window.location.reload(); } catch (e) { /* ignore */ } });
}

function showManualForm(context, showCancel, focusPassword) {
    context.querySelector('.chkRememberLogin').checked = appSettings.enableAutoLogin();
    context.querySelector('.manualLoginForm').classList.remove('hide');
    context.querySelector('.visualLoginForm').classList.add('hide');
    context.querySelector('.btnManual').classList.add('hide');

    if (focusPassword) {
        context.querySelector('#txtManualPassword').focus();
    } else {
        context.querySelector('#txtManualName').focus();
    }

    if (showCancel) {
        context.querySelector('.btnCancel').classList.remove('hide');
    } else {
        context.querySelector('.btnCancel').classList.add('hide');
    }
}

// Umbry: a connected Emby server injects branding CSS that out-specifies our wide-grid stylesheet
// rules and collapses the user-select to a narrow vertical list. INLINE styles beat any stylesheet
// (even !important ones), so force the wide, centered grid inline — the same tactic used for the
// Add Server button. Also clears width caps on every ancestor up to #loginPage in case the branding
// narrows a wrapper rather than the grid itself.
function jpxForceUserGrid(context) {
    try {
        var form = context.querySelector('.visualLoginForm');
        if (form) {
            form.style.setProperty('max-width', '92vw', 'important');
            form.style.setProperty('width', 'auto', 'important');
            form.style.setProperty('background', 'transparent', 'important');
            form.style.setProperty('backdrop-filter', 'none', 'important');
            form.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
            form.style.setProperty('padding', '0', 'important');
            form.style.setProperty('margin', '0 auto 1.2em', 'important');
        }
        var grid = context.querySelector('#divUsers');
        if (grid) {
            var el = grid.parentElement;
            while (el && el.id !== 'loginPage') {
                if (el !== form) { el.style.setProperty('max-width', 'none', 'important'); el.style.setProperty('width', 'auto', 'important'); }
                el = el.parentElement;
            }
            grid.style.setProperty('max-width', '52em', 'important');
            grid.style.setProperty('width', 'auto', 'important');
            grid.style.setProperty('display', 'flex', 'important');
            grid.style.setProperty('flex-wrap', 'wrap', 'important');
            grid.style.setProperty('justify-content', 'center', 'important');
            grid.style.setProperty('align-items', 'flex-start', 'important');
            grid.style.setProperty('margin', '0 auto', 'important');
            [].forEach.call(grid.querySelectorAll('.card.squareCard'), function (c) {
                c.style.setProperty('width', '7em', 'important');
                c.style.setProperty('max-width', '7em', 'important');
                c.style.setProperty('flex', '0 0 auto', 'important');
            });
        }
    } catch (e) { /* ignore */ }
}

function loadUserList(context, apiClient, users) {
    let html = '';

    for (const user of users) {
        // TODO move card creation code to Card component
        let cssClass = 'card squareCard scalableCard squareCard-scalable';

        if (layoutManager.tv) {
            cssClass += ' show-focus';

            if (enableFocusTransform) {
                cssClass += ' show-animation';
            }
        }

        const cardBoxCssClass = 'cardBox cardBox-bottompadded';
        html += '<button type="button" class="' + cssClass + '">';
        html += '<div class="' + cardBoxCssClass + '">';
        html += '<div class="cardScalable">';
        html += '<div class="cardPadder cardPadder-square"></div>';
        html += `<div class="cardContent" data-haspw="${user.HasPassword}" data-username="${user.Name}" data-userid="${user.Id}">`;
        let imgUrl;

        if (user.PrimaryImageTag) {
            imgUrl = apiClient.getUserImageUrl(user.Id, {
                width: 300,
                tag: user.PrimaryImageTag,
                type: 'Primary'
            });

            html += '<div class="cardImageContainer coveredImage" style="background-image:url(\'' + imgUrl + "');\"></div>";
        } else {
            html += `<div class="cardImage flex align-items-center justify-content-center ${getDefaultBackgroundClass()}">`;
            html += '<span class="material-icons cardImageIcon person" aria-hidden="true"></span>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        html += '<div class="cardFooter visualCardBox-cardFooter">';
        html += '<div class="cardText singleCardText cardTextCentered">' + user.Name + '</div>';
        html += '</div>';
        html += '</div>';
        html += '</button>';
    }

    context.querySelector('#divUsers').innerHTML = html;
    jpxForceUserGrid(context);
    setTimeout(function () { jpxForceUserGrid(context); }, 60);
    setTimeout(function () { jpxForceUserGrid(context); }, 400);
}

export default function (view, params) {
    try { startLoginBackdrop(view); } catch (e) { console.error('jpx backdrop', e); }
    // The server chosen via the Umbry inline picker; auth must target IT, not the default.
    let jpxChosenApiClient = null;

    function getApiClient() {
        if (jpxChosenApiClient) {
            return jpxChosenApiClient;
        }

        const serverId = params.serverid;

        if (serverId) {
            return ServerConnections.getOrCreateApiClient(serverId);
        }

        // Umbry: the stock global `ApiClient` is not in scope in this build; use the current
        // connection instead (fixes a ReferenceError on the login view change).
        return ServerConnections.currentApiClient();
    }

    function getTargetUrl() {
        if (params.url) {
            try {
                return decodeURIComponent(params.url);
            } catch (err) {
                console.warn('[LoginPage] unable to decode url param', params.url, err);
            }
        }

        return '/home';
    }

    function showVisualForm() {
        view.querySelector('.visualLoginForm').classList.remove('hide');
        view.querySelector('.manualLoginForm').classList.add('hide');
        view.querySelector('.btnManual').classList.remove('hide');

        import('../../../components/autoFocuser').then(({ default: autoFocuser }) => {
            autoFocuser.autoFocus(view);
        });
    }

    // Umbry standalone server picker (inline on the login page).
    // Emby's /System/Info/Public has no ProductName (Jellyfin/Umbry always do) — use that
    // to pick the per-server-type logo. Defaults to Jellyfin; swaps to Emby on detection.
    function jpxApplyServerLogo(server, img) {
        try { if (!server.__plex) localStorage.removeItem('jpx-active-plex'); } catch (e) { /* ignore */ }
        if (server.__plex) { img.src = plexLogoUrl; return; }
        img.src = jellyfinLogoUrl;
        const addr = server.ManualAddress || server.LocalAddress || server.RemoteAddress || server.address;
        if (!addr) return;
        fetch(String(addr).replace(/\/+$/, '') + '/System/Info/Public', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (info) {
                if (info && !info.ProductName) {
                    img.src = embyLogoUrl;
                }
            }).catch(function () { /* keep the Jellyfin default */ });
    }

    function jpxRenderServers(servers) {
        const container = view.querySelector('.jpx-servers');
        container.innerHTML = '';
        servers.forEach(function (server) {
            const card = document.createElement('button');
            card.className = 'jpx-server-card';
            card.setAttribute('type', 'button');
            const img = document.createElement('img');
            img.className = 'jpx-server-logo';
            img.alt = '';
            jpxApplyServerLogo(server, img);
            const name = document.createElement('span');
            name.className = 'jpx-server-name';
            name.textContent = server.Name || '';
            // Umbry: selection checkbox (corner), shown only in remove-mode.
            const check = document.createElement('span');
            check.className = 'jpx-server-check';
            check.setAttribute('aria-hidden', 'true');
            card.__server = server;
            card.appendChild(check);
            card.appendChild(img);
            card.appendChild(name);
            card.addEventListener('click', function () {
                if (jpxRemoveMode) { card.classList.toggle('selected'); jpxUpdateRemoveBar(); }
                else { jpxChooseServer(server); }
            });
            container.appendChild(card);
        });
    }

    var jpxRemoveMode = false;
    function jpxDeleteServer(server) {
        return new Promise(function (resolve) {
            if (!server) { resolve(); return; }
            if (server.__plex) { try { removePlexServer(server.__plexServer.id); } catch (e) { /* ignore */ } resolve(); }
            else { Promise.resolve(ServerConnections.deleteServer(server.Id)).then(resolve, resolve); }
        });
    }
    function jpxUpdateRemoveBar() {
        var cards = Array.prototype.slice.call(view.querySelectorAll('.jpx-server-card.selected'));
        var names = cards.map(function (c) { return '\u201c' + ((c.__server && c.__server.Name) || 'server') + '\u201d'; });
        var textEl = view.querySelector('.jpx-remove-bar-text');
        var okBtn = view.querySelector('.jpx-rb-ok');
        if (!textEl || !okBtn) return;
        if (!names.length) { textEl.textContent = 'Select the server(s) you want to remove.'; okBtn.setAttribute('disabled', 'disabled'); }
        else { textEl.textContent = 'Are you sure you want to remove ' + names.join(', ') + '?'; okBtn.removeAttribute('disabled'); }
    }
    function jpxEnterRemoveMode() {
        jpxRemoveMode = true;
        view.querySelector('.jpx-server-select').classList.add('jpx-removing');
        view.querySelector('.jpx-add-server').classList.add('hide');
        view.querySelector('.jpx-remove-server').classList.add('hide');
        view.querySelector('.jpx-remove-bar').classList.remove('hide');
        jpxUpdateRemoveBar();
    }
    function jpxExitRemoveMode() {
        jpxRemoveMode = false;
        view.querySelector('.jpx-server-select').classList.remove('jpx-removing');
        Array.prototype.forEach.call(view.querySelectorAll('.jpx-server-card.selected'), function (c) { c.classList.remove('selected'); });
        view.querySelector('.jpx-add-server').classList.remove('hide');
        var has = view.querySelectorAll('.jpx-server-card').length > 0;
        view.querySelector('.jpx-remove-server').classList.toggle('hide', !has);
        view.querySelector('.jpx-remove-bar').classList.add('hide');
    }
    function jpxDoRemoveSelected() {
        var cards = Array.prototype.slice.call(view.querySelectorAll('.jpx-server-card.selected'));
        var servers = cards.map(function (c) { return c.__server; }).filter(Boolean);
        if (!servers.length) return;
        Promise.all(servers.map(jpxDeleteServer)).then(function () { jpxRemoveMode = false; jpxShowServerSelect(); });
    }

    function jpxReloadHome() {
        // Switching servers must start the new server's Home from a clean slate: react-query results
        // (incl. getUserViews / the library tiles) are PERSISTED to IndexedDB, so an SPA navigate
        // leaves the previous server's libraries \"bleeding\" into the new one and mismatched cached
        // shapes can blank Emby. Purge the cache, then hard-reload into Home (mirrors JpxNavPill's
        // goHomeFresh, which is why the nav-pill switch was already clean).
        try { window.location.hash = '#/home'; } catch (e) { /* ignore */ }
        import('apps/experimental/theme/jpxParental').then(function (m) {
            return m.purgeQueryCaches ? m.purgeQueryCaches() : null;
        }).catch(function () { /* ignore */ }).then(function () {
            try { window.location.reload(); } catch (e) { /* ignore */ }
        });
    }

    function jpxChooseServer(server) {
        if (!server) return;
        if (server.__plex) {
            var __srv = server.__plexServer;
            var __activatePlex = function () {
                try { libraryMenu.setDocumentTitle(__srv.name); } catch (e) { /* ignore */ }
                var __client = makePlexApiClient(__srv);
                try {
                    if (!ServerConnections._apiClients.some(function (a) { return a.serverId && a.serverId() === __srv.id; })) {
                        ServerConnections._apiClients.push(__client);
                    }
                } catch (e) { /* ignore */ }
                ServerConnections.setLocalApiClient(__client);
                ServerConnections.firstConnection = true;
                try { localStorage.setItem('jpx-active-plex', __srv.id); localStorage.removeItem('jpx-active-jf'); } catch (e) { /* ignore */ }
                __client.getCurrentUser().then(function (u) {
                    try { Events.trigger(ServerConnections, 'localusersignedin', [u]); } catch (e) { /* ignore */ }
                    jpxReloadHome();
                }, function () { jpxReloadHome(); });
            };
            // A Plex client is just a shim (no connect step), so probe /identity first — if the
            // server is offline, show the "unavailable" page instead of a broken Home.
            loading.show();
            var __pc = new AbortController();
            var __pt = setTimeout(function () { __pc.abort(); }, 6000);
            fetch(__srv.base + '/identity?X-Plex-Token=' + encodeURIComponent(__srv.token), { signal: __pc.signal, headers: { Accept: 'application/json' } })
                .then(function (r) { clearTimeout(__pt); if (!r.ok) throw new Error('unreachable'); loading.hide(); __activatePlex(); })
                .catch(function () { clearTimeout(__pt); loading.hide(); jpxShowServerUnavailable(server); });
            return;
        }
        loading.show();
        ServerConnections.connectToServer(server, {
            enableAutoLogin: appSettings.enableAutoLogin()
        }).then(function (result) {
            loading.hide();
            if (result && result.State === ConnectionState.Unavailable) { jpxShowServerUnavailable(server); return; }
            const apiClient = result.ApiClient;
            // Route all subsequent auth on this page at the chosen server.
            jpxChosenApiClient = apiClient;
            if (result.State === ConnectionState.SignedIn) {
                Dashboard.onServerChanged(apiClient.getCurrentUserId(), apiClient.accessToken(), apiClient);
                jpxReloadHome();
                return;
            }
            Dashboard.onServerChanged(null, null, apiClient);
            view.querySelector('.jpx-server-select').classList.add('hide');
            // Now one level into the flow (user-select / password) — reveal the back arrow.
            view.querySelector('.jpx-login-back').classList.remove('hide');
            apiClient.getPublicUsers().then(function (users) {
                if (users.length) {
                    showVisualForm();
                    loadUserList(view, apiClient, users);
                } else {
                    view.querySelector('#txtManualName').value = '';
                    showManualForm(view, false, false);
                }
            }).catch(function () {
                jpxShowServerSelect();
            });
        }).catch(function () {
            loading.hide();
            jpxShowServerUnavailable(server);
        });
    }

    // Umbry: a themed "server unavailable" screen shown when switching to an offline server —
    // "<name> is currently unavailable", then the OTHER available servers to pick from (reusing the
    // server-select cards), or an Add Server prompt if there are none.
    function jpxShowServerUnavailable(offlineServer) {
        try { libraryMenu.setDocumentTitle('Umbry'); } catch (e) { /* ignore */ }
        view.querySelector('.visualLoginForm').classList.add('hide');
        view.querySelector('.manualLoginForm').classList.add('hide');
        view.querySelector('.readOnlyContent').classList.add('hide');
        view.querySelector('.jpx-server-select').classList.remove('hide');
        view.querySelector('.jpx-login-back').classList.add('hide');

        var offName = (offlineServer && (offlineServer.Name || offlineServer.name)) || 'That server';
        var offId = offlineServer && (offlineServer.Id || (offlineServer.__plexServer && offlineServer.__plexServer.id));

        Promise.resolve(ServerConnections.getAvailableServers()).catch(function () { return []; }).then(function (servers) {
            var __origin = String(window.location.origin || '').replace(/\/+$/, '');
            var __norm = function (a) { return String(a || '').replace(/\/+$/, ''); };
            var __isSelf = function (s) {
                var self = __norm(s.ManualAddress) === __origin || __norm(s.LocalAddress) === __origin || __norm(s.RemoteAddress) === __origin;
                return self && !s.AccessToken && !s.UserId;
            };
            var __real = (servers || []).filter(function (s) { return !__isSelf(s) && s.Id !== offId; });
            var plex = getPlexServers().map(function (s) { return { __plex: true, __plexServer: s, Name: s.name, Id: s.id }; })
                .filter(function (s) { return s.Id !== offId; });
            var __list = __real.concat(plex);

            var heading = view.querySelector('.jpx-ss-heading');
            if (heading) heading.textContent = offName + ' is currently unavailable';
            var sub = view.querySelector('.jpx-ss-subheading');
            if (!sub && heading) {
                sub = document.createElement('div');
                sub.className = 'jpx-ss-subheading';
                heading.parentNode.insertBefore(sub, heading.nextSibling);
            }
            if (sub) { sub.classList.remove('hide'); sub.textContent = __list.length ? 'Please select another server.' : 'Add a server to continue.'; }
            view.querySelector('.jpx-server-select').classList.add('jpx-ss-unavailable');

            jpxRenderServers(__list);
            jpxRemoveMode = false;
            view.querySelector('.jpx-server-select').classList.remove('jpx-removing');
            view.querySelector('.jpx-add-server').classList.remove('hide');
            var __rm = view.querySelector('.jpx-remove-server');
            if (__rm) __rm.classList.toggle('hide', __list.length === 0);
            var __bar = view.querySelector('.jpx-remove-bar'); if (__bar) __bar.classList.add('hide');
        });
        loading.hide();
    }

    function jpxShowServerSelect() {
        try { libraryMenu.setDocumentTitle('Umbry'); } catch (e) { /* ignore */ }
        var __sub0 = view.querySelector('.jpx-ss-subheading'); if (__sub0) __sub0.classList.add('hide');
        var __ss0 = view.querySelector('.jpx-server-select'); if (__ss0) __ss0.classList.remove('jpx-ss-unavailable');
        view.querySelector('.visualLoginForm').classList.add('hide');
        view.querySelector('.manualLoginForm').classList.add('hide');
        view.querySelector('.readOnlyContent').classList.add('hide');
        view.querySelector('.jpx-server-select').classList.remove('hide');
        // Force the Umbry gradient on the Add Server button. Once signed into a server, that
        // server's own Branding CustomCss (loaded cross-origin) can override our .jpx-add-server
        // rule with its themed gradient. An INLINE !important wins over any stylesheet, so the
        // button stays the Umbry purple->violet on every connected server.
        try {
            var __add = view.querySelector('.jpx-add-server');
            if (__add) {
                __add.style.setProperty('background', 'linear-gradient(100deg, #FFC670, #FF9A4B, #C77BD8, #9385F5)', 'important');
                __add.style.setProperty('background-image', 'linear-gradient(100deg, #FFC670, #FF9A4B, #C77BD8, #9385F5)', 'important');
                __add.style.setProperty('color', '#fff', 'important');
                __add.style.setProperty('border', '0', 'important');
            }
        } catch (e) { /* ignore */ }
        // Server-select is the root of the pre-login flow — nothing behind it, hide the back arrow.
        view.querySelector('.jpx-login-back').classList.add('hide');
        Promise.resolve(ServerConnections.getAvailableServers()).catch(function () { return []; }).then(function (servers) {
            // Drop (and purge from credentials) any phantom "self" server pointing at this app's own
            // origin with no token/user — a leftover of the stock origin auto-connect.
            var __origin = String(window.location.origin || '').replace(/\/+$/, '');
            var __norm = function (a) { return String(a || '').replace(/\/+$/, ''); };
            var __isSelf = function (s) {
                var self = __norm(s.ManualAddress) === __origin || __norm(s.LocalAddress) === __origin || __norm(s.RemoteAddress) === __origin;
                return self && !s.AccessToken && !s.UserId;
            };
            var __real = (servers || []).filter(function (s) {
                if (__isSelf(s)) { try { ServerConnections.deleteServer(s.Id); } catch (e) { /* ignore */ } return false; }
                return true;
            });
            const plex = getPlexServers().map(function (s) { return { __plex: true, __plexServer: s, Name: s.name, Id: s.id }; });
            const __list = __real.concat(plex);
            const __heading = view.querySelector('.jpx-ss-heading');
            if (__heading) __heading.textContent = __list.length ? 'Select or Add a Server' : 'Add a Server';
            jpxRenderServers(__list);
            jpxRemoveMode = false;
            view.querySelector('.jpx-server-select').classList.remove('jpx-removing');
            view.querySelector('.jpx-add-server').classList.remove('hide');
            var __rm = view.querySelector('.jpx-remove-server');
            if (__rm) __rm.classList.toggle('hide', __list.length === 0);
            var __bar = view.querySelector('.jpx-remove-bar'); if (__bar) __bar.classList.add('hide');
        });
        loading.hide();
    }

    view.querySelector('#divUsers').addEventListener('click', function (e) {
        const card = dom.parentWithClass(e.target, 'card');
        const cardContent = card ? card.querySelector('.cardContent') : null;

        if (cardContent) {
            const context = view;
            const id = cardContent.getAttribute('data-userid');
            const name = cardContent.getAttribute('data-username');
            const haspw = cardContent.getAttribute('data-haspw');

            if (id === 'manual') {
                context.querySelector('#txtManualName').value = '';
                showManualForm(context, true);
            } else if (haspw == 'false') {
                authenticateUserByName(context, getApiClient(), getTargetUrl(), name, '');
            } else {
                context.querySelector('#txtManualName').value = name;
                context.querySelector('#txtManualPassword').value = '';
                showManualForm(context, true, true);
            }
        }
    });
    view.querySelector('.manualLoginForm').addEventListener('submit', function (e) {
        appSettings.enableAutoLogin(view.querySelector('.chkRememberLogin').checked);
        authenticateUserByName(view, getApiClient(), getTargetUrl(), view.querySelector('#txtManualName').value, view.querySelector('#txtManualPassword').value);
        e.preventDefault();
        return false;
    });
    view.querySelector('.btnForgotPassword').addEventListener('click', function () {
        // Umbry is a standalone client that may be distributed publicly — it can't reach any
        // one server's password-reset page, and Umbry has no account of its own for Jellyfin/
        // Emby users. So point people at the app for whichever server they're signing into.
        const showResetInfo = function (product) {
            Dashboard.alert({
                title: 'Reset your password',
                message: 'To reset your password, please use your ' + product + ' app or the ' + product + ' web portal for this server \u2014 that\u2019s where your account lives. Umbry can\u2019t reset your ' + product + ' password.'
            });
        };
        let addr = '';
        try { const c = getApiClient(); addr = (c && c.serverAddress && c.serverAddress()) || ''; } catch (e) { /* ignore */ }
        if (!addr) { showResetInfo('Jellyfin or Emby'); return; }
        fetch(String(addr).replace(/\/+$/, '') + '/System/Info/Public', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (info) { showResetInfo(info && !info.ProductName ? 'Emby' : 'Jellyfin'); })
            .catch(function () { showResetInfo('Jellyfin'); });
    });
    view.querySelector('.btnCancel').addEventListener('click', showVisualForm);
    view.querySelector('.btnQuick').addEventListener('click', function () {
        authenticateQuickConnect(getApiClient(), getTargetUrl());
        return false;
    });
    view.querySelector('.btnManual').addEventListener('click', function () {
        view.querySelector('#txtManualName').value = '';
        showManualForm(view, true);
    });
    view.querySelector('.btnSelectServer').addEventListener('click', function () {
        Dashboard.selectServer();
    });
    view.querySelector('.jpx-add-server').addEventListener('click', function () {
        Dashboard.navigate('addserver');
    });
    (function () {
        var rm = view.querySelector('.jpx-remove-server'); if (rm) rm.addEventListener('click', jpxEnterRemoveMode);
        var c = view.querySelector('.jpx-rb-cancel'); if (c) c.addEventListener('click', jpxExitRemoveMode);
        var o = view.querySelector('.jpx-rb-ok'); if (o) o.addEventListener('click', jpxDoRemoveSelected);
    })();
    // Pre-login back arrow: step back out of user-select / password to the server picker.
    view.querySelector('.jpx-login-back').addEventListener('click', function () {
        jpxShowServerSelect();
    });

    view.addEventListener('viewshow', function () {
        libraryMenu.setTransparentMenu(true);

        if (!appHost.supports(AppFeature.MultiServer)) {
            view.querySelector('.btnSelectServer').classList.add('hide');
        }

        // Umbry: show the server picker first so it renders even when the current client is
        // null (after sign-out) or a Plex shim; then run the optional server-specific calls.
        jpxShowServerSelect();

        const apiClient = getApiClient();
        if (!apiClient || typeof apiClient.getJSON !== 'function') { return; }

        if (typeof apiClient.getQuickConnect === 'function') {
            apiClient.getQuickConnect('Enabled')
                .then(enabled => {
                    if (enabled === true) {
                        view.querySelector('.btnQuick').classList.remove('hide');
                    }
                })
                .catch(() => {
                    console.debug('Failed to get QuickConnect status');
                });
        }

        apiClient.getJSON(apiClient.getUrl('Branding/Configuration')).then(function (options) {
            const loginDisclaimer = view.querySelector('.loginDisclaimer');

            // eslint-disable-next-line sonarjs/disabled-auto-escaping
            loginDisclaimer.innerHTML = DOMPurify.sanitize(markdownIt({ html: true }).render(options.LoginDisclaimer || ''));

            for (const elem of loginDisclaimer.querySelectorAll('a')) {
                elem.rel = 'noopener noreferrer';
                elem.target = '_blank';
                elem.classList.add('button-link');
                elem.setAttribute('is', 'emby-linkbutton');

                if (layoutManager.tv) {
                    // Disable links navigation on TV
                    elem.tabIndex = -1;
                }
            }
        });
    });
    view.addEventListener('viewhide', function () {
        libraryMenu.setTransparentMenu(false);
    });
}

