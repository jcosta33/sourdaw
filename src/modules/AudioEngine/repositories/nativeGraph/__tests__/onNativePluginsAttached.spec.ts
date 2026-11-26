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

    // One payload per case, so a payload whose mapping would throw once the
    // check is gone cannot hide another payload's call to the handler.
    it.each([
        ['an id that is not a string', { instance_ids: ['inst-a', 7] }],
        ['an empty id', { instance_ids: ['inst-a', ''] }],
        ['an id longer than any instance id', { instance_ids: ['inst-a', 'x'.repeat(257)] }],
        ['more instances than a session hosts', { instance_ids: Array.from({ length: 129 }, (_, i) => `inst-${i}`) }],
        ['a list under another name', { instanceIds: ['inst-a'] }],
        ['no payload at all', null],
    ])('drops a payload with %s', async (_case, payload) => {
        const handler = vi.fn();
        await onNativePluginsAttached(handler);

        deliver(payload);

        expect(handler).not.toHaveBeenCalled();
    });

    it('hands over a payload at the session ceiling with ids at the length bound', async () => {
        const handler = vi.fn();
        await onNativePluginsAttached(handler);
        const instanceIds = Array.from({ length: 128 }, (_, i) => `${i}`.padStart(256, 'x'));

        deliver({ instance_ids: instanceIds });

        expect(handler).toHaveBeenCalledExactlyOnceWith(instanceIds.map((instanceId) => ({ instanceId })));
    });

    it('subscribes to nothing without a desktop runtime', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        await onNativePluginsAttached(() => {});

        expect(desktopListen).not.toHaveBeenCalled();
    });
});
