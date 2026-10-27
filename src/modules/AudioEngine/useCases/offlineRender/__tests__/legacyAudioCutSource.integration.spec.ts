import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, gainEnvelopeStore, takeLaneStore, trackStore, warpStateStore } from '#/modules/Arrangement/stores';
import {
    deleteTimeRange,
    getArrangementHandlers,
    normalizeTrack,
    setTimeOperationDependencies,
} from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    getAutomationHandlers,
    isValidAutomationTimeStateRestorePlan,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, undoHistoryStore as undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
    registerProductionCommandHandlers,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    replaceCrdtDocInLineage,
    setupProjectionBridge,
    getDrumPreviewBranchHandlers,
} from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import {
    getMidiNoteTransformHandlers,
    isValidMidiTimeStateRestorePlan,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
} from '#/modules/MIDI/useCases';
import { readSecondsAtBeat, readTempoAtBeat, tempoMapStore } from '#/modules/Transport/stores';
import {
    getTransportHandlers,
    isValidTimelineMapStateRestorePlan,
    prepareTimelineMapStateRestore,
    prepareTimelineMapTimeOperation,
} from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';

import { projectOfflineAudioClipPlaybacks } from '../projectOfflineAudioClipPlaybacks';

type Project = { tracks: NonNullable<typeof trackStore.value> };
let stopProjectionBridge: () => void;
function hydrateProductionContracts(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers([
        getArrangementHandlers(),
        getAudioRenderingHandlers(),
        getAutomationHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
        getMidiNoteTransformHandlers(),
        getTransportHandlers(),
        getYeastHandlers(),
    ]);
}
function clips(): Clip[] {
    return trackStore.value?.tracks[0]?.clips ?? [];
}
function sourceRead(clip: Clip, beat: number) {
    return projectOfflineAudioClipPlaybacks({
        clip,
        bufferDurationSeconds: 30,
        regionStartBeat: beat,
        regionStartSec: readSecondsAtBeat({ beat }),
        durationSeconds: 20,
        compensationDelay: 0,
        projectBeatToSeconds: (at) => readSecondsAtBeat({ beat: at }),
        resolveTempoAtBeat: (at) => readTempoAtBeat({ beat: at }),
    })[0]!;
}
function reopen(): void {
    const document = getCrdtDoc<Project>('root')!;
    replaceCrdtDocInLineage({ id: 'root', doc: Automerge.load<Project>(Automerge.save(document)) });
    projectCrdtToStores({ resetProjections: true });
    hydrateProductionContracts();
}
async function waitForSaved(stack: 'past' | 'future'): Promise<void> {
    await vi.waitFor(() => {
        const saved = JSON.parse(sessionStorage.getItem('sourdaw-undo-session')!) as Record<string, unknown[]>;
        expect(saved[stack]).toHaveLength(1);
    });
}
describe('legacy audio cut source seconds through Command and saved CRDT replay', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('legacy cut physical source');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        hydrateProductionContracts();
        setTimeOperationDependencies({
            savedRestorePlanValidators: {
                automation: isValidAutomationTimeStateRestorePlan,
                midi: isValidMidiTimeStateRestorePlan,
                timelineMap: isValidTimelineMapStateRestorePlan,
            },
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
        ['selected', 'spanning', 0, 0, 1, 3, 7],
        ['global', 'spanning', 0, 0, 1, 3, 7],
        ['selected', 'right survivor', 2, 0, 1, 2, 6],
        ['global', 'right survivor', 2, 0, 1, 2, 6],
        ['selected', 'stretched signed pre-roll', 0, -1, 2, 5.5, 13.5],
        ['global', 'stretched signed pre-roll', 0, -1, 2, 5.5, 13.5],
        ['selected', 'finite loop', 0, 2, 1, 1, 5],
        ['global', 'finite loop', 0, 2, 1, 1, 5],
        ['selected', 'implicit loop', 0, 2, 1, 4, 8],
        ['global', 'implicit loop', 0, 2, 1, 4, 8],
    ] as const)(
        '%s %s preserves physical source seconds through deletion and Undo/Redo',
        async (route, effect, startBeat, offset, ratio, entrySeconds, endSeconds) => {
            const original: Clip = {
                id: 'source',
                trackId: 'track-1',
                name: 'Legacy recording',
                type: 'audio',
                startBeat,
                endBeat: 8,
                audioBufferId: 'source-buffer',
                audioOffsetBeats: offset,
                stretchMode: 'timestretch',
                stretchRatio: ratio,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#000',
                locked: false,
                muted: false,
            };
            if (effect.includes('loop')) {
                original.loopEnabled = true;
                original.loopOriginBeat = 0;
                if (effect === 'finite loop') {
                    original.loopLength = 4;
                }
            }
            trackStore.set({
                tracks: [normalizeTrack({ id: 'track-1', name: 'Audio', kind: 'audio', clips: [original] })],
                selectedTrackId: 'track-1',
                ghostClips: [],
            });
            takeLaneStore.set({ lanes: [] });
            midiStore.set(defaultMidiStoreState);
            automationStore.set({ lanes: [] });
            gainEnvelopeStore.set({ envelopes: {} });
            warpStateStore.set({ states: {} });
            tempoMapStore.set({
                changes: [
                    { id: 'base', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'slow', beat: 2, tempo: 60, curve: 'instant' },
                ],
            });
            flushAutomergeStorageWrites();
            expect(Object.hasOwn(clips()[0]!, 'audioOffsetSeconds')).toBe(false);
            const before = sourceRead(clips()[0]!, 4);
            // Integrate the old map before applying the source-rate and signed entry.
            expect(before.bufferOffsetSec).toBe(entrySeconds);
            expect(before.bufferOffsetSec + before.playDuration * before.playbackRate).toBe(endSeconds);
            if (route === 'selected') {
                deleteTimeRange(1, 4, ['track-1']);
                flushAutomergeStorageWrites();
            } else {
                await executeAppAction({ type: 'deleteTime', payload: { startBeat: 1, endBeat: 4 } });
            }
            expect(undoStore.value?.past).toHaveLength(1);
            const deleted = structuredClone(clips());
            const right = deleted.at(-1)!;
            expect(right.startBeat).toBe(route === 'selected' ? 4 : 1);
            if (effect.includes('loop')) {
                expect(right.loopLength).toBe(effect === 'finite loop' ? 4 : 8);
                expect(right.audioLoopStartSeconds).toBe(1);
                expect(right.audioLoopPassEntrySeconds).toBe(1);
                expect(right.audioLoopPassOriginBeat).toBe(route === 'selected' ? 0 : -3);
            }
            const after = sourceRead(right, right.startBeat);
            expect(after.bufferOffsetSec).toBe(entrySeconds);
            expect(after.bufferOffsetSec * 48000).toBe(entrySeconds * 48000);
            expect(after.bufferOffsetSec + after.playDuration * after.playbackRate).toBe(endSeconds);
            expect(getCrdtDoc<Project>('root')?.tracks.tracks[0]?.clips).toEqual(deleted);
            // #5126 owns persistence of the selected UI route's callback history.
            // Its live callbacks must still restore legacy field absence exactly.
            if (route === 'global') {
                await waitForSaved('past');
                reopen();
            }
            expect(sourceRead(clips().at(-1)!, right.startBeat).bufferOffsetSec).toBe(entrySeconds);
            expect((await undo()).headConsumed).toBe(true);
            expect(clips()).toEqual([original]);
            expect(Object.hasOwn(clips()[0]!, 'audioOffsetSeconds')).toBe(false);
            expect(sourceRead(clips()[0]!, 4).bufferOffsetSec).toBe(entrySeconds);
            if (route === 'global') {
                await waitForSaved('future');
                reopen();
            }
            await redo();
            expect(clips()).toEqual(deleted);
            expect(sourceRead(clips().at(-1)!, right.startBeat).bufferOffsetSec).toBe(entrySeconds);
            expect(getCrdtDoc<Project>('root')?.tracks.tracks[0]?.clips).toEqual(deleted);
            reopen();
            expect(clips()).toEqual(deleted);
            expect(sourceRead(clips().at(-1)!, right.startBeat).bufferOffsetSec).toBe(entrySeconds);
        }
    );
});
