import type { BrowserWindowConstructorOptions } from 'electron';

type WindowChromeOptions = Pick<BrowserWindowConstructorOptions, 'titleBarOverlay' | 'titleBarStyle'>;

/** Keep platform window chrome native while letting macOS content share its title-bar band. */
export const getWindowChromeOptions = (platform: NodeJS.Platform): WindowChromeOptions =>
    platform === 'darwin'
        ? {
              titleBarOverlay: true,
              titleBarStyle: 'hiddenInset',
          }
        : {};
