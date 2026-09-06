import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { Archive } from 'libarchive.js';

import { PluginType } from 'constants/pluginType';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { toApi } from 'utils/jellyfin-apiclient/compat';

import loading from '../../components/loading/loading';
import dialogHelper from '../../components/dialogHelper/dialogHelper';
import keyboardnavigation from '../../scripts/keyboardNavigation';
import { appRouter } from '../../components/router/appRouter';
import * as userSettings from '../../scripts/settings/userSettings';
import { saveReadingProgress } from '../../apps/experimental/theme/jpxReadingProgress';

import './style.scss';

// supported book file extensions
const FILE_EXTENSIONS = ['.cbr', '.cbt', '.cbz', '.cb7'];
// the comic book archive supports any kind of image format as it's just a zip archive
const IMAGE_FORMATS = ['jpg', 'jpeg', 'jpe', 'jif', 'jfif', 'jfi', 'png', 'avif', 'gif', 'bmp', 'dib', 'tiff', 'tif', 'webp'];

export class ComicsPlayer {
    constructor() {
        this.name = 'Comics Player';
        this.type = PluginType.MediaPlayer;
        this.id = 'comicsplayer';
        this.priority = 1;
        this.imageMap = new Map();

        this.onDialogClosed = this.onDialogClosed.bind(this);
        this.onWindowKeyDown = this.onWindowKeyDown.bind(this);
    }

    play(options) {
        this.currentPage = 0;
        this.pageCount = 0;

        const mediaSourceId = options.items[0].Id;
        this.comicsPlayerSettings = userSettings.getComicsPlayerSettings(mediaSourceId);

        const elem = this.createMediaElement();
        return this.setCurrentSrc(elem, options);
    }

    stop() {
        this.unbindEvents();

        const stopInfo = {
            src: this.item
        };

        try { saveReadingProgress(this.item, this.pageCount ? ((this.currentPage || 0) + 1) / this.pageCount : 0); } catch (e) { /* ignore */ }

        Events.trigger(this, 'stopped', [stopInfo]);

        const mediaSourceId = this.item.Id;
        userSettings.setComicsPlayerSettings(this.comicsPlayerSettings, mediaSourceId);

        this.archiveSource?.release();

        const elem = this.mediaElement;
        if (elem) {
            dialogHelper.close(elem);
            this.mediaElement = null;
        }

        loading.hide();
    }

    destroy() {
        // Nothing to do here
    }

    currentTime() {
        return this.currentPage;
    }

    duration() {
        return this.pageCount;
    }

    currentItem() {
        return this.item;
    }

    volume() {
        return 100;
    }

    isMuted() {
        return false;
    }

    paused() {
        return false;
    }

    seekable() {
        return true;
    }

    onDialogClosed() {
        this.stop();
    }

    onDirChanged = () => {
        let langDir = this.comicsPlayerSettings.langDir;

        if (!langDir || langDir === 'ltr') {
            langDir = 'rtl';
        } else {
            langDir = 'ltr';
        }

        this.changeLanguageDirection(langDir);

        this.comicsPlayerSettings.langDir = langDir;
    };

    changeLanguageDirection(langDir) {
        const currentPage = this.currentPage;

        this.swiperInstance.changeLanguageDirection(langDir);

        const prevIcon = langDir === 'ltr' ? 'arrow_circle_left' : 'arrow_circle_right';
        this.mediaElement.querySelector('.btnToggleLangDir > span').classList.remove(prevIcon);

        const newIcon = langDir === 'ltr' ? 'arrow_circle_right' : 'arrow_circle_left';
        this.mediaElement.querySelector('.btnToggleLangDir > span').classList.add(newIcon);

        const dirTitle = langDir === 'ltr' ? 'Right To Left' : 'Left To Right';
        this.mediaElement.querySelector('.btnToggleLangDir').title = dirTitle;

        this.reload(currentPage);
    }

    onViewChanged = () => {
        let view = this.comicsPlayerSettings.pagesPerView;

        if (!view || view === 1) {
            view = 2;
        } else {
            view = 1;
        }

        this.changeView(view);

        this.comicsPlayerSettings.pagesPerView = view;
    };

    changeView(view) {
        const currentPage = this.currentPage;

        this.swiperInstance.params.slidesPerView = view;
        this.swiperInstance.params.slidesPerGroup = view;

        const prevIcon = view === 1 ? 'devices_fold' : 'import_contacts';
        this.mediaElement.querySelector('.btnToggleView > span').classList.remove(prevIcon);

        const newIcon = view === 1 ? 'import_contacts' : 'devices_fold';
        this.mediaElement.querySelector('.btnToggleView > span').classList.add(newIcon);

        const viewTitle = view === 1 ? 'Double Page View' : 'Single Page View';
        this.mediaElement.querySelector('.btnToggleView').title = viewTitle;

        this.reload(currentPage);
    }

    reload(currentPage) {
        const effect = this.swiperInstance.params.effect;

        this.swiperInstance.params.effect = 'none';
        this.swiperInstance.update();

        this.swiperInstance.slideNext();
        this.swiperInstance.slidePrev();

        if (this.currentPage != currentPage) {
            this.swiperInstance.slideTo(currentPage);
            this.swiperInstance.update();
        }

        this.swiperInstance.params.effect = effect;
        this.swiperInstance.update();
    }

    onWindowKeyDown(e) {
        // Skip modified keys
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

        const key = keyboardnavigation.getKeyName(e);
        if (key === 'Escape') {
            e.preventDefault();
            this.stop();
        }
    }

    bindMediaElementEvents() {
        const elem = this.mediaElement;

        elem?.addEventListener('close', this.onDialogClosed, { once: true });
        elem?.querySelector('.btnExit').addEventListener('click', this.onDialogClosed, { once: true });
        elem?.querySelector('.btnToggleLangDir').addEventListener('click', this.onDirChanged);
        elem?.querySelectorAll('.jpx-comic-mode').forEach(b => b.addEventListener('click', this.onModeClick));
        elem?.querySelector('.jpx-comic-invert')?.addEventListener('click', this.onToggleInvert);
        elem?.querySelector('.jpx-comic-thumbs')?.addEventListener('click', this.onToggleThumbs);
        elem?.querySelector('.jpx-comic-slider')?.addEventListener('input', this.onSliderInput);
    }

    bindEvents() {
        this.bindMediaElementEvents();

        document.addEventListener('keydown', this.onWindowKeyDown);
    }

    unbindMediaElementEvents() {
        const elem = this.mediaElement;

        elem?.removeEventListener('close', this.onDialogClosed);
        elem?.querySelector('.btnExit').removeEventListener('click', this.onDialogClosed);
        elem?.querySelector('.btnToggleLangDir').removeEventListener('click', this.onDirChanged);
        elem?.querySelectorAll('.jpx-comic-mode').forEach(b => b.removeEventListener('click', this.onModeClick));
        elem?.querySelector('.jpx-comic-invert')?.removeEventListener('click', this.onToggleInvert);
        elem?.querySelector('.jpx-comic-thumbs')?.removeEventListener('click', this.onToggleThumbs);
        elem?.querySelector('.jpx-comic-slider')?.removeEventListener('input', this.onSliderInput);
    }

    unbindEvents() {
        this.unbindMediaElementEvents();

        document.removeEventListener('keydown', this.onWindowKeyDown);
    }

    createMediaElement() {
        let elem = this.mediaElement;
        if (elem) {
            return elem;
        }

        elem = document.getElementById('comicsPlayer');
        if (!elem) {
            elem = dialogHelper.createDialog({
                exitAnimationDuration: 400,
                size: 'fullscreen',
                autoFocus: false,
                scrollY: false,
                exitAnimation: 'fadeout',
                removeOnClose: true
            });

            const dirIcon = this.comicsPlayerSettings.langDir === 'ltr' ? 'arrow_circle_right' : 'arrow_circle_left';

            elem.id = 'comicsPlayer';
            elem.classList.add('slideshowDialog', 'jpx-comic');
            const mode0 = this.comicsPlayerSettings.readMode || (this.comicsPlayerSettings.pagesPerView === 2 ? 'two' : 'single');
            elem.innerHTML = `<div dir=${this.comicsPlayerSettings.langDir} class="slideshowSwiperContainer jpx-comic-stage">
                                <div class="swiper-wrapper"></div>
                                <div class="swiper-button-next actionButtonIcon"></div>
                                <div class="swiper-button-prev actionButtonIcon"></div>
                            </div>
                            <div class="jpx-comic-top">
                                <button is="paper-icon-button-light" class="autoSize btnExit jpx-comic-back" tabindex="-1">
                                    <span class="material-icons" aria-hidden="true">arrow_back</span>
                                </button>
                                <span class="jpx-comic-title"></span>
                            </div>
                            <div class="jpx-comic-bottom">
                                <div class="jpx-comic-strip hide"></div>
                                <div class="jpx-comic-slider-row">
                                    <span class="jpx-comic-page">1</span>
                                    <input type="range" class="jpx-comic-slider" min="0" max="0" value="0" />
                                    <span class="jpx-comic-total">1</span>
                                </div>
                                <div class="jpx-comic-controls">
                                    <div class="jpx-comic-modes">
                                        <button type="button" class="jpx-comic-mode jpx-mode-single${mode0 === 'single' ? ' on' : ''}" data-mode="single">Single</button>
                                        <button type="button" class="jpx-comic-mode jpx-mode-two${mode0 === 'two' ? ' on' : ''}" data-mode="two">Two-page</button>
                                        <button type="button" class="jpx-comic-mode jpx-mode-vertical${mode0 === 'vertical' ? ' on' : ''}" data-mode="vertical">Vertical</button>
                                    </div>
                                    <button is="paper-icon-button-light" class="autoSize btnToggleLangDir jpx-comic-icon" tabindex="-1" title="Reading direction">
                                        <span class="material-icons ${dirIcon}" aria-hidden="true"></span>
                                    </button>
                                    <button type="button" class="jpx-comic-icon jpx-comic-invert" title="Invert colors">
                                        <span class="material-icons" aria-hidden="true">invert_colors</span>
                                    </button>
                                    <button type="button" class="jpx-comic-icon jpx-comic-thumbs" title="Thumbnails">
                                        <span class="material-icons" aria-hidden="true">view_carousel</span>
                                    </button>
                                </div>
                            </div>`;

            dialogHelper.open(elem);
        }

        this.mediaElement = elem;

        const dirTitle = this.comicsPlayerSettings.langDir === 'ltr' ? 'Right To Left' : 'Left To Right';
        this.mediaElement.querySelector('.btnToggleLangDir').title = dirTitle;

        this.bindEvents();
        return elem;
    }

    // Umbry: Moonfin reading modes (Single / Two-page / Vertical), color invert, and a page slider.
    onModeClick = (e) => { this.setReadMode(e.currentTarget.getAttribute('data-mode')); };

    setReadMode(mode) {
        this.comicsPlayerSettings.readMode = mode;
        this.mediaElement.querySelectorAll('.jpx-comic-mode').forEach(b => b.classList.toggle('on', b.getAttribute('data-mode') === mode));
        if (!this.swiperInstance) return;
        const cur = this.currentPage;
        if (mode === 'vertical') {
            this.swiperInstance.params.slidesPerView = 1;
            this.swiperInstance.params.slidesPerGroup = 1;
            try { this.swiperInstance.changeDirection('vertical'); } catch (e) { /* ignore */ }
        } else {
            const spv = mode === 'two' ? 2 : 1;
            this.swiperInstance.params.slidesPerView = spv;
            this.swiperInstance.params.slidesPerGroup = spv;
            this.comicsPlayerSettings.pagesPerView = spv;
            try { this.swiperInstance.changeDirection('horizontal'); } catch (e) { /* ignore */ }
        }
        this.reload(cur);
    }

    onToggleInvert = () => {
        this.comicsPlayerSettings.invert = !this.comicsPlayerSettings.invert;
        const stage = this.mediaElement.querySelector('.jpx-comic-stage');
        if (stage) stage.classList.toggle('jpx-comic-inverted', this.comicsPlayerSettings.invert);
        const btn = this.mediaElement.querySelector('.jpx-comic-invert');
        if (btn) btn.classList.toggle('on', this.comicsPlayerSettings.invert);
    };

    onSliderInput = (e) => {
        e.target.__seeking = true;
        const v = parseInt(e.target.value, 10) || 0;
        if (this.swiperInstance) this.swiperInstance.slideTo(v);
        setTimeout(() => { e.target.__seeking = false; }, 400);
    };

    onToggleThumbs = () => {
        const strip = this.mediaElement.querySelector('.jpx-comic-strip');
        const btn = this.mediaElement.querySelector('.jpx-comic-thumbs');
        if (!strip) return;
        const show = strip.classList.contains('hide');
        strip.classList.toggle('hide', !show);
        if (btn) btn.classList.toggle('on', show);
        if (show) { this.buildThumbs(); this.updateThumbActive(); }
    };

    buildThumbs() {
        const strip = this.mediaElement.querySelector('.jpx-comic-strip');
        if (!strip || strip.__built) return;
        const urls = (this.archiveSource && this.archiveSource.urls) || [];
        strip.innerHTML = urls.map((u, i) =>
            '<button type="button" class="jpx-comic-thumb" data-i="' + i + '"><img loading="lazy" src="' + u + '" /><span class="jpx-comic-thumb-n">' + (i + 1) + '</span></button>'
        ).join('');
        strip.querySelectorAll('.jpx-comic-thumb').forEach(t => t.addEventListener('click', () => {
            const i = parseInt(t.getAttribute('data-i'), 10) || 0;
            if (this.swiperInstance) this.swiperInstance.slideTo(i);
        }));
        strip.__built = true;
    }

    updateThumbActive() {
        const strip = this.mediaElement.querySelector('.jpx-comic-strip');
        if (!strip || strip.classList.contains('hide')) return;
        const cur = this.currentPage || 0;
        strip.querySelectorAll('.jpx-comic-thumb').forEach(t => {
            const on = parseInt(t.getAttribute('data-i'), 10) === cur;
            t.classList.toggle('on', on);
            if (on) { try { t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ } }
        });
    }

    updatePager() {
        const el = this.mediaElement;
        if (!el) return;
        const total = this.pageCount || 1;
        const pg = el.querySelector('.jpx-comic-page'); if (pg) pg.textContent = String((this.currentPage || 0) + 1);
        const tt = el.querySelector('.jpx-comic-total'); if (tt) tt.textContent = String(total);
        const sl = el.querySelector('.jpx-comic-slider');
        if (sl && !sl.__seeking) { sl.max = String(Math.max(0, total - 1)); sl.value = String(this.currentPage || 0); }

        try { saveReadingProgress(this.item, total ? ((this.currentPage || 0) + 1) / total : 0); } catch (e) { /* ignore */ }
    }

    setCurrentSrc(elem, options) {
        const item = options.items[0];
        this.item = item;
        this.streamInfo = {
            started: true,
            ended: false,
            item: this.item,
            mediaSource: {
                Id: item.Id
            }
        };

        loading.show();

        Archive.init({
            workerUrl: appRouter.baseUrl() + '/libraries/worker-bundle.js'
        });

        const api = toApi(ServerConnections.getApiClient(item));
        const downloadUrl = getLibraryApi(api).getDownloadUrl({ itemId: item.Id }).replace(/([?&])ApiKey=/gi, '$1api_key=');
        this.archiveSource = new ArchiveSource(downloadUrl);

        //eslint-disable-next-line import/no-unresolved
        import('swiper/css/bundle');

        return this.archiveSource.load()
            // eslint-disable-next-line import/no-unresolved
            .then(() => import('swiper/bundle'))
            .then(({ Swiper }) => {
                loading.hide();

                this.pageCount = this.archiveSource.urls.length;
                this.currentPage = options.startPositionTicks / 10000 || 0;

                this.swiperInstance = new Swiper(elem.querySelector('.slideshowSwiperContainer'), {
                    direction: 'horizontal',
                    // loop is disabled due to the lack of Swiper support in virtual slides
                    loop: false,
                    zoom: {
                        minRatio: 1,
                        toggle: true,
                        containerClass: 'slider-zoom-container'
                    },
                    autoplay: false,
                    keyboard: {
                        enabled: true
                    },
                    preloadImages: true,
                    slidesPerView: this.comicsPlayerSettings.pagesPerView,
                    slidesPerGroup: this.comicsPlayerSettings.pagesPerView,
                    slidesPerColumn: 1,
                    initialSlide: this.currentPage,
                    navigation: {
                        nextEl: '.swiper-button-next',
                        prevEl: '.swiper-button-prev'
                    },
                    pagination: {
                        el: '.swiper-pagination',
                        clickable: true,
                        type: 'fraction'
                    },
                    // reduces memory consumption for large libraries while allowing preloading of images
                    virtual: {
                        slides: this.archiveSource.urls,
                        cache: true,
                        renderSlide: this.getImgFromUrl,
                        addSlidesBefore: 1,
                        addSlidesAfter: 1
                    }
                });

                // save current page ( a page is an image file inside the archive )
                this.swiperInstance.on('slideChange', () => {
                    this.currentPage = this.swiperInstance.activeIndex;
                    this.updatePager();
                    this.updateThumbActive();
                    Events.trigger(this, 'pause');
                });

                // Umbry: seed the title, pager/slider, and restore the saved read mode + invert.
                const titleEl = this.mediaElement.querySelector('.jpx-comic-title');
                if (titleEl) titleEl.textContent = item.Name || '';
                this.updatePager();
                if (this.comicsPlayerSettings.readMode === 'vertical') this.setReadMode('vertical');
                if (this.comicsPlayerSettings.invert) {
                    const stage = this.mediaElement.querySelector('.jpx-comic-stage');
                    if (stage) stage.classList.add('jpx-comic-inverted');
                    const ib = this.mediaElement.querySelector('.jpx-comic-invert');
                    if (ib) ib.classList.add('on');
                }
            });
    }

    getImgFromUrl(url) {
        return `<div class="swiper-slide">
                   <div class="slider-zoom-container">
                       <img src="${url}" class="swiper-slide-img">
                   </div>
               </div>`;
    }

    canPlayMediaType(mediaType) {
        return (mediaType || '').toLowerCase() === 'book';
    }

    canPlayItem(item) {
        return item.Path && FILE_EXTENSIONS.some(ext => item.Path.endsWith(ext));
    }
}

class ArchiveSource {
    constructor(url) {
        this.url = url;
        this.files = [];
        this.urls = [];
    }

    async load() {
        const res = await fetch(this.url);
        if (!res.ok) {
            return;
        }

        const blob = await res.blob();
        this.archive = await Archive.open(blob);
        this.raw = await this.archive.getFilesArray();
        await this.archive.extractFiles();

        let files = await this.archive.getFilesArray();

        // metadata files and files without a file extension should not be considered as a page
        files = files.filter((file) => {
            const name = file.file.name;
            const index = name.lastIndexOf('.');
            return index !== -1 && IMAGE_FORMATS.includes(name.slice(index + 1).toLowerCase());
        });
        files.sort((a, b) => {
            if (a.file.name < b.file.name) {
                return -1;
            } else {
                return 1;
            }
        });

        for (const file of files) {
            const url = URL.createObjectURL(file.file);
            this.urls.push(url);
        }
    }

    release() {
        this.files = [];
        this.urls.forEach(URL.revokeObjectURL);
        this.urls = [];
    }
}

export default ComicsPlayer;
