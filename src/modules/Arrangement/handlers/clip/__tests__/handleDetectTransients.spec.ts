import { change, decodeChange, encodeChange, free, getChanges, getHeads, load } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    applyCanonicalStorageSlotMutation,
    type CanonicalStorageSlotMutation,
} from '#/infra/store/storage/applyCanonicalStorageSlotMutation';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { type detectTransientsForClip } from '#/modules/ElasticAudio/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { canonicalJson, digest } from '#/utils/canonicalDigest';

import { setWarpState } from '../../../stores/warpStates';
import { handleDetectTransients, transientStateMatches } from '../handleDetectTransients';

const mocks = vi.hoisted(() => ({ detect: vi.fn(), notice: vi.fn() }));
vi.mock('#/modules/ElasticAudio/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/ElasticAudio/useCases')>()),
    detectTransientsForClip: mocks.detect,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notice }));

function changedMarkerField(key: string): boolean | string | number {
    if (key === 'locked') {
        return false;
    }
    if (key === 'id' || key === 'origin') {
        return 'changed';
    }
    return 0.1;
}

describe('Arrangement Detect owns async admission and notification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        preferencesStore.trySet(defaultPreferences);
    });
    it.each([undefined, 0.9])('awaits failure and uses explicit or persisted sensitivity %s', async (sensitivity) => {
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
        let fail: ((value: { status: 'failed'; code: 'analysis-failed' }) => void) | undefined;
        mocks.detect.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    fail = resolve;
                })
        );
        const action = { type: 'detectTransients' as const, payload: { clipId: 'clip-1', sensitivity } };
        handleDetectTransients.describe(action);
        const result = handleDetectTransients.execute(action);
        expect(mocks.notice).not.toHaveBeenCalled();
        expect(mocks.detect).toHaveBeenCalledWith('clip-1', sensitivity ?? 0.82, undefined, expect.any(Function));
        fail?.({ status: 'failed', code: 'analysis-failed' });
        expect(await result).toEqual({ status: 'conflict', reason: 'Transient detection failed: analysis-failed' });
        expect(mocks.notice).toHaveBeenCalledWith('Transient detection failed: analysis-failed', 'error');
        expect(handleDetectTransients.undoable).toBe(true);
    });
});

type PreparationRequest = {
    seed: Uint8Array;
    actor: string;
    message?: string;
    mutation: CanonicalStorageSlotMutation;
    preparationPolicy?: string;
};

const lockedMarker = { id: 'locked', originalBeat: 2, warpedBeat: 2.5, origin: 'user' as const, locked: true };

function installProspectiveWorker() {
    const firstRequest = Promise.withResolvers<(malformed?: boolean) => void>();
    const requests: PreparationRequest[] = [];
    class ControlledWorker {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

        postMessage(request: PreparationRequest): void {
            const respond = (malformed = false): void => {
                const data = malformed ? { status: 'complete' } : prepareWorkerReply(request);
                this.onmessage?.(new MessageEvent('message', { data }));
            };
            requests.push(request);
            if (requests.length === 1) {
                firstRequest.resolve(respond);
                return;
            }
            respond();
        }

        terminate(): void {}
    }
    vi.stubGlobal('Worker', ControlledWorker);
    return { firstReply: firstRequest.promise, requests };
}

function prepareWorkerReply({ seed, actor, message, mutation }: PreparationRequest) {
    const before = load<Record<string, unknown>>(seed, { actor });
    const after = change(before, { message }, (draft) => applyCanonicalStorageSlotMutation(draft, mutation));
    try {
        const changes = getChanges(before, after).map((bytes) => {
            const { hash: _hash, ...decoded } = decodeChange(bytes);
            return Uint8Array.from(encodeChange(decoded));
        });
        const operationCount = changes.reduce((total, bytes) => total + decodeChange(bytes).ops.length, 0);
        return {
            status: 'complete',
            heads: getHeads(after),
            changes,
            sequence: { changeCount: changes.length, operationCount },
        };
    } finally {
        free(after);
    }
}

function startDetection() {
    const controller = new AbortController();
    const isCurrent = (): boolean => !controller.signal.aborted;
    type Consume = Parameters<typeof detectTransientsForClip>[3];
    mocks.detect.mockImplementationOnce(async (_clipId, _sensitivity, _signal, consume: Consume) => ({
        status: 'consumed',
        value: await consume(
            {
                status: 'complete',
                identity: {
                    clipId: 'clip-1',
                    trackId: 'track-1',
                    projectId: 'project-1',
                    bufferId: digest('audio-1'),
                    activeAlternative: true,
                    alternativeId: null,
                    sampleRate: 48000,
                    frameCount: 96000,
                    channelCount: 1,
                },
                tempo: 120,
                hits: [{ sampleOffset: 24000, confidence: 0.875 }],
                isCurrent,
                completeUnchanged: () => false,
            },
            { signal: controller.signal, isCurrent, waitForFrame: async () => isCurrent() }
        ),
    }));
    const action = { type: 'detectTransients' as const, payload: { clipId: 'clip-1' } };
    handleDetectTransients.describe(action);
    const transaction = runWithAutomergeStorageTransaction(undefined, () => handleDetectTransients.execute(action));
    if (transaction.status !== 'returned') {
        throw transaction.error;
    }
    return { transaction, cancel: () => controller.abort() };
}

function waitForFirstReply(
    firstReply: ReturnType<typeof installProspectiveWorker>['firstReply'],
    completion: ReturnType<typeof startDetection>['transaction']['value']
) {
    return Promise.race([
        firstReply,
        completion.then((result) => {
            throw new Error('Detect finished before posting its bounded Worker request', { cause: result });
        }),
    ]);
}

describe('Arrangement Detect admits private Worker preparations against current authority', () => {
    beforeEach(() => {
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        mutateCrdtDoc({
            id: 'root',
            changeFn: (document) => {
                document.projectMeta = { projectId: 'project-1', name: 'Before Save' };
                document.transport = { tempo: 120 };
                document.tracks = {
                    tracks: [{ id: 'track-1', clips: [{ id: 'clip-1', type: 'audio', audioBufferId: 'audio-1' }] }],
                };
            },
        });
        setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: 120, markers: [lockedMarker] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    function commitUnrelatedSave(): void {
        mutateCrdtDoc<{ projectMeta: { name: string } }>({
            id: 'root',
            changeFn: (document) => {
                document.projectMeta.name = 'Saved while Detect was in flight';
            },
        });
    }

    it('replans after a sibling commit invalidates the pending reply and publishes only the fresh markers', async () => {
        const { firstReply, requests } = installProspectiveWorker();
        const { transaction } = startDetection();
        try {
            const respond = await waitForFirstReply(firstReply, transaction.value);
            commitUnrelatedSave();
            const saved = getCrdtDoc('root');
            respond();
            const result = await transaction.value;
            expect(result?.status).toBe('written');
            const validation = result?.commitValidation;
            if (!validation) {
                throw new Error('Expected the Detect document validator');
            }
            expect(requests.map(({ mutation, preparationPolicy }) => [mutation.key, preparationPolicy])).toEqual([
                ['warpStates', 'bounded-native-sequence-v1'],
                ['warpStates', 'bounded-native-sequence-v1'],
            ]);
            expect(getCrdtDoc('root')).toBe(saved);
            transaction.validateDocument(validation.documentId, validation.validateDocument);
            transaction.commit();
            expect(getCrdtDoc('root')).toMatchObject({
                projectMeta: { projectId: 'project-1', name: 'Saved while Detect was in flight' },
                warpStates: {
                    states: {
                        'clip-1': { markers: [{ originalBeat: 1, warpedBeat: 1, confidence: 0.875 }, lockedMarker] },
                    },
                },
            });
        } finally {
            transaction.abort();
        }
    });

    it('does not retry an invalid reply while its document plan and source are current', async () => {
        const { firstReply, requests } = installProspectiveWorker();
        const { transaction } = startDetection();
        try {
            const respond = await waitForFirstReply(firstReply, transaction.value);
            const before = getCrdtDoc('root');
            respond(true);
            await expect(transaction.value).rejects.toThrow('Invalid prospective mutation Worker response');
            expect(requests).toHaveLength(1);
            expect(getCrdtDoc('root')).toBe(before);
        } finally {
            transaction.abort();
        }
    });

    it('cancels instead of replanning when both source and document authority expire', async () => {
        const { firstReply, requests } = installProspectiveWorker();
        const { transaction, cancel } = startDetection();
        try {
            await waitForFirstReply(firstReply, transaction.value);
            commitUnrelatedSave();
            const saved = getCrdtDoc('root');
            cancel();
            expect(await transaction.value).toEqual({
                status: 'conflict',
                reason: 'Transient detection was cancelled or its source changed',
            });
            expect(requests).toHaveLength(1);
            expect(getCrdtDoc('root')).toBe(saved);
        } finally {
            transaction.abort();
        }
    });
});

describe('prospective transient-state equality preserves the canonical oracle', () => {
    const marker = {
        id: 'locked-auto',
        originalBeat: 0.8,
        warpedBeat: 1.1,
        origin: 'transient-auto',
        confidence: 0.73,
        locked: true,
    };
    const state = { enabled: true, markers: [marker], stretchMode: 'repitch', originalTempo: 120 };
    const variants: unknown[] = [
        state,
        {
            originalTempo: 120,
            stretchMode: 'repitch',
            markers: [
                {
                    locked: true,
                    confidence: 0.73,
                    origin: 'transient-auto',
                    warpedBeat: 1.1,
                    originalBeat: 0.8,
                    id: 'locked-auto',
                },
            ],
            enabled: true,
        },
        { ...state, enabled: false },
        { ...state, stretchMode: 'wsola' },
        { ...state, originalTempo: 121 },
        { ...state, markers: [] },
        { ...state, unexpected: true },
        ...Object.keys(marker).map((key) => ({
            ...state,
            markers: [{ ...marker, [key]: changedMarkerField(key) }],
        })),
        { ...state, markers: [{ ...marker, unexpected: true }] },
        { ...state, markers: [{ ...marker, confidence: undefined }] },
        { ...state, markers: [{ id: marker.id, originalBeat: marker.originalBeat, warpedBeat: marker.warpedBeat }] },
        { ...state, markers: [marker, { ...marker, id: 'other' }] },
        { ...state, markers: [{ ...marker, id: 'other' }, marker] },
        { ...state, originalTempo: null },
        { ...state, originalTempo: undefined },
        { ...state, markers: [{ ...marker, originalBeat: -0 }] },
        { ...state, markers: [{ ...marker, originalBeat: 0 }] },
        [],
        { a: undefined },
        { b: undefined },
        [undefined],
        Array(1),
        [null],
        [Number.NaN],
        [Number.POSITIVE_INFINITY],
    ];
    it('agrees exactly for full fields, optional keys, unexpected structure and scalar edge cases', () => {
        for (const actual of variants) {
            for (const expected of variants) {
                expect(transientStateMatches(actual, expected)).toBe(canonicalJson(actual) === canonicalJson(expected));
            }
        }
    });
    it.each(['id', 'originalBeat', 'warpedBeat', 'origin', 'confidence', 'locked'] as const)(
        'rejects changed marker %s',
        (key) => {
            const changed = {
                ...state,
                markers: [{ ...marker, [key]: changedMarkerField(key) }],
            };
            expect(transientStateMatches(changed, state)).toBe(false);
        }
    );
});
