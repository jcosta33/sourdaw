import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { createDefaultKit } from '../../models/ToasterKit';
import { fromToasterKitState } from '../../models/ToasterKitState';
import {
    defaultToasterState,
    registerToasterDevice,
    toasterStore,
    toggleStep,
    unregisterToasterDevice,
} from '../../stores/toasterStore';
import { copyMorphTargetPattern } from '../copyMorphTargetPattern';
import { exportPatternToTimeline } from '../exportPatternToTimeline';
import { initToasterKitPersistence } from '../initToasterKitPersistence';
import { setMorphPosition } from '../setMorphPosition/setMorphPosition';
import { toggleMorph } from '../setMorphPosition/toggleMorph';

const DEVICE_ID = 'toaster-bake-integration';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function projectSlots() {
    const document = getCrdtDoc<{ tracks?: unknown; midi?: unknown }>('root');
    if (!document) {
        throw new Error('The integration document is absent');
    }
    return structuredClone({ tracks: document.tracks, midi: document.midi });
}

function prepareTracks(frozenSecondChild = false) {
    const tracks = sanitizeTrackSnapshot({
        selectedTrackId: null,
        tracks: [
            {
                id: 'parent',
                name: 'Drums',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Toaster',
                        type: 'toaster',
                        bypassed: false,
                        parameterValues: {},
                    },
                ],
            },
            { id: 'child-0', name: 'Kick', kind: 'midi', parentId: 'parent' },
            { id: 'child-1', name: 'Snare', kind: 'midi', parentId: 'parent' },
            { id: 'child-2', name: 'Hat', kind: 'midi', parentId: 'parent', frozen: frozenSecondChild },
        ],
    }).tracks;
    trackStore.set({ ...defaultTrackState, tracks });
}

function prepareKit() {
    const kit = createDefaultKit();
    const a = kit.patterns[0]!;
    a.tracks[0]!.steps[0]!.active = true;
    a.tracks[2]!.steps[1]!.active = true;
    toasterStore.set({ [DEVICE_ID]: { ...defaultToasterState, kit } });
}

describe('Toaster effective pattern batch in project truth', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Toaster bake integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getMidiNoteTransformHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        projectStore.set({ ...defaultProjectStoreState, initialized: true, loading: false });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        prepareTracks();
        prepareKit();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        toasterStore.set({});
        trackStore.set({ ...defaultTrackState, tracks: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        projectStore.set(defaultProjectStoreState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('commits every pad lane together; one Undo removes all clips and notes and Redo restores them exactly', async () => {
        const result = await exportPatternToTimeline(DEVICE_ID);
        expect(result).toEqual({ ok: true });
        const createdTracks = structuredClone(trackStore.value?.tracks);
        const createdNotes = structuredClone(midiStore.value?.notesByClipId);
        const createdDocument = projectSlots();
        expect(createdTracks?.find((track) => track.id === 'child-0')?.clips).toHaveLength(1);
        expect(createdTracks?.find((track) => track.id === 'child-2')?.clips).toHaveLength(1);
        expect(Object.values(createdNotes ?? {}).flat()).toHaveLength(2);
        expect(undoStore.value?.past).toHaveLength(4);
        const groupIds = undoHistoryStore.value?.past.map((entry) => entry.groupId) ?? [];
        expect(groupIds).toHaveLength(4);
        expect(groupIds[0]).toEqual(expect.any(String));
        expect(groupIds[0]).not.toBe('');
        expect(new Set(groupIds).size).toBe(1);

        await undo();
        expect(trackStore.value?.tracks.find((track) => track.id === 'child-0')?.clips).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === 'child-2')?.clips).toEqual([]);
        expect(Object.values(midiStore.value?.notesByClipId ?? {}).flat()).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(4);

        await redo();
        expect(trackStore.value?.tracks).toEqual(createdTracks);
        expect(midiStore.value?.notesByClipId).toEqual(createdNotes);
        expect(projectSlots()).toEqual(createdDocument);
    });

    it('reports missing Undo history after a committed bake without losing clips or notes', async () => {
        setActionHistoryMetadataPort({
            ...noActionHistoryMetadataPort,
            recordBatch: () => {
                throw new Error('History unavailable');
            },
        });
        const beforeDocument = projectSlots();
        const result = await exportPatternToTimeline(DEVICE_ID);
        const committedDocument = projectSlots();
        expect(trackStore.value?.tracks.find((track) => track.id === 'child-0')?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks.find((track) => track.id === 'child-2')?.clips).toHaveLength(1);
        expect(Object.values(midiStore.value?.notesByClipId ?? {}).flat()).toHaveLength(2);
        expect(committedDocument).not.toEqual(beforeDocument);
        expect(undoStore.value?.past).toHaveLength(0);
        await undo();
        expect(projectSlots()).toEqual(committedDocument);
        expect(result).toEqual({
            ok: true,
            warning: 'The pattern was added to the timeline, but Undo history is unavailable.',
        });
    });

    it('rejects a late frozen lane with no partial document, store, or history writes', async () => {
        prepareTracks(true);
        const beforeDocument = projectSlots();
        const beforeTracks = structuredClone(trackStore.value);
        const beforeMidi = structuredClone(midiStore.value);
        const beforeHistory = structuredClone(undoStore.value);

        expect((await exportPatternToTimeline(DEVICE_ID)).ok).toBe(false);
        expect(projectSlots()).toEqual(beforeDocument);
        expect(trackStore.value).toEqual(beforeTracks);
        expect(midiStore.value).toEqual(beforeMidi);
        expect(undoStore.value).toEqual(beforeHistory);
    });

    it('preserves a queued ordinary step edit when the later morph command passes a held project snapshot', async () => {
        expect(await copyMorphTargetPattern(DEVICE_ID)).toBe(true);
        const stopPersistence = initToasterKitPersistence();
        let releaseSnapshot = (): void => {};
        const snapshotGate = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });
        let snapshotEntered = (): void => {};
        const entered = new Promise<void>((resolve) => {
            snapshotEntered = resolve;
        });
        const snapshot = transactSnapshot(async () => {
            snapshotEntered();
            await snapshotGate;
        });
        await entered;

        try {
            toggleStep(DEVICE_ID, 0, 3);
            const morphCommit = toggleMorph(DEVICE_ID);
            releaseSnapshot();
            await snapshot;
            expect(await morphCommit).toBe(true);
            await vi.waitFor(() => {
                const device = trackStore.value?.tracks[0]?.devices[0];
                const saved = fromToasterKitState(device?.deviceState);
                expect(saved.patterns[0]?.tracks[0]?.steps[3]?.active).toBe(true);
                expect(saved.morph?.enabled).toBe(true);
            });
        } finally {
            releaseSnapshot();
            stopPersistence();
        }
    });

    it('commits the last position in a rapid sweep through a held project snapshot', async () => {
        expect(await copyMorphTargetPattern(DEVICE_ID)).toBe(true);
        let releaseSnapshot = (): void => {};
        const snapshotGate = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });
        let snapshotEntered = (): void => {};
        const entered = new Promise<void>((resolve) => {
            snapshotEntered = resolve;
        });
        const snapshot = transactSnapshot(async () => {
            snapshotEntered();
            await snapshotGate;
        });
        await entered;

        try {
            const first = setMorphPosition(DEVICE_ID, 0.25);
            const last = setMorphPosition(DEVICE_ID, 0.75);
            releaseSnapshot();
            await snapshot;
            expect(await Promise.all([first, last])).toEqual([true, true]);
            const saved = fromToasterKitState(trackStore.value?.tracks[0]?.devices[0]?.deviceState);
            expect(saved.morph?.position).toBe(0.75);
            expect(toasterStore.value?.[DEVICE_ID]?.kit.morph?.position).toBe(0.75);
        } finally {
            releaseSnapshot();
        }
    });

    it('refuses an old queued morph after device teardown and permits its replacement instance', async () => {
        expect(await copyMorphTargetPattern(DEVICE_ID)).toBe(true);
        let releaseSnapshot = (): void => {};
        const snapshotGate = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });
        let snapshotEntered = (): void => {};
        const entered = new Promise<void>((resolve) => {
            snapshotEntered = resolve;
        });
        const snapshot = transactSnapshot(async () => {
            snapshotEntered();
            await snapshotGate;
        });
        await entered;

        try {
            const stale = setMorphPosition(DEVICE_ID, 0.25);
            const replacementKit = toasterStore.value?.[DEVICE_ID]?.kit;
            unregisterToasterDevice(DEVICE_ID);
            registerToasterDevice(DEVICE_ID, replacementKit);
            const fresh = setMorphPosition(DEVICE_ID, 0.75);
            releaseSnapshot();
            await snapshot;
            expect(await stale).toBe(false);
            expect(await fresh).toBe(true);
            expect(toasterStore.value?.[DEVICE_ID]?.kit.morph?.position).toBe(0.75);
        } finally {
            releaseSnapshot();
        }
    });
});
