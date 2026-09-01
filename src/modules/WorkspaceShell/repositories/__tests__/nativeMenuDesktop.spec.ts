import { beforeEach, describe, expect, it, vi } from 'vitest';

import { nativeMenuDesktop } from '../nativeMenuDesktop';

const bridge = vi.hoisted(() => ({
    isDesktopRuntime: vi.fn(() => true),
    desktopNativeMenu: vi.fn(() => ({ marker: 'native-menu' })),
}));

vi.mock('#/utils/desktopBridge', () => bridge);

describe('nativeMenuDesktop', () => {
    beforeEach(() => {
        bridge.isDesktopRuntime.mockReset();
        bridge.isDesktopRuntime.mockReturnValue(true);
        bridge.desktopNativeMenu.mockClear();
    });

    it('keeps desktop bridge access in the WorkspaceShell repository', () => {
        expect(nativeMenuDesktop()).toEqual({ marker: 'native-menu' });
        expect(bridge.desktopNativeMenu).toHaveBeenCalledTimes(1);
    });

    it('does not expose a native capability in browser runtime', () => {
        bridge.isDesktopRuntime.mockReturnValue(false);

        expect(nativeMenuDesktop()).toBeUndefined();
        expect(bridge.desktopNativeMenu).not.toHaveBeenCalled();
    });
});
