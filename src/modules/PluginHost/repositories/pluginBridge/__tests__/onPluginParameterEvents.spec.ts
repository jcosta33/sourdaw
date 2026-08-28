import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { onPluginParameterEvents } from '../onPluginParameterEvents';
import { onPluginParametersRescanned } from '../onPluginParametersRescanned';
import { type PluginParameterEvents } from '../types';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopListen: vi.fn(),
}));

/** Subscribe and hand back the raw push the native shell would make. */
async function subscribed(): Promise<{
    push: (payload: unknown) => void;
    received: PluginParameterEvents[];
}> {
    const received: PluginParameterEvents[] = [];
    let push: (payload: unknown) => void = () => {};
    vi.mocked(desktopListen).mockImplementation((_event, handler: (payload: unknown) => void) => {
        push = handler;
        return Promise.resolve(() => {});
    });

    await onPluginParameterEvents((events) => received.push(events));

    return { push: (payload) => push(payload), received };
}

describe('onPluginParameterEvents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('subscribes to the wire name the native host emits', async () => {
        await subscribed();

        expect(desktopListen).toHaveBeenCalledWith('plugin-parameter-events', expect.any(Function));
    });

    it('hands the handler a batch it recognises', async () => {
        const { push, received } = await subscribed();

        push({
            payload: {
                instance_id: 'inst-1',
                events: [
                    { param_id: 4, kind: 'gesture_begin' },
                    { param_id: 4, kind: 'value', value: 0.6 },
                    { param_id: 4, kind: 'gesture_end' },
                ],
            },
        });

        expect(received).toEqual([
            {
                instance_id: 'inst-1',
                events: [
                    { param_id: 4, kind: 'gesture_begin' },
                    { param_id: 4, kind: 'value', value: 0.6 },
                    { param_id: 4, kind: 'gesture_end' },
                ],
            },
        ]);
    });

    /// A `value` with no number is not a reading. Admitting one would publish
    /// `undefined` as a control position and blank the knob the user is watching.
    it('refuses a value event carrying no number', async () => {
        const { push, received } = await subscribed();

        push({ payload: { instance_id: 'inst-1', events: [{ param_id: 4, kind: 'value' }] } });

        expect(received).toEqual([]);
    });

    it('refuses a value event carrying a number that is not finite', async () => {
        const { push, received } = await subscribed();

        push({ payload: { instance_id: 'inst-1', events: [{ param_id: 4, kind: 'value', value: Number.NaN }] } });

        expect(received).toEqual([]);
    });

    it('refuses an event kind the renderer has no meaning for', async () => {
        const { push, received } = await subscribed();

        push({ payload: { instance_id: 'inst-1', events: [{ param_id: 4, kind: 'modulation', value: 0.5 }] } });

        expect(received).toEqual([]);
    });

    it('refuses a batch whose instance is not named', async () => {
        const { push, received } = await subscribed();

        push({ payload: { events: [{ param_id: 4, kind: 'value', value: 0.5 }] } });

        expect(received).toEqual([]);
    });

    /// One malformed event condemns the batch rather than being skipped inside
    /// it: a ride with a hole in it is a worse answer than no ride at all, and a
    /// dropped gesture boundary would leave a lane stuck in write mode.
    it('refuses a batch in which any one event is malformed', async () => {
        const { push, received } = await subscribed();

        push({
            payload: {
                instance_id: 'inst-1',
                events: [
                    { param_id: 4, kind: 'value', value: 0.5 },
                    { param_id: 'four', kind: 'value', value: 0.6 },
                ],
            },
        });

        expect(received).toEqual([]);
    });

    it('subscribes to nothing in a browser runtime with no native host', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        const unlisten = await onPluginParameterEvents(() => {});

        expect(desktopListen).not.toHaveBeenCalled();
        expect(() => unlisten()).not.toThrow();
    });
});

describe('onPluginParametersRescanned', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('subscribes to the wire name the native host emits', async () => {
        vi.mocked(desktopListen).mockResolvedValue(() => {});

        await onPluginParametersRescanned(() => {});

        expect(desktopListen).toHaveBeenCalledWith('plugin-parameters-rescanned', expect.any(Function));
    });

    it('refuses a payload that names no instance', async () => {
        const received: unknown[] = [];
        let push: (payload: unknown) => void = () => {};
        vi.mocked(desktopListen).mockImplementation((_event, handler: (payload: unknown) => void) => {
            push = handler;
            return Promise.resolve(() => {});
        });

        await onPluginParametersRescanned((rescanned) => received.push(rescanned));
        push({ payload: { instance_id: 7 } });

        expect(received).toEqual([]);
    });
});
