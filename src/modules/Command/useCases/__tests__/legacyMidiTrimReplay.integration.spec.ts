import { createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    captureDurableDocumentWitness,
    clearActionHistory,
    compactProject,
    createCrdtDoc,
    getCrdtDoc,
    loadCrdtProject,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    sessionUndoWitnessStampPort,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { clearHandlerRegistry } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { undoTreeStore } from '../../stores/undoTree';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeActionGroupUndo } from '../executeActionGroupUndo';
import { executeAppAction } from '../executeAppAction';
import { reconcileSessionUndoForProject } from '../reconcileSessionUndoForProject';
import { redo } from '../redo';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';
import { revertActionGroup } from '../revertActionGroup';
import { revertActionGroupAtomically } from '../revertActionGroupAtomically';
import { stampSessionUndoWitness } from '../stampSessionUndoWitness';
import { undo } from '../undo';
import { rebuildTreeFromPast } from '../undoTree/rebuildTreeFromPast';

import legacyFixtures from './fixtures/legacyMidiTrimReplay.json';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const SESSION_KEY = 'sourdaw-undo-session';
const CLIP_ID = 'legacy-clip';
type Fixture = (typeof legacyFixtures.fixtures)[number];
let indexedDb: ReturnType<typeof installTransactionalIndexedDb>;
let unsubscribe: () => void;

function openFixtureDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('sourdaw-crdt-docs', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function installDocuments(fixture: Fixture): Promise<void> {
    const database = await openFixtureDatabase();
    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('documents', 'readwrite');
        const store = transaction.objectStore('documents');
        store.clear();
        for (const document of fixture.documents) {
            const bytes = Uint8Array.from(Buffer.from(document.base64, 'base64'));
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(document.sha256);
            store.put(bytes, document.key);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
    database.close();
}

async function loadFixture(name = 'duration'): Promise<void> {
    const fixture = legacyFixtures.fixtures.find((candidate) => candidate.name === name);
    if (!fixture) {
        throw new Error(`Missing historical fixture ${name}`);
    }
    await installDocuments(fixture);
    removeCrdtDoc('root');
    createCrdtDoc('root');
    await expect(loadCrdtProject()).resolves.toBe(true);
    projectCrdtToStores({ resetProjections: true });
    sessionStorage.setItem(SESSION_KEY, fixture.mirror);
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    reconcileSessionUndoForProject({ projectId: fixture.projectId, captureWitness: captureDurableDocumentWitness });
    // The producer can run commands that its session mirror does not retain.
    // Hydration owes the saved entries, not every command in the setup sequence.
    const savedHistory = JSON.parse(fixture.mirror);
    expect(undoStore.value?.past).toHaveLength(savedHistory.past.length);
    expect(undoStore.value?.future).toHaveLength(savedHistory.future.length);
    const trim = undoStore.value?.past.find(
        (entry) => entry.kind === 'action' && entry.action.type === 'trimClipStart'
    );
    if (trim?.kind !== 'action' || trim.inverseAction?.type !== 'trimClipStart') {
        throw new Error('Authentic historical trim entry did not hydrate');
    }
    expect(Object.hasOwn(trim.inverseAction.payload, 'midiOffsetBeats')).toBe(false);
    undoTreeStore.set({ enabled: true, tree: rebuildTreeFromPast(undoStore.value?.past ?? []) });
    await settleMirror();
}

async function settleMirror(): Promise<void> {
    flushAutomergeStorageWrites();
    stampSessionUndoWitness();
    const stampedMirror = sessionStorage.getItem(SESSION_KEY);
    await vi.waitFor(() => {
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        const mirror = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}');
        expect(mirror.witness).toBe(captureDurableDocumentWitness());
        expect(sessionStorage.getItem(SESSION_KEY)).toBe(stampedMirror);
    });
}

// These direct API units deliberately do not claim that the historical
// singleton producer persisted groups; every action and inverse stays intact.
async function tagDirectReplayUnit(): Promise<void> {
    const history = undoStore.value;
    if (!history) {
        throw new Error('Expected hydrated history');
    }
    undoStore.set({ ...history, past: history.past.map((entry) => ({ ...entry, groupId: 'direct-replay-unit' })) });
    await settleMirror();
}

function snapshot() {
    return {
        root: JSON.stringify(getCrdtDoc('root')),
        tracks: structuredClone(trackStore.value),
        midi: structuredClone(midiStore.value),
        history: structuredClone(undoStore.value),
        tree: structuredClone(undoTreeStore.value),
        mirror: sessionStorage.getItem(SESSION_KEY),
    };
}

function readClip() {
    const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === CLIP_ID);
    if (!clip) {
        throw new Error('Expected the historical clip');
    }
    return clip;
}

function readCoordinates() {
    flushAutomergeStorageWrites();
    const document = getCrdtDoc('root');
    return structuredClone({
        rawTracks: document?.tracks,
        rawMidi: document?.midi,
        tracks: trackStore.value,
        midi: midiStore.value,
    });
}

describe('authentic pre-capture trim history replay (#5696)', () => {
    beforeAll(() => {
        indexedDb = installTransactionalIndexedDb();
        unsubscribe = actionHistoryStore.subscribe(() => undefined);
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        sessionUndoWitnessStampPort.setProvider(stampSessionUndoWitness);
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        clearUndoHistory();
        clearHandlerRegistry();
        sessionStorage.removeItem(SESSION_KEY);
        resetCrdtProjectAuthority('legacy trim replay');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        await compactProject();
        clearActionHistory();
    });

    afterEach(async () => {
        await settleMirror();
        clearUndoHistory();
        clearHandlerRegistry();
        removeCrdtDoc('root');
        sessionStorage.removeItem(SESSION_KEY);
    });

    afterAll(async () => {
        unsubscribe();
        sessionUndoWitnessStampPort.setProvider(null);
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        await indexedDb.dispose();
    });

    it('refuses the saved duration-derived inverse without consuming history or changing any authority', async () => {
        expect(legacyFixtures.producerRevision).toBe('50e61f334eb3902aa3fa0eab97e8ac63d6bd0e56');
        await loadFixture();
        expect(readClip()).toMatchObject({ startBeat: 2, midiOffsetBeats: 3 });
        expect(midiStore.value?.notesByClipId[CLIP_ID]?.map((note) => note.startBeat)).toEqual([2, 3, 4, 5]);
        const before = snapshot();
        const result = await undo();
        expect(
            result,
            JSON.stringify({
                observedClip: readClip(),
                observedRows: midiStore.value?.notesByClipId[CLIP_ID],
                observedHistory: undoStore.value,
            })
        ).toEqual({ headConsumed: false });
        await settleMirror();
        expect(snapshot()).toEqual(before);
        expect(notifyUser).toHaveBeenCalledWith('Cannot undo "Trim clip start": project state has changed', 'warning');
    });

    it.each(['audio', 'loop-off'])('keeps a compatible naturally produced legacy inverse working: %s', async (name) => {
        await loadFixture(name);
        const peer = structuredClone(midiStore.value?.notesByClipId['peer-clip']);
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(readClip().startBeat).toBe(0);
        expect(midiStore.value?.notesByClipId['peer-clip']).toEqual(peer);
        await redo();
        expect(readClip().startBeat).toBe(2);
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it.each(['zero', 'unnormalized-zero'])(
        'refuses an unauthenticated saved zero-distance looped MIDI inverse: %s',
        async (name) => {
            await loadFixture(name);
            expect(readClip()).toMatchObject({ startBeat: 0, loopEnabled: true, midiOffsetBeats: 0 });
            if (name === 'unnormalized-zero') {
                expect(undoStore.value?.past).toHaveLength(1);
                expect(midiStore.value?.notesByClipId[CLIP_ID]?.map((note) => note.startBeat)).toEqual([
                    -8, -7, -6, -5,
                ]);
                expect(midiStore.value?.ccByClipId[CLIP_ID]?.map((controller) => controller.beat)).toEqual([-8]);
                expect(midiStore.value?.pitchBendByClipId[CLIP_ID]?.map((bend) => bend.beat)).toEqual([-8]);
            }
            const before = snapshot();
            const result = await undo();
            await settleMirror();
            expect(
                result,
                JSON.stringify({
                    result,
                    warnings: vi.mocked(notifyUser).mock.calls,
                    observedClip: readClip(),
                    observedMidi: midiStore.value,
                    past: undoStore.value?.past.length,
                    future: undoStore.value?.future.length,
                })
            ).toEqual({ headConsumed: false });
            expect(snapshot()).toEqual(before);
            expect(notifyUser).toHaveBeenCalledExactlyOnceWith(
                'Cannot undo "Trim clip start": project state has changed',
                'warning'
            );
        }
    );

    it('conservatively refuses a configured-loop legacy inverse whose missing offset is unauthenticated', async () => {
        await loadFixture('configured');
        const before = snapshot();
        await expect(undo()).resolves.toEqual({ headConsumed: false });
        await settleMirror();
        expect(snapshot()).toEqual(before);
    });

    it('defensively refuses direct grouped replay of the authentic legacy actions before singleton batch admission', async () => {
        await loadFixture();
        const before = snapshot();
        await expect(executeActionGroupUndo(undoStore.value?.past ?? [])).resolves.toMatchObject({
            status: 'conflict',
        });
        await settleMirror();
        expect(snapshot()).toEqual(before);
    });

    it.each(['atomic', 'non-atomic'])(
        'preflights an exposed direct %s revert unit before an unrelated prefix can write',
        async (mode) => {
            await loadFixture();
            await executeAppAction({
                type: 'renameClip',
                payload: { clipId: 'peer-clip', name: 'Current peer label' },
            });
            await tagDirectReplayUnit();
            const before = snapshot();
            if (mode === 'atomic') {
                await expect(revertActionGroupAtomically('direct-replay-unit')).resolves.toMatchObject({
                    status: 'refused',
                    reason: 'conflict',
                });
            } else {
                await expect(revertActionGroup('direct-replay-unit')).rejects.toThrow('legacy MIDI trim');
            }
            await settleMirror();
            expect(snapshot()).toEqual(before);
        }
    );

    it('refuses an unprovable coordinate-changing prefix in a direct non-atomic unit', async () => {
        await loadFixture();
        await executeAppAction({ type: 'setClipLoop', payload: { clipId: CLIP_ID, enabled: false } });
        await tagDirectReplayUnit();
        const before = snapshot();
        await expect(revertActionGroup('direct-replay-unit')).rejects.toThrow('earlier inverse');
        await settleMirror();
        expect(snapshot()).toEqual(before);
    });

    it('keeps a compatible exposed non-atomic unit working without widening singleton batch support', async () => {
        await loadFixture('audio');
        await executeAppAction({ type: 'renameClip', payload: { clipId: 'peer-clip', name: 'Current peer label' } });
        await tagDirectReplayUnit();
        await revertActionGroup('direct-replay-unit');
        await settleMirror();
        expect(readClip().startBeat).toBe(0);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(2);
    });

    it('keeps fresh keyless trims and modern captured Undo/Redo working on a duration-derived loop', async () => {
        await loadFixture();
        const original = structuredClone({ tracks: trackStore.value, midi: midiStore.value });
        await executeAppAction({ type: 'trimClipStart', payload: { clipId: CLIP_ID, newStartBeat: 4 } });
        const head = undoStore.value?.past.at(-1);
        expect(head).toMatchObject({ inverseAction: { payload: { midiOffsetBeats: 3 } } });
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect({ tracks: trackStore.value, midi: midiStore.value }).toEqual(original);
        await redo();
        expect(readClip().startBeat).toBe(4);
    });

    it.each([0, 8])('restores a current zero-distance trim with its real captured offset %s', async (offset) => {
        await loadFixture('loop-off');
        await executeAppAction({ type: 'trimClipStart', payload: { clipId: CLIP_ID, newStartBeat: 0 } });
        await executeAppAction({
            type: 'slipClipContent',
            payload: { clipId: CLIP_ID, clipType: 'midi', offset },
        });
        await executeAppAction({ type: 'setClipLoop', payload: { clipId: CLIP_ID, enabled: true } });
        expect(readClip()).toMatchObject({ startBeat: 0, midiOffsetBeats: offset, loopEnabled: true });
        const before = readCoordinates();

        await executeAppAction({ type: 'trimClipStart', payload: { clipId: CLIP_ID, newStartBeat: 0 } });
        const head = undoStore.value?.past.at(-1);
        expect(head).toMatchObject({
            action: { type: 'trimClipStart', payload: { clipId: CLIP_ID, newStartBeat: 0 } },
            inverseAction: { type: 'trimClipStart', payload: { midiOffsetBeats: offset } },
        });
        expect(readClip().midiOffsetBeats).toBe(0);
        expect(midiStore.value?.notesByClipId[CLIP_ID]?.map((note) => note.startBeat)).toEqual([
            0 - offset,
            1 - offset,
            2 - offset,
            3 - offset,
        ]);
        expect(midiStore.value?.ccByClipId[CLIP_ID]?.map((controller) => controller.beat)).toEqual([0 - offset]);
        expect(midiStore.value?.pitchBendByClipId[CLIP_ID]?.map((bend) => bend.beat)).toEqual([0 - offset]);
        const trimmed = readCoordinates();

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(readCoordinates()).toEqual(before);
        await redo();
        expect(readCoordinates()).toEqual(trimmed);
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('rechecks legacy admission after the real snapshot wait before the inverse can write', async () => {
        await loadFixture('loop-off');
        let enter!: () => void;
        let release!: () => void;
        const entered = new Promise<void>((resolve) => {
            enter = resolve;
        });
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const snapshotTransaction = transactSnapshot(async (transaction) => {
            enter();
            await held;
            mutateCrdtDoc<{ tracks: TrackStoreState }>({
                id: 'root',
                snapshotTransaction: transaction,
                changeFn: (doc) => {
                    doc.tracks.tracks[0]!.clips[0]!.loopEnabled = true;
                },
            });
            projectCrdtToStores({ resetProjections: true });
        });
        await entered;
        const pendingUndo = undo();
        release();
        await snapshotTransaction;
        const documentAfterPeer = JSON.stringify(getCrdtDoc('root'));
        const historyBefore = structuredClone(undoStore.value);
        await expect(pendingUndo).resolves.toEqual({ headConsumed: false });
        await settleMirror();
        expect(JSON.stringify(getCrdtDoc('root'))).toBe(documentAfterPeer);
        expect(undoStore.value).toEqual(historyBefore);
        expect(readClip()).toMatchObject({ startBeat: 2, loopEnabled: true });
    });
});
