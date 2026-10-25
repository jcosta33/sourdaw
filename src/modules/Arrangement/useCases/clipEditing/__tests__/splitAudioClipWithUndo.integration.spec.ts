import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, undoHistoryStore, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    registerProductionCommandHandlers,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    projectCrdtToStores,
    replaceCrdtDocInLineage,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../getArrangementHandlers';
import { splitClipWithUndo } from '../splitClipWithUndo';
import { addClip } from '../../clip/addClip';
import { captureAudioSourceSnapshot } from '#/utils/audioSourceTime';

type NotificationEvents = { 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload };
const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function seedClip(canonical: boolean, period: number | undefined): Clip {
    const clip = ClipDummy.create({
        id: 'source',
        trackId: 'audio',
        name: 'Phrase',
        startBeat: 1,
        endBeat: 9,
        audioOffsetBeats: 1,
        loopEnabled: true,
        loopOriginBeat: 0,
        stretchMode: 'timestretch',
        stretchRatio: 2,
        ...(period === undefined ? {} : { loopLength: period }),
        ...(canonical
            ? {
                  audioOffsetSeconds: 0,
                  audioLoopStartSeconds: -0.25,
                  audioLoopPassEntrySeconds: 0.5,
                  audioLoopPassOriginBeat: 0.5,
              }
            : {}),
    });
    const track = TrackDummy.create({ id: 'audio', kind: 'audio', clips: [clip] });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    flushAutomergeStorageWrites();
    return structuredClone(trackStore.value!.tracks[0]!.clips[0]!);
}

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

function reopenSavedProject(): void {
    flushAutomergeStorageWrites();
    const doc = getCrdtDoc('root');
    if (!doc) throw new Error('Expected a project document to save');
    const loaded = Automerge.load(Automerge.save(doc));
    expect(loaded).toEqual(doc);
    replaceCrdtDocInLineage({ id: 'root', doc: loaded });
    projectCrdtToStores({ resetProjections: true });
    hydrateProductionContracts();
}

function seedComp(): void {
    seedClip(false, 4);
    takeLaneStore.set({
        lanes: [
            {
                id: 'lane',
                trackId: 'audio',
                takes: [
                    {
                        id: 'selected',
                        clipId: 'source',
                        name: 'Selected',
                        startBeat: 1,
                        endBeat: 9,
                        selected: false,
                        sourceOffsetBeats: 4,
                    },
                    {
                        id: 'unselected',
                        clipId: 'source',
                        name: 'Future pass',
                        startBeat: 1,
                        endBeat: 9,
                        selected: false,
                        sourceOffsetBeats: 4,
                        passAnchorSeconds: 2,
                        passDepthSeconds: 2,
                        passSourceEndSeconds: 6,
                    },
                ],
                activeCompRegions: [{ startBeat: 1.5, endBeat: 8.5, takeId: 'selected' }],
            },
        ],
    });
    flushAutomergeStorageWrites();
}

function expectDocumentClipParity(): void {
    flushAutomergeStorageWrites();
    expect(getCrdtDoc('root')?.tracks).toEqual({ tracks: trackStore.value!.tracks });
    expect(getCrdtDoc('root')?.takeLanes).toEqual(takeLaneStore.value);
}

describe('audio cut UI wrapper / typed Undo authority', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('audio cut UI wrapper');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        sessionStorage.removeItem('sourdaw-undo-session');
        hydrateProductionContracts();
        setNotificationEventBus(createEventBus<NotificationEvents>());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it.each([
        { canonical: false, period: undefined },
        { canonical: false, period: 4 },
        { canonical: true, period: undefined },
        { canonical: true, period: 4 },
    ])('restores every prior source key and loopLength shape for %j', async ({ canonical, period }) => {
        const before = seedClip(canonical, period);
        splitClipWithUndo(before.id, 2);
        await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(1));
        const entry = undoHistoryStore.value!.past[0]!;
        const split = structuredClone(trackStore.value!.tracks[0]!.clips);
        expect(split).toHaveLength(2);
        expect(split[0]?.loopLength).toBe(period ?? 8);
        expectDocumentClipParity();

        expect((await undo()).headConsumed).toBe(true);
        expect(trackStore.value!.tracks[0]!.clips).toEqual([before]);
        expectDocumentClipParity();
        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toEqual(split);
        expectDocumentClipParity();
        expect(entry.kind).toBe('action');
        if (entry.kind !== 'action') throw new Error('The audio UI split must retain a serializable typed inverse');
        expect(entry.inverseAction?.type).toBe('restoreClipSplitState');
    });

    it('restores source tuples, take origins and gap tiles after saving and reopening the typed UI split', async () => {
        seedComp();
        const before = structuredClone({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes });
        splitClipWithUndo('source', 2);
        await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(1));
        await vi.waitFor(() => {
            const raw = sessionStorage.getItem('sourdaw-undo-session');
            expect(raw).not.toBeNull();
            if (!raw) throw new Error('Expected saved Undo');
            expect(JSON.parse(raw).past).toHaveLength(1);
        });
        const after = structuredClone({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes });
        expect(after.lanes[0]!.baseGapAudioSources).toHaveLength(2);
        expect(after.lanes[0]!.activeCompRegions.every((region) => region.audioSource !== undefined)).toBe(true);
        expectDocumentClipParity();
        for (let cycle = 0; cycle < 2; cycle++) {
            reopenSavedProject();
            expect(undoStore.value?.past).toHaveLength(1);
            expect({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes }).toEqual(after);
            expect((await undo()).headConsumed).toBe(true);
            expect({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes }).toEqual(before);
            expectDocumentClipParity();
            await redo();
            expect({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes }).toEqual(after);
            expectDocumentClipParity();
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
        }
    });

    it('refuses saved Undo without consuming history after a peer changes a selected region source', async () => {
        seedComp();
        splitClipWithUndo('source', 2);
        await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(1));
        const state = takeLaneStore.value!;
        takeLaneStore.set({
            lanes: state.lanes.map((lane) => ({
                ...lane,
                activeCompRegions: lane.activeCompRegions.map((region, index) => {
                    if (index !== 1) return region;
                    if (!region.audioSource) throw new Error('Expected a captured right region source');
                    return { ...region, audioSource: { ...region.audioSource, audioOffsetSeconds: 19 } };
                }),
            })),
        });
        flushAutomergeStorageWrites();
        const peer = structuredClone({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes });
        reopenSavedProject();
        expect((await undo()).headConsumed).toBe(false);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        expect({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes }).toEqual(peer);
        expectDocumentClipParity();
    });

    it('keeps genuinely late right takes and a new tile for a pre-existing disjoint source through saved split cycles', async () => {
        seedComp();
        const outside = addClip({
            id: 'outside',
            trackId: 'audio',
            name: 'Outside',
            type: 'audio',
            startBeat: 20,
            endBeat: 24,
            audioBufferId: 'outside-buffer',
        });
        if (!outside) throw new Error('Expected the owning clip writer to add a disjoint source');
        expectDocumentClipParity();
        const before = structuredClone({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes });
        splitClipWithUndo('source', 2);
        await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(1));
        const right = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id !== 'source' && clip.id !== outside.id);
        if (!right) throw new Error('Expected the actual split right clip');
        const outsideSource = captureAudioSourceSnapshot(outside, outside.endBeat - outside.startBeat, 120);
        if (!outsideSource) throw new Error('Expected the actual outside source law');
        const tile = { clipId: outside.id, startBeat: 20, endBeat: 24, audioSource: outsideSource };
        const late = {
            id: 'late-right',
            clipId: right.id,
            name: 'Late right take',
            startBeat: 2,
            endBeat: 9,
            selected: false,
            sourceOffsetBeats: 0,
            sourceOffsetSeconds: 0,
        };
        const current = takeLaneStore.value!;
        takeLaneStore.set({
            lanes: current.lanes.map((lane) => ({
                ...lane,
                takes: [...lane.takes, late],
                baseGapAudioSources: [...(lane.baseGapAudioSources ?? []), tile].sort(
                    (a, b) => a.clipId.localeCompare(b.clipId) || a.startBeat - b.startBeat
                ),
            })),
        });
        expectDocumentClipParity();
        const after = structuredClone({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes });
        for (let cycle = 0; cycle < 2; cycle++) {
            reopenSavedProject();
            expect(undoStore.value?.past).toHaveLength(1);
            expect((await undo()).headConsumed).toBe(true);
            expect(takeLaneStore.value?.lanes[0]?.takes).toEqual(before.lanes[0]!.takes);
            expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toEqual(before.lanes[0]!.activeCompRegions);
            expect(takeLaneStore.value?.lanes[0]?.baseGapAudioSources).toEqual([tile]);
            expectDocumentClipParity();
            await redo();
            expect({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes }).toEqual(after);
            expectDocumentClipParity();
        }
    });

    it('refuses saved split Undo without a write when a peer changes a transition-owned gap tile', async () => {
        seedComp();
        splitClipWithUndo('source', 2);
        await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(1));
        const state = takeLaneStore.value!;
        takeLaneStore.set({
            lanes: state.lanes.map((lane) => ({
                ...lane,
                baseGapAudioSources: lane.baseGapAudioSources?.map((tile) =>
                    tile.clipId === 'source'
                        ? tile
                        : { ...tile, audioSource: { ...tile.audioSource, audioOffsetSeconds: 19 } }
                ),
            })),
        });
        expectDocumentClipParity();
        reopenSavedProject();
        const peer = structuredClone({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes });
        const document = getCrdtDoc('root');
        expect((await undo()).headConsumed).toBe(false);
        expect(getCrdtDoc('root')).toBe(document);
        expect({ tracks: trackStore.value!.tracks, lanes: takeLaneStore.value!.lanes }).toEqual(peer);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        expectDocumentClipParity();
    });

    it('keeps the split and history cursor when a peer changes its captured source entry', async () => {
        seedClip(true, 4);
        splitClipWithUndo('source', 2);
        await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(1));
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) =>
                    clip.id === 'source' ? { ...clip, audioOffsetSeconds: clip.audioOffsetSeconds! + 1 } : clip
                ),
            })),
        });
        flushAutomergeStorageWrites();
        const peerClips = structuredClone(trackStore.value!.tracks[0]!.clips);

        expect((await undo()).headConsumed).toBe(false);

        expect(trackStore.value!.tracks[0]!.clips).toEqual(peerClips);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        expectDocumentClipParity();
    });
});
