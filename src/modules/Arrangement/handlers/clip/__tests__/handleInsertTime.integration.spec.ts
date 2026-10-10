import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { prepareAutomationTimeOperation, prepareAutomationTimeStateRestore } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { prepareMidiGlobalTimeTransaction, prepareMidiTimeStateRestore } from '#/modules/MIDI/useCases';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';
import { prepareTimelineMapStateRestore, prepareTimelineMapTimeOperation } from '#/modules/Transport/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { markerStore } from '../../../stores/markerStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { setTimeOperationDependencies } from '../../../useCases/timeOperations/timeOperationDependencies';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const AT_BEAT = 8;
const DURATION_BEATS = 4;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

let stopProjectionBridge: () => void;

function arrangeMaterialAt(beat: number): void {
    trackStore.set({
        tracks: [
            TrackDummy.create({
                id: 'track-1',
                kind: 'midi',
                clips: [
                    ClipDummy.create({ id: 'clip', trackId: 'track-1', type: 'midi', startBeat: beat, endBeat: 16 }),
                ],
            }),
        ],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    markerStore.set({ markers: [{ id: 'marker', beat, name: 'Verse', color: '#ffffff' }], sections: [] });
    tempoMapStore.set({
        changes: [
            { id: 'tempo-start', beat: 0, tempo: 120, curve: 'instant' },
            { id: 'tempo', beat, tempo: 90, curve: 'instant' },
        ],
    });
    timeSignatureMapStore.set({
        changes: [
            { id: 'meter-start', beat: 0, numerator: 4, denominator: 4 },
            { id: 'meter', beat, numerator: 3, denominator: 4 },
        ],
    });
    flushAutomergeStorageWrites();
}

function beatOf(changes: readonly { id: string; beat: number }[] | undefined, id: string): number | undefined {
    return changes?.find((change) => change.id === id)?.beat;
}

describe('Insert Time moves each tempo and meter change with the material on its beat', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('insert time map integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
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
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        setTimeOperationDependencies(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it.each([
        { name: 'a float step before the insert point', beat: AT_BEAT - 5e-7, expected: AT_BEAT - 5e-7 },
        { name: 'on the insert point', beat: AT_BEAT, expected: AT_BEAT + DURATION_BEATS },
        {
            name: 'a float step after the insert point',
            beat: AT_BEAT + 5e-7,
            expected: AT_BEAT + 5e-7 + DURATION_BEATS,
        },
    ])('keeps a change $name on the beat of its clip and marker', async ({ beat, expected }) => {
        arrangeMaterialAt(beat);

        await executeAppAction({ type: 'insertTime', payload: { atBeat: AT_BEAT, durationBeats: DURATION_BEATS } });

        const clipStart = trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === 'clip')?.startBeat;
        expect(clipStart).toBe(expected);
        expect(beatOf(markerStore.value?.markers, 'marker')).toBe(expected);
        expect(beatOf(tempoMapStore.value?.changes, 'tempo')).toBe(expected);
        expect(beatOf(timeSignatureMapStore.value?.changes, 'meter')).toBe(expected);
    });
});
