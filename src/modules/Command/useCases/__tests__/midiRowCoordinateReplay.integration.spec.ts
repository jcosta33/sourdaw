import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import * as storage from '#/infra/store/storage/createAutomergeStorage';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { defaultTrackState, trackStore, type Clip, type TrackStoreState } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
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
import { defaultMidiStoreState, midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { AppActionCommittedError, AppActionConflictError } from '../../errors/AppActionExecutionError';
import { clearHandlerRegistry } from '../../stores/handlerRegistry';
import { macroStore } from '../../stores/macroStore';
import { undoStore } from '../../stores/undoStore';
import { undoTreeStore } from '../../stores/undoTree';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { getActionReplayStatus } from '../getActionReplayStatus';
import { recordAction } from '../macro/recording/recordAction';
import { reconcileSessionUndoForProject } from '../reconcileSessionUndoForProject';
import { redo } from '../redo';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';
import { revertAction } from '../revertAction';
import { stampSessionUndoWitness } from '../stampSessionUndoWitness';
import { undo } from '../undo';
import { rebuildTreeFromPast } from '../undoTree/rebuildTreeFromPast';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('../macro/recording/recordAction', async (importOriginal) => {
    const original = await importOriginal<typeof import('../macro/recording/recordAction')>();
    return { recordAction: vi.fn(original.recordAction) };
});

const SESSION_KEY = 'sourdaw-undo-session';
const PROJECT_ID = 'exact-midi-row-replay';
const CLIP_ID = 'phrase';
let indexedDb: ReturnType<typeof installTransactionalIndexedDb>;
let unsubscribe: () => void;

function register(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

function seed(loopLength?: number, type: 'audio' | 'midi' = 'midi', loopEnabled = true): void {
    const clip: Clip = {
        id: CLIP_ID,
        trackId: 'keys',
        name: 'Fractional phrase',
        type,
        startBeat: 0,
        endBeat: 8,
        midiOffsetBeats: 0,
        audioOffsetBeats: 0,
        loopEnabled,
        loopOriginBeat: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
    if (loopLength !== undefined) {
        clip.loopLength = loopLength;
    }
    const track = createTrack({ id: 'keys', name: 'Keys', kind: type, withoutDefaultDevice: true });
    trackStore.set({
        ...defaultTrackState,
        tracks: [{ ...track, clips: [clip, { ...clip, id: 'other', startBeat: 16, endBeat: 24 }] }],
    });
    midiStore.set({
        ...defaultMidiStoreState,
        notesByClipId: {
            [CLIP_ID]: [{ id: 'note', startBeat: 0.1, pitch: 60, duration: 0.25, velocity: 100, probability: 0.4 }],
        },
        ccByClipId: { [CLIP_ID]: [{ id: 'cc', beat: 0.1, controller: 64, value: 127, channel: 2 }] },
        pitchBendByClipId: { [CLIP_ID]: [{ id: 'bend', beat: 0.1, value: 1024, channel: 3 }] },
    });
    storage.flushAutomergeStorageWrites();
}

function slip(offset = -1): AppAction {
    return { type: 'slipClipContent', payload: { clipId: CLIP_ID, clipType: 'midi', offset } };
}
function trim(newStartBeat = 2): AppAction {
    return { type: 'trimClipStart', payload: { clipId: CLIP_ID, newStartBeat } };
}
function readClip(): Clip {
    const clip = trackStore.value?.tracks[0]?.clips.find((candidate) => candidate.id === CLIP_ID);
    if (!clip) {
        throw new Error('Expected the phrase clip');
    }
    return clip;
}
function readRows() {
    storage.flushAutomergeStorageWrites();
    const raw = getCrdtDoc<{ midi: MidiStoreState }>('root')?.midi;
    expect(raw).toEqual(midiStore.value);
    return structuredClone(midiStore.value);
}
function beats(): number[] {
    const rows = readRows();
    return [
        rows!.notesByClipId[CLIP_ID]![0]!.startBeat,
        rows!.ccByClipId[CLIP_ID]![0]!.beat,
        rows!.pitchBendByClipId[CLIP_ID]![0]!.beat,
    ];
}
async function settleMirror(): Promise<void> {
    storage.flushAutomergeStorageWrites();
    stampSessionUndoWitness();
    await vi.waitFor(() => {
        expect(storage.countPendingAutomergeStorageWrites()).toBe(0);
        const mirror = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}');
        expect(mirror.witness).toBe(captureDurableDocumentWitness());
    });
}
async function saveAndReload(): Promise<void> {
    await settleMirror();
    const before = readRows();
    const past = undoStore.value?.past.length;
    const future = undoStore.value?.future.length;
    await compactProject();
    const mirror = sessionStorage.getItem(SESSION_KEY);
    removeCrdtDoc('root');
    createCrdtDoc('root');
    await expect(loadCrdtProject()).resolves.toBe(true);
    projectCrdtToStores({ resetProjections: true });
    sessionStorage.setItem(SESSION_KEY, mirror!);
    register();
    expect(undoStore.value?.past).toHaveLength(past!);
    expect(undoStore.value?.future).toHaveLength(future!);
    expect(readRows()).toEqual(before);
    undoTreeStore.set({ enabled: true, tree: rebuildTreeFromPast(undoStore.value?.past ?? []) });
    await settleMirror();
}
function snapshot() {
    return {
        raw: JSON.stringify(getCrdtDoc('root')),
        tracks: structuredClone(trackStore.value),
        midi: structuredClone(midiStore.value),
        history: structuredClone(undoStore.value),
        tree: structuredClone(undoTreeStore.value),
        mirror: sessionStorage.getItem(SESSION_KEY),
    };
}
function peerRows(change: (state: MidiStoreState) => void): void {
    mutateCrdtDoc<{ midi: MidiStoreState }>({ id: 'root', changeFn: (document) => change(document.midi) });
    projectCrdtToStores({ resetProjections: true });
}

describe('exact row captures through real Command history and persistence (#5695)', () => {
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
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        clearUndoHistory();
        clearHandlerRegistry();
        sessionStorage.removeItem(SESSION_KEY);
        resetCrdtProjectAuthority('exact MIDI row replay');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        await compactProject();
        clearActionHistory();
        register();
    });
    afterEach(async () => {
        registerCrdtStorageRuntime();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
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

    it.each([undefined, 4])(
        'restores exact intermediate and terminal fractional figures with loopLength=%s',
        async (loopLength) => {
            seed(loopLength);
            const initial = readRows();
            const originalClip = structuredClone(readClip());
            await executeAppAction(slip());
            const lifted = readRows();
            const liftedBeat = 0.1 + (loopLength ?? 8);
            expect(beats()).toEqual([liftedBeat, liftedBeat, liftedBeat]);
            await executeAppAction(trim());
            const trimmed = readRows();
            const trimmedClip = structuredClone(readClip());
            expect(undoStore.value?.past).toHaveLength(2);
            expect(undoStore.value?.past.every((entry) => entry.groupId === undefined)).toBe(true);
            await saveAndReload();
            for (let cycle = 0; cycle < 3; cycle += 1) {
                await expect(undo()).resolves.toEqual({ headConsumed: true });
                expect(readRows()).toEqual(lifted);
                await expect(undo()).resolves.toEqual({ headConsumed: true });
                expect(readRows()).toEqual(initial);
                expect(readClip()).toEqual(originalClip);
                await saveAndReload();
                await redo();
                expect(readRows()).toEqual(lifted);
                await redo();
                expect(readRows()).toEqual(trimmed);
                expect(readClip()).toEqual(trimmedClip);
            }
            expect(notifyUser).not.toHaveBeenCalled();
        }
    );

    it.each(['slip', 'trim'] as const)(
        'keeps peer additions, deletions, moves and properties before both directions of %s',
        async (kind) => {
            seed();
            if (kind === 'trim') {
                await executeAppAction(slip());
            }
            await executeAppAction(kind === 'slip' ? slip() : trim());
            const beforeUndo = readRows()!;
            const target = beforeUndo.notesByClipId[CLIP_ID]![0]!.startBeat;
            peerRows((state) => {
                state.notesByClipId[CLIP_ID]![0]!.velocity = 42;
                state.notesByClipId[CLIP_ID]![0]!.expression = { pressure: [{ offsetBeats: 0.125, value: 0.5 }] };
                state.notesByClipId[CLIP_ID]!.push({
                    id: 'added-before-undo',
                    startBeat: target + 1,
                    pitch: 64,
                    duration: 0.5,
                    velocity: 80,
                });
                state.ccByClipId[CLIP_ID] = [];
                state.pitchBendByClipId[CLIP_ID]![0]!.beat = target + 0.25;
                state.pitchBendByClipId[CLIP_ID]![0]!.value = -2048;
            });
            const peerBeforeUndo = readRows();
            await expect(undo()).resolves.toEqual({ headConsumed: true });
            expect(midiStore.value?.notesByClipId[CLIP_ID]?.[0]).toMatchObject({
                velocity: 42,
                probability: 0.4,
                expression: { pressure: [{ offsetBeats: 0.125, value: 0.5 }] },
            });
            expect(midiStore.value?.ccByClipId[CLIP_ID]).toEqual([]);
            peerRows((state) => {
                state.notesByClipId[CLIP_ID]!.push({
                    id: 'added-before-redo',
                    startBeat: 0.2,
                    pitch: 67,
                    duration: 0.5,
                    velocity: 90,
                });
                state.pitchBendByClipId[CLIP_ID]![0]!.value = 3072;
            });
            const peerBeforeRedo = readRows();
            await saveAndReload();
            await redo();
            const redone = readRows()!;
            expect(redone.notesByClipId[CLIP_ID]?.slice(0, 2)).toEqual(peerBeforeUndo?.notesByClipId[CLIP_ID]);
            expect(redone.ccByClipId[CLIP_ID]).toEqual([]);
            expect(redone.pitchBendByClipId[CLIP_ID]?.[0]).toEqual({
                ...peerBeforeUndo!.pitchBendByClipId[CLIP_ID]![0],
                value: 3072,
            });
            await saveAndReload();
            for (let cycle = 0; cycle < 3; cycle += 1) {
                await expect(undo()).resolves.toEqual({ headConsumed: true });
                expect(readRows()).toEqual(peerBeforeRedo);
                await redo();
                expect(readRows()).toEqual(redone);
            }
            expect(notifyUser).not.toHaveBeenCalled();
        }
    );

    it('captures peer material admitted during the actual snapshot wait', async () => {
        seed();
        let entered!: () => void, release!: () => void, waiting!: () => void;
        const began = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const atWait = new Promise<void>((resolve) => {
            waiting = resolve;
        });
        const originalWait = storage.waitForAutomergeSnapshotTransaction;
        const spy = vi.spyOn(storage, 'waitForAutomergeSnapshotTransaction').mockImplementation((transaction) => {
            waiting();
            return originalWait(transaction);
        });
        const peer = transactSnapshot(async (transaction) => {
            entered();
            await held;
            mutateCrdtDoc<{ midi: MidiStoreState }>({
                id: 'root',
                snapshotTransaction: transaction,
                changeFn: (doc) => {
                    doc.midi.notesByClipId[CLIP_ID]!.push({
                        id: 'admitted',
                        startBeat: 0.1,
                        pitch: 64,
                        duration: 0.5,
                        velocity: 80,
                    });
                },
            });
            projectCrdtToStores({ resetProjections: true });
        });
        await began;
        try {
            const pending = executeAppAction(slip());
            await atWait;
            release();
            await peer;
            await pending;
            const entry = undoStore.value?.past.at(-1);
            expect(
                entry?.kind === 'action' &&
                    entry.inverseAction?.type === 'slipClipContent' &&
                    entry.inverseAction.payload.midiRowCoordinates?.coordinates.some(
                        (row) => row.id === 'admitted' && row.beforeBeat === 0.1
                    )
            ).toBe(true);
            await undo();
            expect(midiStore.value?.notesByClipId[CLIP_ID]?.map((row) => row.startBeat)).toEqual([0.1, 0.1]);
        } finally {
            release();
            spy.mockRestore();
        }
    });

    it('restores capture metadata, document, projections, history, tree and mirror on a real failed storage commit', async () => {
        seed();
        await executeAppAction(slip());
        peerRows((state) => {
            state.notesByClipId[CLIP_ID]!.push({ id: 'peer', startBeat: 9.1, pitch: 64, duration: 0.5, velocity: 80 });
        });
        await settleMirror();
        undoTreeStore.set({ enabled: true, tree: rebuildTreeFromPast(undoStore.value?.past ?? []) });
        const before = snapshot();
        storage.configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc<Record<string, unknown>>(id),
            hasDoc: (id) => getCrdtDoc(id) !== undefined,
            getSemanticMessage: () => undefined,
            mutateDoc: () => {
                throw new Error('injected pre-commit storage failure');
            },
        });
        await expect(undo()).rejects.toThrow('injected pre-commit storage failure');
        registerCrdtStorageRuntime();
        await settleMirror();
        expect(snapshot()).toEqual(before);
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        await redo();
        expect(readRows()?.notesByClipId[CLIP_ID]?.[1]?.startBeat).toBe(9.1);
    });

    it('retains reciprocal captures matching the committed product after post-commit bookkeeping fails', async () => {
        seed();
        await executeAppAction(slip());
        await undo();
        peerRows((state) => {
            state.notesByClipId[CLIP_ID]!.push({ id: 'peer', startBeat: 0.2, pitch: 64, duration: 0.5, velocity: 80 });
        });
        const peer = readRows();
        vi.mocked(recordAction).mockImplementationOnce(() => {
            throw new Error('injected post-commit macro failure');
        });
        await expect(redo()).rejects.toBeInstanceOf(AppActionCommittedError);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(readRows()).toEqual(peer);
    });

    it.each(['slip', 'trim'] as const)(
        'refuses an unbound capture added to a fresh %s request before any write',
        async (kind) => {
            seed();
            if (kind === 'trim') {
                await executeAppAction(slip());
            }
            await executeAppAction(kind === 'slip' ? slip() : trim());
            await settleMirror();
            const entry = undoStore.value?.past.at(-1);
            if (
                entry?.kind !== 'action' ||
                (entry.inverseAction?.type !== 'slipClipContent' && entry.inverseAction?.type !== 'trimClipStart')
            ) {
                throw new Error('Expected a coordinate inverse');
            }
            const forged = structuredClone(entry.inverseAction);
            const before = snapshot();
            await expect(executeAppAction(forged)).rejects.toBeInstanceOf(AppActionConflictError);
            await settleMirror();
            expect(snapshot()).toEqual(before);
        }
    );

    it.each(['slip', 'trim'] as const)(
        'refuses malformed bound %s capture without consuming or rewriting pending history',
        async (kind) => {
            seed();
            if (kind === 'trim') {
                await executeAppAction(slip());
            }
            await executeAppAction(kind === 'slip' ? slip() : trim());
            const entry = undoStore.value?.past.at(-1);
            if (
                entry?.kind !== 'action' ||
                (entry.inverseAction?.type !== 'slipClipContent' && entry.inverseAction?.type !== 'trimClipStart')
            ) {
                throw new Error('Expected a coordinate inverse');
            }
            const capture = entry.inverseAction.payload.midiRowCoordinates;
            if (!capture) {
                throw new Error('Expected an executed coordinate capture');
            }
            capture.coordinates[0]!.afterBeat = 99;
            await settleMirror();
            const before = snapshot();
            await expect(undo({ stepOverConflicts: false })).resolves.toEqual({ headConsumed: false });
            await settleMirror();
            expect(snapshot()).toEqual(before);
        }
    );

    it.each(['clip identity', 'redo request', 'opposite displacement', 'anchor'] as const)(
        'excludes an incoherent saved pair with a changed %s',
        async (broken) => {
            seed();
            await executeAppAction(slip());
            await executeAppAction(trim());
            await settleMirror();
            const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY)!);
            const entry = saved.past.at(-1);
            if (broken === 'clip identity') {
                entry.redoAction.payload.clipId = 'other';
            }
            if (broken === 'redo request') {
                entry.redoAction.payload.newStartBeat = 3;
            }
            if (broken === 'opposite displacement') {
                entry.redoAction.payload.midiRowCoordinates.beatDelta = 0;
            }
            if (broken === 'anchor') {
                delete entry.inverseAction.payload.loopOriginBeat;
            }
            const before = readRows();
            const rawBefore = JSON.stringify(getCrdtDoc('root'));
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
            register();
            expect(undoStore.value?.past).toEqual([]);
            expect(readRows()).toEqual(before);
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(rawBefore);
        }
    );

    it('refuses a replay whose live loop basis no longer matches its reciprocal displacement', async () => {
        seed();
        await executeAppAction(slip());
        await undo();
        mutateCrdtDoc<{ tracks: TrackStoreState }>({
            id: 'root',
            changeFn: (doc) => {
                doc.tracks.tracks[0]!.clips[0]!.loopLength = 4;
            },
        });
        projectCrdtToStores({ resetProjections: true });
        await settleMirror();
        const before = snapshot();
        await redo();
        await settleMirror();
        expect(snapshot()).toEqual(before);
    });

    it.each([
        ['slip', 'same loop'],
        ['trim', 'same loop'],
        ['slip', 'changed loop'],
        ['trim', 'changed loop'],
        ['slip', 'zero hints'],
        ['trim', 'zero hints'],
        ['slip', 'unlooped'],
        ['trim', 'unlooped'],
        ['slip', 'audio'],
        ['trim', 'audio'],
    ] as const)('matches fresh public %s commands for saved macro replay on %s material', async (kind, mode) => {
        const audio = mode === 'audio';
        const zeroSlip = mode === 'zero hints' && kind === 'slip';
        seed(8, audio ? 'audio' : 'midi', !zeroSlip);
        if (zeroSlip || (kind === 'trim' && mode !== 'zero hints' && !audio)) {
            await executeAppAction(slip());
        }
        if (zeroSlip || (mode === 'zero hints' && kind === 'trim')) {
            mutateCrdtDoc<{ tracks: TrackStoreState }>({
                id: 'root',
                changeFn: (document) => {
                    const clip = document.tracks.tracks[0]?.clips.find((candidate) => candidate.id === CLIP_ID);
                    if (!clip) {
                        throw new Error('Expected the recording clip');
                    }
                    clip.loopEnabled = true;
                    delete clip.loopOriginBeat;
                },
            });
            projectCrdtToStores({ resetProjections: true });
        }
        const forwardOffset = zeroSlip ? 1 : -1;
        const previousOffset = zeroSlip ? -1 : 0;
        const freshSlip = (offset: number): AppAction => ({
            type: 'slipClipContent',
            payload: { clipId: CLIP_ID, clipType: audio ? 'audio' : 'midi', offset },
        });
        await executeAppAction({ type: 'startMacroRecording' });
        await executeAppAction(kind === 'slip' ? freshSlip(forwardOffset) : trim());
        // Reversion reads authoritative source owners alongside settled history metadata.
        await settleMirror();
        const id = actionHistoryStore.value?.entries.at(-1)?.id;
        if (!id) {
            throw new Error('Expected an action-history entry to revert');
        }
        await expect(revertAction(id)).resolves.toEqual({ status: 'executed' });
        await executeAppAction({ type: 'stopMacroRecording', payload: { name: 'Edit and reverse' } });
        const recorded = macroStore.value?.macros[0];
        if (!recorded) {
            throw new Error('Expected a saved macro');
        }
        expect(recorded.actions).toHaveLength(2);
        if (!audio) {
            expect(recorded.actions[1]).toMatchObject({ payload: { midiRowCoordinates: expect.any(Object) } });
        }
        if (mode === 'zero hints') {
            expect(recorded.actions[1]).toMatchObject({
                payload: kind === 'slip' ? { rowLiftBeats: 0 } : { midiOffsetBeats: 0, loopOriginBeat: null },
            });
        }
        const serialized = JSON.stringify(recorded);
        const saved: typeof recorded = JSON.parse(serialized);
        macroStore.set({ macros: [saved], recording: false, currentRecording: [] });
        if (mode === 'zero hints' && kind === 'trim') {
            await executeAppAction(slip(5));
        }
        mutateCrdtDoc<{ tracks: TrackStoreState }>({
            id: 'root',
            changeFn: (document) => {
                const clip = document.tracks.tracks[0]?.clips.find((candidate) => candidate.id === CLIP_ID);
                if (!clip) {
                    throw new Error('Expected the current clip');
                }
                clip.loopLength = mode === 'same loop' ? 8 : 4;
                clip.loopEnabled = mode !== 'unlooped';
                if (kind === 'trim') {
                    clip.loopOriginBeat = 3;
                }
            },
        });
        projectCrdtToStores({ resetProjections: true });
        const product = () => ({ rows: readRows(), clip: structuredClone(readClip()) });

        for (let playback = 0; playback < 2; playback += 1) {
            peerRows((state) => {
                state.notesByClipId[CLIP_ID]![0]!.startBeat += playback * 0.125;
                state.notesByClipId[CLIP_ID]![0]!.velocity = 42 + playback;
                state.notesByClipId[CLIP_ID]![0]!.expression = { pressure: [{ offsetBeats: 0.125, value: 0.5 }] };
                state.notesByClipId[CLIP_ID]!.push({
                    id: `new-peer-${playback}`,
                    startBeat: 0.2 + playback,
                    pitch: 64,
                    duration: 0.5,
                    velocity: 80,
                });
                state.ccByClipId[CLIP_ID] = [
                    { id: 'peer-cc', beat: 0.3 + playback, controller: 1, value: 42, channel: 2 },
                ];
                state.pitchBendByClipId[CLIP_ID]![0]!.beat += 0.25;
                state.pitchBendByClipId[CLIP_ID]![0]!.value = -2048;
                state.notesByClipId.other = [
                    { id: 'unrelated', startBeat: 0.1, pitch: 67, duration: 0.5, velocity: 90 },
                ];
            });
            const before = product();
            const pastLength = undoStore.value!.past.length;
            // Independent real producers use only public request fields. Undo
            // their own executions to restore the identical macro prestate.
            await executeAppAction(kind === 'slip' ? freshSlip(forwardOffset) : trim(2));
            const freshFirst = product();
            await executeAppAction(kind === 'slip' ? freshSlip(previousOffset) : trim(0));
            const freshSecond = product();
            await saveAndReload();
            await expect(undo()).resolves.toEqual({ headConsumed: true });
            expect(product()).toEqual(freshFirst);
            await saveAndReload();
            await expect(undo()).resolves.toEqual({ headConsumed: true });
            expect(product()).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(pastLength);

            await executeAppAction({ type: 'playMacro', payload: { macroId: saved.id } });
            expect(product()).toEqual(freshSecond);
            expect(undoStore.value?.past).toHaveLength(pastLength + 2);
            const replayedEntries = undoStore.value!.past.slice(-2);
            expect(replayedEntries.every((entry) => entry.groupId === undefined)).toBe(true);
            expect(JSON.stringify(macroStore.value?.macros[0])).toBe(serialized);
            await saveAndReload();
            await expect(undo()).resolves.toEqual({ headConsumed: true });
            expect(product()).toEqual(freshFirst);
            expect(undoStore.value?.past).toHaveLength(pastLength + 1);
            await saveAndReload();
            await expect(undo()).resolves.toEqual({ headConsumed: true });
            expect(product()).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(pastLength);
            expect(undoStore.value?.future).toHaveLength(2);
            await saveAndReload();
            await redo();
            expect(product()).toEqual(freshFirst);
            await saveAndReload();
            await redo();
            expect(product()).toEqual(freshSecond);
            expect(undoStore.value?.past).toHaveLength(pastLength + 2);
            expect(undoStore.value?.future).toHaveLength(0);
        }
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('keeps aliased capability reversions coherent when both original entries replay with peers and reload', async () => {
        seed();
        const initial = readRows();
        await executeAppAction(slip());
        const originalEntry = undoStore.value?.past.at(-1);
        const id = actionHistoryStore.value?.entries.at(-1)?.id;
        if (!id || originalEntry?.kind !== 'action') {
            throw new Error('Expected a recorded action capability');
        }
        expect(getActionReplayStatus(id)).toEqual({ status: 'ready' });
        await expect(revertAction(id)).resolves.toEqual({ status: 'executed' });
        expect(getActionReplayStatus(id)).toEqual({ status: 'unavailable' });
        expect(actionHistoryStore.value?.entries.find((entry) => entry.id === id)?.reverted).toBe(true);
        const reversion = undoStore.value?.past.at(-1);
        if (reversion?.kind !== 'action') {
            throw new Error('Expected an undoable reversion');
        }
        expect(reversion.action).toBe(originalEntry.inverseAction);
        expect(readRows()).toEqual(initial);
        await undo();
        await undo();
        expect(readRows()).toEqual(initial);
        peerRows((state) => {
            state.notesByClipId[CLIP_ID]!.push({ id: 'peer', startBeat: 0.2, pitch: 64, duration: 0.5, velocity: 80 });
        });
        const peer = readRows();
        await redo();
        const beforeCounter = readRows();
        expect(beforeCounter?.notesByClipId[CLIP_ID]?.[1]?.startBeat).toBe(0.2 + 8);
        await redo();
        // This row did not exist when this counteraction captured its inverse.
        // It receives the current semantic translation, not another entry's capture.
        const afterCounter = structuredClone(peer)!;
        afterCounter.notesByClipId[CLIP_ID]![1]!.startBeat = 0.2 + 8 - 8;
        expect(readRows()).toEqual(afterCounter);
        expect(undoStore.value?.past).toHaveLength(2);
        expect(actionHistoryStore.value?.entries.find((entry) => entry.id === id)?.reverted).toBe(true);
        await saveAndReload();
        expect(getActionReplayStatus(id)).toEqual({ status: 'unavailable' });
        for (let cycle = 0; cycle < 2; cycle += 1) {
            await undo();
            expect(readRows()).toEqual(beforeCounter);
            await undo();
            expect(readRows()).toEqual(peer);
            await saveAndReload();
            await redo();
            expect(readRows()).toEqual(beforeCounter);
            await redo();
            expect(readRows()).toEqual(afterCounter);
            await saveAndReload();
        }
    });

    it('aborts a partial owner write and retains actual history captures when the clip setter throws', async () => {
        seed();
        await executeAppAction(slip());
        await settleMirror();
        const before = snapshot();
        let partialMidi: ReturnType<typeof readRows> | undefined;
        const setter = vi.spyOn(trackStore, 'set').mockImplementationOnce(() => {
            partialMidi = structuredClone(midiStore.value);
            throw new Error('injected clip setter failure after MIDI preparation applied');
        });
        try {
            await expect(undo()).rejects.toThrow('injected clip setter failure');
        } finally {
            setter.mockRestore();
        }
        expect(partialMidi).toBeDefined();
        expect(partialMidi).not.toEqual(before.midi);
        await settleMirror();
        expect(snapshot()).toEqual(before);
        await undo();
        await redo();
        expect(readRows()).toEqual(before.midi);
    });
});
