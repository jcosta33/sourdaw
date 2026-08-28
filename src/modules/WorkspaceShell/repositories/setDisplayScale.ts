import { desktopSetZoomFactor, isDesktopRuntime } from '#/utils/desktopBridge';

const BROWSER_BASE_FONT_SIZE_PX = 16;

export function setDisplayScale(scale: number): void {
    document.documentElement.style.removeProperty('zoom');

    if (isDesktopRuntime()) {
        document.documentElement.style.removeProperty('font-size');
        desktopSetZoomFactor(scale);
        return;
    }

    document.documentElement.style.fontSize = `${String(BROWSER_BASE_FONT_SIZE_PX * scale)}px`;
}
