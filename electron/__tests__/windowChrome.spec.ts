import { describe, expect, it } from 'vitest';

import { getWindowChromeOptions } from '../windowChrome.js';

describe('getWindowChromeOptions', () => {
    it('extends macOS content into the title bar while retaining native window controls', () => {
        expect(getWindowChromeOptions('darwin')).toEqual({
            titleBarOverlay: true,
            titleBarStyle: 'hiddenInset',
        });
    });

    it.each(['linux', 'win32'] as const)('keeps the native frame on %s', (platform) => {
        expect(getWindowChromeOptions(platform)).toEqual({});
    });
});
