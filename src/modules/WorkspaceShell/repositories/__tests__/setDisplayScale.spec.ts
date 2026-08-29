import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopSetZoomFactor, isDesktopRuntime } from '#/utils/desktopBridge';

import { setDisplayScale } from '../setDisplayScale';

vi.mock('#/utils/desktopBridge', () => ({
    desktopSetZoomFactor: vi.fn(),
    isDesktopRuntime: vi.fn(),
}));

describe('setDisplayScale', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="root"><div data-testid="project-menu" style="width: 240px"></div></div>
            <div data-slot="dialog-portal"><div style="width: 320px"></div></div>
        `;
    });

    afterEach(() => {
        document.documentElement.style.removeProperty('font-size');
        document.documentElement.style.removeProperty('height');
        document.documentElement.style.removeProperty('zoom');
        document.documentElement.style.removeProperty('overflow');
        document.documentElement.style.removeProperty('width');
        document.body.removeAttribute('style');
        document.body.replaceChildren();
        vi.clearAllMocks();
    });

    it.each([0.5, 1, 1.25, 2])(
        'uses native viewport-aware zoom %s without leaving CSS zoom behind on desktop',
        (scale) => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            document.documentElement.style.zoom = '1.5';

            setDisplayScale(scale);

            expect(desktopSetZoomFactor).toHaveBeenCalledWith(scale);
            expect(document.documentElement.style.zoom).toBe('');
            expect(document.documentElement.style.fontSize).toBe('');
            expect(document.documentElement.style.height).toBe('100%');
            expect(document.documentElement.style.width).toBe('100%');
            expect(document.documentElement.style.overflow).toBe('hidden');
            expect(document.body.style.height).toBe('100%');
            expect(document.body.style.width).toBe('100%');
            expect(document.body.style.overflow).toBe('hidden');
            expect(document.getElementById('root')?.style.height).toBe('100%');
            expect(document.getElementById('root')?.style.width).toBe('100%');
            expect(document.body.style.transform).toBe('');
        }
    );

    it.each([0.5, 1, 2])('delegates browser scale %s to the containing viewport without CSS scaling', (scale) => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
        document.documentElement.style.zoom = '1.5';

        setDisplayScale(scale);

        expect(desktopSetZoomFactor).not.toHaveBeenCalled();
        expect(document.documentElement.style.zoom).toBe('');
        expect(document.documentElement.style.overflow).toBe('hidden');
        expect(document.body.style.transform).toBe('');
        expect(document.body.style.transformOrigin).toBe('');
        expect(document.body.style.width).toBe('100%');
        expect(document.body.style.height).toBe('100%');
        expect(document.body.style.overflow).toBe('hidden');
        expect(postMessage).toHaveBeenCalledWith(
            { type: 'sourdaw:browser-display-scale', scale },
            window.location.origin
        );

        const root = document.getElementById('root');
        expect(root?.style.width).toBe('100%');
        expect(root?.style.height).toBe('100%');
        expect(root?.querySelector('[data-testid="project-menu"]')).toHaveStyle({ width: '240px' });
        expect(document.querySelector('[data-slot="dialog-portal"]')?.parentElement).toBe(document.body);
    });
});
