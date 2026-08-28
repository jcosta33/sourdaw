import { afterEach, describe, expect, it, vi } from 'vitest';

import { desktopSetZoomFactor, isDesktopRuntime } from '#/utils/desktopBridge';

import { setDisplayScale } from '../setDisplayScale';

vi.mock('#/utils/desktopBridge', () => ({
    desktopSetZoomFactor: vi.fn(),
    isDesktopRuntime: vi.fn(),
}));

describe('setDisplayScale', () => {
    afterEach(() => {
        document.documentElement.style.removeProperty('font-size');
        document.documentElement.style.removeProperty('zoom');
        vi.clearAllMocks();
    });

    it('uses native viewport-aware zoom without leaving CSS zoom behind on desktop', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        document.documentElement.style.zoom = '1.5';

        setDisplayScale(1.25);

        expect(desktopSetZoomFactor).toHaveBeenCalledWith(1.25);
        expect(document.documentElement.style.zoom).toBe('');
        expect(document.documentElement.style.fontSize).toBe('');
    });

    it('scales rem-based browser UI without changing viewport geometry', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        document.documentElement.style.zoom = '1.5';

        setDisplayScale(1.25);

        expect(desktopSetZoomFactor).not.toHaveBeenCalled();
        expect(document.documentElement.style.zoom).toBe('');
        expect(document.documentElement.style.fontSize).toBe('20px');
    });
});
