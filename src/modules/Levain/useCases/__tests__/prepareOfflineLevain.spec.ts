import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { prepareOfflineLevain } from '../prepareOfflineLevain';

const mocks = vi.hoisted(() => ({
    autoLoadLevainSamples: vi.fn(() => Promise.resolve()),
}));

vi.mock('../autoLoadSamples', () => ({
    autoLoadLevainSamples: mocks.autoLoadLevainSamples,
}));

type PostedMessage = { type: string; instrumentId?: string; name?: string; value?: number };

function fakePort(): { port: MessagePort; posted: PostedMessage[] } {
    const posted: PostedMessage[] = [];
    const port = {
        postMessage: (message: PostedMessage) => {
            posted.push(message);
        },
    } as unknown as MessagePort;
    return { port, posted };
}

describe('prepareOfflineLevain', () => {
    beforeEach(() => {
        mocks.autoLoadLevainSamples.mockClear();
        mocks.autoLoadLevainSamples.mockImplementation(() => Promise.resolve());
        levainStore.set({});
    });

    it('loads the instrument selected by the device patch without mutating the engine first', async () => {
        const { port, posted } = fakePort();
        levainStore.set({
            'device-a': {
                ...defaultLevainState,
                patch: { ...defaultLevainState.patch, instrumentId: 'cello', currentArticulation: 'tremolo' },
            },
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port });

        expect(posted).toEqual([{ type: 'param', name: 'current_articulation', value: 13 }]);
        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith('device-a', port, 'cello', undefined);
    });

    it('leaves instrument identity and sample-bank replacement in one loader transaction', async () => {
        const { port, posted } = fakePort();
        const postedWhenLoadStarted: PostedMessage[] = [];
        mocks.autoLoadLevainSamples.mockImplementation(() => {
            postedWhenLoadStarted.push(...posted);
            return Promise.resolve();
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port });

        expect(postedWhenLoadStarted).toEqual([{ type: 'param', name: 'current_articulation', value: 0 }]);
    });

    it('loads the selected instrument into that device port, forwarding the abort signal', async () => {
        const { port } = fakePort();
        const controller = new AbortController();
        levainStore.set({
            'device-a': { ...defaultLevainState, patch: { ...defaultLevainState.patch, instrumentId: 'cello' } },
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port, signal: controller.signal });

        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith('device-a', port, 'cello', controller.signal);
    });

    it('falls back to the default instrument for a device with no patch entry', async () => {
        const { port, posted } = fakePort();

        await prepareOfflineLevain({ deviceId: 'never-opened', port });

        expect(posted).toEqual([{ type: 'param', name: 'current_articulation', value: 0 }]);
        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith(
            'never-opened',
            port,
            defaultLevainState.patch.instrumentId,
            undefined
        );
    });

    it('does not resolve until the zone load has finished', async () => {
        // The reason this matters: an offline context renders faster than real
        // time, so a load that is merely started never lands. Starting it is not
        // enough — the caller must be able to wait for it.
        function ignoreRelease(): void {}
        let releaseLoad = ignoreRelease;
        mocks.autoLoadLevainSamples.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releaseLoad = resolve;
                })
        );

        let settled = false;
        const pending = prepareOfflineLevain({ deviceId: 'device-a', port: fakePort().port }).then(() => {
            settled = true;
            return undefined;
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);

        releaseLoad();
        await pending;
        expect(settled).toBe(true);
    });

    it('rejects the offline preparation when the DSP bank cannot be committed', async () => {
        mocks.autoLoadLevainSamples.mockRejectedValueOnce(new Error('bank commit rejected'));

        await expect(prepareOfflineLevain({ deviceId: 'device-a', port: fakePort().port })).rejects.toThrow(
            'bank commit rejected'
        );
    });
});
