import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { prepareOfflineLevain } from '../prepareOfflineLevain';

const mocks = vi.hoisted(() => ({
    loadInstrumentFromManifest: vi.fn(() => Promise.resolve()),
    resolveSampleBasePath: vi.fn((instrumentId: string) => Promise.resolve(`/samples/levain/${instrumentId}`)),
}));

vi.mock('../../repositories/sampleLoader/loadInstrumentFromManifest', () => ({
    loadInstrumentFromManifest: mocks.loadInstrumentFromManifest,
}));

vi.mock('../../repositories/sampleLoader/resolveSampleBasePath', () => ({
    resolveSampleBasePath: mocks.resolveSampleBasePath,
}));

function fakePort(): MessagePort {
    return { postMessage: vi.fn() } as unknown as MessagePort;
}

describe('prepareOfflineLevain', () => {
    beforeEach(() => {
        mocks.loadInstrumentFromManifest.mockClear();
        mocks.resolveSampleBasePath.mockClear();
        mocks.loadInstrumentFromManifest.mockImplementation(() => Promise.resolve());
        levainStore.set({});
    });

    it('loads the instrument the device patch selects, into that device port', async () => {
        const port = fakePort();
        levainStore.set({
            'device-a': { ...defaultLevainState, patch: { ...defaultLevainState.patch, instrumentId: 'cello' } },
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port });

        expect(mocks.resolveSampleBasePath).toHaveBeenCalledWith('cello');
        const [manifestUrl, basePath, passedPort] = mocks.loadInstrumentFromManifest.mock.calls[0] as unknown as [
            string,
            string,
            MessagePort,
        ];
        expect(manifestUrl).toBe('/samples/levain/cello/manifest.json');
        expect(basePath).toBe('/samples/levain/cello');
        expect(passedPort).toBe(port);
    });

    it('falls back to the default instrument for a device with no patch entry', async () => {
        await prepareOfflineLevain({ deviceId: 'never-opened', port: fakePort() });

        expect(mocks.resolveSampleBasePath).toHaveBeenCalledWith(defaultLevainState.patch.instrumentId);
        expect(mocks.loadInstrumentFromManifest).toHaveBeenCalledTimes(1);
    });

    it('does not resolve until the zone load has finished', async () => {
        // The reason this matters: an offline context renders faster than real
        // time, so a load that is merely started never lands. Starting it is not
        // enough — the caller must be able to wait for it.
        let releaseLoad = (): void => {};
        mocks.loadInstrumentFromManifest.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releaseLoad = resolve;
                })
        );

        let settled = false;
        const pending = prepareOfflineLevain({ deviceId: 'device-a', port: fakePort() }).then(() => {
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
