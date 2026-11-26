import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { onPluginTailChanged } from '../onPluginTailChanged';
import { type PluginTailChange } from '../types';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopListen: vi.fn(),
}));

/** Subscribe and hand back the raw push the native shell would make. */
async function subscribed(): Promise<{ push: (payload: unknown) => void; received: PluginTailChange[] }> {
    const received: PluginTailChange[] = [];
    let push: (payload: unknown) => void = () => {};
    vi.mocked(desktopListen).mockImplementation((_event, handler: (payload: unknown) => void) => {
        push = handler;
        return Promise.resolve(() => {});
    });

    await onPluginTailChanged((change) => received.push(change));

    return { push: (payload) => push({ payload }), received };
}

describe('onPluginTailChanged', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('subscribes to the wire name the native host emits', async () => {
        await subscribed();

        expect(desktopListen).toHaveBeenCalledWith('plugin-tail-changed', expect.any(Function));
    });

    it('hands the handler a change that carries its native sequence', async () => {
        const { push, received } = await subscribed();
        const change = { instance_id: 'inst-1', tail_samples: 48_000, sequence: 3 };

        push(change);

        expect(received).toEqual([change]);
    });

    it.each([
        ['a missing sequence', { instance_id: 'inst-1', tail_samples: 48_000 }],
        ['a fractional sequence', { instance_id: 'inst-1', tail_samples: 48_000, sequence: 1.5 }],
        ['a string sequence', { instance_id: 'inst-1', tail_samples: 48_000, sequence: '3' }],
        ['a zero sequence', { instance_id: 'inst-1', tail_samples: 48_000, sequence: 0 }],
        ['a negative sequence', { instance_id: 'inst-1', tail_samples: 48_000, sequence: -2 }],
        [
            'a sequence past what a JSON number holds exactly',
            { instance_id: 'inst-1', tail_samples: 48_000, sequence: 2 ** 60 },
        ],
        ['a fractional tail', { instance_id: 'inst-1', tail_samples: 1.5, sequence: 3 }],
        ['a negative tail', { instance_id: 'inst-1', tail_samples: -1, sequence: 3 }],
        ['an instance id that is not a string', { instance_id: 7, tail_samples: 48_000, sequence: 3 }],
    ])('ignores a change with %s', async (_name, malformed) => {
        const { push, received } = await subscribed();

        push(malformed);

        expect(received).toEqual([]);
    });

    it('subscribes to nothing in a browser runtime', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        await onPluginTailChanged(() => {});

        expect(desktopListen).not.toHaveBeenCalled();
    });
});
