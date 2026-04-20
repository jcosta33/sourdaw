import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { isTauri, invokeLink } from '../helpers';

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

    describe('invokeLink', () => {
        beforeEach(() => {
            vi.resetModules();
        });

        afterEach(() => {
            const w = window as Window & { __TAURI__?: unknown };
            delete w.__TAURI__;
        });

        it('should throw when not running under Tauri', async () => {
            await expect(invokeLink('link:test')).rejects.toThrow(/Tauri desktop/);
        });
    });
});
