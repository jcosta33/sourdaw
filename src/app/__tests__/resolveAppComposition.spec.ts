import { describe, expect, it } from 'vitest';

import { BROWSER_APPLICATION_FRAME_NAME, resolveAppComposition } from '../resolveAppComposition';

const topLevelWebDocument = {
    hasDesktopBridge: false,
    isDevelopment: false,
    isTopLevel: true,
    protocol: 'http:',
    userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
    windowName: '',
};

const electronUserAgent = 'Mozilla/5.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36';

describe('resolveAppComposition', () => {
    it('runs the application in an app document with its desktop bridge', () => {
        expect(
            resolveAppComposition({
                ...topLevelWebDocument,
                hasDesktopBridge: true,
                protocol: 'app:',
            })
        ).toBe('application');
    });

    it('shows a startup error when an app document is missing its desktop bridge', () => {
        expect(resolveAppComposition({ ...topLevelWebDocument, protocol: 'app:' })).toBe('desktop-startup-error');
    });

    it.each([
        { hasDesktopBridge: false, expected: 'desktop-startup-error' },
        { hasDesktopBridge: true, expected: 'application' },
    ] as const)(
        'resolves an HTTP Electron document with bridge $hasDesktopBridge as $expected',
        ({ hasDesktopBridge, expected }) => {
            expect(
                resolveAppComposition({
                    ...topLevelWebDocument,
                    hasDesktopBridge,
                    userAgent: electronUserAgent,
                })
            ).toBe(expected);
        }
    );

    it.each([false, true])(
        'hosts the application frame in a top-level Chrome HTTP document (development: %s)',
        (isDevelopment) => {
            expect(resolveAppComposition({ ...topLevelWebDocument, isDevelopment })).toBe('browser-host');
        }
    );

    it('runs the application directly inside a nested web document', () => {
        expect(resolveAppComposition({ ...topLevelWebDocument, isTopLevel: false })).toBe('application');
    });

    it('hosts a top-level Chrome document even when its window is named like the application frame', () => {
        expect(
            resolveAppComposition({
                ...topLevelWebDocument,
                windowName: BROWSER_APPLICATION_FRAME_NAME,
            })
        ).toBe('browser-host');
    });

    it('allows the direct Page fixture marker on a development server', () => {
        expect(
            resolveAppComposition({
                ...topLevelWebDocument,
                isDevelopment: true,
                windowName: 'sourdaw-e2e-direct',
            })
        ).toBe('application');
    });

    it('ignores the direct Page fixture marker in a production build', () => {
        expect(
            resolveAppComposition({
                ...topLevelWebDocument,
                windowName: 'sourdaw-e2e-direct',
            })
        ).toBe('browser-host');
    });

    it('does not treat a bridge-shaped property as Electron in an ordinary Chrome HTTP document', () => {
        expect(resolveAppComposition({ ...topLevelWebDocument, hasDesktopBridge: true })).toBe('browser-host');
    });
});
