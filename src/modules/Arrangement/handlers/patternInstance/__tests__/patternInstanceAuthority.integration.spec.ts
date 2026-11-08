import * as Automerge from '@automerge/automerge';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    setNotificationEventBus,
    type NotifyPayload,
    type ConfirmPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { type TrackAddedPayload } from '../../../events/TrackAddedEvent';
import { type TrackRemovedPayload } from '../../../events/TrackRemovedEvent';
import { type TrackSelectionChangedPayload } from '../../../events/TrackSelectionChangedEvent';

let handlerMaps: typeof import('#/app/getProductionCommandHandlerMaps');
let arrangement: typeof import('../../../useCases/arrangementEventBus');
let arrangementStores: typeof import('../../../stores/trackStore');
let command: typeof import('#/modules/Command/useCases');
let commandStores: typeof import('#/modules/Command/stores');
let crdt: typeof import('#/modules/CrdtDocument/useCases');
let crdtStores: typeof import('#/modules/CrdtDocument/stores');
let midiStores: typeof import('#/modules/MIDI/stores');

type ArrangementEvents = {
    'track.added': TrackAddedPayload;
    'track.removed': TrackRemovedPayload;
    'track.selectionChanged': TrackSelectionChangedPayload;
};
type Root = {
    tracks: NonNullable<typeof arrangementStores.trackStore.value>;
    midi: NonNullable<typeof midiStores.midiStore.value>;
};
type NotificationEvents = { 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload };

describe('pattern instance project and replay authority', () => {
    let events: ReturnType<typeof createEventBus<ArrangementEvents>>;
    let notifications: ReturnType<typeof createEventBus<NotificationEvents>>;
    let warnings: NotifyPayload[];
    let unsubscribeHistory: (() => void) | undefined;

    beforeAll(async () => {
        // Serialize the owning production graph before importing its public barrels.
        handlerMaps = await import('#/app/getProductionCommandHandlerMaps');
        const projections = await import('#/app/registerProjectSlotProjections');
        projections.registerProjectSlotProjections();
        arrangement = await import('../../../useCases/arrangementEventBus');
        arrangementStores = await import('../../../stores/trackStore');
        command = await import('#/modules/Command/useCases');
        commandStores = await import('#/modules/Command/stores');
        crdt = await import('#/modules/CrdtDocument/useCases');
        crdtStores = await import('#/modules/CrdtDocument/stores');
        midiStores = await import('#/modules/MIDI/stores');
    }, 30_000);

    beforeEach(async () => {
        Container.clear();
        events = createEventBus<ArrangementEvents>();
        notifications = createEventBus<NotificationEvents>();
        warnings = [];
        notifications.on('ui.notify', (payload) => {
            warnings.push(payload);
        });
        setNotificationEventBus(notifications);
        arrangement.setArrangementEventBus(events);
        configureAutomergeStoragePort(null);
        crdt.resetCrdtProjectAuthority('Pattern authority');
        crdt.registerCrdtStorageRuntime();
        commandStores.clearHandlerRegistry();
        command.registerProductionCommandHandlers(
            handlerMaps.getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })
        );
        command.setActionHistoryMetadataPort({
            record: crdt.recordActionHistoryEntry,
            recordBatch: crdt.recordActionHistoryEntries,
            markReverted: crdt.markActionHistoryEntryReverted,
            clear: crdt.clearActionHistory,
        });
        unsubscribeHistory = crdt.subscribeToPublishedActionHistory({
            onHistory: command.syncActionReplayMetadata,
            onRootReplaced: command.resetActionReplayAuthority,
        });
        for (const id of ['source-track', 'destination-track']) {
            await command.executeAppAction({
                type: 'addTrack',
                payload: { id, name: id, kind: 'midi', withoutDefaultDevice: true },
            });
        }
        await command.executeAppAction({
            type: 'addClip',
            payload: {
                id: 'source',
                trackId: 'source-track',
                name: 'Slipped phrase',
                type: 'midi',
                startBeat: 4,
                endBeat: 10,
                midiOffsetBeats: 1.5,
            },
        });
        await command.executeAppAction({
            type: 'addClip',
            payload: {
                id: 'keeper',
                trackId: 'destination-track',
                name: 'Keep me',
                type: 'midi',
                startBeat: 2,
                endBeat: 5,
                midiOffsetBeats: 0.25,
            },
        });
        await command.executeAppAction({
            type: 'addNotes',
            payload: {
                clipId: 'source',
                notes: [
                    { id: 'source-low', pitch: 48, startBeat: 1.75, duration: 1.5, velocity: 93 },
                    { id: 'source-high', pitch: 73, startBeat: 4.25, duration: 0.75, velocity: 61 },
                ],
            },
        });
        await command.executeAppAction({
            type: 'addNotes',
            payload: {
                clipId: 'keeper',
                notes: [{ id: 'keeper-note', pitch: 55, startBeat: 0.5, duration: 0.25, velocity: 79 }],
            },
        });
        hydratePerformance();
        command.clearUndoHistory();
        crdt.clearActionHistory();
    }, 30_000);

    afterEach(async () => {
        await events?.waitForIdle();
        await notifications?.waitForIdle();
        flushAutomergeStorageWrites();
        unsubscribeHistory?.();
        unsubscribeHistory = undefined;
        command?.clearUndoHistory();
        commandStores?.clearHandlerRegistry();
        crdt?.removeCrdtDoc('root');
        Container.clear();
    });

    function root() {
        crdt.settlePendingProjectWritesAndCaptureRevision();
        const document = crdt.getCrdtDoc<Root>('root');
        if (!document) {
            throw new Error('Expected real project authority');
        }
        return document;
    }

    function material() {
        const document = root();
        const copied = Automerge.toJS(document);
        const actual = { tracks: copied.tracks, midi: copied.midi };
        // Selection and ghost clips are local runtime fields, absent from persisted truth.
        expect(actual.tracks.tracks).toEqual(structuredClone(arrangementStores.trackStore.value?.tracks));
        expect(actual.midi).toEqual(structuredClone(midiStores.midiStore.value));
        return actual;
    }

    function clip(clipId: string) {
        const found = material()
            .tracks.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === clipId);
        if (!found) {
            throw new Error(`Expected clip ${clipId}`);
        }
        return found;
    }

    function notes(clipId: string) {
        return material().midi.notesByClipId[clipId] ?? [];
    }

    function hydratePerformance(linkedClipId?: string) {
        // Hydrate real document truth: addNotes has no expression-curve input and
        // there is no public action for authoring an instance's override map.
        const document = Automerge.change(Automerge.clone(root()), (draft) => {
            const low = draft.midi.notesByClipId.source?.[0];
            const high = draft.midi.notesByClipId.source?.[1];
            if (!low || !high) {
                throw new Error('Expected source performance');
            }
            low.pressure = 23;
            low.expression = {
                pressure: [{ offsetBeats: 0.25, value: 87 }],
                pitchBend: [{ offsetBeats: 0.75, value: -2048 }],
            };
            high.slide = 99;
            high.expression = { slide: [{ offsetBeats: 0.125, value: 17 }] };
            if (linkedClipId) {
                const owner = draft.tracks.tracks.find((track) =>
                    track.clips.some((candidate) => candidate.id === linkedClipId)
                );
                const linked = owner?.clips.find((candidate) => candidate.id === linkedClipId);
                if (!linked) {
                    throw new Error('Expected linked instance');
                }
                linked.overrides = { notes: true, gain: true, color: false };
            }
        });
        crdt.replaceCrdtDoc({ id: 'root', doc: document });
        crdt.projectCrdtToStores();
        material();
    }

    async function priorEdit() {
        await command.executeAppAction({
            type: 'setTrackColor',
            payload: { trackId: 'destination-track', color: '#7139ac' },
        });
        const baseline = material();
        expect(commandStores.undoHistoryStore.value?.past).toHaveLength(1);
        return baseline;
    }

    function assertPublishedInverse(label: string) {
        expect(commandStores.undoHistoryStore.value?.past).toHaveLength(2);
        const entry = commandStores.undoHistoryStore.value?.past.at(-1);
        expect(entry).toMatchObject({ kind: 'action', label });
        if (entry?.kind !== 'action') {
            throw new Error('Expected real typed action history');
        }
        expect.soft(entry.inverseAction).not.toBeNull();
        expect(crdtStores.actionHistoryStore.value?.entries).toHaveLength(2);
        expect(crdt.getCrdtDoc<{ actionHistory: unknown }>('root')?.actionHistory).toEqual(
            crdtStores.actionHistoryStore.value
        );
    }

    it('undoes only the created linked clip and notes, then redoes their exact identities and clip-relative performance', async () => {
        const before = await priorEdit();
        await command.executeAppAction({
            type: 'createPatternInstance',
            payload: { sourceClipId: 'source', targetTrackId: 'destination-track', startBeat: 19 },
        });
        const created = material()
            .tracks.tracks.flatMap((track) => track.clips)
            .filter((candidate) => candidate.id !== 'source' && candidate.id !== 'keeper');
        expect(created).toHaveLength(1);
        const instance = created[0]!;
        expect(instance).toMatchObject({
            trackId: 'destination-track',
            startBeat: 19,
            endBeat: 25,
            midiOffsetBeats: 1.5,
            parentClipId: 'source',
            overrides: {},
        });
        expect(notes(instance.id)).toEqual(
            notes('source').map((note) => ({ ...note, id: `note-inst-${instance.id}-${note.id}` }))
        );
        const forward = material();
        assertPublishedInverse('Create Pattern Instance');

        await command.undo();
        expect.soft(material()).toEqual(before);
        expect
            .soft(
                material()
                    .tracks.tracks.flatMap((track) => track.clips)
                    .some((candidate) => candidate.id === instance.id)
            )
            .toBe(false);
        expect.soft(notes(instance.id)).toEqual([]);
        expect.soft(commandStores.undoHistoryStore.value?.past).toHaveLength(1);
        await command.redo();
        expect.soft(material()).toEqual(forward);
        expect.soft(commandStores.undoHistoryStore.value?.past).toHaveLength(2);
    });

    it('restores the exact nonempty link and override fields on detach Undo, then removes them on Redo without touching notes or neighbors', async () => {
        await command.executeAppAction({
            type: 'createPatternInstance',
            payload: { sourceClipId: 'source', targetTrackId: 'destination-track', startBeat: 19 },
        });
        const instance = material()
            .tracks.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.parentClipId === 'source');
        if (!instance) {
            throw new Error('Expected actual linked instance');
        }
        hydratePerformance(instance.id);
        command.clearUndoHistory();
        crdt.clearActionHistory();
        const before = await priorEdit();
        const linked = clip(instance.id);
        expect(linked.overrides).toEqual({ notes: true, gain: true, color: false });
        const performance = notes(instance.id);

        await command.executeAppAction({ type: 'detachPatternInstance', payload: { clipId: instance.id } });
        const { parentClipId: _parent, overrides: _overrides, ...detached } = linked;
        expect(clip(instance.id)).toEqual(detached);
        expect(Object.hasOwn(clip(instance.id), 'parentClipId')).toBe(false);
        expect(Object.hasOwn(clip(instance.id), 'overrides')).toBe(false);
        expect(notes(instance.id)).toEqual(performance);
        const forward = material();
        assertPublishedInverse('Detach Pattern Instance');

        await command.undo();
        expect.soft(material()).toEqual(before);
        expect.soft(clip(instance.id)).toEqual(linked);
        expect.soft(notes(instance.id)).toEqual(performance);
        expect.soft(commandStores.undoHistoryStore.value?.past).toHaveLength(1);
        await command.redo();
        expect.soft(material()).toEqual(forward);
        expect.soft(Object.hasOwn(clip(instance.id), 'parentClipId')).toBe(false);
        expect.soft(Object.hasOwn(clip(instance.id), 'overrides')).toBe(false);
        expect.soft(commandStores.undoHistoryStore.value?.past).toHaveLength(2);
    });

    function mergePeer(change: Automerge.ChangeFn<Root>) {
        const current = root();
        const peer = Automerge.change(Automerge.clone(current), change);
        crdt.replaceCrdtDocInLineage({ id: 'root', doc: Automerge.merge(Automerge.clone(current), peer) });
        crdt.projectCrdtToStores();
        material();
    }

    async function createLinkedInstance() {
        await command.executeAppAction({
            type: 'createPatternInstance',
            payload: {
                sourceClipId: 'source',
                targetTrackId: 'destination-track',
                startBeat: 19,
                targetClipId: 'linked-instance',
            },
        });
        return clip('linked-instance');
    }

    function replayHistory() {
        const history = commandStores.undoHistoryStore.value;
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

    it('preserves a peer note on the FIRST Undo of the initial creation without any Redo refreshing its guard', async () => {
        await priorEdit();
        const instance = await createLinkedInstance();
        expect(replayHistory().past.at(-1)).toMatchObject({
            action: { type: 'createPatternInstance' },
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: {
                    clipId: instance.id,
                    generatedMidiStateGuard: {
                        entityJson: expect.stringContaining(instance.id),
                        midiByClipIdJson: expect.stringContaining('source-low'),
                    },
                },
            },
        });
        mergePeer((draft) => {
            draft.midi.notesByClipId[instance.id]!.push({
                id: 'first-undo-peer-note',
                pitch: 83,
                startBeat: 4.125,
                duration: 0.375,
                velocity: 49,
            });
        });
        const changed = material();
        const raw = Automerge.toJS(root());
        const history = replayHistory();
        expect(history.past).toHaveLength(2);
        expect(history.future).toEqual([]);
        await command.undo();
        expect(Automerge.toJS(root())).toEqual(raw);
        expect(material()).toEqual(changed);
        expect(replayHistory()).toEqual(history);
        await notifications.waitForIdle();
        expect(warnings).toEqual([
            { message: 'Cannot undo "Create Pattern Instance": project state has changed', level: 'warning' },
        ]);
    });

    it('reuses the canonical versioned identity through repeated real replay and refuses to discard peer notes after Redo', async () => {
        const instance = await createLinkedInstance();
        const performance = notes(instance.id);
        const entry = commandStores.undoHistoryStore.value?.past.at(-1);
        expect(entry).toMatchObject({ action: { payload: { targetClipId: instance.id } } });
        for (let cycle = 0; cycle < 2; cycle++) {
            await command.undo();
            expect(
                material()
                    .tracks.tracks.flatMap((track) => track.clips)
                    .map((candidate) => candidate.id)
            ).toEqual(['source', 'keeper']);
            expect(Object.hasOwn(material().midi.notesByClipId, instance.id)).toBe(false);
            await command.redo();
            expect(clip(instance.id)).toEqual(instance);
            expect(notes(instance.id)).toEqual(performance);
        }
        mergePeer((draft) => {
            draft.midi.notesByClipId[instance.id]!.push({
                id: 'peer-note',
                pitch: 81,
                startBeat: 3.5,
                duration: 0.5,
                velocity: 43,
            });
        });
        const changed = material();
        const past = replayHistory().past;
        await command.undo();
        expect(material()).toEqual(changed);
        expect(commandStores.undoHistoryStore.value?.past).toEqual(past);
        expect(commandStores.undoHistoryStore.value?.future).toEqual([]);
        await notifications.waitForIdle();
        expect(warnings).toEqual([
            { message: 'Cannot undo "Create Pattern Instance": project state has changed', level: 'warning' },
        ]);
    });

    it('discards only its created material while keeping a genuine peer edit to the destination keeper', async () => {
        const before = material();
        const instance = await createLinkedInstance();
        mergePeer((draft) => {
            draft.tracks.tracks
                .find((track) => track.id === 'destination-track')!
                .clips.find((candidate) => candidate.id === 'keeper')!.name = 'Peer keeper';
        });
        const expected = structuredClone(before);
        expected.tracks.tracks
            .find((track) => track.id === 'destination-track')!
            .clips.find((candidate) => candidate.id === 'keeper')!.name = 'Peer keeper';
        await command.undo();
        expect(material()).toEqual(expected);
        expect(Object.hasOwn(material().midi.notesByClipId, instance.id)).toBe(false);
    });

    it.each(['absent', 'empty', 'nonempty'] as const)(
        'replays detach with %s overrides while preserving non-link peer edits',
        async (presence) => {
            const instance = await createLinkedInstance();
            mergePeer((draft) => {
                const linked = draft.tracks.tracks
                    .find((track) => track.id === 'destination-track')!
                    .clips.find((candidate) => candidate.id === instance.id)!;
                if (presence === 'absent') {
                    delete linked.overrides;
                } else {
                    linked.overrides = presence === 'empty' ? {} : { notes: true, gain: false };
                }
            });
            command.clearUndoHistory();
            crdt.clearActionHistory();
            const linked = clip(instance.id);
            await command.executeAppAction({ type: 'detachPatternInstance', payload: { clipId: instance.id } });
            mergePeer((draft) => {
                draft.tracks.tracks
                    .find((track) => track.id === 'destination-track')!
                    .clips.find((candidate) => candidate.id === instance.id)!.gain = 0.375;
                draft.midi.notesByClipId[instance.id]![0]!.velocity = 47;
            });
            const changedNotes = notes(instance.id);
            await command.undo();
            expect(clip(instance.id)).toEqual({ ...linked, gain: 0.375 });
            expect(Object.hasOwn(clip(instance.id), 'overrides')).toBe(presence !== 'absent');
            expect(notes(instance.id)).toEqual(changedNotes);
            await command.redo();
            expect(Object.hasOwn(clip(instance.id), 'parentClipId')).toBe(false);
            expect(Object.hasOwn(clip(instance.id), 'overrides')).toBe(false);
            expect(clip(instance.id).gain).toBe(0.375);
            expect(notes(instance.id)).toEqual(changedNotes);
        }
    );

    it('refuses a stale detach inverse after a peer relinks the instance', async () => {
        const instance = await createLinkedInstance();
        command.clearUndoHistory();
        crdt.clearActionHistory();
        await command.executeAppAction({ type: 'detachPatternInstance', payload: { clipId: instance.id } });
        mergePeer((draft) => {
            const linked = draft.tracks.tracks
                .find((track) => track.id === 'destination-track')!
                .clips.find((candidate) => candidate.id === instance.id)!;
            linked.parentClipId = 'keeper';
            linked.overrides = { notes: false };
        });
        const changed = material();
        const past = replayHistory().past;
        await command.undo();
        expect(material()).toEqual(changed);
        expect(commandStores.undoHistoryStore.value?.past).toEqual(past);
        expect(commandStores.undoHistoryStore.value?.future).toEqual([]);
        await notifications.waitForIdle();
        expect(warnings).toEqual([
            { message: 'Cannot undo "Detach Pattern Instance": project state has changed', level: 'warning' },
        ]);
    });

    it('refuses an occupied canonical clip identity without notes, project or history effects', async () => {
        const before = material();
        await command.executeAppAction({
            type: 'createPatternInstance',
            payload: {
                sourceClipId: 'source',
                targetTrackId: 'destination-track',
                startBeat: 19,
                targetClipId: 'keeper',
            },
        });
        expect(material()).toEqual(before);
        expect(commandStores.undoHistoryStore.value?.past).toEqual([]);
        expect(crdtStores.actionHistoryStore.value?.entries).toEqual([]);
    });

    it('refuses an audio source through the actual typed creator without any project or history effects', async () => {
        await command.executeAppAction({
            type: 'addClip',
            payload: {
                id: 'audio-source',
                trackId: 'destination-track',
                type: 'audio',
                name: 'Audio source',
                startBeat: 12,
                endBeat: 16,
                audioBufferId: 'audio-source-buffer',
            },
        });
        command.clearUndoHistory();
        crdt.clearActionHistory();
        const before = material();
        await command.executeAppAction({
            type: 'createPatternInstance',
            payload: {
                sourceClipId: 'audio-source',
                targetTrackId: 'source-track',
                startBeat: 24,
                targetClipId: 'refused-audio-instance',
            },
        });
        expect(material()).toEqual(before);
        expect(commandStores.undoHistoryStore.value?.past).toEqual([]);
        expect(crdtStores.actionHistoryStore.value?.entries).toEqual([]);
    });

    it('keeps MIDI pattern placement on an eligible audio track with exact notes and same-ID replay', async () => {
        await command.executeAppAction({
            type: 'addTrack',
            payload: {
                id: 'audio-destination',
                name: 'Eligible audio track',
                kind: 'audio',
                withoutDefaultDevice: true,
            },
        });
        command.clearUndoHistory();
        crdt.clearActionHistory();
        const before = material();
        await command.executeAppAction({
            type: 'createPatternInstance',
            payload: {
                sourceClipId: 'source',
                targetTrackId: 'audio-destination',
                startBeat: 21,
                targetClipId: 'midi-on-audio',
            },
        });
        expect(clip('midi-on-audio')).toMatchObject({
            trackId: 'audio-destination',
            type: 'midi',
            startBeat: 21,
            endBeat: 27,
            midiOffsetBeats: 1.5,
            parentClipId: 'source',
        });
        expect(notes('midi-on-audio')).toEqual(
            notes('source').map((note) => ({ ...note, id: `note-inst-midi-on-audio-${note.id}` }))
        );
        const forward = material();
        await command.undo();
        expect(material()).toEqual(before);
        await command.redo();
        expect(material()).toEqual(forward);
    });
});
