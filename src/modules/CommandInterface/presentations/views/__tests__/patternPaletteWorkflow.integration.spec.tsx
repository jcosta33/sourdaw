import * as Automerge from '@automerge/automerge';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type TrackRemovedPayload, type TrackSelectionChangedPayload } from '#/modules/Arrangement/events';
import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import {
    clearClipSelection,
    selectAllClips,
    selectClipWithFocus,
    setArrangementEventBus,
    toggleClipInSelection,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    syncActionReplayMetadata,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    projectCrdtToStores,
    recordActionHistoryEntries,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
    settlePendingProjectWritesAndCaptureRevision,
    subscribeToPublishedActionHistory,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { toggleCommandPalette, updateWorkspaceState } from '#/modules/WorkspaceShell/useCases';
import {
    setNotificationEventBus,
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { CommandPalette } from '../CommandPalette';

type ArrangementEvents = {
    'track.removed': TrackRemovedPayload;
    'track.selectionChanged': TrackSelectionChangedPayload;
};
type NotificationEvents = { 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload };
type Root = { tracks: NonNullable<typeof trackStore.value>; midi: NonNullable<typeof midiStore.value> };

function material() {
    settlePendingProjectWritesAndCaptureRevision();
    const root = getCrdtDoc<Root>('root');
    if (!root) {
        throw new Error('Expected actual project root');
    }
    const copied = Automerge.toJS(root);
    const actual = { tracks: copied.tracks, midi: copied.midi };
    expect(actual.tracks.tracks).toEqual(structuredClone(trackStore.value?.tracks));
    expect(actual.midi).toEqual(structuredClone(midiStore.value));
    return actual;
}

function replayHistory() {
    const history = undoHistoryStore.value;
    if (!history) {
        throw new Error('Expected actual replay history');
    }
    const capture = (entries: typeof history.past) =>
        entries.map((entry) => {
            if (entry.kind !== 'action') {
                throw new Error('Expected serializable typed action history');
            }
            return structuredClone(entry);
        });
    return { past: capture(history.past), future: capture(history.future) };
}

function readClip(clipId: string) {
    const clip = material()
        .tracks.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId);
    if (!clip) {
        throw new Error(`Expected actual clip ${clipId}`);
    }
    return clip;
}

async function showCommand(label: string) {
    act(() => {
        toggleCommandPalette();
    });
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: label } });
    return screen.getByRole('option', { name: new RegExp(`^${label}`) });
}

async function invokeCommand(label: string) {
    fireEvent.click(await showCommand(label));
}

describe('mounted pattern palette project workflow', () => {
    let events: ReturnType<typeof createEventBus<ArrangementEvents>>;
    let notifications: ReturnType<typeof createEventBus<NotificationEvents>>;
    let unsubscribeHistory: (() => void) | undefined;

    beforeEach(async () => {
        Container.clear();
        events = createEventBus<ArrangementEvents>();
        notifications = createEventBus<NotificationEvents>();
        setArrangementEventBus(events);
        setNotificationEventBus(notifications);
        registerProjectSlotProjections();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Mounted pattern palette');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            recordBatch: recordActionHistoryEntries,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        unsubscribeHistory = subscribeToPublishedActionHistory({
            onHistory: syncActionReplayMetadata,
            onRootReplaced: resetActionReplayAuthority,
        });
        for (const id of ['source-track', 'keeper-track']) {
            await executeAppAction({
                type: 'addTrack',
                payload: { id, name: id, kind: 'midi', withoutDefaultDevice: true },
            });
        }
        await executeAppAction({
            type: 'addClip',
            payload: {
                id: 'source',
                trackId: 'source-track',
                type: 'midi',
                name: 'Expression phrase',
                startBeat: 4,
                endBeat: 10,
                midiOffsetBeats: 1.5,
            },
        });
        await executeAppAction({
            type: 'addClip',
            payload: { id: 'keeper', trackId: 'keeper-track', type: 'midi', name: 'Keep me', startBeat: 1, endBeat: 3 },
        });
        await executeAppAction({
            type: 'addNotes',
            payload: {
                clipId: 'source',
                notes: [
                    { id: 'low', pitch: 49, startBeat: 1.75, duration: 1.5, velocity: 91 },
                    { id: 'high', pitch: 76, startBeat: 4.25, duration: 0.75, velocity: 63 },
                ],
            },
        });
        await executeAppAction({
            type: 'addNotes',
            payload: {
                clipId: 'keeper',
                notes: [{ id: 'keeper-note', pitch: 54, startBeat: 0.5, duration: 0.5, velocity: 77 }],
            },
        });
        settlePendingProjectWritesAndCaptureRevision();
        const root = getCrdtDoc<Root>('root');
        if (!root) {
            throw new Error('Expected performance fixture authority');
        }
        replaceCrdtDoc({
            id: 'root',
            doc: Automerge.change(Automerge.clone(root), (draft) => {
                draft.midi.notesByClipId.source![0]!.pressure = 21;
                draft.midi.notesByClipId.source![0]!.expression = { pressure: [{ offsetBeats: 0.25, value: 87 }] };
                draft.midi.notesByClipId.source![1]!.slide = 99;
                draft.midi.notesByClipId.source![1]!.expression = { pitchBend: [{ offsetBeats: 0.125, value: -3072 }] };
            }),
        });
        projectCrdtToStores();
        clearUndoHistory();
        clearActionHistory();
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 'keeper-track', color: '#7139ac' } });
        selectClipWithFocus('source');
        updateWorkspaceState({ commandPaletteOpen: false });
    });

    afterEach(async () => {
        cleanup();
        await events?.waitForIdle();
        await notifications?.waitForIdle();
        flushAutomergeStorageWrites();
        unsubscribeHistory?.();
        clearUndoHistory();
        clearHandlerRegistry();
        removeCrdtDoc('root');
        Container.clear();
    });

    it('creates from the selected MIDI clip, selects the committed copy, then detaches and replays exact material through the palette', async () => {
        const before = material();
        const sourceNotes = before.midi.notesByClipId.source!;
        render(<CommandPalette />);
        await invokeCommand('Create Pattern Instance');
        await waitFor(() => {
            expect(trackStore.value?.tracks.flatMap((track) => track.clips)).toHaveLength(3);
        });
        const created = material()
            .tracks.tracks.flatMap((track) => track.clips)
            .find((clip) => clip.parentClipId === 'source');
        if (!created) {
            throw new Error('Expected actual palette-created linked clip');
        }
        expect(created).toMatchObject({
            trackId: 'source-track',
            startBeat: 10,
            endBeat: 16,
            type: 'midi',
            midiOffsetBeats: 1.5,
            overrides: {},
        });
        await waitFor(() => {
            expect(clipSelectionStore.value?.selectedClipId).toBe(created.id);
        });
        const expectedNotes = sourceNotes.map((note) => ({ ...note, id: `note-inst-${created.id}-${note.id}` }));
        expect(material().midi.notesByClipId[created.id]).toEqual(expectedNotes);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect(actionHistoryStore.value?.entries).toHaveLength(2);

        await invokeCommand('Detach Pattern Instance');
        await waitFor(() => {
            expect(Object.hasOwn(readClip(created.id), 'parentClipId')).toBe(false);
            expect(undoHistoryStore.value?.past).toHaveLength(3);
        });
        const detached = material();
        expect(Object.hasOwn(readClip(created.id), 'overrides')).toBe(false);
        expect(detached.midi.notesByClipId[created.id]).toEqual(expectedNotes);

        await invokeCommand('Undo');
        await waitFor(() => {
            expect(readClip(created.id)).toEqual(created);
        });
        expect(material().midi.notesByClipId[created.id]).toEqual(expectedNotes);
        await invokeCommand('Redo');
        await waitFor(() => {
            expect(material()).toEqual(detached);
        });
        await invokeCommand('Undo');
        await waitFor(() => {
            expect(readClip(created.id)).toEqual(created);
        });
        await invokeCommand('Undo');
        await waitFor(() => {
            expect(material()).toEqual(before);
        });
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        await invokeCommand('Redo');
        await waitFor(() => {
            expect(readClip(created.id)).toEqual(created);
        });
        await invokeCommand('Redo');
        await waitFor(() => {
            expect(material()).toEqual(detached);
        });
    });

    it('resolves Detach from the current selection when invoked, rather than a cached catalog target', async () => {
        await executeAppAction({
            type: 'createPatternInstance',
            payload: {
                sourceClipId: 'source',
                targetTrackId: 'source-track',
                startBeat: 10,
                targetClipId: 'prepared-instance',
            },
        });
        const linked = readClip('prepared-instance');
        const notes = material().midi.notesByClipId[linked.id];
        render(<CommandPalette />);
        const option = await showCommand('Detach Pattern Instance');
        act(() => {
            selectClipWithFocus(linked.id);
        });
        fireEvent.click(option);
        await waitFor(() => {
            expect(Object.hasOwn(readClip(linked.id), 'parentClipId')).toBe(false);
        });
        expect(readClip('source')).toMatchObject({ id: 'source', startBeat: 4, endBeat: 10 });
        expect(material().midi.notesByClipId[linked.id]).toEqual(notes);
        await invokeCommand('Undo');
        await waitFor(() => {
            expect(readClip(linked.id)).toEqual(linked);
        });
    });

    it('creates from the focused clip when it is not first in a multi-selection', async () => {
        selectClipWithFocus('source');
        toggleClipInSelection('keeper');
        expect(clipSelectionStore.value).toMatchObject({
            selectedClipId: 'keeper',
            selectedClipIds: ['source', 'keeper'],
        });
        const before = material();
        const priorHistory = replayHistory();
        render(<CommandPalette />);

        await invokeCommand('Create Pattern Instance');

        await waitFor(() => {
            expect(trackStore.value?.tracks.flatMap((track) => track.clips)).toHaveLength(3);
        });
        const created = material()
            .tracks.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id !== 'source' && candidate.id !== 'keeper');
        if (!created) {
            throw new Error('Expected the committed pattern copy');
        }
        expect(created).toMatchObject({
            parentClipId: 'keeper',
            trackId: 'keeper-track',
            startBeat: 3,
            endBeat: 5,
            type: 'midi',
            overrides: {},
        });
        const expected = structuredClone(before);
        const owner = expected.tracks.tracks.find((track) => track.id === 'keeper-track');
        const notes = before.midi.notesByClipId.keeper;
        if (!owner || !notes) {
            throw new Error('Expected the focused clip owner and notes');
        }
        owner.clips.push(created);
        expected.midi.notesByClipId[created.id] = notes.map((note) => ({
            ...note,
            id: `note-inst-${created.id}-${note.id}`,
        }));
        expect(material()).toEqual(expected);
        await waitFor(() => expect(clipSelectionStore.value?.selectedClipId).toBe(created.id));
        expect(replayHistory().past.slice(0, -1)).toEqual(priorHistory.past);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect(actionHistoryStore.value?.entries).toHaveLength(2);
    });

    it('detaches only the focused linked clip when it is not first in a multi-selection', async () => {
        for (const [sourceClipId, targetTrackId, startBeat, targetClipId] of [
            ['source', 'source-track', 10, 'source-instance'],
            ['keeper', 'keeper-track', 3, 'keeper-instance'],
        ] as const) {
            await executeAppAction({
                type: 'createPatternInstance',
                payload: { sourceClipId, targetTrackId, startBeat, targetClipId },
            });
        }
        selectClipWithFocus('source-instance');
        toggleClipInSelection('keeper-instance');
        expect(clipSelectionStore.value).toMatchObject({
            selectedClipId: 'keeper-instance',
            selectedClipIds: ['source-instance', 'keeper-instance'],
        });
        const before = material();
        const priorHistory = replayHistory();
        render(<CommandPalette />);

        await invokeCommand('Detach Pattern Instance');

        await waitFor(() => expect(undoHistoryStore.value?.past).toHaveLength(4));
        const expected = structuredClone(before);
        const detached = expected.tracks.tracks
            .flatMap((track) => track.clips)
            .find((clip) => clip.id === 'keeper-instance');
        if (!detached) {
            throw new Error('Expected the focused linked fixture');
        }
        delete detached.parentClipId;
        delete detached.overrides;
        expect(material()).toEqual(expected);
        expect(readClip('source-instance')).toEqual(
            before.tracks.tracks.flatMap((track) => track.clips).find((clip) => clip.id === 'source-instance')
        );
        expect(clipSelectionStore.value?.selectedClipId).toBe('keeper-instance');
        expect(replayHistory().past.slice(0, -1)).toEqual(priorHistory.past);

        await invokeCommand('Undo');
        await waitFor(() => expect(material()).toEqual(before));
        await invokeCommand('Redo');
        await waitFor(() => expect(material()).toEqual(expected));
    });

    it.each(['Create Pattern Instance', 'Detach Pattern Instance'] as const)(
        'leaves Select All with no primary unchanged after %s',
        async (label) => {
            await executeAppAction({
                type: 'createPatternInstance',
                payload: {
                    sourceClipId: 'source',
                    targetTrackId: 'source-track',
                    startBeat: 10,
                    targetClipId: 'prepared-instance',
                },
            });
            // Enumerate every real clip with a linked clip first, so an illicit
            // first-ID fallback cannot hide behind detaching an unlinked parent.
            selectAllClips(() => ['prepared-instance', 'source', 'keeper']);
            const selection = clipSelectionStore.value;
            expect(selection).toMatchObject({
                selectedClipId: null,
                selectedClipIds: ['prepared-instance', 'source', 'keeper'],
            });
            const before = material();
            const priorHistory = replayHistory();
            const metadata = structuredClone(actionHistoryStore.value);
            render(<CommandPalette />);

            const command = await showCommand(label);
            await act(async () => {
                fireEvent.click(command);
            });

            expect(material()).toEqual(before);
            expect(clipSelectionStore.value).toBe(selection);
            expect(replayHistory()).toEqual(priorHistory);
            expect(actionHistoryStore.value).toEqual(metadata);
        }
    );

    it('leaves missing selection without project or history effects', async () => {
        clearClipSelection();
        const before = material();
        const past = replayHistory();
        render(<CommandPalette />);
        await invokeCommand('Create Pattern Instance');
        await invokeCommand('Detach Pattern Instance');
        expect(material()).toEqual(before);
        expect(replayHistory()).toEqual(past);
    });

    it('leaves a selected audio clip without pattern, link, selection or history effects', async () => {
        await executeAppAction({
            type: 'addClip',
            payload: {
                id: 'audio-selected',
                trackId: 'keeper-track',
                type: 'audio',
                name: 'Audio',
                startBeat: 12,
                endBeat: 16,
                audioBufferId: 'audio-selection-buffer',
            },
        });
        selectClipWithFocus('audio-selected');
        const before = material();
        const past = replayHistory();
        render(<CommandPalette />);
        await invokeCommand('Create Pattern Instance');
        await invokeCommand('Detach Pattern Instance');
        expect(material()).toEqual(before);
        expect(clipSelectionStore.value?.selectedClipId).toBe('audio-selected');
        expect(replayHistory()).toEqual(past);
    });
});
