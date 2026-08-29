import { describe, expect, it } from 'vitest';

import { shouldHostBrowserViewport } from '../shouldHostBrowserViewport';

const topLevelBrowser = {
    isDesktopRuntime: false,
    isTopLevel: true,
    windowName: '',
};

describe('shouldHostBrowserViewport', () => {
    it('hosts the application frame in an ordinary top-level browser document', () => {
        expect(shouldHostBrowserViewport({ ...topLevelBrowser, isDevelopment: true })).toBe(true);
    });

    it('allows the direct Page fixture marker on any development server', () => {
        expect(
            shouldHostBrowserViewport({
                ...topLevelBrowser,
                isDevelopment: true,
                windowName: 'sourdaw-e2e-direct',
            })
        ).toBe(false);
    });

    it('ignores the direct Page fixture marker in a production build', () => {
        expect(
            shouldHostBrowserViewport({
                ...topLevelBrowser,
                isDevelopment: false,
                windowName: 'sourdaw-e2e-direct',
            })
        ).toBe(true);
    });

    it('renders directly inside desktop and nested application documents', () => {
        expect(shouldHostBrowserViewport({ ...topLevelBrowser, isDevelopment: false, isDesktopRuntime: true })).toBe(
            false
        );
        expect(shouldHostBrowserViewport({ ...topLevelBrowser, isDevelopment: false, isTopLevel: false })).toBe(false);
    });
});
