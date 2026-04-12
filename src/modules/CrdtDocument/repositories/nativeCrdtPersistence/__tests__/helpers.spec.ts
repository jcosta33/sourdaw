import { afterEach, describe, expect, it } from 'vitest';

import { isTauriAvailable } from '../helpers';

type WindowWithTauri = Window & { __TAURI__?: object };

describe('isTauriAvailable', () => {
    afterEach(() => {
        delete (window as WindowWithTauri).__TAURI__;
    });

    it('returns false when the Tauri marker is absent', () => {
        expect(isTauriAvailable()).toBe(false);
    });

    it('returns true when __TAURI__ is defined on window', () => {
        (window as WindowWithTauri).__TAURI__ = {};
        expect(isTauriAvailable()).toBe(true);
    });
});
