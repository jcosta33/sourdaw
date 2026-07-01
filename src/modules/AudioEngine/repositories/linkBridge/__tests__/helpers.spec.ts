import { describe, it, expect } from 'vitest';

import { isTauri } from '../helpers';

describe('linkBridge/helpers', () => {
    describe('isTauri', () => {
        it('should return false when __TAURI__ is not on window', () => {
            expect(isTauri()).toBe(false);
        });

        it('should return true when __TAURI__ is present on window', () => {
            const w = window as Window & { __TAURI__?: unknown };
            w.__TAURI__ = {};
            expect(isTauri()).toBe(true);
            delete w.__TAURI__;
        });
    });
});
