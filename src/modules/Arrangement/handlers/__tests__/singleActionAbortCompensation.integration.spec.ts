import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { prepareAutomationTimeOperation, prepareAutomationTimeStateRestore } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore as undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    isAppActionConflictError,
    productionBriefAdmissionPort,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { prepareMidiGlobalTimeTransaction, prepareMidiTimeStateRestore } from '#/modules/MIDI/useCases';
import { prepareTimelineMapStateRestore, prepareTimelineMapTimeOperation } from '#/modules/Transport/useCases';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { trackStore } from '../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../useCases/getArrangementHandlers';
import { setTimeOperationDependencies } from '../../useCases/timeOperations/timeOperationDependencies';
import { trackTemplateCache } from '../../useCases/trackTemplate';

/**
 * `deleteTime`, `insertTime` and `loadTrackTemplate` learn their inverse while they
 * execute: `describe` hands back a holder and `execute` fills it in. A single action
 * aborted after execute has to replay that finished inverse, as the batch does, not the
 * placeholder (or absence) `describe` returned.
 *
 * Everything is real (the Arrangement handler map, `executeAppAction`, the Automerge
 * document, the time-operation owners) except two seams: the production brief admits the
 * action before it executes and refuses the commit afterwards, and the inverse handlers
 * are spied through to the real ones.
 */

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

// Restoring or discarding a track drives the live engine strip, which jsdom's stubbed
// AudioContext cannot build. The subject is which inverse is replayed, so the engine seam
// is stubbed over the real barrel.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getTrackAnalyser: vi.fn(() => null),
    getMasterAnalyser: vi.fn(() => null),
    createTrackStrip: vi.fn(),
    removeTrackStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSolo: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

let stopProjectionBridge: () => void;

/** The error a promise rejects with; a promise that resolves fails the spec. */
async function rejectionOf(pending: Promise<void>): Promise<unknown> {
    try {
        await pending;
    } catch (error) {
        return error;
    }
    throw new Error('Expected the action to reject');
}

function storedTracks() {
    flushAutomergeStorageWrites();
    return structuredClone(getCrdtDoc<{ tracks: { tracks: unknown[] } }>('root')?.tracks.tracks);
}

/**
 * Admits the action when it is captured and refuses it at commit, the one point between:
 * the admission check before execute reads the brief once and the commit validator reads
 * it again.
 */
function refuseTheCommit(): void {
    productionBriefAdmissionPort.setGuard(() => {
        let reads = 0;
        return { allowsCurrent: () => reads++ === 0 };
    });
}

/** Registers the real Arrangement handlers, spying through on the inverses a refused action can replay. */
function registerObservingHandlers() {
    const handlers = getArrangementHandlers();
    const restoredPlans = vi.spyOn(handlers.restoreTimeOperationState, 'execute');
    const discardedTracks = vi.spyOn(handlers.discardCreatedTracks, 'execute');
    registerHandlerMap(handlers);
    return { restoredPlans, discardedTracks };
}

describe('a single action aborted after it learned its inverse', () => {
    beforeEach(() => {
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('single action abort compensation');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        setArrangementEventBus(new NoopArrangementEventBus());
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setTimeOperationDependencies({
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore,
            prepareTimelineMapTimeOperation,
            prepareTimelineMapStateRestore,
        });
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    kind: 'audio',
                    clips: [
                        ClipDummy.create({
                            id: 'source',
                            trackId: 'track-1',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 10,
                            audioBufferId: 'source-buffer',
                        }),
                    ],
                }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        trackTemplateCache.templates = [
            {
                id: 'tmpl-lead',
                name: 'Lead',
                category: 'user',
                trackKind: 'audio',
                devices: [],
                sends: [],
                gain: 0.8,
                pan: 0,
                color: '#123456',
                createdAt: 0,
            },
        ];
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        trackTemplateCache.templates = null;
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it.each([
        ['deleteTime', { type: 'deleteTime', payload: { startBeat: 3, endBeat: 5 } }],
        ['insertTime', { type: 'insertTime', payload: { atBeat: 3, durationBeats: 2 } }],
    ] as const)(
        'replays the real restore plan of a refused %s and reports a conflict, leaving the project as it was',
        async (_type, action) => {
            const { restoredPlans } = registerObservingHandlers();
            const before = storedTracks();
            refuseTheCommit();

            expect(isAppActionConflictError(await rejectionOf(executeAppAction(action)))).toBe(true);

            expect(restoredPlans).toHaveBeenCalledTimes(1);
            expect(restoredPlans.mock.calls[0]?.[0].payload.plan).toHaveProperty('version', 1);
            expect(storedTracks()).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(0);
        }
    );

    it('discards the tracks a refused loadTrackTemplate created, as the batch does', async () => {
        const { discardedTracks } = registerObservingHandlers();
        const before = storedTracks();
        refuseTheCommit();

        const failure = await rejectionOf(
            executeAppAction({ type: 'loadTrackTemplate', payload: { templateId: 'tmpl-lead' } })
        );

        expect(isAppActionConflictError(failure)).toBe(true);

        expect(discardedTracks).toHaveBeenCalledTimes(1);
        expect(discardedTracks.mock.calls[0]?.[0].payload.trackIds).toHaveLength(1);
        expect(storedTracks()).toEqual(before);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('replays nothing when the actions commit', async () => {
        const { restoredPlans, discardedTracks } = registerObservingHandlers();

        await executeAppAction({ type: 'deleteTime', payload: { startBeat: 3, endBeat: 5 } });
        await executeAppAction({ type: 'loadTrackTemplate', payload: { templateId: 'tmpl-lead' } });

        expect(restoredPlans).not.toHaveBeenCalled();
        expect(discardedTracks).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(2);
    });
});
