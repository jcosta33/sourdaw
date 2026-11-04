import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
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
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { loopPhaseControllers, loopPhaseNotes, scoreMidiClips } from '../../../__tests__/midiClipScore';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../getArrangementHandlers';
import { splitClipWithUndo } from '../splitClipWithUndo';

type NotificationEvents = { 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload };
const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};
const EMPTY_MIDI = { probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };

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
    if (!doc) {
        throw new Error('Expected a project document to save');
    }
    const loaded = Automerge.load(Automerge.save(doc));
    expect(loaded).toEqual(doc);
    replaceCrdtDocInLineage({ id: 'root', doc: loaded });
    projectCrdtToStores({ resetProjections: true });
    hydrateProductionContracts();
}

/** A loop-4 phrase over [0,16), its loop anchored at beat 0. */
function seedLoopingPhrase(): void {
    const clip = ClipDummy.create({
        id: 'source',
        trackId: 'keys',
        name: 'Phrase',
        type: 'midi',
        startBeat: 0,
        endBeat: 16,
        midiOffsetBeats: 0,
        loopEnabled: true,
        loopLength: 4,
        loopOriginBeat: 0,
    });
    trackStore.set({
        tracks: [TrackDummy.create({ id: 'keys', kind: 'midi', clips: [clip] })],
        selectedTrackId: 'keys',
        ghostClips: [],
    });
    midiStore.set({
        ...EMPTY_MIDI,
        notesByClipId: { source: loopPhaseNotes() },
        ccByClipId: { source: loopPhaseControllers() },
    });
    flushAutomergeStorageWrites();
}

function projectSnapshot() {
    return structuredClone({
        clips: trackStore.value!.tracks[0]!.clips,
        notes: midiStore.value!.notesByClipId,
        controllers: midiStore.value!.ccByClipId,
    });
}

function savedUndo(): { past: unknown[]; future: unknown[] } {
    const raw = sessionStorage.getItem('sourdaw-undo-session');
    if (!raw) {
        return { past: [], future: [] };
    }
    return JSON.parse(raw);
}

function expectDocumentParity(): void {
    flushAutomergeStorageWrites();
    const doc = getCrdtDoc<{
        tracks: unknown;
        midi: { notesByClipId: unknown; ccByClipId: unknown };
    }>('root');
    expect(doc?.tracks).toEqual({ tracks: trackStore.value!.tracks });
    expect(doc?.midi.notesByClipId).toEqual(midiStore.value!.notesByClipId);
    expect(doc?.midi.ccByClipId).toEqual(midiStore.value!.ccByClipId);
}

describe('splitting a looping MIDI clip through typed Undo', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('looping MIDI split undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem('sourdaw-undo-session');
        hydrateProductionContracts();
        setNotificationEventBus(createEventBus<NotificationEvents>());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set(EMPTY_MIDI);
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set(EMPTY_MIDI);
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('keeps every beat on an off-grid split, and undo and redo restore each side exactly after saving', async () => {
        seedLoopingPhrase();
        const before = projectSnapshot();
        const beforeRaw = structuredClone(getCrdtDoc('root'));
        const played = scoreMidiClips(before.clips, 0, 16);

        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'source', beat: 5, rightClipId: 'right' } },
            { source: 'manual' }
        );
        await vi.waitFor(() => expect(savedUndo().past).toHaveLength(1));
        const after = projectSnapshot();
        expect(after.clips.map((clip) => clip.id)).toEqual(['source', 'right']);
        expect(scoreMidiClips(after.clips, 0, 16)).toEqual(played);
        expectDocumentParity();
        const afterRaw = structuredClone(getCrdtDoc('root'));

        for (let cycle = 0; cycle < 2; cycle++) {
            reopenSavedProject();
            expect((await undo()).headConsumed).toBe(true);
            expect(projectSnapshot()).toEqual(before);
            expect(getCrdtDoc('root')).toEqual(beforeRaw);
            expectDocumentParity();
            await vi.waitFor(() => expect(savedUndo().future).toHaveLength(1));
            reopenSavedProject();
            await redo();
            expect(projectSnapshot()).toEqual(after);
            expect(getCrdtDoc('root')).toEqual(afterRaw);
            expect(scoreMidiClips(projectSnapshot().clips, 0, 16)).toEqual(played);
            expectDocumentParity();
            await vi.waitFor(() => expect(savedUndo().past).toHaveLength(1));
        }
    });

    it('restores each side exactly through the timeline split gesture', async () => {
        seedLoopingPhrase();
        const before = projectSnapshot();
        const played = scoreMidiClips(before.clips, 0, 16);

        splitClipWithUndo('source', 5);
        await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(1));
        const after = projectSnapshot();
        expect(after.clips).toHaveLength(2);
        expect(scoreMidiClips(after.clips, 0, 16)).toEqual(played);

        for (let cycle = 0; cycle < 2; cycle++) {
            expect((await undo()).headConsumed).toBe(true);
            expect(projectSnapshot()).toEqual(before);
            expectDocumentParity();
            await redo();
            expect(projectSnapshot()).toEqual(after);
            expectDocumentParity();
        }
    });
});
