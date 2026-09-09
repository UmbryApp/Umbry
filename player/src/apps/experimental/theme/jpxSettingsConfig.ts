// Umbry settings tree — ported 1:1 from Moonfin's menu spec (see KB moonfin-menu-tree-spec.md).
// Data-driven: JpxSettingsDrawer renders any panel from this config. Moonfin-custom rows persist to
// jpxPrefs; rows that map to a working Jellyfin page use type 'route'; 'appTheme' opens the picker.

export type JpxRowType =
    | 'nav'        // chevron -> push another panel (row.panel)
    | 'route'      // navigate to a Jellyfin route (row.route) and close
    | 'appTheme'   // open the App Theme picker
    | 'toggle'     // switch bound to a pref key
    | 'select'     // value-pill: menu of options bound to a pref key
    | 'slider'     // slider bound to a pref key
    | 'color'      // color swatch bound to a pref key
    | 'link'       // open an external URL (row.url)
    | 'action'     // fires a named action (row.action)
    | 'static'     // display-only value (row.value)
    | 'prose';     // a block of legal/policy text (row.body, paragraphs split on \n\n)

export interface JpxOption { value: string; label: string }

export interface JpxRow {
    type: JpxRowType;
    icon?: string;
    title: string;
    subtitle?: string;
    key?: string;            // pref key for toggle/select/slider/color
    store?: 'jpx' | 'user' | 'app' | 'subApp' | 'userConfig'; // backing (default jpx). userConfig=server user.Configuration field
    optionsSource?: 'cultures'; // dynamically populate select options (e.g. the server's language list)
    default?: unknown;
    options?: JpxOption[];   // for select
    min?: number; max?: number; step?: number; unit?: string; // for slider
    panel?: string;          // for nav
    route?: string;          // for route
    url?: string;            // for link
    action?: string;         // for action
    value?: string;          // for static
    body?: string;           // for prose
    admin?: boolean;
    electronOnly?: boolean;  // only show inside the Umbry desktop app (window.umbry present)
    nativeOnly?: boolean;    // show in any packaged native app (desktop Electron OR Android/Capacitor)
}

export interface JpxSection { header?: string; rows: JpxRow[] }
export interface JpxPanel { id: string; title: string; sections: JpxSection[] }

const onOff = undefined; // (toggles default false unless default set)

const PBT_OPTS: JpxOption[] = [ { value: 'none', label: 'None' }, { value: 'elapsed', label: 'Time elapsed' }, { value: 'remaining', label: 'Time remaining' }, { value: 'duration', label: 'Total duration' }, { value: 'endsat', label: 'Ends at' } ];

export const JPX_PANELS: Record<string, JpxPanel> = {
    root: {
        id: 'root', title: 'Settings',
        sections: [{ rows: [
            { type: 'route', icon: 'admin_panel_settings', title: 'Administration', subtitle: 'Access the server administration panel', route: 'jpxadmin', admin: true },
            { type: 'nav', icon: 'lock', title: 'Account & Security', subtitle: 'Authentication, PIN code, and parental controls', panel: 'auth' },
            { type: 'nav', icon: 'palette', title: 'Personalization', subtitle: 'Theme, navigation, home rows, and library visibility', panel: 'personalization' },
            { type: 'nav', icon: 'play_circle', title: 'Playback & SyncPlay', subtitle: 'Audio/video settings, subtitles, downloads, and SyncPlay controls', panel: 'playback' },
            { type: 'nav', icon: 'hub', title: 'Integrations', subtitle: 'Plugin sync, Seerr, ratings, and more', panel: 'integrations' },
            { type: 'nav', icon: 'info', title: 'About', subtitle: 'App version, legal information, and credits', panel: 'about' }
        ] }]
    },

    // ---- Account & Security ----
    auth: {
        id: 'auth', title: 'Account & Security',
        sections: [
            { header: 'Authentication', rows: [
                { type: 'select', icon: 'person', title: 'Auto Login', key: 'pref_auto_login_behavior', default: 'last', options: [
                    { value: 'disabled', label: 'Disabled' }, { value: 'last', label: 'Last User' }, { value: 'current', label: 'Current User' } ] },
                { type: 'toggle', icon: 'lock', title: 'Always Authenticate', subtitle: 'Require password even with stored token', key: 'pref_always_authenticate', default: false },
                { type: 'nav', icon: 'family_restroom', title: 'Parental Controls & PIN', subtitle: 'Kids Mode, content restrictions, and PIN', panel: 'parental' }
            ] },
            { header: 'Account Preferences', rows: [
                { type: 'route', icon: 'language', title: 'Interface Language', subtitle: 'Display language', route: 'userprofile' }
            ] },
            { header: 'Umbry Account', rows: [
                { type: 'action', icon: 'vpn_key', title: 'Password Recovery Code', subtitle: 'Generate a code to reset your account password if you forget it', action: 'account_recovery_code' },
                { type: 'action', icon: 'logout', title: 'Sign out of Umbry', subtitle: 'Sign out of your Umbry account on this device — returns you to the sign-in screen', action: 'account_sign_out' }
            ] },
            { header: 'Umbry Desktop App', rows: [
                { type: 'action', icon: 'delete_forever', title: 'Uninstall Umbry', subtitle: 'Remove the Umbry desktop app from this computer', action: 'uninstall_umbry', electronOnly: true }
            ] },
            { header: 'Privacy & Safety', rows: [
                { type: 'toggle', icon: 'exit_to_app', title: 'Confirm Exit', subtitle: 'Show confirmation before exiting', key: 'confirm_exit', default: false }
            ] }
        ]
    },

    // ---- Parental Controls (Umbry-native Kids Mode + PIN) ----
    parental: {
        id: 'parental', title: 'Parental Controls',
        sections: [
            { header: 'PIN', rows: [
                { type: 'static', icon: 'shield', title: 'PIN Status', value: 'Not set' },
                { type: 'action', icon: 'password', title: 'Set / Change PIN', subtitle: '4-digit PIN, synced to your account', action: 'parental_set_pin' },
                { type: 'action', icon: 'lock_open', title: 'Remove PIN', subtitle: 'Delete the saved PIN', action: 'parental_clear_pin' }
            ] },
            { header: 'Kids Mode Rules', rows: [
                { type: 'select', icon: 'verified_user', title: 'Maximum Rating', subtitle: 'Highest maturity shown in Kids Mode', key: 'pref_kids_max_level', default: '3', options: [
                    { value: '1', label: 'Little Kids (G / TV-Y)' },
                    { value: '2', label: 'Older Kids (PG / TV-PG)' },
                    { value: '3', label: 'Teens (PG-13 / TV-14)' },
                    { value: '4', label: 'Mature (R / TV-MA)' } ] },
                { type: 'toggle', icon: 'help_outline', title: 'Block Unrated Content', subtitle: 'Hide items that have no rating', key: 'pref_kids_block_unrated', default: true },
                { type: 'action', icon: 'video_library', title: 'Hidden Libraries', subtitle: 'Choose libraries to hide in Kids Mode', action: 'parental_hidden_libs' },
                { type: 'action', icon: 'block', title: 'Blocked Genres & Tags', subtitle: 'Block content by genre or tag, regardless of rating', action: 'parental_blocked_genres' },
                { type: 'select', icon: 'visibility_off', title: 'Restricted Content', subtitle: 'Hide it, or show it but require the PIN to open', key: 'pref_kids_restriction_mode', default: 'hide', options: [
                    { value: 'hide', label: 'Hide' },
                    { value: 'lock', label: 'Lock (PIN to open)' } ] }
            ] },
            { header: 'Kids Mode', rows: [
                { type: 'action', icon: 'child_care', title: 'Enter Kids Mode', subtitle: 'Lock the app to allowed content', action: 'parental_enter_kids' }
            ] }
        ]
    },

    // ---- Personalization ----
    personalization: {
        id: 'personalization', title: 'Personalization',
        sections: [
            { header: 'Appearance', rows: [
                { type: 'nav', icon: 'style', title: 'General Style', subtitle: 'Theme accents, backdrops, and watched indicators', panel: 'generalStyle' },
                { type: 'nav', icon: 'article', title: 'Details Screen', subtitle: 'Style, background blur, and tab behavior', panel: 'detailsScreen' },
                { type: 'nav', icon: 'view_sidebar', title: 'Navigation', subtitle: 'Navbar style, toolbar buttons, appearance', panel: 'navigation' }
            ] },
            { header: 'Layout', rows: [
                { type: 'nav', icon: 'home', title: 'Home Screen', subtitle: 'Sections, image types, overlays, and media previews', panel: 'homeScreen' },
                { type: 'nav', icon: 'video_library', title: 'Libraries', subtitle: 'Library visibility, folder view, and multi-server behavior', panel: 'libraries' }
            ] },
            { header: 'Extras', rows: [
                { type: 'nav', icon: 'featured_play_list', title: 'Media Bar', subtitle: 'Featured content, appearance', panel: 'mediaBar' },
                { type: 'nav', icon: 'preview', title: 'Local Previews', subtitle: 'Configure trailer, media, and audio previews', panel: 'localPreviews' },
                { type: 'nav', icon: 'auto_awesome', title: 'Seasonal Effects', subtitle: 'Visual effects and seasonal decorations', panel: 'seasonal' },
                { type: 'nav', icon: 'music_note', title: 'Theme Music', subtitle: 'Detail pages, home rows, and volume', panel: 'themeMusic' }
            ] }
        ]
    },

    generalStyle: {
        id: 'generalStyle', title: 'General Style',
        sections: [
            { header: 'Theme', rows: [
                { type: 'select', icon: 'devices', title: 'Interface Style', subtitle: 'Automatic matches your device', key: 'pref_interface_style', default: 'auto', options: [
                    { value: 'auto', label: 'Automatic' }, { value: 'apple', label: 'Apple' }, { value: 'material', label: 'Material' } ] },
                { type: 'appTheme', icon: 'palette', title: 'App Theme', subtitle: 'Apply a fully custom theme' },
                { type: 'toggle', icon: 'auto_awesome', title: 'Seasonal Themes', subtitle: 'Automatically switch to a festive theme around each holiday (reverts after)', key: 'pref_auto_seasonal_theme', default: false },
                { type: 'color', icon: 'border_color', title: 'Focus Border Color', key: 'focus_color', default: '#c235ff' }
            ] },
            { header: 'Clock', rows: [
                { type: 'select', icon: 'access_time', title: 'Clock Display', key: 'pref_clock_behavior', default: 'never', options: [
                    { value: 'always', label: 'Always' }, { value: 'menus', label: 'In Menus' }, { value: 'never', label: 'Never' } ] },
                { type: 'toggle', icon: 'schedule', title: '24-Hour Clock', subtitle: 'Use 24-hour time formatting wherever the clock is shown', key: 'pref_use_24_hour_clock', default: false }
            ] },
            { header: 'Display', rows: [
                { type: 'toggle', icon: 'zoom_in', title: 'Focus Expansion Animation', subtitle: 'Scale focused or hovered cards and tiles', key: 'pref_card_focus_expansion', default: true },
                { type: 'select', icon: 'zoom_out_map', title: 'UI Scaling', key: 'pref_desktop_ui_scale', default: 'medium', options: [
                    { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }, { value: 'xl', label: 'Extra Large' } ] },
                { type: 'toggle', icon: 'photo', title: 'Background Backdrops', subtitle: 'Show backdrop images behind content', key: 'pref_show_backdrop', default: true },
                { type: 'select', icon: 'contrast', title: 'OLED Mode', key: 'pref_oled_mode', default: 'off', options: [
                    { value: 'off', label: 'Off' }, { value: 'subtle', label: 'Subtle' }, { value: 'vivid', label: 'Vivid' } ] },
                { type: 'slider', icon: 'blur_on', title: 'Browsing Background Blur', key: 'browsingBackgroundBlurAmount', default: 0, min: 0, max: 30, step: 1, unit: 'px' },
                { type: 'select', icon: 'check_circle', title: 'Watched Indicators', key: 'pref_watched_indicator_behavior', default: 'always', options: [
                    { value: 'always', label: 'Always' }, { value: 'unwatched', label: 'Unwatched Only' }, { value: 'never', label: 'Never' } ] }
            ] }
        ]
    },

    detailsScreen: {
        id: 'detailsScreen', title: 'Details Screen',
        sections: [{ rows: [
            { type: 'select', icon: 'article', title: 'Details Screen Style', key: 'pref_detail_screen_style', default: 'modern', options: [ { value: 'classic', label: 'Classic' }, { value: 'modern', label: 'Modern' } ] },
            { type: 'slider', icon: 'blur_on', title: 'Details Background Blur', key: 'detailsBackgroundBlurAmount', default: 10, min: 0, max: 30, step: 1, unit: 'px' },
            { type: 'toggle', icon: 'tab', title: 'Expanded Tabs', key: 'pref_detail_expanded_tabs', default: false },
            { type: 'toggle', icon: 'info', title: 'Show Technical Details', key: 'pref_detail_show_technical_details', default: true },
            { type: 'toggle', icon: 'visibility_off', title: 'Hide Media Description', subtitle: 'Spoiler control', key: 'pref_hide_details_media_description', default: false }
        ] }]
    },

    navigation: {
        id: 'navigation', title: 'Navigation',
        sections: [
            { header: 'Appearance', rows: [
                { type: 'select', icon: 'view_sidebar', title: 'Navigation Position', key: 'pref_navbar_position', default: 'top-left', options: [ { value: 'top-left', label: 'Top Left' }, { value: 'top-center', label: 'Top Center' }, { value: 'top-right', label: 'Top Right' }, { value: 'left-center', label: 'Left Center' }, { value: 'right-center', label: 'Right Center' }, { value: 'bottom-left', label: 'Bottom Left' }, { value: 'bottom-center', label: 'Bottom Center' }, { value: 'bottom-right', label: 'Bottom Right' } ] },
                { type: 'slider', icon: 'opacity', title: 'Navbar Opacity', key: 'navbarOpacity', default: 100, min: 20, max: 100, step: 5, unit: '%' }
            ] },
            { header: 'Buttons', rows: [
                { type: 'toggle', icon: 'shuffle', title: 'Show Shuffle Button', subtitle: 'Show shuffle button in navigation', key: 'pref_show_shuffle_button', default: true },
                { type: 'toggle', icon: 'theater_comedy', title: 'Show Genres Button', key: 'pref_show_genres_button', default: true },
                { type: 'toggle', icon: 'favorite', title: 'Show Favorites Button', key: 'pref_show_favorites_button', default: true },
                { type: 'toggle', icon: 'video_library', title: 'Show Libraries in Toolbar', key: 'pref_show_libraries_in_toolbar', default: true },
                { type: 'toggle', icon: 'dns', title: 'Show Switch Server Button', subtitle: 'Quickly switch between your servers', key: 'pref_show_switch_server_button', default: true }
            ] }
        ]
    },

    homeScreen: {
        id: 'homeScreen', title: 'Home Screen',
        sections: [
            { header: 'Home Row Display', rows: [
                { type: 'select', icon: 'view_carousel', title: 'Row Type', key: 'pref_home_rows_style', default: 'classic', options: [ { value: 'classic', label: 'Classic' }, { value: 'modern', label: 'Modern' } ] },
                { type: 'select', icon: 'photo_size_select_large', title: 'Card Display Size', key: 'poster_size', default: 'medium', options: [ { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }, { value: 'xl', label: 'Extra Large' } ] },
                { type: 'slider', icon: 'unfold_more', title: 'Home Row Padding', key: 'home_rows_padding', default: 12, min: 0, max: 40, step: 2, unit: 'px' }
            ] },
            { header: 'Continue Watching and Next Up', rows: [
                { type: 'toggle', icon: 'merge_type', title: 'Merge Continue Watching and Next Up', subtitle: 'Combine both rows', key: 'pref_merge_continue_watching_next_up', default: false },
                { type: 'select', icon: 'event_busy', title: 'Max days in Next Up', key: 'pref_next_up_max_days', default: '0', options: [ { value: '0', label: 'No Limit' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '180', label: '180 days' }, { value: '365', label: '365 days' } ] },
                { type: 'toggle', icon: 'menu_book', title: 'Hide Continue Reading Row', subtitle: 'Umbry only; your Jellyfin layout is unchanged', key: 'pref_hide_continue_reading', default: true },
                { type: 'toggle', icon: 'headset', title: 'Hide Continue Listening Row', subtitle: 'Umbry only; your Jellyfin layout is unchanged', key: 'pref_hide_continue_listening', default: true }
            ] },
            { header: 'Home Row Sections', rows: [
                { type: 'nav', icon: 'tune', title: 'Home Row Toggles', panel: 'homeRowToggles' }
            ] }
        ]
    },

    homeRowToggles: {
        id: 'homeRowToggles', title: 'Home Row Toggles',
        sections: [{ rows: [
            { type: 'toggle', icon: 'collections_bookmark', title: 'Display Collections Rows', key: 'pref_display_collections_rows', default: false },
            { type: 'toggle', icon: 'favorite', title: 'Display Favorites Rows', key: 'pref_display_favorites_rows', default: false },
            { type: 'toggle', icon: 'theater_comedy', title: 'Display Genres Rows', key: 'pref_display_genres_rows', default: false },
            { type: 'toggle', icon: 'playlist_play', title: 'Display Playlists Rows', key: 'pref_display_playlists_rows', default: false },
            { type: 'toggle', icon: 'replay', title: 'Display Rewatch Row', key: 'pref_display_rewatch_row', default: false },
            { type: 'toggle', icon: 'history', title: 'Display Since You Watched Rows', key: 'pref_display_since_you_watched_rows', default: false }
        ] }]
    },

    libraries: {
        id: 'libraries', title: 'Libraries',
        sections: [
            { header: 'General', rows: [
                { type: 'toggle', icon: 'dns', title: 'Multi-Server Libraries', subtitle: 'Show libraries from all servers', key: 'enable_multi_server_libraries', default: false },
                { type: 'toggle', icon: 'library_books', title: 'Merge Recent Rows by Type', key: 'pref_merge_recent_rows_by_type', default: false },
                { type: 'action', icon: 'checklist', title: 'Included Libraries', subtitle: 'Choose which libraries from this server appear in Umbry', action: 'library_inclusion' }
            ] },
            { header: 'Home Screen', rows: [
                { type: 'action', icon: 'video_library', title: 'Homepage Libraries', subtitle: 'Show, hide, and reorder libraries on the Home screen', action: 'home_libraries' }
            ] },
            { header: 'Library View', rows: [
                { type: 'toggle', icon: 'info', title: 'Show Media Details', key: 'pref_show_media_details_on_library_page', default: true },
                { type: 'toggle', icon: 'hide_image', title: 'Hide Backdrops while Browsing', key: 'pref_hide_backdrops_in_libraries', default: false }
            ] }
        ]
    },

    mediaBar: {
        id: 'mediaBar', title: 'Media Bar',
        sections: [{ rows: [
            { type: 'select', icon: 'category', title: 'Content Type', key: 'mediaBarContentType', default: 'both', options: [ { value: 'both', label: 'Movies & Shows' }, { value: 'movies', label: 'Movies' }, { value: 'shows', label: 'Shows' } ] },
            { type: 'select', icon: 'source', title: 'Source Type', key: 'mediaBarSourceType', default: 'random', options: [ { value: 'random', label: 'Random' }, { value: 'recentlyAdded', label: 'Recently Added' }, { value: 'recentlyReleased', label: 'Recently Released' } ] },
            { type: 'slider', icon: 'tag', title: 'Item Count', key: 'mediaBarItemCount', default: 7, min: 1, max: 20, step: 1 },
            { type: 'toggle', icon: 'skip_next', title: 'Auto Advance', subtitle: 'Auto-advance slides', key: 'mediaBarAutoAdvance', default: true }
        ] }]
    },

    localPreviews: {
        id: 'localPreviews', title: 'Local Previews',
        sections: [{ rows: [
            { type: 'toggle', icon: 'movie', title: 'Trailer Preview', subtitle: 'Auto-play trailers', key: 'mediaBarTrailerPreview', default: true },
            { type: 'toggle', icon: 'volume_up', title: 'Trailer Audio', subtitle: 'Enable trailer audio', key: 'mediaBarTrailerAudio', default: false },
            { type: 'toggle', icon: 'preview', title: 'Media Preview', key: 'episodePreviewEnabled', default: false },
            { type: 'toggle', icon: 'graphic_eq', title: 'Preview Audio', subtitle: 'Enable preview audio', key: 'previewAudioEnabled', default: false }
        ] }]
    },

    seasonal: {
        id: 'seasonal', title: 'Seasonal Effects',
        sections: [{ rows: [
            { type: 'toggle', icon: 'ac_unit', title: 'Snow', key: 'seasonal_snow', default: false },
            { type: 'toggle', icon: 'celebration', title: 'Fireworks', key: 'seasonal_fireworks', default: false },
            { type: 'toggle', icon: 'auto_awesome', title: 'Confetti', key: 'seasonal_confetti', default: false }
        ] }]
    },

    themeMusic: {
        id: 'themeMusic', title: 'Theme Music',
        sections: [{ rows: [
            { type: 'toggle', icon: 'music_note', title: 'Theme Music', subtitle: 'Play theme music on detail pages', key: 'themeMusicEnabled', default: false },
            { type: 'slider', icon: 'volume_up', title: 'Theme Music Volume', key: 'themeMusicVolume', default: 50, min: 0, max: 100, step: 5, unit: '%' },
            { type: 'toggle', icon: 'repeat', title: 'Loop Theme Music', key: 'themeMusicLoop', default: true }
        ] }]
    },

    // ---- Playback & SyncPlay (Jellyfin-backed -> route to the working pages) ----
    playback: {
        id: 'playback', title: 'Playback',
        sections: [{ rows: [
            { type: 'nav', icon: 'play_circle', title: 'Video Playback', subtitle: 'Player behavior, zoom, and skip lengths', panel: 'videoPlayback' },
            { type: 'nav', icon: 'volume_up', title: 'Audio', subtitle: 'Normalization and language preferences', panel: 'audio' },
            { type: 'nav', icon: 'subtitles', title: 'Subtitles', subtitle: 'Appearance, mode, and languages', panel: 'subtitles' },
            { type: 'nav', icon: 'smart_display', title: 'Automation & Queue', subtitle: 'Cinema mode, autoplay, and Next Up', panel: 'automation' }
        ] }]
    },

    // ---- Audio (native; wired to userSettings + server user config) ----
    audio: {
        id: 'audio', title: 'Audio',
        sections: [
            { header: 'Media Player Behavior', rows: [
                { type: 'select', icon: 'graphic_eq', title: 'Audio Normalization', subtitle: 'Even out volume across tracks', store: 'user', key: 'selectAudioNormalization', default: 'TrackGain', options: [ { value: 'TrackGain', label: 'Track' }, { value: 'AlbumGain', label: 'Album' }, { value: 'None', label: 'Off' } ] }
            ] },
            { header: 'Audio Stream', rows: [
                { type: 'select', icon: 'language', title: 'Default Audio Language', subtitle: 'Preferred audio language', store: 'userConfig', key: 'AudioLanguagePreference', default: '', optionsSource: 'cultures' },
                { type: 'toggle', icon: 'music_note', title: 'Prefer Default Audio Track', subtitle: 'Play the default track over a localized dub', store: 'userConfig', key: 'PlayDefaultAudioTrack', default: false },
                { type: 'toggle', icon: 'save', title: 'Remember Audio Selections', subtitle: 'Reuse your audio choice across episodes', store: 'userConfig', key: 'RememberAudioSelections', default: true }
            ] }
        ]
    },

    // ---- Automation & Queue (native; wired to userSettings + server user config) ----
    automation: {
        id: 'automation', title: 'Automation & Queue',
        sections: [
            { header: 'Playback', rows: [
                { type: 'toggle', icon: 'movie_filter', title: 'Cinema Mode', subtitle: 'Play trailers before movies', store: 'user', key: 'enableCinemaMode', default: true }
            ] },
            { header: 'Up Next', rows: [
                { type: 'toggle', icon: 'skip_next', title: 'Autoplay Next Episode', subtitle: 'Automatically play the next episode', store: 'userConfig', key: 'EnableNextEpisodeAutoPlay', default: true },
                { type: 'toggle', icon: 'preview', title: 'Next Up Info Overlay', subtitle: 'Show the Next Up card near the end of an episode', store: 'user', key: 'enableNextVideoInfoOverlay', default: true },
                { type: 'toggle', icon: 'visibility', title: 'Still Watching Prompt', subtitle: 'Ask if you are still watching after several episodes', store: 'user', key: 'stillWatchingPrompt', default: true }
            ] }
        ]
    },

    // ---- Video Playback (native Moonfin-style; wired to real Jellyfin settings) ----
    videoPlayback: {
        id: 'videoPlayback', title: 'Video Playback',
        sections: [
            { header: 'Media Player Behavior', rows: [
                { type: 'select', icon: 'zoom_out_map', title: 'Player Zoom Mode', subtitle: 'How video is scaled to fit the screen', store: 'app', key: 'aspectRatio', default: 'auto', options: [ { value: 'auto', label: 'Auto' }, { value: 'cover', label: 'Cover' }, { value: 'fill', label: 'Fill' } ] },
                { type: 'select', icon: 'replay', title: 'Skip Back Length', subtitle: 'How far the rewind button jumps', store: 'user', key: 'skipBackLength', default: '10000', options: [ { value: '5000', label: '5 seconds' }, { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }, { value: '30000', label: '30 seconds' } ] },
                { type: 'select', icon: 'forward', title: 'Skip Forward Length', subtitle: 'How far the fast-forward button jumps', store: 'user', key: 'skipForwardLength', default: '30000', options: [ { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }, { value: '30000', label: '30 seconds' }, { value: '60000', label: '60 seconds' } ] },
                { type: 'action', icon: 'tune', title: 'Player Buttons', subtitle: 'Reorder or hide buttons in the player menu', action: 'player_buttons' },
                { type: 'nav', icon: 'timeline', title: 'Progress Bar Time', subtitle: 'Choose the time labels around the scrubber', panel: 'progressBarTime' }
            ] },
            { header: 'Streaming', rows: [
                { type: 'select', icon: 'high_quality', title: 'Max Resolution', subtitle: 'Cap the resolution the player requests', store: 'app', key: 'maxVideoWidth', default: '0', options: [ { value: '0', label: 'Auto' }, { value: '3840', label: '4K (2160p)' }, { value: '2560', label: '1440p' }, { value: '1920', label: '1080p' }, { value: '1280', label: '720p' }, { value: '640', label: '480p' } ] },
                { type: 'toggle', icon: 'aspect_ratio', title: 'Limit Reported Resolution', subtitle: 'Tell the server this device maxes out at the resolution above', store: 'app', key: 'limitSupportedVideoResolution', default: false }
            ] }
        ]
    },

    // ---- Progress Bar Time (labels around the video scrubber; read by jpxVideoOsd) ----
    progressBarTime: {
        id: 'progressBarTime', title: 'Progress Bar Time',
        sections: [
            { header: 'Above the bar', rows: [
                { type: 'select', icon: 'format_align_left', title: 'Left', key: 'pbt_above_left', default: 'none', options: PBT_OPTS },
                { type: 'select', icon: 'format_align_center', title: 'Center', key: 'pbt_above_center', default: 'none', options: PBT_OPTS },
                { type: 'select', icon: 'format_align_right', title: 'Right', key: 'pbt_above_right', default: 'endsat', options: PBT_OPTS }
            ] },
            { header: 'Below the bar', rows: [
                { type: 'select', icon: 'format_align_left', title: 'Left', key: 'pbt_below_left', default: 'elapsed', options: PBT_OPTS },
                { type: 'select', icon: 'format_align_center', title: 'Center', key: 'pbt_below_center', default: 'none', options: PBT_OPTS },
                { type: 'select', icon: 'format_align_right', title: 'Right', key: 'pbt_below_right', default: 'duration', options: PBT_OPTS }
            ] },
            { header: 'Music Player', rows: [
                { type: 'select', icon: 'music_note', title: 'Right Label', subtitle: 'Shown on the right of the music progress bar', key: 'pbt_music', default: 'duration', options: PBT_OPTS }
            ] }
        ]
    },

    // ---- Subtitles (native; appearance wired to the player's real subtitle style) ----
    subtitles: {
        id: 'subtitles', title: 'Subtitles',
        sections: [
            { header: 'General', rows: [
                { type: 'select', icon: 'closed_caption', title: 'Subtitle Mode', subtitle: 'When subtitles are shown', store: 'userConfig', key: 'SubtitleMode', default: 'Default', options: [ { value: 'Default', label: 'Default' }, { value: 'Smart', label: 'Smart' }, { value: 'OnlyForced', label: 'Only Forced' }, { value: 'Always', label: 'Always' }, { value: 'None', label: 'None' } ] },
                { type: 'select', icon: 'language', title: 'Subtitle Language', subtitle: 'Preferred subtitle language', store: 'userConfig', key: 'SubtitleLanguagePreference', default: '', optionsSource: 'cultures' },
                { type: 'toggle', icon: 'save', title: 'Remember Subtitle Selections', subtitle: 'Reuse your subtitle choice across episodes', store: 'userConfig', key: 'RememberSubtitleSelections', default: true }
            ] },
            { header: 'Customization', rows: [
                { type: 'nav', icon: 'brush', title: 'Subtitle Customization', subtitle: 'Colors, size, and position', panel: 'subtitleCustom' }
            ] },
            { header: 'Rendering', rows: [
                { type: 'toggle', icon: 'image', title: 'PGS Direct Play', subtitle: 'Render PGS (image) subtitles directly instead of transcoding', store: 'app', key: 'subtitlerenderpgs', default: false }
            ] }
        ]
    },

    subtitleCustom: {
        id: 'subtitleCustom', title: 'Subtitle Customization',
        sections: [{ rows: [
            { type: 'color', icon: 'format_color_text', title: 'Text Color', store: 'subApp', key: 'textColor', default: '#ffffff' },
            { type: 'select', icon: 'border_color', title: 'Text Outline', store: 'subApp', key: 'dropShadow', default: 'dropshadow', options: [ { value: 'dropshadow', label: 'Drop Shadow' }, { value: 'uniform', label: 'Outline' }, { value: 'raised', label: 'Raised' }, { value: 'depressed', label: 'Depressed' }, { value: 'none', label: 'None' } ] },
            { type: 'color', icon: 'format_color_fill', title: 'Background Color', store: 'subApp', key: 'textBackground', default: 'transparent' },
            { type: 'select', icon: 'format_size', title: 'Subtitle Size', store: 'subApp', key: 'textSize', default: 'medium', options: [ { value: 'smaller', label: 'Smaller' }, { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }, { value: 'larger', label: 'Larger' }, { value: 'extralarge', label: 'Extra Large' } ] },
            { type: 'slider', icon: 'height', title: 'Vertical Offset', subtitle: 'Move subtitles up or down', store: 'subApp', key: 'verticalPosition', default: -3, min: -30, max: 30, step: 1 }
        ] }]
    },

    // ---- Integrations ----
    integrations: {
        id: 'integrations', title: 'Integrations',
        sections: [{ header: 'General', rows: [
            { type: 'toggle', icon: 'star', title: 'Additional Ratings', subtitle: 'Show TMDB ratings on detail pages', key: 'enableAdditionalRatings', default: false },
            { type: 'toggle', icon: 'label', title: 'Rating Labels', key: 'showRatingLabels', default: true },
            { type: 'action', icon: 'live_tv', title: 'Requests (Jellyseerr / Overseerr)', subtitle: 'Link your request server — enter its address and test the connection', action: 'seerr_config' },
            { type: 'action', icon: 'open_in_new', title: 'Open Requests', subtitle: 'Browse and request titles in your Seerr, inside Umbry', action: 'seerr_open' }
        ] }]
    },

    // ---- About ----
    about: {
        id: 'about', title: 'About',
        sections: [
            { header: 'App Info', rows: [
                { type: 'static', icon: 'info', title: 'Version', value: 'Umbry' },
                { type: 'action', icon: 'system_update_alt', title: 'Check for Updates', subtitle: 'See if a newer version of Umbry is available', action: 'check_updates', nativeOnly: true },
                { type: 'link', icon: 'code', title: 'Source Code', subtitle: 'Umbry is GPL-2.0 (built on Jellyfin) — download the source', url: 'https://dl.umbry.org/umbry-web-source.tar.gz' },
                { type: 'route', icon: 'troubleshoot', title: 'Diagnostics & Logging', subtitle: 'Server logs', route: 'dashboard/logs', admin: true }
            ] },
            { header: 'Acknowledgments', rows: [
                { type: 'prose', title: 'Acknowledgments', body: 'Umbry is built on Jellyfin Web (jellyfin.org) and also connects to Emby and Plex servers. Several of the visual themes in Umbry were adapted from the Moonfin project and then customized. Jellyfin, Emby, and Moonfin are independent projects; Umbry is not affiliated with or endorsed by any of them. Jellyfin Web and Moonfin are licensed under the GNU General Public License version 2, and Umbry is distributed under that same license.' }
            ] },
            { header: 'Legal', rows: [
                { type: 'nav', icon: 'privacy_tip', title: 'Privacy Policy', subtitle: 'How Umbry handles your data', panel: 'privacy' }
            ] }
        ]
    },

    // ---- Legal: in-app Privacy Policy ----
    privacy: {
        id: 'privacy', title: 'Privacy Policy',
        sections: [{ rows: [
            { type: 'prose', title: 'Privacy Policy', body: 'Umbry is a media player that connects to media servers you control — Jellyfin, Emby, and Plex. Umbry is not a media service and does not host, stream, or have access to your media itself.\n\nYour Umbry account. Umbry has no servers of its own — we never receive, store, or have access to your account or your settings. Creating an Umbry account is optional; when you do, your email address, a securely hashed password, and your app settings (your saved servers, their connection details, and your preferences) are stored in a database on the Umbry Server that you run on your own hardware, so they can sync across the devices where you install the Player. Server access tokens are kept encrypted. The data stays on equipment you control — only you can reach it, it is never sold or shared, and Umbry shows no advertising.\n\nYour media servers. When you browse or play, Umbry talks directly to the servers you have added. Your library contents and viewing activity stay between your device and your own servers — Umbry does not receive or store them.\n\nOptional integrations. Some features contact third-party services only when you turn them on — for example, Additional Ratings fetches a rating from The Movie Database (TMDB) for the item you are viewing. These requests happen only while the feature is enabled.\n\nNo tracking. Umbry contains no analytics, advertising, or third-party trackers.\n\nYour control. You can delete your Umbry account and its stored settings at any time. Removing a server from Umbry deletes its saved connection details from your account.\n\nThe current version of this policy is published on the Umbry website.' }
        ] }]
    }
};

void onOff;
