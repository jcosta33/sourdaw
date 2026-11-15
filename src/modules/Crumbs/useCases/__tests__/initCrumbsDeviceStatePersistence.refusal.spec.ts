import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { resetCrdtProjectAuthority } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { fromCrumbsDeviceState, toCrumbsDeviceState } from '../../models/CrumbsDeviceState';
import { crumbsStore, ensureInstance, setActiveSample, setMode } from '../../stores/crumbsStore';
import { beginCrumbsPairedReconcile, endCrumbsPairedReconcile } from '../../stores/sampleLoadGate';
import { replayCrumbsDeviceStateCommit } from '../crumbsDeviceStateMirror';
import { initCrumbsDeviceStatePersistence } from '../initCrumbsDeviceStatePersistence';

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const DEVICE_ID = 'crumbs-1';

function makeCrumbsTracks(deviceState?: ReturnType<typeof toCrumbsDeviceState>) {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Sampler',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Crumbs',
                        type: 'crumbs',
                        bypassed: false,
                        parameterValues: {},
                        deviceState,
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

/** Resolves once every microtask queued so far has run. */
const afterMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const lock = () =>
    agentProjectRepairStateStore.set({
        audioGraphValid: false,
        detectedRevision: 'revision-1',
        inspectionAvailable: true,
        projectInvariantsValid: false,
        rawProjectRetained: true,
        repairCandidates: [],
        status: 'repair-required',
    });
const unlock = () => agentProjectRepairStateStore.set(null);
const SETTLED_SAMPLE = {
    sampleId: 7,
    sampleRate: 48000,
    channels: 2,
    frameCount: 48000,
    durationSecs: 1,
    detectedRoot: null,
    detectedBpm: null,
    category: 'unknown',
    filePath: 'settled.wav',
    fileName: 'settled.wav',
} as const;
const documentSampleId = () =>
    fromCrumbsDeviceState(trackStore.value?.tracks[0]?.devices[0]?.deviceState)?.activeSample?.sampleId;
const documentMode = () => fromCrumbsDeviceState(trackStore.value?.tracks[0]?.devices[0]?.deviceState)?.mode;

describe('initCrumbsDeviceStatePersistence on a refused project', () => {
    let stopPersistence: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        trackStore.set({ ...defaultTrackState, tracks: makeCrumbsTracks() });
        lock();
        crumbsStore.set({});
        stopPersistence = initCrumbsDeviceStatePersistence();
        ensureInstance(DEVICE_ID);
    });

    afterEach(() => {
        stopPersistence();
        crumbsStore.set({});
        unlock();
    });

    it('writes the refused mode once the project is unlocked, without a further edit', async () => {
        setMode(DEVICE_ID, 'slice');
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        expect(documentMode()).toBeUndefined();

        unlock();

        await vi.waitFor(() => expect(documentMode()).toBe('slice'));
    });

    it('tells the user again after the device leaves the store and returns', async () => {
        setMode(DEVICE_ID, 'slice');
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));

        crumbsStore.set({});
        ensureInstance(DEVICE_ID);
        setMode(DEVICE_ID, 'warp');

        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(2));
    });

    it('writes nothing on unlock when the document already holds the session state', async () => {
        setMode(DEVICE_ID, 'slice');
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        // A peer's identical chunk reaches the document while the project is still locked.
        const session = crumbsStore.value?.[DEVICE_ID];
        if (!session) {
            throw new Error('Crumbs fixture is absent');
        }
        trackStore.set({
            ...defaultTrackState,
            tracks: makeCrumbsTracks(toCrumbsDeviceState({ mode: session.mode, activeSample: session.activeSample })),
        });
        const dispatched = vi.spyOn(trackStore, 'set');

        unlock();
        await afterMicrotasks();

        expect(dispatched).not.toHaveBeenCalled();
        expect(documentMode()).toBe('slice');
    });

    it('does not write a refused edit into the project that replaced the one it was refused in', async () => {
        setMode(DEVICE_ID, 'slice');
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));

        // A load installs the new root, then clears the repair state; the new project holds the same device id.
        resetCrdtProjectAuthority('Replacement');
        trackStore.set({ ...defaultTrackState, tracks: makeCrumbsTracks() });
        await afterMicrotasks();

        expect(agentProjectRepairStateStore.value).toBeNull();
        expect(documentMode()).toBeUndefined();
    });

    it('holds the admitted write while a paired reconcile is unsettled and writes the settled state on release', async () => {
        setActiveSample(DEVICE_ID, SETTLED_SAMPLE);
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        beginCrumbsPairedReconcile(DEVICE_ID);

        unlock();
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(documentSampleId()).toBeUndefined();

        // The pair settles on the state the refused edit already holds: only the replay can write it.
        endCrumbsPairedReconcile(DEVICE_ID);
        replayCrumbsDeviceStateCommit(DEVICE_ID);

        await vi.waitFor(() => expect(documentSampleId()).toBe(7));
    });
});
