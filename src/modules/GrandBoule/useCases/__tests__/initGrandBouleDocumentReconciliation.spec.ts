import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FixtureDevice = { id: string; type: string; deviceState: unknown };
type FixtureTracks = { tracks: { devices: FixtureDevice[] }[] };

const mocks = vi.hoisted(() => ({
    subscribe: vi.fn((_listener: (docId?: string) => void) => vi.fn()),
    trackStore: { value: undefined as FixtureTracks | undefined },
    isReady: vi.fn(),
    apply: vi.fn(),
    syncVoicing: vi.fn(),
    syncMidiCalibration: vi.fn(),
}));

// Exhaustive over this spec's own graph, which imports only these two names
// from the barrel. The real module is deliberately not loaded: its projection
// registry evaluates every projected store, far beyond what this spec needs.
// `DOC_PREFIX_ROOT` is the storage key constant (`models/CrdtDocumentTypes`).
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    DOC_PREFIX_ROOT: 'root',
    subscribeToCrdtChanges: mocks.subscribe,
}));
// Exhaustive over this spec's own graph: the sweep and the hydrate read
// `trackStore` and nothing else from this barrel.
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('../resolveGrandBouleEngine', () => ({ resolveGrandBouleEngine: () => ({ isReady: mocks.isReady }) }));
vi.mock('../applyGrandBouleMorphState', () => ({ applyGrandBouleMorphState: mocks.apply }));
vi.mock('../syncGrandBouleVoicingToEngine', () => ({ syncGrandBouleVoicingToEngine: mocks.syncVoicing }));
vi.mock('../calibrateGrandBouleMidi/syncMidiCalibrationToEngine', () => ({
    syncMidiCalibrationToEngine: mocks.syncMidiCalibration,
}));

import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/useCases';

import { readGrandBouleDeviceState, toGrandBouleDeviceState } from '../../models/GrandBouleDeviceState';
import { createGrandBouleStore, resetGrandBouleStores } from '../../stores/grandBouleStore';
import { captureOfflineGrandBoule } from '../captureOfflineGrandBoule';
import { initGrandBouleDocumentReconciliation } from '../initGrandBouleDocumentReconciliation';
import { reconcileGrandBouleDevicesFromProject } from '../reconcileGrandBouleDevicesFromProject';

const DEVICE_A = 'grand-peer-a';
const DEVICE_B = 'grand-peer-b';

const CHUNK_AT_5 = {
    version: 1,
    data: {
        modelA: 'balanced-grand',
        modelB: 'clear-grand',
        morphPosition: 0.3,
        layerBalance: 0,
        enabled: true,
        temperament: 5,
        hammerHardness: -0.4,
        velocityCurve: 1.1,
        stereoWidth: 0.9,
        toneTilt: 0.25,
    },
};

function projectWith(...devices: FixtureDevice[]): FixtureTracks {
    return { tracks: [{ devices }] };
}

function grandBouleDevice(deviceId: string, deviceState: unknown): FixtureDevice {
    return { id: deviceId, type: 'grand-boule', deviceState };
}

/** Seed the per-device store the way a session that loaded temperament 1 holds it. */
function seedStaleStore(deviceId: string): void {
    const store = createGrandBouleStore(deviceId);
    const state = store.value;
    if (state === null) {
        throw new Error('per-device store must exist after createGrandBouleStore');
    }
    store.set({ ...state, temperament: 1 });
}

/** The sweep runs one microtask after the notification, coalesced. */
function flushSweep(): Promise<void> {
    return Promise.resolve();
}

describe('initGrandBouleDocumentReconciliation', () => {
    let stop: (() => void) | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        resetGrandBouleStores();
        mocks.trackStore.value = undefined;
        mocks.isReady.mockReturnValue(true);
        stop = initGrandBouleDocumentReconciliation();
    });

    afterEach(() => {
        stop?.();
    });

    function documentOriginListener(): (docId?: string) => void {
        const listener = mocks.subscribe.mock.calls.at(-1)?.[0];
        if (listener === undefined) {
            throw new Error('subscription was not registered');
        }
        return listener;
    }

    it('reconciles a stale store from a peer-committed chunk on a root-document change', async () => {
        seedStaleStore(DEVICE_A);
        mocks.trackStore.value = projectWith(grandBouleDevice(DEVICE_A, CHUNK_AT_5));
        const listener = documentOriginListener();

        listener(DOC_PREFIX_ROOT);
        await flushSweep();

        expect(createGrandBouleStore(DEVICE_A).value?.temperament).toBe(5);
    });

    it('syncs a ready live engine to the reconciled state', async () => {
        seedStaleStore(DEVICE_A);
        mocks.trackStore.value = projectWith(grandBouleDevice(DEVICE_A, CHUNK_AT_5));
        const listener = documentOriginListener();

        listener(DOC_PREFIX_ROOT);
        await flushSweep();

        const store = createGrandBouleStore(DEVICE_A);
        const engine = { isReady: mocks.isReady };
        expect(mocks.apply).toHaveBeenCalledWith(engine, readGrandBouleDeviceState(CHUNK_AT_5).morph);
        expect(mocks.syncVoicing).toHaveBeenCalledExactlyOnceWith({ engine, store });
        expect(mocks.syncMidiCalibration).toHaveBeenCalledExactlyOnceWith({ engine, store });
    });

    it('reconciles on a bulk change that names no document', async () => {
        seedStaleStore(DEVICE_A);
        mocks.trackStore.value = projectWith(grandBouleDevice(DEVICE_A, CHUNK_AT_5));
        const listener = documentOriginListener();

        listener(undefined);
        await flushSweep();

        expect(createGrandBouleStore(DEVICE_A).value?.temperament).toBe(5);
    });

    it('ignores a change to a document that backs no project store', async () => {
        seedStaleStore(DEVICE_A);
        mocks.trackStore.value = projectWith(grandBouleDevice(DEVICE_A, CHUNK_AT_5));
        const listener = documentOriginListener();

        listener('branch_snapshot_1');
        await flushSweep();

        expect(createGrandBouleStore(DEVICE_A).value?.temperament).toBe(1);
        expect(mocks.apply).not.toHaveBeenCalled();
        expect(mocks.syncVoicing).not.toHaveBeenCalled();
        expect(mocks.syncMidiCalibration).not.toHaveBeenCalled();
    });

    // Through the public subscription seam the repository's local-write hint is
    // not visible, so a change a local CRDT-backed store wrote fires here too.
    // The assertion pins which: it does fire, and it is harmless — the hydrate's
    // diff gate leaves the store object untouched, and the ready engine is
    // re-pushed through the same doors a panel pick uses with the values it
    // already holds, so the net effect is nil.
    it('is harmless for a local-store change the store already reflects', async () => {
        const store = createGrandBouleStore(DEVICE_A);
        const state = store.value;
        if (state === null) {
            throw new Error('per-device store must exist after createGrandBouleStore');
        }
        const persisted = readGrandBouleDeviceState(CHUNK_AT_5);
        store.set({
            ...state,
            morph: persisted.morph,
            temperament: persisted.temperament,
            parameters: persisted.parameters,
        });
        const unrewritten = store.value;
        mocks.trackStore.value = projectWith(grandBouleDevice(DEVICE_A, CHUNK_AT_5));
        const listener = documentOriginListener();

        listener(DOC_PREFIX_ROOT);
        await flushSweep();

        expect(store.value).toBe(unrewritten);
        expect(mocks.apply).toHaveBeenCalledWith(
            { isReady: mocks.isReady },
            readGrandBouleDeviceState(CHUNK_AT_5).morph
        );
        expect(mocks.syncVoicing).toHaveBeenCalledWith({ engine: { isReady: mocks.isReady }, store });
        expect(mocks.syncMidiCalibration).toHaveBeenCalledWith({ engine: { isReady: mocks.isReady }, store });
    });

    it('coalesces a burst of notifications into one sweep', async () => {
        seedStaleStore(DEVICE_A);
        mocks.trackStore.value = projectWith(grandBouleDevice(DEVICE_A, CHUNK_AT_5));
        const listener = documentOriginListener();

        listener(DOC_PREFIX_ROOT);
        listener(DOC_PREFIX_ROOT);
        listener(undefined);
        await flushSweep();

        expect(mocks.syncVoicing).toHaveBeenCalledTimes(1);
        expect(createGrandBouleStore(DEVICE_A).value?.temperament).toBe(5);
    });

    it('reconciles every Grand Boule device on the project and no other device', () => {
        seedStaleStore(DEVICE_A);
        seedStaleStore(DEVICE_B);
        mocks.trackStore.value = projectWith(
            grandBouleDevice(DEVICE_A, CHUNK_AT_5),
            { id: 'toaster-1', type: 'toaster', deviceState: undefined },
            grandBouleDevice(DEVICE_B, undefined)
        );

        reconcileGrandBouleDevicesFromProject();

        expect(createGrandBouleStore(DEVICE_A).value?.temperament).toBe(5);
        // A device with no chunk decodes to the default temperament 0, not the seeded 1.
        expect(createGrandBouleStore(DEVICE_B).value?.temperament).toBe(0);
    });

    it('updates the store without touching an engine that is not ready', async () => {
        mocks.isReady.mockReturnValue(false);
        seedStaleStore(DEVICE_A);
        mocks.trackStore.value = projectWith(grandBouleDevice(DEVICE_A, CHUNK_AT_5));
        const listener = documentOriginListener();

        listener(DOC_PREFIX_ROOT);
        await flushSweep();

        expect(createGrandBouleStore(DEVICE_A).value?.temperament).toBe(5);
        expect(mocks.apply).not.toHaveBeenCalled();
        expect(mocks.syncVoicing).not.toHaveBeenCalled();
        expect(mocks.syncMidiCalibration).not.toHaveBeenCalled();
    });

    it('stops reconciling after the subscription is released', async () => {
        seedStaleStore(DEVICE_A);
        mocks.trackStore.value = projectWith(grandBouleDevice(DEVICE_A, CHUNK_AT_5));
        const unsubscribe = vi.fn();
        mocks.subscribe.mockReturnValueOnce(unsubscribe);
        const secondStop = initGrandBouleDocumentReconciliation();

        secondStop();
        documentOriginListener()(DOC_PREFIX_ROOT);
        await flushSweep();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(createGrandBouleStore(DEVICE_A).value?.temperament).toBe(1);
        expect(mocks.syncVoicing).not.toHaveBeenCalled();
        stop = undefined;
    });
});

describe('reconcileGrandBouleDevicesFromProject — the stale-mirror oracle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetGrandBouleStores();
        mocks.trackStore.value = undefined;
        mocks.isReady.mockReturnValue(true);
    });

    afterEach(() => {
        resetGrandBouleStores();
    });

    it('projects the peer-committed temperament through the capture a native body folds (#4894)', () => {
        // The store holds what the session loaded; the document holds what the
        // peer committed. `captureOfflineGrandBoule` is store-wins, so before the
        // reconcile the capture follows the stale store — exactly the window
        // `projectNativeDeviceState`'s grand-boule arm documents for #4894.
        seedStaleStore(DEVICE_A);
        expect(captureOfflineGrandBoule({ deviceId: DEVICE_A, deviceState: CHUNK_AT_5 }).voicing.temperament).toBe(1);
        expect(toGrandBouleDeviceState(readGrandBouleDeviceState(CHUNK_AT_5)).data.temperament).toBe(5);

        mocks.trackStore.value = projectWith(grandBouleDevice(DEVICE_A, CHUNK_AT_5));
        reconcileGrandBouleDevicesFromProject();

        expect(captureOfflineGrandBoule({ deviceId: DEVICE_A, deviceState: CHUNK_AT_5 }).voicing.temperament).toBe(5);
    });
});
