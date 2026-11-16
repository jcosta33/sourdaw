import { change, clone, merge, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initDeviceStateReconciliation } from '#/app/initDeviceStateReconciliation';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { toToasterKitState } from '../../models/ToasterKitState';
import { registerToasterDevice, toasterStore, toggleStep } from '../../stores/toasterStore';
import { initToasterKitPersistence } from '../initToasterKitPersistence';
import { toasterRefusalEpisodes } from '../toasterRefusalEpisodes';

// A collaborator's change that also lifts the repair requirement reaches the session as
// one merge: the device-state reconciliation is queued by the change notification, then
// the projection clears the repair state and re-projects the peer's kit. The refusal
// episode's admitted write must land after the reconcile, and must not write the peer's
// kit back as a new edit.

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const DEVICE_ID = 'toaster-1';
const PEER_ACTOR_ID = 'bbbbbbbbbbbbbbbb';

type DeviceRow = { id: string; deviceState?: unknown };
type RootDocument = { tracks?: { tracks: { devices: DeviceRow[] }[] } };

function makeToasterTracks() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Drums',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Toaster',
                        type: 'toaster',
                        bypassed: false,
                        parameterValues: { masterGain: 1 },
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

function liveDocument(): Doc<RootDocument> {
    const doc = getCrdtDoc<RootDocument>('root');
    if (!doc) {
        throw new Error('Expected a live root document');
    }
    return doc;
}

/** The local document after it merges a collaborator's edit, as a sync receive publishes it. */
function receiveRemoteEdit(edit: (draft: RootDocument) => void): void {
    const local = liveDocument();
    const remote = change(clone(local, PEER_ACTOR_ID), edit);
    replaceCrdtDocInLineage({ id: 'root', doc: merge(clone(local), remote) });
}

function sessionKitData(): unknown {
    const kit = toasterStore.value?.[DEVICE_ID]?.kit;
    if (!kit) {
        throw new Error('Toaster fixture is absent');
    }
    return toToasterKitState(kit).data;
}

const documentKitData = () => trackStore.value?.tracks[0]?.devices[0]?.deviceState?.data;

/** Re-registers the handlers with a `setDeviceState` that counts the writes it executes. */
function countDeviceStateWrites(): { count: number } {
    const writes = { count: 0 };
    const handlers = getArrangementHandlers();
    clearHandlerRegistry();
    registerHandlerMap({
        ...handlers,
        setDeviceState: {
            ...handlers.setDeviceState,
            execute: (action, context) => {
                writes.count += 1;
                const result = handlers.setDeviceState.execute(action, context);
                if (result instanceof Promise) {
                    throw new TypeError('Expected the device state handler to execute synchronously');
                }
                return result;
            },
        },
    });
    return writes;
}

describe('a Toaster refusal ended by a peer merge', () => {
    let stopReconciliation: () => void;
    let stopProjection: () => void;
    let stopPersistence: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        trackStore.set({ ...defaultTrackState, tracks: makeToasterTracks() });
        flushAutomergeStorageWrites();
        // Bootstrap registers the reconciliation before a session starts the projection bridge.
        stopReconciliation = initDeviceStateReconciliation();
        stopProjection = setupProjectionBridge();
        toasterStore.set({});
        stopPersistence = initToasterKitPersistence();
        registerToasterDevice(DEVICE_ID);
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'revision-1',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
    });

    afterEach(() => {
        stopPersistence();
        toasterStore.set({});
        toasterRefusalEpisodes.endAll();
        stopProjection();
        stopReconciliation();
        agentProjectRepairStateStore.set(null);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('keeps the peer kit the merge brought and writes nothing back', async () => {
        toggleStep(DEVICE_ID, 0, 1);
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        const refusedKit = sessionKitData();
        const peerState = toToasterKitState({ ...toasterStore.value![DEVICE_ID]!.kit, swing: 0.3 });
        expect(peerState.data).not.toEqual(refusedKit);
        const writes = countDeviceStateWrites();

        // The real projection re-inspects the merged document, which needs no repair, and
        // re-projects the peer's device state.
        receiveRemoteEdit((draft) => {
            const device = draft.tracks?.tracks[0]?.devices.find((row) => row.id === DEVICE_ID);
            if (!device) {
                throw new Error('Expected the Toaster device in the forked document');
            }
            device.deviceState = peerState;
        });
        expect(agentProjectRepairStateStore.value).toBeNull();

        await vi.waitFor(() => expect(sessionKitData()).toEqual(peerState.data));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(documentKitData()).toEqual(peerState.data);
        expect(writes.count).toBe(0);
        expect(notifyUser).toHaveBeenCalledTimes(1);
    });
});
