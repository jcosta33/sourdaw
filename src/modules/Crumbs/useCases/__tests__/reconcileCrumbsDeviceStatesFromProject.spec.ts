import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FixtureDevice = { id: string; type: string; deviceState: unknown };
type FixtureTracks = { tracks: { id: string; kind: string; devices: FixtureDevice[] }[] };

const mocks = vi.hoisted(() => ({
    trackStore: { value: undefined as FixtureTracks | undefined },
    emitModeChanged: vi.fn(() => Promise.resolve()),
    nativeSetMode: vi.fn(() => Promise.resolve()),
    nativeLoadSample: vi.fn(),
    getWaveformPeaks: vi.fn(() => Promise.resolve([])),
    getDroppedWrites: vi.fn(() => Promise.resolve(0)),
    executeAppAction: vi.fn((_action: unknown) => Promise.resolve()),
}));

// Exhaustive over this spec's graph: the sweep reads `trackStore` and nothing
// else from this barrel.
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
// The engine doors the live routes push through, mocked so the assertions
// observe the push without a strip or a native session. The live routes
// themselves (`switchCrumbsMode`, `loadSampleFromPath`) stay real, so the
// session store carries exactly what a loaded session would hold. The strip
// push is the composition root's subscription, so the mode door is the
// emitted `crumbs.modeChanged` signal.
vi.mock('../../repositories/crumbsBridge/setCrumbsMode', () => ({ setCrumbsMode: mocks.nativeSetMode }));
vi.mock('../../repositories/crumbsBridge/loadSample', () => ({ loadSample: mocks.nativeLoadSample }));
vi.mock('../../repositories/crumbsBridge/getWaveformPeaks', () => ({ getWaveformPeaks: mocks.getWaveformPeaks }));
vi.mock('../../repositories/crumbsBridge/getCrumbsDroppedSampleWrites', () => ({
    getCrumbsDroppedSampleWrites: mocks.getDroppedWrites,
}));
// The persistence subscriber commits through this door; captured so the
// data-loss case can read exactly what a local edit mirrored into the document.
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.executeAppAction }));

import { setCrumbsEventBus } from '../../stores/crumbsEventBus';
import { crumbsStore, defaultCrumbsState, setMode } from '../../stores/crumbsStore';
import { initCrumbsDeviceStatePersistence } from '../initCrumbsDeviceStatePersistence';
import { reconcileCrumbsDeviceStatesFromProject } from '../reconcileCrumbsDeviceStatesFromProject';

import type { SampleMeta } from '../../models/CrumbsTypes';

const DEVICE_ID = 'crumbs-peer-1';
const TRACK_ID = 'track-1';

const SAMPLE_A: SampleMeta = {
    sampleId: 1,
    sampleRate: 48000,
    channels: 2,
    frameCount: 1000,
    durationSecs: 0.02,
    detectedRoot: 60,
    detectedBpm: 120,
    category: 'loop',
    filePath: '/samples/a.wav',
    fileName: 'a.wav',
};

/**
 * What the session's own decode of `/samples/b.wav` produces. `sampleId` 42 is
 * *this* instance's counter value — deliberately different from the peer chunk's
 * 7 below, because an instance assigns its own ids and the store must carry the
 * id the local engine answers to.
 */
const LOCAL_DECODE_OF_B = {
    sampleId: 42,
    sampleRate: 48000,
    channels: 2,
    frameCount: 2000,
    durationSecs: 0.04,
    detectedRoot: 62,
    detectedBpm: 100,
    category: 'percussive',
    decodeWarningCount: 0,
    decodeWarnings: [],
};

function peerChunk(over: { mode?: string; sampleId?: number; filePath?: string } = {}): Record<string, unknown> {
    return {
        version: 1,
        data: {
            mode: over.mode ?? 'quick',
            activeSample: {
                ...SAMPLE_A,
                filePath: over.filePath ?? SAMPLE_A.filePath,
                sampleId: over.sampleId ?? SAMPLE_A.sampleId,
            },
        },
    };
}

function projectWith(...devices: FixtureDevice[]): void {
    mocks.trackStore.value = { tracks: [{ id: TRACK_ID, kind: 'midi', devices }] };
}

function crumbsDevice(deviceState: unknown): FixtureDevice {
    return { id: DEVICE_ID, type: 'builtin-crumbs', deviceState };
}

type SetDeviceStateAction = {
    type: 'setDeviceState';
    payload: { state: { data: { mode: string; activeSample: { filePath: string } | null } } };
};

function isSetDeviceStateAction(value: unknown): value is SetDeviceStateAction {
    return typeof value === 'object' && value !== null && 'type' in value && value.type === 'setDeviceState';
}

/** The sweep is synchronous; the sample route it triggers is async. */
function flushLoad(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('reconcileCrumbsDeviceStatesFromProject', () => {
    let stopPersistence: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.nativeLoadSample.mockResolvedValue(LOCAL_DECODE_OF_B);
        mocks.trackStore.value = undefined;
        setCrumbsEventBus({ emit: mocks.emitModeChanged });
        crumbsStore.set({ [DEVICE_ID]: { ...defaultCrumbsState, activeSample: SAMPLE_A } });
        // The persistence subscriber runs beside the sweep exactly as bootstrap
        // wires them: a reconciled sample is a store edit its committed map has
        // never seen, which is what the data-loss case reads back.
        stopPersistence = initCrumbsDeviceStatePersistence();
    });

    afterEach(() => {
        stopPersistence();
        crumbsStore.set({});
    });

    it('loads a peer-committed sample into the engine and the store', async () => {
        projectWith(crumbsDevice(peerChunk({ filePath: '/samples/b.wav', sampleId: 7 })));

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();

        expect(mocks.nativeLoadSample).toHaveBeenCalledWith(DEVICE_ID, '/samples/b.wav');
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.filePath).toBe('/samples/b.wav');
        // The store carries the id the local decode assigned, not the peer's
        // engine-local counter value the chunk carried.
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.sampleId).toBe(42);
    });

    it('switches a peer-committed mode through the store, the signal and the native instance', async () => {
        projectWith(crumbsDevice(peerChunk({ mode: 'slice', sampleId: 7, filePath: '/samples/b.wav' })));

        reconcileCrumbsDeviceStatesFromProject();

        expect(crumbsStore.value?.[DEVICE_ID]?.mode).toBe('slice');
        expect(mocks.emitModeChanged).toHaveBeenCalledWith('crumbs.modeChanged', {
            deviceId: DEVICE_ID,
            mode: 'slice',
        });
        expect(mocks.nativeSetMode).toHaveBeenCalledWith(DEVICE_ID, 'slice');
    });

    it('reconciles the owner type only', async () => {
        projectWith(crumbsDevice(peerChunk({ filePath: '/samples/b.wav', sampleId: 7 })), {
            id: 'toaster-1',
            type: 'toaster',
            deviceState: undefined,
        });

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();

        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.filePath).toBe('/samples/b.wav');
        expect(mocks.nativeLoadSample).toHaveBeenCalledTimes(1);
    });

    it('skips a device the session has not loaded', async () => {
        crumbsStore.set({});
        projectWith(crumbsDevice(peerChunk({ filePath: '/samples/b.wav', sampleId: 7 })));

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();

        expect(crumbsStore.value?.[DEVICE_ID]).toBeUndefined();
        expect(mocks.nativeLoadSample).not.toHaveBeenCalled();
    });

    // The guard that makes the sweep affordable and loop-free. `sampleId` is
    // deliberately absent from the comparison: it is an engine-local counter,
    // so two peers each holding their own id for the same file must read as
    // equal or every reconciliation would commit the local counter back and
    // the peers would chase each other forever.
    it('does not re-apply when the chunk matches mode and file even on a foreign sampleId', async () => {
        const storeBefore = crumbsStore.value?.[DEVICE_ID];
        projectWith(crumbsDevice(peerChunk({ sampleId: 999 })));

        reconcileCrumbsDeviceStatesFromProject();

        expect(crumbsStore.value?.[DEVICE_ID]).toBe(storeBefore);
        expect(mocks.nativeLoadSample).not.toHaveBeenCalled();
        expect(mocks.emitModeChanged).not.toHaveBeenCalled();
        expect(mocks.nativeSetMode).not.toHaveBeenCalled();
    });

    // #4764's data-loss shape: the peer loads a sample while the device is
    // loaded, then the user switches mode. The commit mirrors the chunk's whole
    // playback state, so it carries the peer's sample only if the
    // reconciliation applied it first — without that, this commit silently
    // reverts the peer's sample to the stale local one.
    it('carries the peer key in the next local edit’s commit', async () => {
        projectWith(crumbsDevice(peerChunk({ filePath: '/samples/b.wav', sampleId: 7 })));

        reconcileCrumbsDeviceStatesFromProject();
        await flushLoad();
        setMode(DEVICE_ID, 'drum');

        const commit = mocks.executeAppAction.mock.calls.map((call) => call[0]).findLast(isSetDeviceStateAction);
        expect(commit).toBeDefined();
        expect(commit?.payload.state.data.mode).toBe('drum');
        expect(commit?.payload.state.data.activeSample?.filePath).toBe('/samples/b.wav');
    });
});
