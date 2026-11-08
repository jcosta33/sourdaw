import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { automationStore, type AutomationStoreState } from '../../../stores/automationStore';
import { getAutomationHandlers } from '../../getAutomationHandlers';
import { isRecordingAutomation } from '../isRecordingAutomation';
import { recordAutomationValue } from '../recordAutomationValue';
import { setAutomationRecordingDependencies } from '../recordingDependencies';
import { releaseTouchAutomation } from '../releaseTouchAutomation';
import { startAutomationRecording } from '../startAutomationRecording';
import { stopAutomationRecording } from '../stopAutomationRecording';

type Root = {
    automation: AutomationStoreState;
    tracks: Pick<TrackStoreState, 'tracks'>;
};

function root() {
    const document = getCrdtDoc<Root>('root');
    if (!document) {
        throw new Error('Expected the real recording project');
    }
    return document;
}

function points(pairs: readonly (readonly [number, number])[]): AutomationPoint[] {
    return pairs.map(([beat, value]) => ({ beat, value, curve: 'linear', tension: 0 }));
}

const baseline = points([
    [0, 0.11],
    [1.25, 0.22],
    [4, 0.44],
    [7.5, 0.66],
    [12, 0.77],
]);
const touched = points([
    [0, 0.11],
    [1.25, 0.22],
    [1.5, 0.8],
    [2.5, 0.2],
    [3.5, 0.8],
    [4, 0.44],
    [7.5, 0.66],
    [12, 0.77],
]);
const rideLane: AutomationLane = {
    id: 'recorded-gain',
    trackId: 'recording-track',
    parameterId: 'gain',
    parameterName: 'Gain',
    points: baseline,
    objects: [],
    visible: true,
    enabled: true,
    collapsed: false,
    minValue: 0,
    maxValue: 1,
};
const keeperLane: AutomationLane = {
    id: 'keeper-pan',
    trackId: 'keeper-track',
    parameterId: 'pan',
    parameterName: 'Pan',
    points: [
        { id: 'keeper-start', beat: 0, value: -0.65, curve: 'step', tension: 0 },
        { id: 'keeper-end', beat: 9.5, value: 0.3, curve: 'linear', tension: 0.4 },
    ],
    objects: [],
    visible: true,
    enabled: true,
    collapsed: true,
    minValue: -1,
    maxValue: 1,
    color: '#aabbcc',
};

function expectLanes(recordedPoints: AutomationPoint[], keeperEnabled: boolean): void {
    flushAutomergeStorageWrites();
    const expected = {
        lanes: [
            { ...structuredClone(rideLane), points: recordedPoints },
            { ...structuredClone(keeperLane), enabled: keeperEnabled },
        ],
    };
    expect(root().automation).toStrictEqual(expected);
    expect(automationStore.value).toStrictEqual(expected);
}

const cases = [
    {
        mode: 'write',
        release: false,
        committed: points([
            [0, 0.11],
            [1.5, 0.8],
            [2.5, 0.2],
            [3.5, 0.8],
            [7.5, 0.8],
            [12, 0.77],
        ]),
    },
    {
        mode: 'latch',
        release: false,
        committed: points([
            [0, 0.11],
            [1.25, 0.22],
            [1.5, 0.8],
            [2.5, 0.2],
            [3.5, 0.8],
            [7.5, 0.8],
            [12, 0.77],
        ]),
    },
    { mode: 'touch', release: true, committed: touched },
] as const;

describe('recorded automation ride project authority and callback history', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recorded ride authority');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearActionHistory();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const context = new AudioContext({ sampleRate: 48_000 });
        Object.defineProperties(context, {
            baseLatency: { value: 0.0625 },
            outputLatency: { value: 0.0625 },
        });
        // At 48 kHz, 3,000 + 3,000 hardware and 6,000 track frames are
        // 0.25 seconds: exactly 0.5 beat at this fixture's flat 120 BPM.
        setAutomationRecordingDependencies({
            getAudioContext: () => context,
            getCompensationDelay: () => 0.125,
        });
    });

    afterEach(() => {
        stopAutomationRecording();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(cases)(
        '$mode ride survives real Undo/Redo while preserving other edits',
        async ({ mode, release, committed }) => {
            const track = createTrack({
                id: 'recording-track',
                name: 'Ride',
                kind: 'audio',
                withoutDefaultDevice: true,
            });
            const keeper = createTrack({
                id: 'keeper-track',
                name: 'Keeper',
                kind: 'audio',
                withoutDefaultDevice: true,
            });
            trackStore.set({
                tracks: [{ ...track, automationMode: mode }, keeper],
                selectedTrackId: track.id,
                ghostClips: [],
            });
            automationStore.set({ lanes: structuredClone([rideLane, keeperLane]) });
            transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 1 });
            flushAutomergeStorageWrites();
            const priorEdit = {
                type: 'renameTrack',
                payload: { trackId: 'keeper-track', name: 'Keeper renamed', expectedName: 'Keeper' },
            } satisfies AppAction;
            await executeAppAction(priorEdit);
            expect(undoHistoryStore.value?.past).toHaveLength(1);

            startAutomationRecording();
            recordAutomationValue('recording-track', 'gain', 0.8, 2);
            recordAutomationValue('recording-track', 'gain', 0.2, 3);
            recordAutomationValue('recording-track', 'gain', 0.8, 4);
            expect(isRecordingAutomation('recording-track', 'gain')).toBe(true);
            if (release) {
                releaseTouchAutomation('recording-track', 'gain');
                expect(isRecordingAutomation('recording-track', 'gain')).toBe(false);
                // Touch has already written before stop must capture its undo entry.
                expectLanes(touched, true);
            } else {
                expectLanes(baseline, true);
            }
            expect(undoHistoryStore.value?.past).toHaveLength(1);

            const previousEntryIds = (undoHistoryStore.value?.past ?? []).map((entry) => entry.id);
            expect(previousEntryIds).toHaveLength(1);
            const previousMetadata = structuredClone(actionHistoryStore.value);
            const projectedTracks = structuredClone(trackStore.value);
            const rawTracks = structuredClone(root().tracks);
            expect(projectedTracks?.tracks[1]?.name).toBe('Keeper renamed');
            expect(root().tracks.tracks[1]?.name).toBe('Keeper renamed');

            stopAutomationRecording(8);

            expectLanes(committed, true);
            expect(isRecordingAutomation('recording-track', 'gain')).toBe(false);
            const recordedEntry = undoHistoryStore.value?.past.at(-1);
            expect(recordedEntry).toMatchObject({ kind: 'callback', label: 'Record Automation' });
            expect(undoHistoryStore.value?.past.map((entry) => entry.kind)).toEqual(['action', 'callback']);
            // Recording owns a local callback entry, not durable semantic action metadata.
            expect(actionHistoryStore.value).toStrictEqual(previousMetadata);

            // A later real write must survive the callback's captured before/after
            // snapshots. Decline its history so the next Undo still targets the ride.
            const keeperEdit = {
                type: 'setAutomationLaneEnabled',
                payload: { laneId: 'keeper-pan', enabled: false },
            } satisfies AppAction;
            await executeAppAction(keeperEdit, { skipUndo: true });
            expectLanes(committed, false);
            expect(undoHistoryStore.value?.past.at(-1)?.id).toBe(recordedEntry?.id);

            await undo();

            expectLanes(baseline, false);
            expect(undoHistoryStore.value?.past.map((entry) => entry.id)).toEqual(previousEntryIds);
            expect(undoHistoryStore.value?.future.map((entry) => entry.id)).toEqual([recordedEntry?.id]);
            expect(trackStore.value).toStrictEqual(projectedTracks);
            expect(root().tracks).toStrictEqual(rawTracks);

            await redo();

            expectLanes(committed, false);
            expect(undoHistoryStore.value?.past.map((entry) => entry.id)).toEqual([
                ...previousEntryIds,
                recordedEntry?.id,
            ]);
            expect(undoHistoryStore.value?.future).toEqual([]);
            expect(trackStore.value).toStrictEqual(projectedTracks);
            expect(root().tracks).toStrictEqual(rawTracks);
            expect(actionHistoryStore.value).toStrictEqual(previousMetadata);
        }
    );
});
