import { LayoutMode } from 'constants/layoutMode';

import { appHost } from './apphost';
import browser from '../scripts/browser';
import appSettings from '../scripts/settings/appSettings';
import Events from '../utils/events.ts';

function setLayout(instance, layout, selectedLayout) {
    if (layout === selectedLayout) {
        instance[layout] = true;
        document.documentElement.classList.add('layout-' + layout);
    } else {
        instance[layout] = false;
        document.documentElement.classList.remove('layout-' + layout);
    }
}

export const SETTING_KEY = 'layout';

class LayoutManager {
    tv = false;
    mobile = false;
    desktop = false;
    experimental = false;

    get layout() {
        if (this.tv) return LayoutMode.Tv;
        if (this.experimental) return LayoutMode.Experimental;
        if (this.mobile) return LayoutMode.Mobile;
        if (this.desktop) return LayoutMode.Desktop;
        return LayoutMode.Experimental;
    }

    setLayout(layout = '', save = true) {
        const layoutValue = (!layout || layout === LayoutMode.Auto) ? '' : layout;

        if (!layoutValue) {
            this.autoLayout();
        } else {
            setLayout(this, LayoutMode.Mobile, layoutValue);
            setLayout(this, LayoutMode.Tv, layoutValue);
            setLayout(this, LayoutMode.Desktop, layoutValue);
        }

        console.debug('[LayoutManager] using layout mode', layoutValue);
        this.experimental = layoutValue === LayoutMode.Experimental;
        if (this.experimental) {
            const legacyLayoutMode = browser.mobile ? LayoutMode.Mobile : LayoutMode.Desktop;
            console.debug('[LayoutManager] using legacy layout mode', legacyLayoutMode);
            setLayout(this, legacyLayoutMode, legacyLayoutMode);
        }

        if (save) appSettings.set(SETTING_KEY, layoutValue);

        Events.trigger(this, 'modechange');
    }

    getSavedLayout() {
        const saved = appSettings.get(SETTING_KEY);
        // Umbry: the stock TV/stable shell is not the Umbry experience. Route a saved TV
        // layout to the experimental (Umbry) shell, which now carries D-pad spatial navigation.
        return saved === LayoutMode.Tv ? LayoutMode.Experimental : saved;
    }

    autoLayout() {
        // Take a guess at initial layout. The consuming app can override.
        // Umbry: even on a detected TV, use the experimental (Umbry) shell rather than the
        // stock TV shell — the Umbry UI is the experimental shell + spatial navigation.
        this.setLayout(browser.tv ? LayoutMode.Experimental : this.defaultLayout || LayoutMode.Experimental, false);
    }

    init() {
        const saved = this.getSavedLayout();
        if (saved) {
            this.setLayout(saved, false);
        } else {
            this.autoLayout();
        }
    }
}

const layoutManager = new LayoutManager();

if (appHost.getDefaultLayout) {
    layoutManager.defaultLayout = appHost.getDefaultLayout();
}

layoutManager.init();

export default layoutManager;
