import { describe, expect, it } from 'vitest';

import { resolveAppComposition } from '../resolveAppComposition';

const topLevelWebDocument = {
    hasDesktopBridge: false,
    isDevelopment: false,
    isTopLevel: true,
    protocol: 'https:',
    windowName: '',
};

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

    it.each([false, true])(
        'hosts the application frame in a top-level web document (development: %s)',
        (isDevelopment) => {
            expect(resolveAppComposition({ ...topLevelWebDocument, isDevelopment })).toBe('browser-host');
        }
    );

    it('runs the application directly inside a nested web document', () => {
        expect(resolveAppComposition({ ...topLevelWebDocument, isTopLevel: false })).toBe('application');
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

    it('preserves direct application composition for a web document with the desktop bridge', () => {
        expect(resolveAppComposition({ ...topLevelWebDocument, hasDesktopBridge: true })).toBe('application');
    });
});
