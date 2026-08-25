import { describe, expect, it } from 'vitest';

import { getWindowChromeOptions } from '../windowChrome.js';

describe('getWindowChromeOptions', () => {
    it('extends macOS content into the title bar while retaining native window controls', () => {
        expect(getWindowChromeOptions('darwin')).toEqual({
            titleBarOverlay: true,
            titleBarStyle: 'hiddenInset',
        });
    });

    it('goes frameless on linux, where the app draws its own window controls', () => {
        expect(getWindowChromeOptions('linux')).toEqual({ frame: false });
    });

    it('keeps the native frame on win32', () => {
        expect(getWindowChromeOptions('win32')).toEqual({});
    });
});
