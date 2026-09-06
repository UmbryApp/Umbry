import loading from 'components/loading/loading';
import globalize from 'lib/globalize';
import { ConnectionState, ServerConnections } from 'lib/jellyfin-apiclient';
import appSettings from 'scripts/settings/appSettings';
import Dashboard from 'utils/dashboard';

import 'elements/emby-button/emby-button';

// Umbry: share the login page's backdrop + wordmark + auth styling so add-server matches.
import { startAuthBackdrop } from '../login/umbry-backdrop';
import '../login/login.scss';

function handleConnectionResult(page, result) {
    loading.hide();
    switch (result.State) {
        case ConnectionState.SignedIn: {
            const apiClient = result.ApiClient;
            Dashboard.onServerChanged(apiClient.getCurrentUserId(), apiClient.accessToken(), apiClient);
            Dashboard.navigate('home');
            break;
        }
        case ConnectionState.ServerSignIn:
            if (result.SystemInfo && result.SystemInfo.StartupWizardCompleted !== false) {
                Dashboard.navigate('login?serverid=' + result.Servers[0].Id, false, 'none');
            } else {
                Dashboard.navigate('/wizard/start');
            }
            break;
        case ConnectionState.ServerSelection:
            Dashboard.navigate('selectserver', false, 'none');
            break;
        case ConnectionState.ServerUpdateNeeded:
            Dashboard.alert({
                message: globalize.translate('ServerUpdateNeeded', '<a href="https://github.com/jellyfin/jellyfin">https://github.com/jellyfin/jellyfin</a>')
            });
            break;
        case ConnectionState.Unavailable:
            Dashboard.alert({
                message: globalize.translate('MessageUnableToConnectToServer'),
                title: globalize.translate('HeaderConnectionFailure')
            });
    }
}

// Umbry: after entering just an address (no token), try Jellyfin/Emby first; if it isn't one,
// treat it as a Plex server and offer a Plex account sign-in (OAuth or email/password). This lets
// people you've shared libraries with connect with the address alone — they sign in as themselves.
function tryPlexSignIn(page, base) {
    loading.hide();
    import('../../../apps/experimental/theme/jpxPlexSignIn').then(function(m) {
        m.promptPlexSignIn(base).then(function(srv) {
            if (srv) {
                Dashboard.navigate('login');
            }
            // cancelled -> stay on the add-server page
        });
    }).catch(function() {
        Dashboard.alert({
            message: globalize.translate('MessageUnableToConnectToServer'),
            title: globalize.translate('HeaderConnectionFailure')
        });
    });
}

function connectJellyfin(page, host) {
    var base = /^https?:\/\//.test(host) ? host : 'http://' + host;
    ServerConnections.connectToAddress(host, {
        enableAutoLogin: appSettings.enableAutoLogin()
    }).then(function(result) {
        if (result && (result.State === ConnectionState.SignedIn || result.State === ConnectionState.ServerSignIn)) {
            handleConnectionResult(page, result);
        } else {
            tryPlexSignIn(page, base);
        }
    }, function() {
        tryPlexSignIn(page, base);
    });
}

function submitServer(page) {
    loading.show();
    // eslint-disable-next-line sonarjs/slow-regex
    const host = page.querySelector('#txtServerHost').value.replace(/\/+$/, '');
    const base = /^https?:\/\//.test(host) ? host : 'http://' + host;
    const tokenField = page.querySelector('#txtPlexToken');
    const plexToken = tokenField ? tokenField.value.trim() : '';

    // Umbry: a Plex token means "add this as a Plex server". Plex only returns a browser-usable
    // CORS header (Access-Control-Allow-Origin: <our origin>) when the request carries a token — a
    // tokenless probe is always blocked, so the token has to come first. addPlexServer() validates
    // the address+token against /identity?X-Plex-Token= and registers it; data is then pulled
    // natively (no routing to Plex).
    if (plexToken) {
        import('../../../apps/experimental/theme/jpxPlex').then(function(plex) {
            plex.addPlexServer(base, plexToken).then(function(srv) {
                loading.hide();
                if (srv) {
                    Dashboard.navigate('login');
                } else {
                    Dashboard.alert({ message: 'Could not reach that Plex server, or the token is invalid. Check the address (e.g. 192.168.1.100:32400) and your Plex token, then try again.' });
                }
            }).catch(function() {
                loading.hide();
                Dashboard.alert({ message: 'Could not reach that Plex server, or the token is invalid.' });
            });
        }).catch(function() {
            loading.hide();
            Dashboard.alert({ message: 'Could not load the Plex connector.' });
        });
        return;
    }

    connectJellyfin(page, host);
}

export default function(view) {
    try { startAuthBackdrop(view); } catch (e) { console.error('jpx backdrop', e); }

    view.querySelector('.addServerForm').addEventListener('submit', onServerSubmit);
    view.querySelector('.btnCancel').addEventListener('click', goBack);

    // Umbry: the manual Plex token lives behind an "Advanced" toggle so end users just enter the
    // address and sign in with Plex; power users can still reveal it to paste a token.
    var advToggle = view.querySelector('.jpx-advanced-toggle');
    var advFields = view.querySelector('.jpx-advanced-fields');
    if (advToggle && advFields) {
        advToggle.addEventListener('click', function(e) {
            e.preventDefault();
            advFields.classList.toggle('hide');
        });
    }

    import('../../../components/autoFocuser').then(({ default: autoFocuser }) => {
        autoFocuser.autoFocus(view);
    });

    function onServerSubmit(e) {
        submitServer(view);
        e.preventDefault();
        return false;
    }

    function goBack() {
        import('../../../components/router/appRouter').then(({ appRouter }) => {
            appRouter.back();
        });
    }
}
