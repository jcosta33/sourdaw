import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import {
    getAutomationHandlers,
    isValidAutomationTimeStateRestorePlan,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoStore } from '#/modules/Command/stores';
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
import { midiStore } from '#/modules/MIDI/stores';
import {
    getMidiNoteTransformHandlers,
    isValidMidiTimeStateRestorePlan,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
} from '#/modules/MIDI/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import {
    getTransportHandlers,
    isValidTimelineMapStateRestorePlan,
    prepareTimelineMapStateRestore,
    prepareTimelineMapTimeOperation,
} from '#/modules/Transport/useCases';
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
import { type Clip } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../getArrangementHandlers';
import { setTimeOperationDependencies } from '../../timeOperations/timeOperationDependencies';
import { deleteTimeRange } from '../deleteTimeRange';

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
        getProjectHandlers(),
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

type SeedVariant = { label: string; clip: Partial<Clip>; range: { startBeat: number; endBeat: number } };

/**
 * The phrase seeds: a stored loop of 4, a loop-enabled clip with no stored
 * length (it loops its own duration, which the trim shortens), and a clip that
 * does not loop; each loop is anchored at beat 0. Each range removes the
 * clip's head off the loop grid.
 */
const SEED_VARIANTS: SeedVariant[] = [
    {
        label: 'a stored loop length',
        clip: { loopEnabled: true, loopLength: 4, loopOriginBeat: 0 },
        range: { startBeat: 0, endBeat: 5 },
    },
    {
        label: 'no stored loop length',
        clip: { loopEnabled: true, loopOriginBeat: 0, endBeat: 6 },
        range: { startBeat: 0, endBeat: 1 },
    },
    { label: 'no loop', clip: {}, range: { startBeat: 0, endBeat: 2.5 } },
];

/** The phrase on a MIDI clip over [0,16) unless the variant says otherwise. */
function seedPhrase(overrides: Partial<Clip>): Clip {
    const clip = ClipDummy.create({
        id: 'source',
        trackId: 'keys',
        name: 'Phrase',
        type: 'midi',
        startBeat: 0,
        endBeat: 16,
        midiOffsetBeats: 0,
        ...overrides,
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
    return clip;
}

function projectSnapshot() {
    return structuredClone({
        clips: trackStore.value!.tracks[0]!.clips,
        notes: midiStore.value!.notesByClipId,
        controllers: midiStore.value!.ccByClipId,
    });
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

describe.each(SEED_VARIANTS)(
    'deleting the selected range over the head of a MIDI clip with $label',
    ({ clip, range }) => {
        beforeEach(() => {
            Container.clear();
            configureAutomergeStoragePort(null);
            resetCrdtProjectAuthority('selected range head excise undo');
            removeCrdtDoc('root');
            createCrdtDoc('root');
            registerCrdtStorageRuntime();
            registerProjectSlotProjections();
            sessionStorage.removeItem('sourdaw-undo-session');
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
            setTimeOperationDependencies(null);
            trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
            takeLaneStore.set({ lanes: [] });
            midiStore.set(EMPTY_MIDI);
            tempoMapStore.set({ changes: [] });
            transportStore.set(structuredClone(defaultTransportState));
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
            Container.clear();
        });

        it('plays what followed the range where it played, and undo, redo and saving restore each state exactly', async () => {
            const source = seedPhrase(clip);
            const before = projectSnapshot();
            const beforeRaw = structuredClone(getCrdtDoc('root'));
            const played = scoreMidiClips([source], range.endBeat, source.endBeat);
            // The fixture is not vacuous: the surviving span strikes notes.
            expect(played.filter((beat) => beat.struck.length > 0).length).toBeGreaterThan(1);

            deleteTimeRange(range.startBeat, range.endBeat, ['keys']);
            expect(undoStore.value?.past).toHaveLength(1);
            expectDocumentParity();
            const after = projectSnapshot();
            expect(after.clips.map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
                ['source', range.endBeat, source.endBeat],
            ]);
            expect(after.notes).toEqual(before.notes);
            expect(scoreMidiClips(after.clips, range.endBeat, source.endBeat)).toEqual(played);
            const afterRaw = structuredClone(getCrdtDoc('root'));

            // The selected-range entry is a session callback, so its undo and redo
            // run before the project is reopened; the reopen then proves each
            // state saves and loads exactly.
            for (let cycle = 0; cycle < 2; cycle++) {
                expect((await undo()).headConsumed).toBe(true);
                expect(projectSnapshot()).toEqual(before);
                expectDocumentParity();
                expect(getCrdtDoc('root')).toEqual(beforeRaw);
                await redo();
                expect(projectSnapshot()).toEqual(after);
                expectDocumentParity();
                expect(getCrdtDoc('root')).toEqual(afterRaw);
            }

            reopenSavedProject();
            expect(projectSnapshot()).toEqual(after);
            expect(scoreMidiClips(projectSnapshot().clips, range.endBeat, source.endBeat)).toEqual(played);
        });

        it('saves and reopens the undone clip exactly', async () => {
            seedPhrase(clip);
            const before = projectSnapshot();

            deleteTimeRange(range.startBeat, range.endBeat, ['keys']);
            expect((await undo()).headConsumed).toBe(true);
            reopenSavedProject();
            expect(projectSnapshot()).toEqual(before);
        });
    }
);
