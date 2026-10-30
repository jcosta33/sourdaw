import { getHeads } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    getAutomationHandlers,
    isValidAutomationTimeStateRestorePlan,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    hasForeignPendingProjectWrites,
    markActionHistoryEntryReverted,
    projectCrdtToStores,
    recordActionHistoryEntries,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    getMidiNoteTransformHandlers,
    isValidMidiTimeStateRestorePlan,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
} from '#/modules/MIDI/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import {
    getTransportHandlers,
    isValidTimelineMapStateRestorePlan,
    prepareTimelineMapStateRestore,
    prepareTimelineMapTimeOperation,
} from '#/modules/Transport/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { setTimeOperationDependencies } from '../../../useCases/timeOperations/timeOperationDependencies';

type SourceOwners = {
    tracks: NonNullable<typeof trackStore.value>['tracks'];
    takeLanes: NonNullable<typeof takeLaneStore.value>;
    midi: NonNullable<typeof midiStore.value>;
    automation: NonNullable<typeof automationStore.value>;
};

type SourceDocument = Omit<SourceOwners, 'tracks'> & {
    tracks: { tracks: SourceOwners['tracks'] };
};

function sourceOwners(): SourceOwners {
    const raw = getCrdtDoc<SourceDocument>('root');
    if (!raw || !trackStore.value || !takeLaneStore.value || !midiStore.value || !automationStore.value) {
        throw new Error('Expected the registered clip edit owners');
    }
    const projected = {
        tracks: trackStore.value.tracks,
        takeLanes: takeLaneStore.value,
        midi: midiStore.value,
        automation: automationStore.value,
    };
    expect({ tracks: raw.tracks.tracks, takeLanes: raw.takeLanes, midi: raw.midi, automation: raw.automation }).toEqual(
        projected
    );
    return structuredClone(projected);
}

function sourceBuffer(): AudioBuffer {
    const sampleRate = 48_000;
    // The preceding sample owns this crossing, so the admitted cut is beside
    // the retained Delete Time source-tile boundary rather than exactly on it.
    const samples = Float32Array.from(
        { length: sampleRate * 4 },
        (_, sample) => (Math.sin((sample * 440 * Math.PI * 2) / sampleRate + 0.0001) * 12_000) / 32768
    );
    return {
        getChannelData: () => samples,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate,
        duration: samples.length / sampleRate,
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
    };
}

describe('completed command metadata and audio source admission', () => {
    let stopProjectionBridge: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('completed command metadata source admission');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setNotificationEventBus(createEventBus());
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        actionHistoryStore.set({ entries: [] });
        const clip = ClipDummy.create({
            id: 'source-clip',
            trackId: 'source-track',
            endBeat: 8,
            audioBufferId: 'source-buffer',
            audioOffsetSeconds: 0,
            audioUnwrappedOffsetSeconds: 0,
        });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'source-track', clips: [clip] })],
            selectedTrackId: null,
            ghostClips: [],
        });
        const take = { ...createTake(clip.id, 'Take 1', 0, 8), id: 'source-take' };
        takeLaneStore.set({
            lanes: [
                {
                    ...createTakeLane('source-track'),
                    id: 'source-lane',
                    takes: [take],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: take.id }],
                },
            ],
        });
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: true });
        flushAutomergeStorageWrites();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores({ resetProjections: true });
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
        // Match bootstrap: the metadata producer is part of the real command path.
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            recordBatch: recordActionHistoryEntries,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
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
        vi.spyOn(audioBufferCache, 'get').mockReturnValue(sourceBuffer());
    });

    afterEach(() => {
        stopProjectionBridge();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearHandlerRegistry();
        setTimeOperationDependencies(null);
        clearUndoHistory();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
        Container.clear();
    });

    async function deleteMiddle() {
        await executeAppAction({ type: 'deleteTime', payload: { startBeat: 2, endBeat: 4 } });
        const clips = trackStore.value?.tracks[0]?.clips;
        if (!clips || clips.length !== 2 || !clips[0] || !clips[1]) {
            throw new Error('Delete Time must produce the two actual source fragments');
        }
        expect(clips.map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [0, 2],
            [2, 6],
        ]);
        expect(takeLaneStore.value?.lanes[0]?.baseGapAudioSources).toEqual([
            expect.objectContaining({ clipId: clips[1].id, startBeat: 2, endBeat: 6 }),
        ]);
        return { firstId: clips[0].id, secondId: clips[1].id };
    }

    it('replays a registered grouped ripple removal and adjacent-sample split with exact raw and projected owners', async () => {
        const { firstId, secondId } = await deleteMiddle();
        const before = sourceOwners();
        const committed: string[] = [];
        const group = { source: 'manual' as const, groupId: 'remove-then-split' };
        await executeAppAction(
            { type: 'removeClip', payload: { clipId: firstId } },
            { ...group, onCommitted: () => committed.push('removeClip') }
        );
        expect(hasForeignPendingProjectWrites()).toBe(false);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(trackStore.value?.tracks[0]?.clips).toMatchObject([{ id: secondId, startBeat: 0, endBeat: 4 }]);
        await executeAppAction(
            { type: 'splitClip', payload: { clipId: secondId, beat: 2 } },
            { ...group, onCommitted: () => committed.push('splitClip') }
        );
        expect(committed).toEqual(['removeClip', 'splitClip']);
        const changed = sourceOwners();
        expect(changed.tracks[0]?.clips[0]?.endBeat).toBeCloseTo(2 - 2 / 48_000, 12);
        expect(changed.tracks[0]?.clips).toHaveLength(2);
        expect(undoHistoryStore.value?.past.slice(-2).map((entry) => entry.groupId)).toEqual([
            group.groupId,
            group.groupId,
        ]);
        for (let cycle = 0; cycle < 2; cycle += 1) {
            expect((await undo()).headConsumed).toBe(true);
            expect(sourceOwners()).toEqual(before);
            await redo();
            expect(sourceOwners()).toEqual(changed);
            expect(hasForeignPendingProjectWrites()).toBe(false);
        }
    });

    it('settles only metadata while a genuine foreign source write remains unpublished and blocks the split', async () => {
        const { secondId } = await deleteMiddle();
        const original = sourceOwners();
        const foreign = runWithAutomergeStorageTransaction(undefined, () => {
            takeLaneStore.set({
                lanes: original.takeLanes.lanes.map((lane) => ({
                    ...lane,
                    takes: lane.takes.map((take) => ({ ...take, sourceOffsetSeconds: 0.5 })),
                })),
            });
        });
        try {
            recordActionHistoryEntry({
                id: 'metadata-beside-foreign-source',
                label: 'Completed command',
                actionKind: 'removeClip',
                source: 'manual',
                timestamp: 10,
                reverted: false,
            });
            expect(getCrdtDoc<SourceDocument>('root')?.takeLanes).toEqual(original.takeLanes);
            expect(countPendingAutomergeStorageWrites()).toBe(1);
            expect(hasForeignPendingProjectWrites()).toBe(true);
            const raw = structuredClone(getCrdtDoc('root'));
            const heads = getHeads(getCrdtDoc('root')!);
            const history = structuredClone(undoHistoryStore.value);
            await expect(
                executeAppAction({ type: 'splitClip', payload: { clipId: secondId, beat: 4 } })
            ).rejects.toThrow('Action conflicts with current project state: splitClip');
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(getHeads(getCrdtDoc('root')!)).toEqual(heads);
            expect(undoHistoryStore.value).toEqual(history);
            expect(countPendingAutomergeStorageWrites()).toBe(1);
            expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(0.5);
        } finally {
            foreign.abort();
        }
        expect(sourceOwners()).toEqual(original);
    });

    it('keeps unscoped foreign audio source writes pending while completed metadata settles', async () => {
        const { secondId } = await deleteMiddle();
        const original = sourceOwners();
        const deferredFrame = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
        const pendingTakeLanes = {
            lanes: original.takeLanes.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map((take) => ({ ...take, sourceOffsetSeconds: 0.5 })),
            })),
        };
        try {
            // This owner is unscoped: a global flush could publish it.
            takeLaneStore.set(pendingTakeLanes);
            expect(countPendingAutomergeStorageWrites()).toBe(1);
            expect(getCrdtDoc<SourceDocument>('root')?.takeLanes).toEqual(original.takeLanes);
            const metadata = {
                id: 'metadata-beside-unscoped-source',
                label: 'Completed command',
                actionKind: 'removeClip',
                source: 'manual' as const,
                timestamp: 10,
                reverted: false,
            };
            recordActionHistoryEntry(metadata);
            const rawHistory = getCrdtDoc<{ actionHistory: NonNullable<typeof actionHistoryStore.value> }>(
                'root'
            )?.actionHistory;
            expect(rawHistory?.entries).toContainEqual(metadata);
            expect(rawHistory).toEqual(actionHistoryStore.value);
            expect(getCrdtDoc<SourceDocument>('root')?.takeLanes).toEqual(original.takeLanes);
            expect(takeLaneStore.value).toEqual(pendingTakeLanes);
            expect(countPendingAutomergeStorageWrites()).toBe(1);
            expect(hasForeignPendingProjectWrites()).toBe(true);
            const raw = structuredClone(getCrdtDoc('root'));
            const heads = getHeads(getCrdtDoc('root')!);
            const history = structuredClone(undoHistoryStore.value);
            await expect(
                executeAppAction({ type: 'splitClip', payload: { clipId: secondId, beat: 4 } })
            ).rejects.toThrow('Action conflicts with current project state: splitClip');
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(getHeads(getCrdtDoc('root')!)).toEqual(heads);
            expect(undoHistoryStore.value).toEqual(history);
            expect(takeLaneStore.value).toEqual(pendingTakeLanes);
            expect(countPendingAutomergeStorageWrites()).toBe(1);
        } finally {
            // Restore and settle only this test's deliberately buffered source value.
            takeLaneStore.set(original.takeLanes);
            flushAutomergeStorageWrites();
            deferredFrame.mockRestore();
        }
        expect(sourceOwners()).toEqual(original);
    });
});
