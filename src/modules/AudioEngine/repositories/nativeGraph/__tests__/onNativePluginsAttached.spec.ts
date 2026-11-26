import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { onNativePluginsAttached } from '../onNativePluginsAttached';

vi.mock('#/utils/desktopBridge', () => ({
    desktopListen: vi.fn(),
    isDesktopRuntime: vi.fn(),
}));

/** The bridge's own envelope, which nests the native payload under `payload`. */
function deliver(payload: unknown): void {
    const listener = vi.mocked(desktopListen).mock.calls[0]?.[1];
    if (!listener) {
        throw new Error('no listener was registered');
    }
    listener({ event: 'plugins-attached', payload });
}

describe('onNativePluginsAttached', () => {
    beforeEach(() => {
        vi.mocked(desktopListen).mockReset();
        vi.mocked(desktopListen).mockResolvedValue(() => {});
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('listens on the wire name the native host emits', async () => {
        await onNativePluginsAttached(() => {});

        expect(vi.mocked(desktopListen).mock.calls[0]?.[0]).toBe('plugins-attached');
    });

    it('hands the handler the attached instances the payload names', async () => {
        const handler = vi.fn();
        await onNativePluginsAttached(handler);

        deliver({ instance_ids: ['inst-a', 'inst-b'] });

        expect(handler).toHaveBeenCalledExactlyOnceWith([{ instanceId: 'inst-a' }, { instanceId: 'inst-b' }]);
    });

    it('drops a payload that does not name instances', async () => {
        const handler = vi.fn();
        await onNativePluginsAttached(handler);

        deliver({ instance_ids: ['inst-a', 7] });
        deliver({ instanceIds: ['inst-a'] });
        deliver(null);

        expect(handler).not.toHaveBeenCalled();
    });

    it('subscribes to nothing without a desktop runtime', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        await onNativePluginsAttached(() => {});

        expect(desktopListen).not.toHaveBeenCalled();
    });
});
