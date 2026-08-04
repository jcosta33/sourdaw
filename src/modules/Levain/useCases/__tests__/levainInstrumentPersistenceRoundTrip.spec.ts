import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';

import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { hydrateLevainStateFromProject } from '../hydrateLevainStateFromProject';
import { initLevainDeviceStatePersistence } from '../initLevainDeviceStatePersistence';
import { levainBridge } from '../levainParamBridge/levainBridge';
import { registerLevainDevice } from '../levainParamBridge/registerLevainDevice';
import { loadInstrument } from '../loadPreset';
import { prepareOfflineLevain } from '../prepareOfflineLevain';

const mocks = vi.hoisted(() => ({
    autoLoadLevainSamples: vi.fn(() => Promise.resolve()),
}));

vi.mock('../autoLoadSamples', () => ({
    autoLoadLevainSamples: mocks.autoLoadLevainSamples,
}));

// The bridge's engine-facing half needs a registered worklet port; this spec is
// about what crosses into the document, so it stubs the two calls that would
// otherwise reach a device that does not exist and leaves the store writes real.
vi.mock('../levainParamBridge/loadSamplesForInstrument', () => ({
    loadSamplesForInstrument: vi.fn(),
}));
vi.mock('../levainParamBridge/setLevainParamWithAudio', () => ({
    setLevainParamWithAudio: vi.fn(),
}));

const DEVICE_ID = 'levain-1';

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

/**
 * Built through the projection rather than as a `Track` literal, so the fixture is
 * a track the document could actually produce and the spec stays on Arrangement's
 * contract barrel.
 */
function makeLevainTracks(deviceState?: Track['devices'][number]['deviceState']): Track[] {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Cellos',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Levain',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: { masterGain: 0.8, current_articulation: 2 },
                        deviceState,
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

/**
 * A Levain patch is mostly numbers, and numbers already round-trip through
 * `Device.parameterValues`. Its instrument id does not — `persistDevicePatch` keeps
 * only finite numbers — so a reopened orchestral arrangement came back playing
 * violin-1 on the cello, horn and timpani tracks, live and in the export, with no
 * error of any kind.
 *
 * `sanitizeTrackSnapshot` is the projection step that makes this a real reload
 * rather than a store echo: it is the exact function the CRDT hydrate and the file
 * import both run through, and it rebuilds each device field by field, so anything
 * it does not carry is gone no matter what the store held a moment earlier.
 */
describe('Levain instrument persistence round trip', () => {
    let stopPersistence: () => void;

    beforeEach(() => {
        mocks.autoLoadLevainSamples.mockClear();
        mocks.autoLoadLevainSamples.mockImplementation(() => Promise.resolve());
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        levainStore.set({});
        trackStore.set({ ...defaultTrackState, tracks: makeLevainTracks() });
        stopPersistence = initLevainDeviceStatePersistence();
    });

    afterEach(() => {
        stopPersistence();
    });

    it('carries the instrument the user picked through a reload, into playback and the export', async () => {
        levainStore.set({ [DEVICE_ID]: { ...defaultLevainState } });
        await Promise.resolve();

        // The panel's instrument picker calls exactly this.
        loadInstrument(DEVICE_ID, 'cello');
        await Promise.resolve();
        await Promise.resolve();

        const loadedState = levainStore.value?.[DEVICE_ID];
        if (!loadedState) {
            throw new Error('Levain state did not load');
        }
        levainStore.set({
            [DEVICE_ID]: {
                ...loadedState,
                patch: { ...loadedState.patch, currentArticulation: 'tremolo' },
            },
        });
        await Promise.resolve();
        await Promise.resolve();

        // Reload: project the document, then rebuild the session from it alone.
        const projected = sanitizeTrackSnapshot(trackStore.value);
        trackStore.set({ ...defaultTrackState, tracks: projected.tracks });
        levainStore.set({});

        expect(hydrateLevainStateFromProject(DEVICE_ID)?.patch.instrumentId).toBe('cello');
        expect(hydrateLevainStateFromProject(DEVICE_ID)?.patch.currentArticulation).toBe('tremolo');

        const { port, posted } = fakePort();
        await prepareOfflineLevain({ deviceId: DEVICE_ID, port });

        expect(posted).toEqual([{ type: 'param', name: 'current_articulation', value: 13 }]);
        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith(DEVICE_ID, port, 'cello', undefined);
    });

    it('plays the instrument project truth holds after a reload wiped the session store', async () => {
        // The reader alone, with a chunk the document already carries — a project
        // saved in an earlier session and opened by a build that has registered no
        // device yet.
        trackStore.set({
            ...defaultTrackState,
            tracks: makeLevainTracks({ version: 1, data: { instrumentId: 'cello' } }),
        });
        levainStore.set({});
        const { port, posted } = fakePort();

        await prepareOfflineLevain({ deviceId: DEVICE_ID, port });

        expect(posted).toEqual([{ type: 'param', name: 'current_articulation', value: 0 }]);
        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith(DEVICE_ID, port, 'cello', undefined);
    });

    it('still reaches the module default for a device project truth holds no chunk for', async () => {
        // Presence pin for the two tests above: the fallback must remain reachable,
        // or "restores the saved instrument" would also be satisfied by a reader
        // that hard-codes one.
        const { port, posted } = fakePort();

        await prepareOfflineLevain({ deviceId: DEVICE_ID, port });

        expect(posted).toEqual([{ type: 'param', name: 'current_articulation', value: 0 }]);
    });

    it('registers a reloaded device onto the saved instrument, not onto the default', async () => {
        // Live playback, not the export: `registerLevainDevice` is what seeds the
        // session store and starts the sample load when the device chain is built,
        // and it ran before anything had told it which instrument this device is.
        Container.clear();
        const autoLoadLevainSamples = vi.fn().mockResolvedValue(undefined);
        injectDependencies(levainBridge, {
            getAllTracks: () => [],
            persistDeviceParam: vi.fn(),
            autoLoadLevainSamples,
            resolveEligibleDeviceWriteTarget: (deviceId: string) => ({
                status: 'eligible' as const,
                trackId: 'track-1',
                deviceId,
            }),
        });
        trackStore.set({
            ...defaultTrackState,
            tracks: makeLevainTracks({ version: 1, data: { instrumentId: 'timpani' } }),
        });
        levainStore.set({});

        const port = fakePort().port;
        await registerLevainDevice(DEVICE_ID, { setParam: vi.fn(), handleCc: vi.fn() }, port);

        expect(levainStore.value?.[DEVICE_ID]?.patch.instrumentId).toBe('timpani');
        expect(autoLoadLevainSamples).toHaveBeenCalledWith(DEVICE_ID, port, 'timpani', expect.any(AbortSignal));
    });

    it('does not write a chunk for a device that only appeared', async () => {
        // Registration is not an edit. Committing on first sight would write a chunk
        // for every Levain ever loaded and mark a freshly opened project dirty.
        levainStore.set({ [DEVICE_ID]: { ...defaultLevainState } });
        await Promise.resolve();
        await Promise.resolve();

        expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toBeUndefined();
    });
});
