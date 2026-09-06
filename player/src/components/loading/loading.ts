import './loading.scss';

let loader: HTMLDivElement | undefined;

function createLoader(): HTMLDivElement {
    const elem = document.createElement('div');
    elem.setAttribute('dir', 'ltr');
    elem.classList.add('jpx-loader');

    elem.innerHTML = '<div class="jpx-aurora"><span class="jpx-aurora-blob jpx-aurora-1"></span><span class="jpx-aurora-blob jpx-aurora-2"></span><span class="jpx-aurora-blob jpx-aurora-3"></span></div><div class="jpx-loader-vignette"></div><div class="jpx-loader-mark"></div>';

    document.body.appendChild(elem);
    return elem;
}

export function show() {
    if (!loader) {
        loader = createLoader();
    }
    loader.classList.add('mdlSpinnerActive');
}

export function hide() {
    if (loader) {
        loader.classList.remove('mdlSpinnerActive');
    }
}

const loading = {
    show,
    hide
};

window.Loading = loading;

export default loading;
