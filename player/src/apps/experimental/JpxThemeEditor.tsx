import Drawer from '@mui/material/Drawer';
import Slider from '@mui/material/Slider';
import React, { useCallback, useMemo, useState } from 'react';

import type { JpxThemeSpec } from './theme/jpxThemes';
import { applyTheme, getActiveThemeId, getThemeById, listAllThemes, saveCustomTheme, setActiveTheme } from './theme/jpxTheme';

import './jpxSettingsDrawer.scss';
import './jpxThemeEditor.scss';

// Umbry Theme Editor — Moonfin's theme editor, reimplemented natively. Clone a base theme,
// tweak tokens (live preview via applyTheme), save as a custom theme (shows in the App Theme
// picker), or export/import the JSON.

// spec color (#AARRGGBB) <-> native <input type=color> (#RRGGBB)
const toInput = (argb: string): string => {
    const h = (argb || '').replace('#', '');
    return '#' + (h.length === 8 ? h.slice(2) : h).padStart(6, '0').slice(0, 6);
};
const fromInput = (rgb: string): string => '#FF' + rgb.replace('#', '').toUpperCase();

const slug = (name: string): string =>
    'custom-' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'theme');

const clone = (s: JpxThemeSpec): JpxThemeSpec => JSON.parse(JSON.stringify(s)) as JpxThemeSpec;

interface ColorField { key: keyof JpxThemeSpec['colors'] | 'focusBorderColor'; label: string }
const COLOR_FIELDS: ColorField[] = [
    { key: 'accent', label: 'Accent' },
    { key: 'onAccent', label: 'On Accent' },
    { key: 'background', label: 'Background' },
    { key: 'surface', label: 'Surface' },
    { key: 'surfaceVariant', label: 'Surface Variant' },
    { key: 'buttonNormal', label: 'Button' },
    { key: 'inputBorder', label: 'Input Border' },
    { key: 'rangeProgress', label: 'Slider / Progress' },
    { key: 'focusBorderColor', label: 'Focus Border' }
];

interface JpxThemeEditorProps {
    open: boolean;
    onClose: () => void;
    onBack: () => void;
}

const JpxThemeEditor = ({ open, onClose, onBack }: JpxThemeEditorProps) => {
    const startBase = useMemo(() => clone(getThemeById(getActiveThemeId())), []);
    const [ spec, setSpec ] = useState<JpxThemeSpec>(() => ({ ...startBase, id: '', displayName: 'My Theme' }));
    const [ showJson, setShowJson ] = useState(false);
    const [ importText, setImportText ] = useState('');

    // Apply live on every change.
    const apply = useCallback((next: JpxThemeSpec) => { setSpec(next); applyTheme(next, false); }, []);

    const setColor = (field: ColorField, rgb: string) => {
        const next = clone(spec);
        if (field.key === 'focusBorderColor') next.borders.focusBorderColor = fromInput(rgb);
        else (next.colors as Record<string, string>)[field.key] = fromInput(rgb);
        apply(next);
    };

    const setBase = (id: string) => {
        const base = clone(getThemeById(id));
        apply({ ...base, id: '', displayName: spec.displayName });
    };

    const setRadius = (v: number) => { const n = clone(spec); n.borders.cardRadius = v; apply(n); };
    const setGlow = (v: number) => {
        const n = clone(spec);
        n.borders.focusGlow = v > 0 ? [{ color: n.borders.focusBorderColor.replace('#FF', '#80'), blur: v }] : [];
        apply(n);
    };
    const setFlag = (flag: 'isGlass' | 'isPixel', on: boolean) => {
        const n = clone(spec);
        n.isGlass = flag === 'isGlass' ? on : false;
        n.isPixel = flag === 'isPixel' ? on : false;
        apply(n);
    };

    const save = () => {
        const toSave: JpxThemeSpec = { ...clone(spec), id: slug(spec.displayName || 'theme'), displayName: spec.displayName || 'My Theme' };
        saveCustomTheme(toSave);
        setActiveTheme(toSave.id);
        onClose();
    };

    const doImport = () => {
        try {
            const parsed = JSON.parse(importText) as JpxThemeSpec;
            if (parsed && parsed.colors && parsed.borders) apply({ ...parsed, id: '' });
        } catch { /* ignore bad JSON */ }
    };

    const json = useMemo(() => JSON.stringify(spec, null, 2), [ spec ]);

    return (
        <Drawer anchor='right' open={open} onClose={onClose} PaperProps={{ className: 'jpx-settings-paper jpx-editor-paper' }}>
            <div className='jpx-settings-head'>
                <button type='button' className='jpx-settings-close' aria-label='Back' onClick={onBack}>
                    <span className='material-icons' aria-hidden='true'>arrow_back</span>
                </button>
                <span className='jpx-settings-title'>Theme Editor</span>
                <button type='button' className='jpx-settings-close' aria-label='Close' onClick={onClose}>
                    <span className='material-icons' aria-hidden='true'>close</span>
                </button>
            </div>

            <div className='jpx-settings-list'>
                <div className='jpx-settings-section-header'>Theme</div>
                <div className='jpx-editor-field'>
                    <label>Name</label>
                    <input className='jpx-editor-text' value={spec.displayName}
                        onChange={e => setSpec({ ...spec, displayName: e.target.value })} />
                </div>
                <div className='jpx-editor-field'>
                    <label>Start From</label>
                    <select className='jpx-editor-text' onChange={e => setBase(e.target.value)} defaultValue=''>
                        <option value='' disabled>Choose a base…</option>
                        {listAllThemes().map(t => <option key={t.id} value={t.id}>{t.displayName}</option>)}
                    </select>
                </div>

                <div className='jpx-settings-section-header'>Colors</div>
                {COLOR_FIELDS.map(f => {
                    const cur = f.key === 'focusBorderColor' ? spec.borders.focusBorderColor : (spec.colors as Record<string, string>)[f.key];
                    return (
                        <div className='jpx-editor-color-row' key={f.key}>
                            <span className='jpx-editor-color-label'>{f.label}</span>
                            <label className='jpx-color' style={{ background: toInput(cur) }}>
                                <input type='color' value={toInput(cur)} onChange={e => setColor(f, e.target.value)} />
                            </label>
                        </div>
                    );
                })}

                <div className='jpx-settings-section-header'>Shape & Effects</div>
                <div className='jpx-editor-field'>
                    <label>Card Radius <b>{spec.borders.cardRadius}px</b></label>
                    <Slider size='small' value={spec.borders.cardRadius} min={0} max={32} step={1}
                        onChange={(_e, v) => setRadius(v as number)} />
                </div>
                <div className='jpx-editor-field'>
                    <label>Focus Glow <b>{spec.borders.focusGlow[0]?.blur ?? 0}px</b></label>
                    <Slider size='small' value={spec.borders.focusGlow[0]?.blur ?? 0} min={0} max={64} step={2}
                        onChange={(_e, v) => setGlow(v as number)} />
                </div>
                <button type='button' className='jpx-settings-row' onClick={() => setFlag('isGlass', !spec.isGlass)}>
                    <span className='jpx-settings-text'><span className='jpx-settings-row-title'>Glass effect</span></span>
                    <span className={`jpx-toggle${spec.isGlass ? ' on' : ''}`}><span className='jpx-toggle-knob' /></span>
                </button>
                <button type='button' className='jpx-settings-row' onClick={() => setFlag('isPixel', !spec.isPixel)}>
                    <span className='jpx-settings-text'><span className='jpx-settings-row-title'>Pixel effect</span></span>
                    <span className={`jpx-toggle${spec.isPixel ? ' on' : ''}`}><span className='jpx-toggle-knob' /></span>
                </button>

                <div className='jpx-settings-section-header'>JSON</div>
                <button type='button' className='jpx-settings-row' onClick={() => setShowJson(s => !s)}>
                    <span className='jpx-settings-text'><span className='jpx-settings-row-title'>{showJson ? 'Hide' : 'Import / Export'} JSON</span></span>
                    <span className='material-icons jpx-settings-chev'>{showJson ? 'expand_less' : 'expand_more'}</span>
                </button>
                {showJson && (
                    <div className='jpx-editor-json'>
                        <label>Export (copy this)</label>
                        <textarea className='jpx-editor-textarea' readOnly value={json} onFocus={e => e.currentTarget.select()} />
                        <label>Import (paste + Load)</label>
                        <textarea className='jpx-editor-textarea' value={importText} placeholder='Paste theme JSON…'
                            onChange={e => setImportText(e.target.value)} />
                        <button type='button' className='jpx-editor-btn' onClick={doImport}>Load JSON</button>
                    </div>
                )}
            </div>

            <div className='jpx-settings-foot'>
                <button type='button' className='jpx-editor-save' onClick={save}>Save Theme</button>
            </div>
        </Drawer>
    );
};

export default JpxThemeEditor;
