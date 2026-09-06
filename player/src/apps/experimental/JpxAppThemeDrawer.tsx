import Drawer from '@mui/material/Drawer';
import React, { useCallback, useReducer, useState } from 'react';

import type { JpxThemeSpec } from './theme/jpxThemes';
import { applyTheme, getActiveThemeId, listAllThemes } from './theme/jpxTheme';
import JpxThemeEditor from './JpxThemeEditor';

import './jpxSettingsDrawer.scss';
import './jpxAppTheme.scss';

// Umbry App Theme picker — Moonfin's "App Theme" screen: preset cards with a gradient sample
// bar; selecting one live-applies it (jpxTheme.applyTheme) and persists it. Opens over the
// settings drawer with a back arrow.

// '#AARRGGBB' | '#RRGGBB' -> CSS, for the sample bar only.
const css = (argb: string): string => {
    const h = (argb || '').replace('#', '');
    if (h.length === 8) return '#' + h.slice(2) + h.slice(0, 2);
    return '#' + h;
};

const swatch = (t: JpxThemeSpec): string => {
    const c = t.colors;
    return `linear-gradient(90deg, ${css(c.background)} 0%, ${css(c.surface)} 22%, ${css(c.accent)} 55%, ${css(c.rangeProgress)} 100%)`;
};

interface JpxAppThemeDrawerProps {
    open: boolean;
    onClose: () => void;
    onBack: () => void;
}

const JpxAppThemeDrawer = ({ open, onClose, onBack }: JpxAppThemeDrawerProps) => {
    const [ active, setActive ] = useState<string>(() => getActiveThemeId());
    const [ editorOpen, setEditorOpen ] = useState(false);
    const [ , refresh ] = useReducer((x: number) => x + 1, 0);

    const pick = useCallback((t: JpxThemeSpec) => {
        applyTheme(t);
        setActive(t.id);
    }, []);

    // Re-read the theme list + active id when the editor closes (a saved custom theme appears here).
    const closeEditor = useCallback(() => { setEditorOpen(false); setActive(getActiveThemeId()); refresh(); }, []);

    return (
        <Drawer
            anchor='right'
            open={open}
            onClose={onClose}
            PaperProps={{ className: 'jpx-settings-paper' }}
        >
            <div className='jpx-settings-head'>
                <button type='button' className='jpx-settings-close' aria-label='Back' onClick={onBack}>
                    <span className='material-icons' aria-hidden='true'>arrow_back</span>
                </button>
                <span className='jpx-settings-title'>App Theme</span>
                <button type='button' className='jpx-settings-close' aria-label='Close' onClick={onClose}>
                    <span className='material-icons' aria-hidden='true'>close</span>
                </button>
            </div>

            <p className='jpx-apptheme-intro'>
                Custom themes alter visual elements across Umbry. Choose one to suit your style.
            </p>

            <div className='jpx-settings-list'>
                {listAllThemes().map(t => (
                    <button
                        type='button'
                        key={t.id}
                        className={`jpx-apptheme-card${active === t.id ? ' selected' : ''}`}
                        onClick={() => pick(t)}
                    >
                        <span className='jpx-apptheme-top'>
                            <span className='jpx-apptheme-name'>{t.displayName}</span>
                            {active === t.id && (
                                <span className='material-icons jpx-apptheme-check' aria-hidden='true'>check_circle</span>
                            )}
                        </span>
                        <span className='jpx-apptheme-desc'>{t.description}</span>
                        <span className='jpx-apptheme-bar' style={{ background: swatch(t) }} />
                    </button>
                ))}

                <button type='button' className='jpx-apptheme-create' onClick={() => setEditorOpen(true)}>
                    <span className='material-icons' aria-hidden='true'>add</span>
                    Create new theme
                </button>
            </div>

            <JpxThemeEditor open={editorOpen} onBack={closeEditor} onClose={() => { closeEditor(); onClose(); }} />
        </Drawer>
    );
};

export default JpxAppThemeDrawer;
