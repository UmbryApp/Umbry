// Umbry App Themes. A few presets (Nocturne, Nightdrive, Frost, Arcade) were adapted from the
// Moonfin project's ThemeSpec presets and then tuned into Umbry originals; Moonfin (GPL-2.0) is
// credited in the app's acknowledgments (Settings > About). The rest are Umbry-original. Colors are
// in #AARRGGBB (alpha-first) form; the loader (jpxTheme.ts) converts them to CSS. Umbry purple = default.

export interface JpxGlow {
    color: string;
    blur: number;
    spread?: number;
    x?: number;
    y?: number;
}

export interface JpxThemeSpec {
    id: string;
    displayName: string;
    description: string;
    colors: {
        background: string;
        onBackground: string;
        surface: string;
        onSurface: string;
        surfaceVariant: string;
        scrim: string;
        accent: string;
        onAccent: string;
        buttonNormal: string;
        buttonFocused: string;
        onButtonNormal: string;
        inputBackground: string;
        inputBorder: string;
        inputBorderFocused: string;
        rangeTrack: string;
        rangeProgress: string;
        rangeThumb: string;
        card?: string;
        error?: string;
    };
    borders: {
        cardRadius: number;
        chipRadius: number;
        focusBorderColor: string;
        focusBorderWidth: number;
        focusGlow: JpxGlow[];
    };
    // Umbry extra: an optional brand gradient for primary buttons/titles (falls back to accent).
    gradient?: string;
    // Optional PAGE background gradient (the ground behind every page); falls back to the flat background color.
    bgGradient?: string;
    textGlow?: JpxGlow[];
    isGlass?: boolean;
    isPixel?: boolean;
    transparentNav?: boolean;
    // Animated seasonal decoration layer (drifting bats, falling snow/leaves/confetti, fireworks)
    // + ambient effects, driven by jpxSeasonalFx. Undefined = none.
    seasonalFx?: 'halloween' | 'xmas' | 'thanksgiving' | 'newyear' | 'july4' | 'stpatricks' | 'valentines';
}

export const JPX_THEMES: JpxThemeSpec[] = [
    {
        id: 'umbry',
        displayName: 'Umbry',
        description: 'The Umbry default — deep umbra with an ember-to-twilight glow.',
        colors: {
            background: '#FF110D24', onBackground: '#FFECE9FB',
            surface: '#FF1A1538', onSurface: '#FFECE9FB', surfaceVariant: '#FF221B44', scrim: '#CC000000',
            accent: '#FF9385F5', onAccent: '#FF160E2A',
            buttonNormal: '#FF241D48', buttonFocused: '#FF9385F5', onButtonNormal: '#FFECE9FB',
            inputBackground: '#14FFFFFF', inputBorder: '#22FFFFFF', inputBorderFocused: '#FF9385F5',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FF9385F5', rangeThumb: '#FF9385F5',
            card: '#FF1A1538'
        },
        borders: {
            cardRadius: 16, chipRadius: 999, focusBorderColor: '#FF9385F5', focusBorderWidth: 2,
            focusGlow: [{ color: '#809385F5', blur: 22 }]
        },
        gradient: 'linear-gradient(100deg, #FFC670, #FF9A4B 42%, #C77BD8 74%, #9385F5)',
        // Dusk ground: twilight glow top-right, faint ember rise bottom-left, over an umbra fade.
        bgGradient: 'radial-gradient(110% 55% at 88% -8%, rgba(147, 133, 245, 0.16), transparent 62%), '
            + 'radial-gradient(95% 45% at 6% 108%, rgba(255, 154, 75, 0.10), transparent 60%), '
            + 'linear-gradient(172deg, #191233 0%, #110D24 46%, #0B0818 100%)'
    },
    {
        id: 'nocturne',
        displayName: 'Nocturne',
        description: 'A clean, dark theme with a cool cyan-teal accent.',
        colors: {
            background: '#FF0D0F13', onBackground: '#FFF3F5F7',
            surface: '#FF171A20', onSurface: '#FFF3F5F7', surfaceVariant: '#FF222630', scrim: '#CC000000',
            accent: '#FF29C7DE', onAccent: '#FF06121A',
            buttonNormal: '#FF232833', buttonFocused: '#FF29C7DE', onButtonNormal: '#FFF3F5F7',
            inputBackground: '#FF232833', inputBorder: '#FF394150', inputBorderFocused: '#FF29C7DE',
            rangeTrack: '#FF394150', rangeProgress: '#FF29C7DE', rangeThumb: '#FF29C7DE',
            card: '#FF171A20'
        },
        borders: {
            cardRadius: 10, chipRadius: 999, focusBorderColor: '#FF29C7DE', focusBorderWidth: 2,
            focusGlow: [{ color: '#5529C7DE', blur: 16 }]
        }
    },
    {
        id: 'nightdrive',
        displayName: 'Nightdrive',
        description: 'Synthwave neon — a magenta glow over cyan text.',
        colors: {
            background: '#FF0B0420', onBackground: '#FF25E0F2',
            surface: '#CC1E0A3F', onSurface: '#FF25E0F2', surfaceVariant: '#CC1E0A3F', scrim: '#CC0B0420',
            accent: '#FFFF3D9E', onAccent: '#FFFFFFFF',
            buttonNormal: '#00000000', buttonFocused: '#FF25E0F2', onButtonNormal: '#FFFF3D9E',
            inputBackground: '#331E0A3F', inputBorder: '#66FF3D9E', inputBorderFocused: '#FFFF3D9E',
            rangeTrack: '#66201840', rangeProgress: '#FFFF3D9E', rangeThumb: '#FFFF3D9E',
            card: '#CC1E0A3F', error: '#FFFF003C'
        },
        borders: {
            cardRadius: 10, chipRadius: 8, focusBorderColor: '#FFFF3D9E', focusBorderWidth: 1.4,
            focusGlow: [{ color: '#99FF3D9E', blur: 8, spread: 0.5 }, { color: '#6625E0F2', blur: 5 }]
        },
        gradient: 'linear-gradient(135deg, #FF3D9E 0%, #A733FF 50%, #25E0F2 100%)',
        textGlow: [{ color: '#6625E0F2', blur: 8 }],
        transparentNav: true
    },
    {
        id: 'frost',
        displayName: 'Frost',
        description: 'Frosted liquid glass with a cool blue accent.',
        colors: {
            background: '#CC07090F', onBackground: '#FFFFFFFF',
            surface: '#D90E1117', onSurface: '#FFFFFFFF', surfaceVariant: '#29FFFFFF', scrim: '#99060810',
            accent: '#FF2E97FF', onAccent: '#FFFFFFFF',
            buttonNormal: '#1FFFFFFF', buttonFocused: '#F2FFFFFF', onButtonNormal: '#FFFFFFFF',
            inputBackground: '#1FFFFFFF', inputBorder: '#33FFFFFF', inputBorderFocused: '#FF2E97FF',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FF2E97FF', rangeThumb: '#FFFFFFFF',
            card: '#D90E1117'
        },
        borders: {
            cardRadius: 14, chipRadius: 999, focusBorderColor: '#FFFFFFFF', focusBorderWidth: 2,
            focusGlow: [{ color: '#40FFFFFF', blur: 12 }, { color: '#332E97FF', blur: 22, spread: 1 }]
        },
        isGlass: true,
        transparentNav: true
    },
    {
        id: 'arcade',
        displayName: 'Arcade',
        description: 'Retro pixel-art — a chunky palette, blocky borders, and hard shadows.',
        colors: {
            background: '#FF1A1C2C', onBackground: '#FFF4F4F4',
            surface: '#FF333C57', onSurface: '#FFF4F4F4', surfaceVariant: '#FF566C86', scrim: '#CC1A1C2C',
            accent: '#FFF58461', onAccent: '#FF1A1C2C',
            buttonNormal: '#FF29366F', buttonFocused: '#FFFFD27E', onButtonNormal: '#FFF4F4F4',
            inputBackground: '#FF333C57', inputBorder: '#FF566C86', inputBorderFocused: '#FFFFD27E',
            rangeTrack: '#FF333C57', rangeProgress: '#FF9BEA63', rangeThumb: '#FFFFD27E',
            card: '#FF333C57'
        },
        borders: {
            cardRadius: 0, chipRadius: 0, focusBorderColor: '#FFFFD27E', focusBorderWidth: 3,
            focusGlow: [{ color: '#99FFD27E', blur: 0, x: 4, y: 4 }]
        },
        gradient: 'linear-gradient(135deg, #F58461 0%, #FFD27E 45%, #4FB0F7 100%)',
        isPixel: true
    },
    {
        id: 'ember',
        displayName: 'Ember',
        description: 'Molten charcoal with an ember-orange to amber glow — the one warm theme.',
        colors: {
            background: '#FF0E0A08', onBackground: '#FFFDF6EE',
            surface: '#FF1A1310', onSurface: '#FFFDF6EE', surfaceVariant: '#FF241A14', scrim: '#CC0A0705',
            accent: '#FFFF6B2D', onAccent: '#FF1A0A03',
            buttonNormal: '#FF2A1F18', buttonFocused: '#FFFFB03A', onButtonNormal: '#FFFDF6EE',
            inputBackground: '#14FFFFFF', inputBorder: '#26FFFFFF', inputBorderFocused: '#FFFF6B2D',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FFFF6B2D', rangeThumb: '#FFFFB03A',
            card: '#FF1A1310', error: '#FFFF4530'
        },
        borders: {
            cardRadius: 14, chipRadius: 999, focusBorderColor: '#FFFF6B2D', focusBorderWidth: 2,
            focusGlow: [{ color: '#99FF6B2D', blur: 16 }, { color: '#55FF3D2E', blur: 8 }]
        },
        gradient: 'linear-gradient(120deg, #ff3d2e 0%, #ff6b2d 50%, #ffb03a 100%)',
        textGlow: [{ color: '#4DFF6B2D', blur: 10 }],
        transparentNav: true
    },
    {
        id: 'aurora',
        displayName: 'Aurora',
        description: 'Ethereal midnight glass with a green-to-teal-to-violet aurora shimmer.',
        colors: {
            background: '#FF060A12', onBackground: '#FFEAFBF6',
            surface: '#D90A121E', onSurface: '#FFEAFBF6', surfaceVariant: '#29FFFFFF', scrim: '#99060A12',
            accent: '#FF37F0C4', onAccent: '#FF03130E',
            buttonNormal: '#1FFFFFFF', buttonFocused: '#FFA97BFF', onButtonNormal: '#FFEAFBF6',
            inputBackground: '#1FFFFFFF', inputBorder: '#33FFFFFF', inputBorderFocused: '#FF37F0C4',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FF37F0C4', rangeThumb: '#FFA97BFF',
            card: '#D90A121E'
        },
        borders: {
            cardRadius: 16, chipRadius: 999, focusBorderColor: '#FF37F0C4', focusBorderWidth: 2,
            focusGlow: [{ color: '#6637F0C4', blur: 16 }, { color: '#55A97BFF', blur: 24, spread: 1 }]
        },
        gradient: 'linear-gradient(120deg, #37F0C4 0%, #34D8FF 45%, #A97BFF 100%)',
        textGlow: [{ color: '#4D37F0C4', blur: 10 }],
        isGlass: true,
        transparentNav: true
    },
    {
        id: 'matrix',
        displayName: 'Matrix',
        description: 'Terminal phosphor-green on pure black — blocky, glowing, hacker-core.',
        colors: {
            background: '#FF020402', onBackground: '#FF33E06A',
            surface: '#FF071007', onSurface: '#FF6BFF95', surfaceVariant: '#FF0C1A0C', scrim: '#CC020402',
            accent: '#FF00FF66', onAccent: '#FF02140A',
            buttonNormal: '#FF0C1A0C', buttonFocused: '#FF00FF66', onButtonNormal: '#FF9BFFB8',
            inputBackground: '#1500FF66', inputBorder: '#4400FF66', inputBorderFocused: '#FF00FF66',
            rangeTrack: '#3300FF66', rangeProgress: '#FF00FF66', rangeThumb: '#FF00FF66',
            card: '#FF071007', error: '#FFFF3B3B'
        },
        borders: {
            cardRadius: 4, chipRadius: 4, focusBorderColor: '#FF00FF66', focusBorderWidth: 1.5,
            focusGlow: [{ color: '#9900FF66', blur: 10 }, { color: '#5500FF66', blur: 4 }]
        },
        gradient: 'linear-gradient(90deg, #00FF66 0%, #00C853 100%)',
        textGlow: [{ color: '#6600FF66', blur: 8 }]
    },
    {
        id: 'crimson',
        displayName: 'Crimson',
        description: 'Moody near-black with a deep blood-red accent and a warm ember glow.',
        colors: {
            background: '#FF0C0608', onBackground: '#FFF6E9EC',
            surface: '#FF16090C', onSurface: '#FFF6E9EC', surfaceVariant: '#FF210E12', scrim: '#CC0C0608',
            accent: '#FFE11D3A', onAccent: '#FFFFFFFF',
            buttonNormal: '#FF2A1116', buttonFocused: '#FFE11D3A', onButtonNormal: '#FFF6E9EC',
            inputBackground: '#14FFFFFF', inputBorder: '#26FFFFFF', inputBorderFocused: '#FFE11D3A',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FFE11D3A', rangeThumb: '#FFE11D3A',
            card: '#FF16090C', error: '#FFFF4530'
        },
        borders: {
            cardRadius: 14, chipRadius: 999, focusBorderColor: '#FFE11D3A', focusBorderWidth: 2,
            focusGlow: [{ color: '#99E11D3A', blur: 16 }, { color: '#55A00C22', blur: 8 }]
        },
        gradient: 'linear-gradient(120deg, #7a0f1f 0%, #e11d3a 55%, #ff5a3c 100%)',
        textGlow: [{ color: '#40E11D3A', blur: 9 }],
        transparentNav: true
    },
    {
        id: 'midas',
        displayName: 'Midas',
        description: 'Onyx and metallic gold — quiet luxury, no glow, sharp contrast.',
        colors: {
            background: '#FF0A0906', onBackground: '#FFF3ECD9',
            surface: '#FF141109', onSurface: '#FFF3ECD9', surfaceVariant: '#FF201A0E', scrim: '#CC0A0906',
            accent: '#FFE8B33D', onAccent: '#FF171203',
            buttonNormal: '#FF241D0E', buttonFocused: '#FFFFD86B', onButtonNormal: '#FFF3ECD9',
            inputBackground: '#14FFFFFF', inputBorder: '#26FFFFFF', inputBorderFocused: '#FFE8B33D',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FFE8B33D', rangeThumb: '#FFFFD86B',
            card: '#FF141109'
        },
        borders: {
            cardRadius: 12, chipRadius: 999, focusBorderColor: '#FFE8B33D', focusBorderWidth: 2,
            focusGlow: [{ color: '#80E8B33D', blur: 18 }]
        },
        gradient: 'linear-gradient(120deg, #b8860b 0%, #e8b33d 45%, #ffe08a 100%)',
        transparentNav: true
    },
    {
        id: 'halloween',
        displayName: 'Halloween',
        description: 'Jack-o-lantern orange and haunted purple on black, with a spooky double glow.',
        colors: {
            background: '#FF0A0710', onBackground: '#FFF7EAD9',
            surface: '#FF161020', onSurface: '#FFF7EAD9', surfaceVariant: '#FF241733', scrim: '#CC0A0710',
            accent: '#FFFF7A18', onAccent: '#FF190A02',
            buttonNormal: '#FF241733', buttonFocused: '#FFB14BFF', onButtonNormal: '#FFF7EAD9',
            inputBackground: '#14FFFFFF', inputBorder: '#33B14BFF', inputBorderFocused: '#FFFF7A18',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FFFF7A18', rangeThumb: '#FFB14BFF',
            card: '#FF161020', error: '#FFFF4530'
        },
        borders: {
            cardRadius: 14, chipRadius: 999, focusBorderColor: '#FFFF7A18', focusBorderWidth: 2,
            focusGlow: [{ color: '#99FF7A18', blur: 16 }, { color: '#66B14BFF', blur: 24, spread: 1 }]
        },
        gradient: 'linear-gradient(120deg, #7B2FF7 0%, #B14BFF 30%, #FF7A18 100%)',
        textGlow: [{ color: '#66FF7A18', blur: 10 }, { color: '#40B14BFF', blur: 18 }],
        transparentNav: true,
        seasonalFx: 'halloween'
    },
    {
        id: 'christmas',
        displayName: 'Christmas',
        description: 'Evergreen and cranberry red with warm gold — and gently falling snow.',
        colors: {
            background: '#FF060F0A', onBackground: '#FFF6F1E7',
            surface: '#FF0E1A12', onSurface: '#FFF6F1E7', surfaceVariant: '#FF15271B', scrim: '#CC060F0A',
            accent: '#FFE23A47', onAccent: '#FFFFFFFF',
            buttonNormal: '#FF15271B', buttonFocused: '#FF2FB56E', onButtonNormal: '#FFF6F1E7',
            inputBackground: '#14FFFFFF', inputBorder: '#332FB56E', inputBorderFocused: '#FFE23A47',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FFE23A47', rangeThumb: '#FFE8B33D',
            card: '#FF0E1A12', error: '#FFFF4530'
        },
        borders: {
            cardRadius: 14, chipRadius: 999, focusBorderColor: '#FFE23A47', focusBorderWidth: 2,
            focusGlow: [{ color: '#88E23A47', blur: 16 }, { color: '#552FB56E', blur: 20 }]
        },
        gradient: 'linear-gradient(120deg, #c0392b 0%, #1f9d55 50%, #e8b33d 100%)',
        textGlow: [{ color: '#40E8B33D', blur: 10 }],
        transparentNav: true,
        seasonalFx: 'xmas'
    },
    {
        id: 'thanksgiving',
        displayName: 'Thanksgiving',
        description: 'Rustic harvest — burnt orange, maroon, and amber, with drifting autumn leaves.',
        colors: {
            background: '#FF0E0906', onBackground: '#FFF4E7D5',
            surface: '#FF1A1109', onSurface: '#FFF4E7D5', surfaceVariant: '#FF281A0F', scrim: '#CC0E0906',
            accent: '#FFCB6D2C', onAccent: '#FF1A0A02',
            buttonNormal: '#FF2A1B10', buttonFocused: '#FFE0A23A', onButtonNormal: '#FFF4E7D5',
            inputBackground: '#14FFFFFF', inputBorder: '#268A2B2B', inputBorderFocused: '#FFCB6D2C',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FFCB6D2C', rangeThumb: '#FFE0A23A',
            card: '#FF1A1109', error: '#FFFF4530'
        },
        borders: {
            cardRadius: 14, chipRadius: 999, focusBorderColor: '#FFCB6D2C', focusBorderWidth: 2,
            focusGlow: [{ color: '#88CB6D2C', blur: 16 }, { color: '#558A2B2B', blur: 20 }]
        },
        gradient: 'linear-gradient(120deg, #8A2B2B 0%, #CB6D2C 55%, #E0A23A 100%)',
        textGlow: [{ color: '#40CB6D2C', blur: 10 }],
        transparentNav: true,
        seasonalFx: 'thanksgiving'
    },
    {
        id: 'newyear',
        displayName: "New Year's",
        description: 'Midnight black with champagne gold and silver — sparkles and confetti at the ready.',
        colors: {
            background: '#FF060608', onBackground: '#FFF4F1E8',
            surface: '#FF111116', onSurface: '#FFF4F1E8', surfaceVariant: '#FF1C1C24', scrim: '#CC060608',
            accent: '#FFFFD54A', onAccent: '#FF16130A',
            buttonNormal: '#FF1C1C24', buttonFocused: '#FFE8ECF2', onButtonNormal: '#FFF4F1E8',
            inputBackground: '#14FFFFFF', inputBorder: '#33E8ECF2', inputBorderFocused: '#FFFFD54A',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FFFFD54A', rangeThumb: '#FFE8ECF2',
            card: '#FF111116'
        },
        borders: {
            cardRadius: 14, chipRadius: 999, focusBorderColor: '#FFFFD54A', focusBorderWidth: 2,
            focusGlow: [{ color: '#99FFD54A', blur: 16 }, { color: '#55E8ECF2', blur: 22, spread: 1 }]
        },
        gradient: 'linear-gradient(120deg, #FFD54A 0%, #E8ECF2 45%, #B14BFF 100%)',
        textGlow: [{ color: '#66FFD54A', blur: 10 }],
        transparentNav: true,
        seasonalFx: 'newyear'
    },
    {
        id: 'july4',
        displayName: '4th of July',
        description: 'Stars and stripes — patriot blue, rocket red, and white, with bursting fireworks.',
        colors: {
            background: '#FF05060C', onBackground: '#FFF2F4FA',
            surface: '#FF0C1020', onSurface: '#FFF2F4FA', surfaceVariant: '#FF141A30', scrim: '#CC05060C',
            accent: '#FF2E5BFF', onAccent: '#FFFFFFFF',
            buttonNormal: '#FF141A30', buttonFocused: '#FFE23A47', onButtonNormal: '#FFF2F4FA',
            inputBackground: '#14FFFFFF', inputBorder: '#33E23A47', inputBorderFocused: '#FF2E5BFF',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FF2E5BFF', rangeThumb: '#FFE23A47',
            card: '#FF0C1020', error: '#FFFF4530'
        },
        borders: {
            cardRadius: 14, chipRadius: 999, focusBorderColor: '#FF2E5BFF', focusBorderWidth: 2,
            focusGlow: [{ color: '#992E5BFF', blur: 16 }, { color: '#66E23A47', blur: 22, spread: 1 }]
        },
        gradient: 'linear-gradient(120deg, #E23A47 0%, #FFFFFF 50%, #2E5BFF 100%)',
        textGlow: [{ color: '#552E5BFF', blur: 10 }],
        transparentNav: true,
        seasonalFx: 'july4'
    },
    {
        id: 'stpatricks',
        displayName: "St. Patrick's Day",
        description: 'Emerald green and pot-of-gold, with a shower of lucky shamrocks.',
        colors: {
            background: '#FF04100A', onBackground: '#FFF0FBE9',
            surface: '#FF0A1A0E', onSurface: '#FFF0FBE9', surfaceVariant: '#FF102A16', scrim: '#CC04100A',
            accent: '#FF2FBF57', onAccent: '#FF04140A',
            buttonNormal: '#FF102A16', buttonFocused: '#FFF2C94B', onButtonNormal: '#FFF0FBE9',
            inputBackground: '#14FFFFFF', inputBorder: '#33F2C94B', inputBorderFocused: '#FF2FBF57',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FF2FBF57', rangeThumb: '#FFF2C94B',
            card: '#FF0A1A0E', error: '#FFFF4530'
        },
        borders: {
            cardRadius: 14, chipRadius: 999, focusBorderColor: '#FF2FBF57', focusBorderWidth: 2,
            focusGlow: [{ color: '#992FBF57', blur: 16 }, { color: '#55F2C94B', blur: 20 }]
        },
        gradient: 'linear-gradient(120deg, #0f7a34 0%, #2fbf57 55%, #f2c94b 100%)',
        textGlow: [{ color: '#4D2FBF57', blur: 10 }],
        transparentNav: true,
        seasonalFx: 'stpatricks'
    },
    {
        id: 'valentines',
        displayName: "Valentine's Day",
        description: 'Rose pink and wine red with a soft blush glow — and a fall of hearts.',
        colors: {
            background: '#FF120610', onBackground: '#FFFDEEF3',
            surface: '#FF1E0A18', onSurface: '#FFFDEEF3', surfaceVariant: '#FF2C0F24', scrim: '#CC120610',
            accent: '#FFFF4E8B', onAccent: '#FFFFFFFF',
            buttonNormal: '#FF2C0F24', buttonFocused: '#FFFF9EC4', onButtonNormal: '#FFFDEEF3',
            inputBackground: '#14FFFFFF', inputBorder: '#33FF9EC4', inputBorderFocused: '#FFFF4E8B',
            rangeTrack: '#33FFFFFF', rangeProgress: '#FFFF4E8B', rangeThumb: '#FFFF9EC4',
            card: '#FF1E0A18', error: '#FFFF4530'
        },
        borders: {
            cardRadius: 16, chipRadius: 999, focusBorderColor: '#FFFF4E8B', focusBorderWidth: 2,
            focusGlow: [{ color: '#99FF4E8B', blur: 16 }, { color: '#55FF9EC4', blur: 22, spread: 1 }]
        },
        gradient: 'linear-gradient(120deg, #b0184e 0%, #ff4e8b 50%, #ff9ec4 100%)',
        textGlow: [{ color: '#4DFF4E8B', blur: 10 }],
        transparentNav: true,
        seasonalFx: 'valentines'
    }
];

export const DEFAULT_THEME_ID = 'umbry';
