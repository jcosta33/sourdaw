import { desktopSetZoomFactor, isDesktopRuntime } from '#/utils/desktopBridge';

const ROOT_ELEMENT_ID = 'root';

function resetBrowserScale(): void {
    document.documentElement.style.removeProperty('height');
    document.documentElement.style.removeProperty('overflow');
    document.documentElement.style.removeProperty('width');
    document.body.style.removeProperty('height');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('transform');
    document.body.style.removeProperty('transform-origin');
    document.body.style.removeProperty('width');

    const root = document.getElementById(ROOT_ELEMENT_ID);
    root?.style.removeProperty('height');
    root?.style.removeProperty('width');
}

export function setDisplayScale(scale: number): void {
    document.documentElement.style.removeProperty('zoom');
    document.documentElement.style.removeProperty('font-size');
    resetBrowserScale();

    document.documentElement.style.height = '100%';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.width = '100%';
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100%';
    document.body.style.width = '100%';

    const root = document.getElementById(ROOT_ELEMENT_ID);
    if (root !== null) {
        root.style.height = '100%';
        root.style.width = '100%';
    }

    if (isDesktopRuntime()) {
        desktopSetZoomFactor(scale);
        return;
    }

    window.parent.postMessage({ type: 'sourdaw:browser-display-scale', scale }, window.location.origin);
}
