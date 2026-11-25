import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';
import { type Clip, type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    createVersionedCommandEnvelope,
    executeAppAction,
    parseVersionedCommandEnvelope,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureDurableDocumentWitness,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    loadCrdtProject,
    markActionHistoryEntryReverted,
    persistCrdtProject,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    sessionUndoWitnessStampPort,
} from '#/modules/CrdtDocument/useCases';
import { isRecord } from '#/utils/structuralEquality';

import { arrangementStore } from '../../stores/arrangementStore';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { locateMissingMedia } from '../locateMissingMedia';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';

const SESSION_KEY = 'sourdaw-undo-session';
const io = vi.hoisted(() => ({ buffers: new Map<string, AudioBuffer>(), decode: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: ({ bufferId }: { bufferId: string }) => io.buffers.get(bufferId) ?? null,
    decodeAudioFile: io.decode,
    discardDecodedAudioFile: vi.fn(),
    getAudioContext: () => null,
    prepareCachedAudioBuffersFromIdb: async () => ({ publish: () => undefined, cancel: () => undefined }),
}));
vi.mock('../../repositories/nativeFileDialog/pickFiles', () => ({
    pickFiles: async () => [new File(['audio'], 'replacement.wav')],
}));

type Root = { tracks: { tracks: Track[] } };

function track(id: string, clipId: string): Track {
    const clip: Clip = {
        id: clipId,
        trackId: id,
        name: `${clipId}.wav`,
        type: 'audio',
        audioBufferId: 'missing',
        startBeat: 0,
        endBeat: 4,
        audioOffsetSeconds: 1.25,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
    return { ...createTrack({ id, name: id, kind: 'audio', withoutDefaultDevice: true }), clips: [clip] };
}

function registerProduction(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
}

function reconcile(): void {
    expect(projectStore.value?.projectId).toBeTypeOf('string');
    reconcileSessionUndoForProject({
        projectId: projectStore.value?.projectId,
        captureWitness: captureDurableDocumentWitness,
    });
}

function mirror(): Record<string, unknown> & { past: unknown[]; future: unknown[] } {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!isRecord(value) || !Array.isArray(value.past) || !Array.isArray(value.future)) {
        throw new Error('Expected the production undo session mirror');
    }
    return { ...value, past: value.past, future: value.future };
}

function expectSources(source: string): void {
    flushAutomergeStorageWrites();
    const raw = getCrdtDoc<Root>('root')?.tracks.tracks;
    expect(raw?.flatMap((owner) => owner.clips.map((clip) => clip.audioBufferId))).toEqual([source, source]);
    expect(trackStore.value?.tracks.flatMap((owner) => owner.clips.map((clip) => clip.audioBufferId))).toEqual([
        source,
        source,
    ]);
}

function expectPriorColor(color: string): void {
    expect(getCrdtDoc<Root>('root')?.tracks.tracks.find((owner) => owner.id === 'track-one')?.color).toBe(color);
    expect(trackStore.value?.tracks.find((owner) => owner.id === 'track-one')?.color).toBe(color);
}

async function createHistory(): Promise<void> {
    await executeAppAction({ type: 'setTrackColor', payload: { trackId: 'track-one', color: '#123456' } });
    await vi.waitFor(() => expect(mirror().past).toHaveLength(1));
    await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
    expectSources('replacement');
    expectPriorColor('#123456');
    expect(undoHistoryStore.value?.past).toHaveLength(2);
    await persistCrdtProject();
    expect(mirror()).toMatchObject({
        projectId: projectStore.value?.projectId,
        witness: captureDurableDocumentWitness(),
    });
    expect(mirror().past).toHaveLength(2);
}

async function reloadSession(): Promise<void> {
    const savedWitness = captureDurableDocumentWitness();
    const projectId = projectStore.value?.projectId;
    removeCrdtDoc('root');
    createCrdtDoc('root');
    await expect(loadCrdtProject()).resolves.toBe(true);
    projectCrdtToStores({ resetProjections: true });
    expect(projectStore.value?.projectId).toBe(projectId);
    expect(captureDurableDocumentWitness()).toBe(savedWitness);
    registerProduction();
    reconcile();
}

function target(
    entry: Record<string, unknown>,
    family: 'action' | 'inverseAction' | 'redoAction'
): Record<string, unknown> {
    const action = entry[family];
    const payload = isRecord(action) ? action.payload : null;
    const first = isRecord(payload) && Array.isArray(payload.targets) ? payload.targets[0] : null;
    if (!isRecord(first)) {
        throw new Error('Expected captured relink target');
    }
    return first;
}

const corruptions: readonly { name: string; corrupt: (entry: Record<string, unknown>) => void }[] = [
    {
        name: 'inverse is missing',
        corrupt: (entry) => {
            entry.inverseAction = null;
        },
    },
    {
        name: 'redo is missing',
        corrupt: (entry) => {
            delete entry.redoAction;
        },
    },
    {
        name: 'inverse has another action family',
        corrupt: (entry) => {
            entry.inverseAction = { type: 'renameTrack', payload: { trackId: 'track-one', name: 'Other' } };
        },
    },
    {
        name: 'redo has another action family',
        corrupt: (entry) => {
            entry.redoAction = { type: 'renameTrack', payload: { trackId: 'track-one', name: 'Other' } };
        },
    },
    {
        name: 'inverse owner differs',
        corrupt: (entry) => {
            target(entry, 'inverseAction').trackId = 'other-owner';
        },
    },
    {
        name: 'forward active alternative differs',
        corrupt: (entry) => {
            target(entry, 'action').activeAlternativeId = 'other-active';
        },
    },
    {
        name: 'inverse before is not the forward after',
        corrupt: (entry) => {
            target(entry, 'inverseAction').before = { audioBufferId: 'forged' };
        },
    },
    {
        name: 'inverse after is not the forward before',
        corrupt: (entry) => {
            target(entry, 'inverseAction').after = { audioBufferId: 'forged' };
        },
    },
    {
        name: 'redo differs from the forward capture',
        corrupt: (entry) => {
            target(entry, 'redoAction').after = { audioBufferId: 'forged' };
        },
    },
    {
        name: 'source capture is malformed',
        corrupt: (entry) => {
            target(entry, 'inverseAction').after = { audioBufferId: 1 };
        },
    },
];

describe('Locate session Undo through production registration and durable reload', () => {
    let indexedDb: TransactionalIndexedDbInstallation;

    beforeAll(() => {
        indexedDb = installTransactionalIndexedDb();
        registerProjectSlotProjections();
    });
    afterAll(async () => {
        await indexedDb.dispose();
    });
    beforeEach(async () => {
        io.buffers.clear();
        io.decode.mockImplementation(async () => {
            const buffer = MockAudioBuffer.create(1, 8, 48000);
            io.buffers.set('replacement', buffer);
            return { id: 'replacement', buffer };
        });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Locate session Undo fixture');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        resetActionReplayAuthority();
        agentProjectRepairStateStore.set(null);
        clearUndoHistory();
        sessionStorage.removeItem(SESSION_KEY);
        projectStore.set({ ...defaultProjectStoreState, loading: false, initialized: true });
        trackStore.set({
            tracks: [track('track-one', 'clip-a'), track('track-two', 'clip-alias')],
            selectedTrackId: null,
        });
        arrangementStore.set({ activeArrangementId: 'arr-a', arrangements: [] });
        flushAutomergeStorageWrites();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        sessionUndoWitnessStampPort.setProvider(stampSessionUndoWitness);
        registerProduction();
        reconcile();
    });
    afterEach(() => {
        flushAutomergeStorageWrites();
        clearUndoHistory();
        clearHandlerRegistry();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        sessionStorage.removeItem(SESSION_KEY);
        vi.restoreAllMocks();
    });

    it('hydrates reachable past and future relinks, retaining a prior edit and actual alias Undo/Redo', async () => {
        const originalColor = trackStore.value?.tracks[0]?.color;
        if (originalColor === undefined) {
            throw new Error('Expected the original track color');
        }
        await createHistory();
        const livePastEntry = undoHistoryStore.value?.past.at(-1);
        await reloadSession();
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect(undoHistoryStore.value?.past.at(-1)).not.toBe(livePastEntry);
        expect(undoHistoryStore.value?.past.at(-1)).toMatchObject({ action: { type: 'relinkClipAudioSources' } });
        expectSources('replacement');
        await undo();
        expectSources('missing');
        expectPriorColor('#123456');
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
        await persistCrdtProject();
        expect(mirror().past).toHaveLength(1);
        expect(mirror().future).toHaveLength(1);
        const liveFutureEntry = undoHistoryStore.value?.future[0];
        await reloadSession();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
        expect(undoHistoryStore.value?.future[0]).not.toBe(liveFutureEntry);
        await redo();
        expectSources('replacement');
        expectPriorColor('#123456');
        await undo();
        await undo();
        flushAutomergeStorageWrites();
        expectPriorColor(originalColor);
        expectSources('missing');
    });

    it.each(corruptions)('rejects a hydrated relink whose $name without writing sources', async ({ corrupt }) => {
        await createHistory();
        const saved = mirror();
        const entry = saved.past.at(-1);
        if (!isRecord(entry)) {
            throw new Error('Expected serialized relink entry');
        }
        corrupt(entry);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
        const before = JSON.stringify(getCrdtDoc<Root>('root')?.tracks);
        const witness = captureDurableDocumentWitness();
        registerProduction();
        reconcile();
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
        expect(JSON.stringify(getCrdtDoc<Root>('root')?.tracks)).toBe(before);
        expect(captureDurableDocumentWitness()).toBe(witness);
        expectSources('replacement');
        expectPriorColor('#123456');
    });

    it('keeps the locally replayable relink rejected at the provider serialized boundary', async () => {
        await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        const entry = undoHistoryStore.value?.past[0];
        if (entry?.kind !== 'action' || entry.action.type !== 'relinkClipAudioSources') {
            throw new Error('Expected real relink action');
        }
        const envelope = createVersionedCommandEnvelope({
            action: entry.action,
            availableDeviceVersions: {},
            expectedEffect: 'Relink source',
            normalizedProjectRevision: captureDurableDocumentWitness(),
            objectReferences: [],
            parameterUnits: [],
            reason: 'Relink source',
            time: [],
        });
        expect(parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(envelope))).toEqual({
            status: 'invalid',
            reason: 'Command operation is not deterministic at the serialized boundary',
        });
        expectSources('replacement');
    });
});
