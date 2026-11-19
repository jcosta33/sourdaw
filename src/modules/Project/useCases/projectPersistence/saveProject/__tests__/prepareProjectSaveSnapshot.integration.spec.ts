import { Blob as NativeBlob } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { performance as nativePerformance, PerformanceObserver } from 'node:perf_hooks';
import { MessageChannel } from 'node:worker_threads';

import * as A from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectLifecycle } from '#/app/registerProjectLifecycle';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { NativePreparationWorker, settleNativePreparationWorkers } from '#/helpers/__tests__/nativePreparationWorker';
import { applyCanonicalStorageSlotMutation } from '#/infra/store/storage/applyCanonicalStorageSlotMutation';
import {
    captureAutomergeStoragePreparationScope,
    configureAutomergeStoragePort,
    createAutomergeStoragePreview,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { getWarpState, trackStore } from '#/modules/Arrangement/stores';
import { addClip, addTrack, hydrateClipWarpStates, renameTrack } from '#/modules/Arrangement/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectIdentity,
    exportSdawFile,
    getCrdtDoc,
    getCrdtDocIds,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
    subscribeToCrdtChanges,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { type HandlerExecutionResult } from '#/utils/handlerContract';
import { matchesJsonFingerprint } from '#/utils/jsonSemanticEquality';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { seedDenseProject } from '../../../../__tests__/seedDenseProject';
import { createProjectId } from '../../../../models/ProjectData';
import { arrangementStore } from '../../../../stores/arrangementStore';
import { projectLoadFailureStore } from '../../../../stores/projectLoadFailureStore';
import { getSettledProjectId, projectStore } from '../../../../stores/projectStore';
import { syncCurrentArrangementToStore } from '../../../arrangement/syncCurrentArrangementToStore';
import { takeSnapshot } from '../../../arrangement/takeSnapshot';
import { createFreshProjectMetadata } from '../../../createFreshProjectMetadata';
import { resetModuleStoresToDefault } from '../../helpers/resetModuleStoresToDefault';
import { prepareProjectSaveSnapshot, ProjectSavePreparationStaleError } from '../prepareProjectSaveSnapshot';

const requests: { key: unknown; policy: unknown }[] = [];
let nextReply: ReturnType<typeof Promise.withResolvers<() => void>> | undefined;

class ObservedNativePreparationWorker extends NativePreparationWorker {
    override postMessage(data: unknown, transfer: ArrayBuffer[]): void {
        if (!isRecord(data) || !isRecord(data.mutation)) {
            throw new Error('Expected the actual canonical native preparation request');
        }
        requests.push({ key: data.mutation.key, policy: data.preparationPolicy });
        const handler = requireValue(this.onmessage);
        const held = nextReply;
        nextReply = undefined;
        this.onmessage = (event) => {
            let delivered = false;
            const deliver = (): void => {
                if (!delivered) {
                    delivered = true;
                    handler.call(this, event);
                }
            };
            if (held) {
                held.resolve(deliver);
            } else {
                deliver();
            }
        };
        super.postMessage(data, transfer);
    }
}

function requireValue<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) {
        throw new Error('Expected actual project preparation authority');
    }
    return value;
}

type NativeRoot = {
    [key: string]: unknown;
    projectMeta: Record<string, unknown>;
    arrangements: NonNullable<typeof arrangementStore.value>;
};

function root() {
    return requireValue(getCrdtDoc<NativeRoot>('root'));
}

function materializeExpectedArrangementSlot(value: NonNullable<typeof arrangementStore.value>): unknown {
    const empty = A.init<Record<string, unknown>>();
    const preview = createAutomergeStoragePreview(new Map([['root', empty]]));
    try {
        preview.scope(() => arrangementStore.set(value));
        const slot = requireValue(preview.getDocument('root')?.arrangements);
        // The detached owner omits unencodable optional fields. The intended
        // JSON verifies it did not silently sanitize any persisted content.
        expect(matchesJsonFingerprint(slot, JSON.stringify(value))).toBe(true);
        return slot;
    } finally {
        preview.release();
        A.free(empty);
    }
}

function witnessNativeTruth(): () => void {
    const original = root();
    const truth = A.toJS(original);
    const heads = A.getHeads(original);
    const history = A.getChangesMetaSince(original, []);
    return () => {
        expect(root()).toBe(original);
        expect(A.toJS(root())).toEqual(truth);
        expect(A.getHeads(root())).toEqual(heads);
        expect(A.getChangesMetaSince(root(), [])).toEqual(history);
    };
}

function reinstallNativeRoot(): void {
    replaceCrdtDoc({ id: 'root', doc: A.from(A.toJS(root())) });
}

function finishLoadedProjection(): void {
    // Cold projection deliberately restores transient launch/loading defaults.
    // This fixture represents the loaded session that is allowed to Save.
    const project = requireValue(projectStore.value);
    projectStore.set({ ...project, loading: false, initialized: true });
    flushAutomergeStorageWrites();
    expect(getSettledProjectId()).toBe(root().projectMeta.projectId);
    expect(projectStore.value?.loading).toBe(false);
}

function seedProject(): void {
    resetCrdtProjectAuthority('Private Save preparation');
    resetModuleStoresToDefault();
    projectStore.set(createFreshProjectMetadata({ name: 'Private Save', initialized: true, loading: false }));
    requireValue(addTrack({ id: 'source-track', name: 'Original source', kind: 'audio' }));
    requireValue(
        addClip({
            id: 'source-clip',
            trackId: 'source-track',
            name: 'Retained audio',
            type: 'audio',
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'retained-pcm',
        })
    );
    requireValue(addTrack({ id: 'midi-track', name: 'MIDI control', kind: 'midi' }));
    requireValue(
        addClip({
            id: 'midi-clip',
            trackId: 'midi-track',
            name: 'MIDI phrase',
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
        })
    );
    setMidiStoreState({
        notesByClipId: {
            'midi-clip': [{ id: 'note', pitch: 61, startBeat: 0.25, duration: 0.75, velocity: 0.6 }],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
        noteCoordinateFormat: 'clip-relative',
    });
    hydrateClipWarpStates([
        {
            clipId: 'source-clip',
            ...getWarpState('source-clip'),
            enabled: true,
            markers: [{ id: 'manual', originalBeat: 1, warpedBeat: 1.125, origin: 'user', locked: true }],
        },
    ]);
    arrangementStore.set({
        activeArrangementId: 'active',
        arrangements: [takeSnapshot('active', 'Active'), takeSnapshot('inactive', 'Inactive')],
    });
    flushAutomergeStorageWrites();
    let retained = A.clone(root());
    for (let index = 0; index < 4; index++) {
        retained = A.change(retained, { message: `Retained native edit ${index}`, time: index }, (draft) => {
            draft.retainedControl = { index, fraction: 0.125 };
        });
    }
    retained = A.change(retained, (draft) => {
        draft._storagePublicationEvidence = [{ kind: 'source', version: 1, memberId: 'retained', digest: 'proof' }];
    });
    replaceCrdtDoc({ id: 'root', doc: retained });
    projectCrdtToStores({ resetProjections: true });
    finishLoadedProjection();
    renameTrack('source-track', 'Fresh live source');
    flushAutomergeStorageWrites();
    expect(requireValue(trackStore.value).tracks[0]?.name).toBe('Fresh live source');
    expect(root().arrangements.arrangements[0]?.tracks.tracks[0]?.name).toBe('Original source');
    expect(getWarpState('source-clip').markers).toEqual([
        expect.objectContaining({ id: 'manual', origin: 'user', locked: true }),
    ]);
}

function startPreparation(signal?: AbortSignal, expectedOutgoingProjectIdentity?: string) {
    const transaction = runWithAutomergeStorageTransaction(undefined, () =>
        prepareProjectSaveSnapshot(signal, expectedOutgoingProjectIdentity)
    );
    if (transaction.status !== 'returned') {
        throw transaction.error;
    }
    // Register rejection handling before the synchronous admission assertions.
    const settlement = Promise.allSettled([transaction.value]);
    return { ...transaction, settlement };
}

function registerValidation(transaction: ReturnType<typeof startPreparation>, result: HandlerExecutionResult): void {
    const validation = requireValue(result.commitValidation);
    transaction.validateCommit(validation.beforeCommit);
    transaction.validateDocument(validation.documentId, validation.validateDocument, validation.beforeMutation);
}

function holdPreparation(expectedOutgoingProjectIdentity?: string) {
    const reply = Promise.withResolvers<() => void>();
    nextReply = reply;
    const cancellation = new AbortController();
    const transaction = startPreparation(cancellation.signal, expectedOutgoingProjectIdentity);
    const response = Promise.race([
        reply.promise,
        transaction.value.then(() => {
            throw new Error('Preparation completed without its genuine native Worker reply');
        }),
    ]);
    return { transaction, cancellation, reply: response };
}

async function finishHeldPreparation(held: ReturnType<typeof holdPreparation>, deliver: () => void): Promise<void> {
    held.cancellation.abort();
    deliver();
    // The case asserts the preparation outcome; drain even a refusal during teardown.
    await held.transaction.settlement;
    held.transaction.abort();
}

const sourceEdits = [
    {
        source: 'track',
        edit() {
            renameTrack('source-track', 'Subscriber edit');
            return trackStore.value?.tracks[0]?.name;
        },
        expected: 'Subscriber edit',
    },
    {
        source: 'MIDI',
        edit() {
            const midi = requireValue(midiStore.value);
            setMidiStoreState({
                ...midi,
                notesByClipId: {
                    ...midi.notesByClipId,
                    'midi-clip': [
                        ...requireValue(midi.notesByClipId['midi-clip']),
                        { id: 'later-note', pitch: 72, startBeat: 2, duration: 0.5, velocity: 0.8 },
                    ],
                },
            });
            return midiStore.value?.notesByClipId['midi-clip']?.at(-1)?.id;
        },
        expected: 'later-note',
    },
    {
        source: 'warp',
        edit() {
            const warp = getWarpState('source-clip');
            hydrateClipWarpStates([
                {
                    ...warp,
                    clipId: 'source-clip',
                    markers: [
                        ...warp.markers,
                        { id: 'later-marker', originalBeat: 3, warpedBeat: 3.25, origin: 'user', locked: true },
                    ],
                },
            ]);
            return getWarpState('source-clip').markers.at(-1)?.id;
        },
        expected: 'later-marker',
    },
];

function observeSourceEdit(edit: () => string | undefined) {
    const edited = vi.fn(edit);
    const observe = (): void => {
        if (edited.mock.calls.length === 0) {
            edited();
        }
    };
    return { observe, edited };
}

async function expectRefusalBeforeWorker(message: string): Promise<void> {
    const projection = projectStore.value;
    const arrangements = arrangementStore.value;
    const verifyNativeTruth = witnessNativeTruth();
    const transaction = startPreparation(undefined, captureProjectIdentity());
    try {
        await expect(transaction.value).rejects.toThrow(message);
        expect(requests).toEqual([]);
        verifyNativeTruth();
        expect(projectStore.value).toBe(projection);
        expect(arrangementStore.value).toBe(arrangements);
    } finally {
        transaction.abort();
    }
}

beforeEach(() => {
    registerProjectLifecycle();
    registerProjectSlotProjections();
    registerCrdtStorageRuntime();
    requests.length = 0;
    nextReply = undefined;
    agentProjectRepairStateStore.set(null);
    projectLoadFailureStore.set(null);
    vi.stubGlobal('Worker', ObservedNativePreparationWorker);
    vi.stubGlobal('MessageChannel', MessageChannel);
    vi.stubGlobal('performance', nativePerformance);
    seedProject();
});

afterEach(async () => {
    await settleNativePreparationWorkers();
    configureAutomergeStoragePort(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    agentProjectRepairStateStore.set(null);
    projectLoadFailureStore.set(null);
});

describe('private Project Save preparation with real native storage', () => {
    it('validates and publishes the prepared snapshot when the owner commits later', async () => {
        const before = root();
        const beforeTruth = A.toJS(before);
        const history = A.getChangesMetaSince(before, []);
        const actor = A.getActorId(before);
        const control = A.clone(before);
        const cursor = A.saveIncremental(control);
        A.free(control);
        expect(cursor.byteLength).toBeGreaterThan(0);
        const state = requireValue(arrangementStore.value);
        const expected = materializeExpectedArrangementSlot({
            ...state,
            arrangements: state.arrangements.map((snapshot) =>
                snapshot.id === state.activeArrangementId ? takeSnapshot(snapshot.id, snapshot.name) : snapshot
            ),
        });
        const publications: string[][] = [];
        const unsubscribe = subscribeToCrdtChanges(() => publications.push(A.getHeads(root())));
        const transaction = startPreparation();
        try {
            expect(requests).toEqual([{ key: 'arrangements', policy: 'bounded-native-sequence-v1' }]);
            const result = await transaction.value;
            expect(result.status).toBe('written');
            expect(root()).toBe(before);
            expect(A.toJS(root())).toEqual(beforeTruth);
            expect(publications).toEqual([]);
            registerValidation(transaction, result);
            expect(() => transaction.commit()).not.toThrow();
            expect(publications).toHaveLength(1);
            expect(A.toJS(root())).toEqual({
                ...beforeTruth,
                arrangements: expected,
                projectMeta: { ...requireValue(beforeTruth.projectMeta), updatedAt: projectStore.value?.updatedAt },
            });
            expect(A.getActorId(root())).toBe(actor);
            expect(A.getChangesMetaSince(root(), []).slice(0, history.length)).toEqual(history);
            expect(A.saveIncremental(before)).toEqual(cursor);
        } finally {
            transaction.abort();
            unsubscribe();
        }
    });

    it.each([
        { loading: true, initialized: true },
        { loading: false, initialized: false },
    ])('keeps ordinary preparation closed with loading=$loading or initialized=$initialized', async (flags) => {
        projectStore.set({ ...requireValue(projectStore.value), ...flags });
        const verifyNativeTruth = witnessNativeTruth();
        const transaction = startPreparation();
        try {
            await expect(transaction.value).rejects.toThrow('requires settled project identity');
            expect(requests).toEqual([]);
            verifyNativeTruth();
        } finally {
            transaction.abort();
        }
    });

    it('prepares and commits the outgoing take snapshot while the replacement is loading', async () => {
        const project = requireValue(projectStore.value);
        const updatedAt = project.updatedAt + 1;
        vi.spyOn(Date, 'now').mockReturnValue(updatedAt);
        projectStore.set({ ...project, loading: true, initialized: false, dirty: false });
        const before = A.toJS(root());
        const state = requireValue(arrangementStore.value);
        const expected = materializeExpectedArrangementSlot({
            ...state,
            arrangements: [takeSnapshot('active', 'Active'), requireValue(state.arrangements[1])],
        });
        const verifyNativeTruth = witnessNativeTruth();
        const held = holdPreparation(captureProjectIdentity());
        const deliver = await held.reply;
        try {
            expect(requests).toEqual([{ key: 'arrangements', policy: 'bounded-native-sequence-v1' }]);
            verifyNativeTruth();
            deliver();
            const result = await held.transaction.value;
            expect(result.status).toBe('written');
            verifyNativeTruth();
            registerValidation(held.transaction, result);
            held.transaction.commit();
            expect(A.toJS(root())).toEqual({
                ...before,
                arrangements: expected,
                projectMeta: { ...before.projectMeta, updatedAt },
            });
            expect(projectStore.value).toMatchObject({ loading: true, initialized: false, dirty: true, updatedAt });
        } finally {
            await finishHeldPreparation(held, deliver);
        }
    });

    it('refuses a spent outgoing identity before requesting a Worker even when persisted metadata still matches', async () => {
        const expectedOutgoingProjectIdentity = captureProjectIdentity();
        const oldMetadata = A.toJS(root()).projectMeta;
        const project = projectStore.value;
        const arrangements = arrangementStore.value;
        reinstallNativeRoot();
        expect(captureProjectIdentity()).not.toBe(expectedOutgoingProjectIdentity);
        expect(A.toJS(root()).projectMeta).toEqual(oldMetadata);
        expect(projectStore.value).toBe(project);
        const verifyNativeTruth = witnessNativeTruth();
        const transaction = startPreparation(undefined, expectedOutgoingProjectIdentity);
        try {
            await expect(transaction.value).rejects.toThrow('Project authority changed during Save preparation');
            expect(requests).toEqual([]);
            verifyNativeTruth();
            expect(projectStore.value).toBe(project);
            expect(arrangementStore.value).toBe(arrangements);
        } finally {
            transaction.abort();
        }
    });

    it.each(['projectId', 'createdAt'] as const)(
        'refuses %s disagreement before requesting a Worker even for the current outgoing identity',
        async (input) => {
            const project = requireValue(projectStore.value);
            const mismatching = A.change(A.clone(root()), (draft) => {
                draft.projectMeta[input] = input === 'projectId' ? createProjectId() : project.createdAt + 1;
            });
            replaceCrdtDoc({ id: 'root', doc: mismatching });
            expect(root().projectMeta[input]).not.toBe(project[input]);
            expect(projectStore.value).toBe(project);

            await expectRefusalBeforeWorker('requires matching outgoing project metadata');
        }
    );

    it('refuses pending identity migration before requesting a Worker even for the current outgoing identity', async () => {
        const project = requireValue(projectStore.value);
        projectStore.set({ ...project, identityMigrationPending: true });
        expect(projectStore.value?.identityMigrationPending).toBe(true);

        await expectRefusalBeforeWorker('requires settled project identity');
    });

    it('does not stage or replan a replaced outgoing root while its genuine Worker reply is held', async () => {
        const project = requireValue(projectStore.value);
        projectStore.set({ ...project, loading: true, initialized: false });
        const oldMetadata = A.toJS(root()).projectMeta;
        const expectedOutgoingProjectIdentity = captureProjectIdentity();
        const held = holdPreparation(expectedOutgoingProjectIdentity);
        const deliver = await held.reply;
        try {
            const arrangements = arrangementStore.value;
            const projection = projectStore.value;
            reinstallNativeRoot();
            expect(captureProjectIdentity()).not.toBe(expectedOutgoingProjectIdentity);
            expect(A.toJS(root()).projectMeta).toEqual(oldMetadata);
            const verifyNativeTruth = witnessNativeTruth();
            const refusal = held.transaction.value.catch((error: unknown) => error);
            deliver();
            const error = await refusal;
            expect(error).toBeInstanceOf(Error);
            expect(error).not.toBeInstanceOf(ProjectSavePreparationStaleError);
            expect(error).toMatchObject({ message: 'Project authority changed during Save preparation' });
            expect(projectStore.value).toBe(projection);
            expect(arrangementStore.value).toBe(arrangements);
            held.transaction.abort();
            verifyNativeTruth();
            expect(projectStore.value).toEqual(projection);
            expect(arrangementStore.value).toEqual(arrangements);
        } finally {
            await finishHeldPreparation(held, deliver);
        }
    });

    it('refuses a replaced outgoing root at the later owner commit', async () => {
        const project = requireValue(projectStore.value);
        projectStore.set({ ...project, loading: true, initialized: false });
        const expectedOutgoingProjectIdentity = captureProjectIdentity();
        const oldMetadata = A.toJS(root()).projectMeta;
        const transaction = startPreparation(undefined, expectedOutgoingProjectIdentity);
        try {
            const result = await transaction.value;
            registerValidation(transaction, result);
            reinstallNativeRoot();
            expect(captureProjectIdentity()).not.toBe(expectedOutgoingProjectIdentity);
            expect(A.toJS(root()).projectMeta).toEqual(oldMetadata);
            const verifyNativeTruth = witnessNativeTruth();
            expect(() => transaction.commit()).toThrow('Project authority changed during Save preparation');
            transaction.abort();
            verifyNativeTruth();
        } finally {
            transaction.abort();
        }
    });

    it('keeps native truth and both projected owned slots unchanged until the real reply is admitted', async () => {
        const before = root();
        const project = projectStore.value;
        const arrangements = arrangementStore.value;
        const held = holdPreparation();
        const deliver = await held.reply;
        try {
            expect(captureAutomergeStoragePreparationScope()).toBeUndefined();
            expect(root()).toBe(before);
            expect(projectStore.value).toBe(project);
            expect(arrangementStore.value).toBe(arrangements);
            deliver();
            const result = await held.transaction.value;
            expect(captureAutomergeStoragePreparationScope()).toBeUndefined();
            expect(root()).toBe(before);
            expect(projectStore.value?.dirty).toBe(true);
            expect(arrangementStore.value?.arrangements[0]?.tracks.tracks[0]?.name).toBe('Fresh live source');
            registerValidation(held.transaction, result);
            held.transaction.commit();
            expect(root().arrangements.arrangements[0]?.tracks.tracks[0]?.name).toBe('Fresh live source');
        } finally {
            await finishHeldPreparation(held, deliver);
        }
    });

    it('settles a real pending predecessor before capturing the native preparation base', async () => {
        const before = root();
        renameTrack('source-track', 'Pending owner edit');
        expect(root()).toBe(before);
        const transaction = startPreparation();
        try {
            expect(root()).not.toBe(before);
            expect(requests).toEqual([{ key: 'arrangements', policy: 'bounded-native-sequence-v1' }]);
            const result = await transaction.value;
            registerValidation(transaction, result);
            transaction.commit();
            expect(root().arrangements.arrangements[0]?.tracks.tracks[0]?.name).toBe('Pending owner edit');
            expect(trackStore.value?.tracks[0]?.name).toBe('Pending owner edit');
        } finally {
            transaction.abort();
        }
    });

    it.each(
        sourceEdits.flatMap((source) => [
            { ...source, slot: 'metadata', subscribe: (observe: () => void) => projectStore.subscribe(observe) },
            { ...source, slot: 'arrangement', subscribe: (observe: () => void) => arrangementStore.subscribe(observe) },
        ])
    )(
        'refuses a same-owner $source edit from the $slot staging notification',
        async ({ edit, expected, subscribe }) => {
            const before = root();
            const truth = A.toJS(before);
            const { observe, edited } = observeSourceEdit(edit);
            const unsubscribe = subscribe(observe);
            const transaction = startPreparation();
            try {
                await expect(transaction.value).rejects.toBeInstanceOf(ProjectSavePreparationStaleError);
                expect(edited).toHaveReturnedWith(expected);
                expect(root()).toBe(before);
                transaction.abort();
                flushAutomergeStorageWrites();
                expect(A.toJS(root())).toEqual(truth);
            } finally {
                unsubscribe();
                transaction.abort();
            }
        }
    );

    it.each(sourceEdits)('refuses a same-owner $source edit before the later commit', async ({ edit, expected }) => {
        const before = root();
        const truth = A.toJS(before);
        const heads = A.getHeads(before);
        const { observe, edited } = observeSourceEdit(edit);
        const transaction = startPreparation();
        try {
            const result = await transaction.value;
            transaction.scope(observe);
            expect(A.getHeads(root())).toEqual(heads);
            registerValidation(transaction, result);
            expect(() => transaction.commit()).toThrow(ProjectSavePreparationStaleError);
            expect(edited).toHaveReturnedWith(expected);
            expect(root()).toBe(before);
            transaction.abort();
            flushAutomergeStorageWrites();
            expect(A.toJS(root())).toEqual(truth);
        } finally {
            transaction.abort();
        }
    });

    it('preserves a newer external source edit and dirty metadata when its prepared owner aborts', async () => {
        const transaction = startPreparation();
        try {
            const result = await transaction.value;
            renameTrack('source-track', 'External edit');
            const project = requireValue(projectStore.value);
            projectStore.set({ ...project, updatedAt: project.updatedAt + 100, dirty: true });
            flushAutomergeStorageWrites();
            const external = root();
            const truth = A.toJS(external);
            registerValidation(transaction, result);
            expect(() => transaction.commit()).toThrow(ProjectSavePreparationStaleError);
            transaction.abort();
            flushAutomergeStorageWrites();
            expect(root()).toBe(external);
            expect(A.toJS(root())).toEqual(truth);
            expect(trackStore.value?.tracks[0]?.name).toBe('External edit');
            expect(projectStore.value?.updatedAt).toBe(project.updatedAt + 100);
            expect(projectStore.value?.dirty).toBe(true);
        } finally {
            transaction.abort();
        }
    });

    it.each(['aborted signal', 'closed owner', 'replacement', 'agent repair', 'load failure'] as const)(
        'refuses %s while its genuine reply is held without reviving native publication',
        async (reason) => {
            const before = root();
            const truth = A.toJS(before);
            const held = holdPreparation();
            const deliver = await held.reply;
            try {
                if (reason === 'aborted signal') {
                    held.cancellation.abort(new Error('Cancelled Save preparation'));
                } else if (reason === 'closed owner') {
                    held.transaction.abort();
                } else if (reason === 'replacement') {
                    resetCrdtProjectAuthority('Replacement authority');
                } else if (reason === 'agent repair') {
                    agentProjectRepairStateStore.set({
                        audioGraphValid: false,
                        detectedRevision: 'repair-fixture',
                        inspectionAvailable: true,
                        projectInvariantsValid: false,
                        rawProjectRetained: true,
                        repairCandidates: [],
                        status: 'repair-required',
                    });
                } else {
                    projectLoadFailureStore.set({ message: 'Needs repair', projectName: 'Private Save' });
                }
                const authority = root();
                const authorityTruth = A.toJS(authority);
                const expectedAuthority = reason === 'replacement' ? authority : before;
                const expectedTruth = reason === 'replacement' ? authorityTruth : truth;
                deliver();
                const [outcome] = await held.transaction.settlement;
                expect(outcome).toMatchObject({ status: 'rejected', reason: expect.any(Error) });
                expect(outcome).not.toMatchObject({ reason: expect.any(ProjectSavePreparationStaleError) });
                held.transaction.abort();
                expect(root()).toBe(authority);
                expect(A.toJS(root())).toEqual(authorityTruth);
                expect(authority).toBe(expectedAuthority);
                expect(A.toJS(authority)).toEqual(expectedTruth);
            } finally {
                await finishHeldPreparation(held, deliver);
            }
        }
    );

    it('refuses a stale same-project source while its reply is held and retains the real external write', async () => {
        const held = holdPreparation();
        const deliver = await held.reply;
        try {
            renameTrack('source-track', 'Later live source');
            flushAutomergeStorageWrites();
            const external = root();
            const truth = A.toJS(external);
            deliver();
            await expect(held.transaction.value).rejects.toBeInstanceOf(ProjectSavePreparationStaleError);
            held.transaction.abort();
            expect(root()).toBe(external);
            expect(A.toJS(root())).toEqual(truth);
        } finally {
            await finishHeldPreparation(held, deliver);
        }
    });

    it('validates both native owned slots rather than admitting a wrong private target', async () => {
        const source = root();
        const before = A.toJS(source);
        const state = requireValue(arrangementStore.value);
        const intended = materializeExpectedArrangementSlot({
            ...state,
            arrangements: state.arrangements.map((snapshot) =>
                snapshot.id === state.activeArrangementId ? takeSnapshot(snapshot.id, snapshot.name) : snapshot
            ),
        });
        const transaction = startPreparation();
        try {
            const result = await transaction.value;
            const validation = requireValue(result.commitValidation);
            let candidate = A.clone(source);
            candidate = A.change(candidate, (draft) => {
                applyCanonicalStorageSlotMutation(draft, {
                    kind: 'canonical-json-slot-v1',
                    key: 'arrangements',
                    baseValue: before.arrangements,
                    value: intended,
                    documentPresence: { slot: before.arrangements },
                });
                draft.projectMeta.updatedAt = requireValue(projectStore.value).updatedAt;
            });
            try {
                expect(A.toJS(candidate).arrangements).toEqual(intended);
                expect(validation.validateDocument(candidate)).toBeNull();
                const wrongArrangement = A.change(A.clone(candidate), (draft) => {
                    requireValue(draft.arrangements.arrangements[0]).name = 'Wrong private arrangement';
                });
                const wrongMetadata = A.change(A.clone(candidate), (draft) => {
                    draft.projectMeta.name = 'Wrong private metadata';
                });
                try {
                    expect(validation.validateDocument(wrongArrangement)).toBe(
                        'Prepared Save snapshot or metadata changed before publication'
                    );
                    expect(validation.validateDocument(wrongMetadata)).toBe(
                        'Prepared Save snapshot or metadata changed before publication'
                    );
                } finally {
                    A.free(wrongArrangement);
                    A.free(wrongMetadata);
                }
            } finally {
                A.free(candidate);
            }
            registerValidation(transaction, result);
            transaction.commit();
        } finally {
            transaction.abort();
        }
    });

    it('stages metadata alone when the active cache is already current', async () => {
        syncCurrentArrangementToStore();
        flushAutomergeStorageWrites();
        const before = root();
        const truth = A.toJS(before);
        const updatedAt = requireValue(projectStore.value).updatedAt + 1;
        vi.spyOn(Date, 'now').mockReturnValue(updatedAt);
        const transaction = startPreparation();
        try {
            const result = await transaction.value;
            expect(requests).toEqual([]);
            expect(root()).toBe(before);
            registerValidation(transaction, result);
            transaction.commit();
            expect(A.toJS(root())).toEqual({ ...truth, projectMeta: { ...truth.projectMeta, updatedAt } });
            expect(projectStore.value?.dirty).toBe(true);
        } finally {
            transaction.abort();
        }
    });

    it('does not create native operations or retire evidence for an equal timestamp and dirty-only change', async () => {
        syncCurrentArrangementToStore();
        const project = requireValue(projectStore.value);
        projectStore.set({ ...project, dirty: false });
        flushAutomergeStorageWrites();
        const evidence = A.change(A.clone(root()), (draft) => {
            draft._storagePublicationEvidence = [{ kind: 'source', version: 1, memberId: 'retained', digest: 'proof' }];
        });
        replaceCrdtDoc({ id: 'root', doc: evidence });
        projectCrdtToStores({ resetProjections: true });
        finishLoadedProjection();
        const before = root();
        const truth = A.toJS(before);
        const heads = A.getHeads(before);
        vi.spyOn(Date, 'now').mockReturnValue(requireValue(projectStore.value).updatedAt);
        const transaction = startPreparation();
        try {
            const result = await transaction.value;
            expect(requests).toEqual([]);
            expect(projectStore.value?.dirty).toBe(true);
            registerValidation(transaction, result);
            transaction.commit();
            expect(A.getHeads(root())).toEqual(heads);
            expect(A.toJS(root())).toEqual(truth);
        } finally {
            transaction.abort();
        }
    });

    it('refuses unavailable native preparation without an unscoped or synchronous fallback', async () => {
        vi.stubGlobal('Worker', undefined);
        const before = root();
        const truth = A.toJS(before);
        const transaction = startPreparation();
        try {
            await expect(transaction.value).rejects.toThrow('Worker');
            expect(requests).toEqual([]);
            transaction.abort();
            expect(root()).toBe(before);
            expect(A.toJS(root())).toEqual(truth);
        } finally {
            transaction.abort();
        }
    });

    it('requires an actual open transaction owner', async () => {
        await expect(prepareProjectSaveSnapshot()).rejects.toThrow('requires an open owning transaction');
        expect(requests).toEqual([]);
    });

    it('prepares and later commits the existing dense native project through the private Save owner', async () => {
        seedDenseProject();
        finishLoadedProjection();
        vi.stubGlobal('Blob', NativeBlob);
        const original = root();
        const originalTruth = A.toJS(original);
        const history = A.getChangesMetaSince(original, []);
        const heads = A.getHeads(original);
        const actor = A.getActorId(original);
        expect(history.length).toBeGreaterThanOrEqual(2048);
        expect(trackStore.value?.tracks).toHaveLength(32);
        expect(trackStore.value?.tracks.flatMap((track) => track.clips)).toHaveLength(256);
        expect(Object.values(requireValue(midiStore.value).notesByClipId).flat()).toHaveLength(8192);
        for (let index = 0; index < 8; index++) {
            expect(getWarpState(`scale-clip-${index + 1}-0`).markers).toHaveLength(120);
        }
        const state = requireValue(arrangementStore.value);
        const intended = materializeExpectedArrangementSlot({
            ...state,
            arrangements: state.arrangements.map((snapshot) =>
                snapshot.id === state.activeArrangementId ? takeSnapshot(snapshot.id, snapshot.name) : snapshot
            ),
        });
        const control = A.clone(original);
        const cursor = A.saveIncremental(control);
        A.free(control);
        expect(cursor.byteLength).toBeGreaterThan(0);
        const updatedAt = requireValue(projectStore.value).updatedAt + 1;
        vi.spyOn(Date, 'now').mockReturnValue(updatedAt);
        const cancellation = new AbortController();
        const timings: { name: string; duration: number; detail?: unknown }[] = [];
        const report: {
            timings: typeof timings;
            totalWallMs?: number;
            nativePublications: number;
            nativePublicationsAtCommit?: number;
            nativeChunkCount?: number;
            reached: string[];
            failure?: string;
            cleanupRejection?: string;
        } = { timings, nativePublications: 0, reached: ['fixture-and-source-controls'] };
        const collect = (entries: readonly PerformanceEntry[]): void => {
            for (const entry of entries) {
                if (entry.name.startsWith('automerge-')) {
                    const detail: unknown = 'detail' in entry ? entry.detail : undefined;
                    timings.push({ name: entry.name, duration: entry.duration, detail });
                    if (
                        (entry.name.includes('prospective-') || entry.name.includes('materialization-handoff')) &&
                        entry.duration >= 50
                    ) {
                        const primaryKey = isRecord(detail) ? detail.primaryKey : undefined;
                        const sequenceIndex = isRecord(detail) ? detail.sequenceIndex : undefined;
                        const attribution = JSON.stringify({
                            primaryKey: typeof primaryKey === 'string' ? primaryKey : null,
                            sequenceIndex: typeof sequenceIndex === 'number' ? sequenceIndex : null,
                        });
                        cancellation.abort(
                            new Error(
                                `Actual native preparation phase reached 50 ms: ${entry.name} took ${entry.duration} ms ${attribution}`
                            )
                        );
                    }
                }
            }
        };
        const observer = new PerformanceObserver((list) => collect(list.getEntries()));
        observer.observe({ entryTypes: ['measure'] });
        const projectedHeads: string[][] = [];
        const unsubscribe = subscribeToCrdtChanges(() => {
            report.nativePublications += 1;
        });
        const unstore = arrangementStore.subscribe(() => projectedHeads.push(A.getHeads(root())));
        const wallStarted = performance.now();
        const prefixStarted = performance.now();
        const transaction = startPreparation(cancellation.signal);
        const prefixMs = performance.now() - prefixStarted;
        timings.push({ name: 'actual-helper-synchronous-prefix', duration: prefixMs });
        try {
            expect(requests).toEqual([{ key: 'arrangements', policy: 'bounded-native-sequence-v1' }]);
            if (prefixMs >= 50) {
                cancellation.abort(new Error('Actual private Save synchronous prefix exceeded50ms'));
            }
            expect(prefixMs, 'Actual private Save synchronous prefix').toBeLessThan(50);
            report.reached.push('prefix-bound');
            const result = await transaction.value;
            collect(observer.takeRecords());
            cancellation.signal.throwIfAborted();
            expect(root()).toBe(original);
            expect(report.nativePublications).toBe(0);
            expect(projectedHeads.length).toBeGreaterThan(0);
            expect(projectedHeads.every((value) => valuesEqual(value, heads))).toBe(true);
            registerValidation(transaction, result);
            const commitStarted = performance.now();
            transaction.commit();
            const commitMs = performance.now() - commitStarted;
            report.nativePublicationsAtCommit = report.nativePublications;
            timings.push({ name: 'actual-storage-commit-with-validators-and-subscribers', duration: commitMs });
            report.totalWallMs = performance.now() - wallStarted;
            expect(commitMs, 'Actual private Save storage commit').toBeLessThan(50);
            collect(observer.takeRecords());
            cancellation.signal.throwIfAborted();
            report.reached.push('native-admission-and-commit-bounds');
            expect(report.nativePublications).toBe(1);
            const updated = root();
            expect(A.toJS(updated)).toEqual({
                ...originalTruth,
                arrangements: intended,
                projectMeta: { ...originalTruth.projectMeta, updatedAt },
            });
            expect(A.getActorId(updated)).toBe(actor);
            expect(A.getChangesMetaSince(updated, []).slice(0, history.length)).toEqual(history);
            expect(A.saveIncremental(original)).toEqual(cursor);
            const additions = A.getChangesMetaSince(updated, heads);
            expect(additions.length).toBeGreaterThan(1);
            const supplemental = requireValue(additions.at(-1));
            const supplementalBytes = A.getChangesSince(updated, supplemental.deps);
            expect(supplementalBytes).toHaveLength(1);
            expect(A.decodeChange(requireValue(supplementalBytes[0])).ops).toEqual([
                expect.objectContaining({
                    action: 'set',
                    obj: requireValue(A.getObjectId(updated.projectMeta)),
                    key: 'updatedAt',
                    value: updatedAt,
                }),
            ]);
            report.nativeChunkCount = additions.length - 1;
            const expectedIndices = Array.from({ length: report.nativeChunkCount }, (_, index) => index);
            for (const name of [
                'automerge-prospective-response-task',
                'automerge-prospective-apply-task',
                'automerge-prospective-authority-task',
                'automerge-prospective-sequence-slice-task',
            ]) {
                const records = timings.filter((entry) => entry.name === name);
                expect(records, name).toHaveLength(report.nativeChunkCount);
                expect(
                    records.map(({ detail }) => {
                        if (!isRecord(detail)) {
                            throw new Error(`Missing actual native sequence detail: ${name}`);
                        }
                        return detail.sequenceIndex;
                    })
                ).toEqual(expectedIndices);
            }
            expect(
                timings.filter((entry) => entry.name === 'automerge-prospective-sequence-planning-task')
            ).toHaveLength(1);
            const historySlices = timings.filter(
                (entry) => entry.name === 'automerge-prospective-sequence-planning-history-task'
            );
            expect(historySlices).toHaveLength(Math.ceil(history.length / 128));
            for (const [index, entry] of historySlices.entries()) {
                expect(entry.detail).toEqual({
                    primaryKey: 'arrangements',
                    sequenceIndex: undefined,
                    historyIndex: index,
                    visitedChangeCount: Math.min(history.length, (index + 1) * 128),
                    historyComplete: index === historySlices.length - 1,
                });
                expect(entry.duration).toBeLessThan(50);
            }
            for (const name of [
                'automerge-storage-materialization-handoff-task',
                'automerge-storage-prepared-publication',
            ]) {
                const records = timings.filter((entry) => entry.name === name);
                expect(records, name).toHaveLength(1);
                expect(records[0]?.detail).toEqual({
                    preparationPolicy: 'bounded-native-sequence-v1',
                    primaryKey: 'arrangements',
                });
            }
            report.reached.push('complete-native-truth-history-cursor-and-phase-census');
            const actorSequence = requireValue(
                A.getChangesMetaSince(updated, []).findLast((entry) => entry.actor === actor)
            ).seq;
            renameTrack('scale-track-0', 'Later dense owner edit');
            flushAutomergeStorageWrites();
            const later = root();
            const laterTruth = A.toJS(later);
            const laterHistory = A.getChangesMetaSince(later, []);
            const laterChanges = A.getChangesMetaSince(later, A.getHeads(updated));
            expect(laterChanges).toHaveLength(1);
            expect(laterChanges[0]).toMatchObject({ actor, seq: actorSequence + 1 });
            expect(trackStore.value?.tracks[0]?.name).toBe('Later dense owner edit');
            const exportStarted = performance.now();
            const blob = exportSdawFile();
            const binary = await blob.arrayBuffer();
            timings.push({
                name: 'diagnostic-public-SDAW-export-and-Blob-arrayBuffer',
                duration: performance.now() - exportStarted,
                detail: { bytes: binary.byteLength, documents: getCrdtDocIds() },
            });
            expect(binary.byteLength).toBeGreaterThan(0);
            const encoding = A.clone(later);
            let bytes: Uint8Array;
            try {
                bytes = A.save(encoding);
            } finally {
                A.free(encoding);
            }
            const reloaded = A.load<NativeRoot>(bytes);
            try {
                expect(A.toJS(reloaded)).toEqual(laterTruth);
                expect(A.getHeads(reloaded)).toEqual(A.getHeads(later));
                expect(A.getChangesMetaSince(reloaded, [])).toEqual(laterHistory);
            } finally {
                A.free(reloaded);
            }
            report.reached.push('later-owner-edit-public-export-and-independent-native-reload');
        } catch (error) {
            report.failure = error instanceof Error ? error.message : String(error);
            throw error;
        } finally {
            report.totalWallMs ??= performance.now() - wallStarted;
            cancellation.abort();
            const [outcome] = await transaction.settlement;
            if (outcome.status === 'rejected') {
                const reason: unknown = outcome.reason;
                report.cleanupRejection = reason instanceof Error ? reason.message : String(reason);
            }
            transaction.abort();
            unstore();
            unsubscribe();
            collect(observer.takeRecords());
            observer.disconnect();
            if (process.env.SOURDAW_DENSE_SAVE_DIAGNOSTIC) {
                writeFileSync(process.env.SOURDAW_DENSE_SAVE_DIAGNOSTIC, JSON.stringify(report, null, 2));
            }
        }
    }, 70_000);
});
