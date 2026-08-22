import type { BrowserWindowConstructorOptions } from 'electron';

type WindowChromeOptions = Pick<BrowserWindowConstructorOptions, 'frame' | 'titleBarOverlay' | 'titleBarStyle'>;

/**
 * The window chrome contract, per platform.
 *
 * - macOS shares its title-bar band with the content through the
 *   window-controls overlay and keeps the native traffic-light controls.
 * - Linux is frameless: the renderer draws its own minimize/maximize/close
 *   inside the header row (`WindowControls`), which is also the drag region.
 * - Every other platform keeps the fully native frame.
 */
export const getWindowChromeOptions = (platform: NodeJS.Platform): WindowChromeOptions => {
    if (platform === 'darwin') {
        return {
            titleBarOverlay: true,
            titleBarStyle: 'hiddenInset',
        };
    }
    if (platform === 'linux') {
        return { frame: false };
    }
    return {};
};
