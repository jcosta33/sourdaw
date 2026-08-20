import { afterEach, describe, expect, it, vi } from 'vitest';

const { loggerMock } = vi.hoisted(() => ({
    loggerMock: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: loggerMock }));

import { hasSharedArrayBuffer, isCrossOriginIsolated, getRuntimeCapabilities, logCapabilities } from '../capabilities';

describe('capabilities', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        Reflect.deleteProperty(window, 'sourdaw');
        loggerMock.info.mockClear();
        loggerMock.warn.mockClear();
    });

    describe('hasSharedArrayBuffer', () => {
        it('returns true when SharedArrayBuffer is defined globally', () => {
            vi.stubGlobal('SharedArrayBuffer', class {});

            expect(hasSharedArrayBuffer()).toBe(true);
        });

        it('returns false when SharedArrayBuffer is undefined (e.g. no COOP/COEP isolation)', () => {
            vi.stubGlobal('SharedArrayBuffer', undefined);

            expect(hasSharedArrayBuffer()).toBe(false);
        });
    });

    describe('isCrossOriginIsolated', () => {
        it('returns true when globalThis.crossOriginIsolated is true', () => {
            vi.stubGlobal('crossOriginIsolated', true);

            expect(isCrossOriginIsolated()).toBe(true);
        });

        it('returns false when globalThis.crossOriginIsolated is false', () => {
            vi.stubGlobal('crossOriginIsolated', false);

            expect(isCrossOriginIsolated()).toBe(false);
        });
    });

    describe('getRuntimeCapabilities', () => {
        it('bundles isDesktopRuntime, hasSharedArrayBuffer, and isCrossOriginIsolated into one snapshot', () => {
            Object.defineProperty(window, 'sourdaw', { configurable: true, value: {} });
            vi.stubGlobal('SharedArrayBuffer', class {});
            vi.stubGlobal('crossOriginIsolated', true);

            expect(getRuntimeCapabilities()).toEqual({
                isDesktopRuntime: true,
                hasSharedArrayBuffer: true,
                isCrossOriginIsolated: true,
            });
        });

        it('reflects a browser tab with no desktop shell and no SAB isolation', () => {
            vi.stubGlobal('SharedArrayBuffer', undefined);
            vi.stubGlobal('crossOriginIsolated', false);

            expect(getRuntimeCapabilities()).toEqual({
                isDesktopRuntime: false,
                hasSharedArrayBuffer: false,
                isCrossOriginIsolated: false,
            });
        });
    });

    describe('logCapabilities', () => {
        it('logs the capability snapshot as a single structured info line', () => {
            vi.stubGlobal('SharedArrayBuffer', class {});
            vi.stubGlobal('crossOriginIsolated', true);

            logCapabilities();

            expect(loggerMock.info).toHaveBeenCalledExactlyOnceWith(
                `[capabilities] ${JSON.stringify({
                    isDesktopRuntime: false,
                    hasSharedArrayBuffer: true,
                    isCrossOriginIsolated: true,
                })}`
            );
            expect(loggerMock.warn).not.toHaveBeenCalled();
        });

        it('warns when crossOriginIsolated is false, since SAB-backed plugins silently fail to instantiate', () => {
            vi.stubGlobal('crossOriginIsolated', false);

            logCapabilities();

            expect(loggerMock.warn).toHaveBeenCalledExactlyOnceWith(
                '[capabilities] crossOriginIsolated=false — SharedArrayBuffer-backed plugins (Grand Boule, Gluten, Proof) will fail to instantiate. Check COOP/COEP headers.'
            );
        });

        it('does not warn when crossOriginIsolated is true', () => {
            vi.stubGlobal('crossOriginIsolated', true);

            logCapabilities();

            expect(loggerMock.warn).not.toHaveBeenCalled();
        });
    });
});
