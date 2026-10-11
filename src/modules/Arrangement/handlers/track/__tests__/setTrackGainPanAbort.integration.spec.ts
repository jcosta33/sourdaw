import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

/**
 * The fader and pan knob write the audio engine the moment the handler runs,
 * before the document commits. When that commit is then refused, the document
 * rolls back with the transaction and only the abort compensation puts the
 * engine back, so a single action must replay the same inverse a batch does.
 *
 * Everything but the two engine setters is real: the Arrangement handler map,
 * `executeAppAction`, a real Automerge document and the real undo stack.
 */

const engineCalls = vi.hoisted(() => ({
    gain: [] as [string, number][],
    pan: [] as [string, number][],
    afterWrite: null as (() => void) | null,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: (trackId: string, gain: number) => {
        engineCalls.gain.push([trackId, gain]);
        engineCalls.afterWrite?.();
    },
    setTrackPan: (trackId: string, pan: number) => {
        engineCalls.pan.push([trackId, pan]);
        engineCalls.afterWrite?.();
    },
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const TRACK_ID = 'audio-1';
const REPAIR_REQUIRED_MESSAGE = 'Project repair is required before project actions can execute';

function storedTrack() {
    return trackStore.value?.tracks.find((track) => track.id === TRACK_ID);
}

function undoDepth(): number {
    return undoStore.value?.past.length ?? 0;
}

/** Refuses the commit once, right after the handler's first engine write. */
function refuseCommitAfterEngineWrite(): void {
    engineCalls.afterWrite = () => {
        if (agentProjectRepairStateStore.value !== null) {
            return;
        }
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
    };
}

describe('a single fader or pan action whose commit is refused after the engine write', () => {
    beforeEach(() => {
        engineCalls.gain.length = 0;
        engineCalls.pan.length = 0;
        engineCalls.afterWrite = null;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('track gain pan abort');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, name: 'Guitar', kind: 'audio', gain: 0.8, pan: 10 })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
    });

    afterEach(() => {
        engineCalls.afterWrite = null;
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        agentProjectRepairStateStore.set(null);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('puts the engine back to the stored gain', async () => {
        const before = undoDepth();
        refuseCommitAfterEngineWrite();

        await expect(
            executeAppAction({ type: 'setTrackGain', payload: { trackId: TRACK_ID, gain: 0.5, expectedGain: 0.8 } })
        ).rejects.toThrow(REPAIR_REQUIRED_MESSAGE);

        expect(engineCalls.gain).toEqual([
            [TRACK_ID, 0.5],
            [TRACK_ID, 0.8],
        ]);
        expect(storedTrack()?.gain).toBe(0.8);
        expect(undoDepth()).toBe(before);
    });

    it('puts the engine back to the stored pan', async () => {
        const before = undoDepth();
        refuseCommitAfterEngineWrite();

        await expect(
            executeAppAction({ type: 'setTrackPan', payload: { trackId: TRACK_ID, pan: -20, expectedPan: 10 } })
        ).rejects.toThrow(REPAIR_REQUIRED_MESSAGE);

        expect(engineCalls.pan).toEqual([
            [TRACK_ID, -20],
            [TRACK_ID, 10],
        ]);
        expect(storedTrack()?.pan).toBe(10);
        expect(undoDepth()).toBe(before);
    });

    it('leaves the engine on the new gain and pan when the commit is not refused', async () => {
        await executeAppAction({
            type: 'setTrackGain',
            payload: { trackId: TRACK_ID, gain: 0.5, expectedGain: 0.8 },
        });
        await executeAppAction({ type: 'setTrackPan', payload: { trackId: TRACK_ID, pan: -20, expectedPan: 10 } });

        expect(engineCalls.gain).toEqual([[TRACK_ID, 0.5]]);
        expect(engineCalls.pan).toEqual([[TRACK_ID, -20]]);
        expect(storedTrack()?.gain).toBe(0.5);
        expect(storedTrack()?.pan).toBe(-20);
    });
});
