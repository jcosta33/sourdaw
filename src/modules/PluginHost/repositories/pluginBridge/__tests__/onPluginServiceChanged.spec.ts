import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { onPluginServiceChanged } from '../onPluginServiceChanged';
import { type PluginServiceChange } from '../types';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopListen: vi.fn(),
}));

/** Subscribe and hand back the raw push the native shell would make. */
async function subscribed(): Promise<{
    push: (payload: unknown) => void;
    received: PluginServiceChange[];
}> {
    const received: PluginServiceChange[] = [];
    let push: (payload: unknown) => void = () => {};
    vi.mocked(desktopListen).mockImplementation((_event, handler: (payload: unknown) => void) => {
        push = handler;
        return Promise.resolve(() => {});
    });

    await onPluginServiceChanged((change) => received.push(change));

    return { push: (payload) => push(payload), received };
}

describe('onPluginServiceChanged', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('subscribes to the wire name the native host emits', async () => {
        await subscribed();

        expect(desktopListen).toHaveBeenCalledWith('plugin-service-changed', expect.any(Function));
    });

    it('hands the handler both an out-of-service change and a back-in-service one', async () => {
        const { push, received } = await subscribed();

        push({ payload: { instance_id: 'inst-1', out_of_service_reason: 'it refused' } });
        push({ payload: { instance_id: 'inst-1', out_of_service_reason: null } });

        expect(received).toEqual([
            { instance_id: 'inst-1', out_of_service_reason: 'it refused' },
            { instance_id: 'inst-1', out_of_service_reason: null },
        ]);
    });

    /// A reason that is not a string or null is not a state this slot can show;
    /// admitting one would write `undefined` into a message.
    it.each([
        ['a missing reason', { instance_id: 'inst-1' }],
        ['a numeric reason', { instance_id: 'inst-1', out_of_service_reason: 3 }],
        ['a missing instance id', { out_of_service_reason: 'x' }],
        ['a numeric instance id', { instance_id: 7, out_of_service_reason: null }],
        ['a null payload', null],
        ['a non-object payload', 'inst-1'],
    ])('drops %s', async (_name, payload) => {
        const { push, received } = await subscribed();

        push({ payload });

        expect(received).toEqual([]);
    });

    it('subscribes to nothing outside the desktop runtime', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        const unlisten = await onPluginServiceChanged(() => {});

        expect(desktopListen).not.toHaveBeenCalled();
        expect(unlisten).toBeTypeOf('function');
    });
});
