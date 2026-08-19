import { afterEach, describe, expect, it } from 'vitest';

import { isNativeCrdtAvailable } from '../isNativeCrdtAvailable';

type WindowWithDesktopBridge = Window & { sourdaw?: object };

describe('isNativeCrdtAvailable', () => {
    afterEach(() => {
        delete (window as WindowWithDesktopBridge).sourdaw;
    });

    it('returns false when the desktop bridge is absent', () => {
        expect(isNativeCrdtAvailable()).toBe(false);
    });

    it('returns true when window.sourdaw is present', () => {
        (window as WindowWithDesktopBridge).sourdaw = {};
        expect(isNativeCrdtAvailable()).toBe(true);
    });
});
