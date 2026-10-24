import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../useCases/getArrangementHandlers';
import { runtimeGraphTopology } from '../../useCases/runtimeGraphTopology';

const notifyUserMock = vi.hoisted(() => vi.fn());
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notifyUserMock }));

const runtimeMocks = vi.hoisted(() => ({
    engineRemoveSend: vi.fn(),
    engineSetSend: vi.fn(),
    engineSetTrackGain: vi.fn(),
    engineSetTrackMute: vi.fn(),
    engineSetTrackSoloGate: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: runtimeMocks.engineSetTrackGain,
    setTrackMute: runtimeMocks.engineSetTrackMute,
    setTrackSoloGate: runtimeMocks.engineSetTrackSoloGate,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
    removeSend: runtimeMocks.engineRemoveSend,
    setSend: runtimeMocks.engineSetSend,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

const VOCALS_ID = 'track-vocals';
const REVERB_ID = 'bus-reverb';

function vocals() {
    return trackStore.value?.tracks.find((track) => track.id === VOCALS_ID);
}

function reverbSendLevel(): number | undefined {
    return vocals()?.sends.find((send) => send.busId === REVERB_ID)?.level;
}

function commitAgentBatch(actions: AppAction[]) {
    return executeAppActionBatch(actions, {
        source: 'prompt',
        groupId: 'agent-mix',
        groupLabel: 'Agent mix change',
        requireCompensation: true,
    });
}

/**
 * An agent's mixing proposal commits as an atomic batch that demands a guarded
 * compensation for every action, so a send or solo change it cannot undo
 * safely is refused before anything is written (#5554).
 */
describe('agent mixer batches with required compensation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureRuntimeGraphProjectRevisionValidator(
            (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
        );
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setArrangementEventBus(new NoopArrangementEventBus());
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const reverb = createTrack({ id: REVERB_ID, name: 'Reverb', kind: 'bus' });
        const vocalTrack = {
            ...createTrack({ id: VOCALS_ID, name: 'Vocals', kind: 'audio' }),
            sends: [{ busId: REVERB_ID, level: 0.25, preFader: false }],
        };
        trackStore.set({ tracks: [vocalTrack, reverb], selectedTrackId: VOCALS_ID, ghostClips: [] });
    });

    afterEach(() => {
        configureRuntimeGraphProjectRevisionValidator(null);
        configureRuntimeGraphTopologyValidator(null);
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits a send level change and undoes it back to the prior level', async () => {
        const result = await commitAgentBatch([
            { type: 'setSend', payload: { trackId: VOCALS_ID, busId: REVERB_ID, level: 0.5 } },
        ]);

        expect(result).toMatchObject({ status: 'committed' });
        expect(reverbSendLevel()).toBe(0.5);

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(reverbSendLevel()).toBe(0.25);
    });

    it('commits a solo change and undoes it back to the prior solo state', async () => {
        const result = await commitAgentBatch([
            { type: 'soloTrack', payload: { trackId: VOCALS_ID, soloed: true, expectedSoloed: false } },
        ]);

        expect(result).toMatchObject({ status: 'committed' });
        expect(vocals()?.soloed).toBe(true);

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(vocals()?.soloed).toBe(false);
    });

    it('turns undo into a conflict after a later send edit, leaving the whole group applied', async () => {
        await commitAgentBatch([
            { type: 'setSend', payload: { trackId: VOCALS_ID, busId: REVERB_ID, level: 0.5 } },
            { type: 'soloTrack', payload: { trackId: VOCALS_ID, soloed: true, expectedSoloed: false } },
        ]);
        // Someone else moves the send after the agent did; that write carries no
        // undo entry of its own, so the agent group stays at the head.
        await executeAppAction(
            { type: 'setSend', payload: { trackId: VOCALS_ID, busId: REVERB_ID, level: 0.8 } },
            { skipUndo: true }
        );

        await expect(undo()).resolves.toEqual({ headConsumed: false });
        expect(notifyUserMock).toHaveBeenCalledWith(
            'Cannot undo "Agent mix change": project state has changed',
            'warning'
        );

        // Neither the send restore nor the solo restore lands on its own.
        expect(reverbSendLevel()).toBe(0.8);
        expect(vocals()?.soloed).toBe(true);
    });

    it('turns undo into a conflict after a later solo edit, leaving the whole group applied', async () => {
        await commitAgentBatch([
            { type: 'setSend', payload: { trackId: VOCALS_ID, busId: REVERB_ID, level: 0.5 } },
            { type: 'soloTrack', payload: { trackId: VOCALS_ID, soloed: true, expectedSoloed: false } },
        ]);
        await executeAppAction(
            { type: 'soloTrack', payload: { trackId: VOCALS_ID, soloed: false, expectedSoloed: true } },
            { skipUndo: true }
        );

        await expect(undo()).resolves.toEqual({ headConsumed: false });
        expect(notifyUserMock).toHaveBeenCalledWith(
            'Cannot undo "Agent mix change": project state has changed',
            'warning'
        );

        expect(reverbSendLevel()).toBe(0.5);
        expect(vocals()?.soloed).toBe(false);
    });

    it('guards the solo inverse even when the forward change states no expected solo state', async () => {
        const result = await commitAgentBatch([{ type: 'soloTrack', payload: { trackId: VOCALS_ID, soloed: true } }]);

        expect(result).toMatchObject({ status: 'committed' });
        expect(vocals()?.soloed).toBe(true);

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(vocals()?.soloed).toBe(false);
    });
});
