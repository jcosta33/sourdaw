/**
 * The module's one desktop seam, pinned where the boundary allows the bridge.
 *
 * `enableExternalClientTransport` refuses to open an externally reachable
 * transport when this probe reports no shell, so a probe that answered from
 * anything but the live bridge would open a door on a build that cannot carry
 * it — or bolt one shut on a build that can.
 */

import { describe, expect, it, vi } from 'vitest';

import { isDesktopRuntime } from '#/utils/desktopBridge';

import { readNativeTransportSupport } from '../nativeTransportRepository';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
}));

describe('readNativeTransportSupport', () => {
    it('reports the shell the desktop bridge reports, either way', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        expect(readNativeTransportSupport()).toEqual({ available: true });

        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        expect(readNativeTransportSupport()).toEqual({ available: false });
    });
});
