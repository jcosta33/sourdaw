import { afterEach, describe, expect, it } from 'vitest';

import { isNativeCrdtAvailable } from '../isNativeCrdtAvailable';

type WindowWithTauri = Window & { __TAURI_INTERNALS__?: object };

describe('isNativeCrdtAvailable', () => {
    afterEach(() => {
        delete (window as WindowWithTauri).__TAURI_INTERNALS__;
    });

    it('returns false when the Tauri desktop runtime marker is absent', () => {
        expect(isNativeCrdtAvailable()).toBe(false);
    });

    it('returns true when __TAURI_INTERNALS__ is present on window', () => {
        (window as WindowWithTauri).__TAURI_INTERNALS__ = {};
        expect(isNativeCrdtAvailable()).toBe(true);
    });
});
