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

    it('tells the engine which instrument it is, using the id the device patch selects', async () => {
        // `setInstrument` is the only route to the realism layer's
        // `configure_for`. Without it an offline instance renders as
        // `Instrument::Other`: no body resonance, no sympathetic strings, no bow
        // noise, and no bow-scrape/bow-lift transients. Right samples, wrong
        // instrument, on every exported orchestral track.
        const { port, posted } = fakePort();
        levainStore.set({
            'device-a': {
                ...defaultLevainState,
                patch: { ...defaultLevainState.patch, instrumentId: 'cello', currentArticulation: 'tremolo' },
            },
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port });

        expect(posted).toEqual([
            { type: 'setInstrument', instrumentId: 'cello' },
            { type: 'param', name: 'current_articulation', value: 13 },
        ]);
    });

    it('posts the instrument identity before starting the load that clears zones', async () => {
        // Order matters, and it is only safe in this direction because the
        // loader's first message is `clearZones`, whose `realism.reset()` clears
        // filter state and not the configuration. Reversed, the engine would be
        // configured only after the samples arrive.
        const { port, posted } = fakePort();
        const postedWhenLoadStarted: PostedMessage[] = [];
        mocks.autoLoadLevainSamples.mockImplementation(() => {
            postedWhenLoadStarted.push(...posted);
            return Promise.resolve();
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port });

        expect(postedWhenLoadStarted).toEqual([
            { type: 'setInstrument', instrumentId: defaultLevainState.patch.instrumentId },
            { type: 'param', name: 'current_articulation', value: 0 },
        ]);
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

        expect(posted).toEqual([
            { type: 'setInstrument', instrumentId: defaultLevainState.patch.instrumentId },
            { type: 'param', name: 'current_articulation', value: 0 },
        ]);
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
        let releaseLoad = (): void => {};
        mocks.autoLoadLevainSamples.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releaseLoad = resolve;
                })
        );

        let settled = false;
        const pending = prepareOfflineLevain({ deviceId: 'device-a', port: fakePort().port }).then(() => {
            settled = true;
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);

        releaseLoad();
        await pending;
        expect(settled).toBe(true);
    });
});
