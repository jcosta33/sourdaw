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
import { DEFAULT_TEMPO_BPM, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { canonicalJson, digest } from '#/utils/canonicalDigest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { removeWarpState, setWarpState } from '../../../stores/warpStates';
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

type DetectedHit = { sampleOffset: number; confidence: number };
const defaultHits: DetectedHit[] = [{ sampleOffset: 24000, confidence: 0.875 }];

function startDetection(
    detected: { tempo: number; hits: DetectedHit[] } = { tempo: 120, hits: defaultHits },
    completeUnchanged = false,
    beforeFirstFrame?: () => void
) {
    let framesWaited = 0;
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
                tempo: detected.tempo,
                hits: detected.hits,
                isCurrent,
                completeUnchanged: () => completeUnchanged,
            },
            {
                signal: controller.signal,
                isCurrent,
                waitForFrame: async () => {
                    framesWaited += 1;
                    if (framesWaited === 1) {
                        beforeFirstFrame?.();
                    }
                    return isCurrent();
                },
            }
        ),
    }));
    const action = { type: 'detectTransients' as const, payload: { clipId: 'clip-1' } };
    const description = handleDetectTransients.describe(action);
    const transaction = runWithAutomergeStorageTransaction(undefined, () => handleDetectTransients.execute(action));
    if (transaction.status !== 'returned') {
        throw transaction.error;
    }
    return { description, transaction, cancel: () => controller.abort() };
}

function waitForFirstReply(
    firstReply: ReturnType<typeof installProspectiveWorker>['firstReply'],
    completion: ReturnType<typeof startDetection>['transaction']['value']
) {
    return Promise.race([
        firstReply,
        Promise.resolve(completion).then((result) => {
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
                    tracks: [
                        {
                            id: 'track-1',
                            clips: [{ id: 'clip-1', type: 'audio', audioBufferId: 'audio-1', startBeat: 0 }],
                        },
                    ],
                };
            },
        });
        setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: 120, markers: [lockedMarker] });
        flushAutomergeStorageWrites();
        hydrateTempoProjections();
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

    function setTransportTempo(tempo: number): void {
        mutateCrdtDoc<{ transport: { tempo: number } }>({
            id: 'root',
            changeFn: (document) => {
                document.transport.tempo = tempo;
            },
        });
        hydrateTempoProjections();
    }

    async function detectAndCommit(detected: { tempo: number; hits: DetectedHit[] }) {
        installProspectiveWorker();
        const { description, transaction } = startDetection(detected);
        try {
            const result = await transaction.value;
            expect(result?.status).toBe('written');
            const validation = result?.commitValidation;
            if (!validation) {
                throw new Error('Expected the Detect document validator');
            }
            transaction.validateDocument(validation.documentId, validation.validateDocument);
            transaction.commit();
            return description;
        } finally {
            transaction.abort();
        }
    }

    // Playback reads the stores, which project the document slots: refresh them after a raw document edit.
    function hydrateTempoProjections(): void {
        tempoMapStore.hydrate();
        transportStore.hydrate();
    }

    function restoreSnapshots(inverseAction: { type: string; payload?: unknown } | null | undefined) {
        if (inverseAction?.type !== 'restoreTrackClipStates') {
            throw new Error('Expected the Detect inverse to restore track clip states');
        }
        return inverseAction.payload as {
            expected: { clipSatellites: { clipId: string; warpState: { originalTempo: number | null } | null }[] }[];
            replacement: { clipSatellites: { clipId: string; warpState: { originalTempo: number | null } | null }[] }[];
        };
    }

    function storedWarpState() {
        return (getCrdtDoc('root') as { warpStates: { states: Record<string, unknown> } }).warpStates.states['clip-1'];
    }

    it('stamps the clip-start tempo as the reference tempo and encodes a hit at it', async () => {
        setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: null, markers: [] });
        await detectAndCommit({ tempo: 120, hits: [{ sampleOffset: 24000, confidence: 0.875 }] });
        expect(storedWarpState()).toMatchObject({
            originalTempo: 120,
            markers: [{ originalBeat: 1, warpedBeat: 1, origin: 'transient-auto', confidence: 0.875 }],
        });
    });

    it('keeps encoding at the stored reference tempo after the transport tempo changes', async () => {
        const userMarker = { id: 'user', originalBeat: 2, warpedBeat: 2, origin: 'user' as const, locked: false };
        setWarpState('clip-1', {
            enabled: true,
            stretchMode: 'repitch',
            originalTempo: 120,
            markers: [userMarker],
        });
        setTransportTempo(90);
        await detectAndCommit({
            tempo: 90,
            hits: [
                { sampleOffset: 48000, confidence: 0.5 },
                { sampleOffset: 24000, confidence: 0.75 },
            ],
        });
        const state = storedWarpState() as { originalTempo: number; markers: { id: string; originalBeat: number }[] };
        expect(state.originalTempo).toBe(120);
        expect(state.markers.map(({ id, originalBeat }) => [id, originalBeat])).toEqual([
            [expect.any(String), 1],
            ['user', 2],
        ]);
    });

    it('completes a clip with no stored warp state and no hits without writing one', async () => {
        const { firstReply } = installProspectiveWorker();
        removeWarpState('clip-1');
        flushAutomergeStorageWrites();
        const { transaction } = startDetection({ tempo: 120, hits: [] }, true);
        try {
            const result = await Promise.race([
                transaction.value,
                firstReply.then(() => {
                    throw new Error('Detect planned a write for an unchanged warp state');
                }),
            ]);
            expect(result?.status).toBe('no-write');
            transaction.commit();
        } finally {
            transaction.abort();
        }
        expect(storedWarpState()).toBeUndefined();
    });

    it('completes a markerless clip that keeps a stored reference tempo and finds no hits without writing', async () => {
        const { firstReply } = installProspectiveWorker();
        const stored = { enabled: false, stretchMode: 'repitch' as const, originalTempo: 120, markers: [] };
        setWarpState('clip-1', stored);
        flushAutomergeStorageWrites();
        const { description, transaction } = startDetection({ tempo: 120, hits: [] }, true);
        try {
            const result = await Promise.race([
                transaction.value,
                firstReply.then(() => {
                    throw new Error('Detect planned a write for an unchanged warp state');
                }),
            ]);
            expect(result?.status).toBe('no-write');
            transaction.commit();
        } finally {
            transaction.abort();
        }
        expect(storedWarpState()).toEqual(stored);
        const inverse = restoreSnapshots(description.inverseAction);
        expect(inverse.expected).toEqual([]);
        expect(inverse.replacement).toEqual([]);
    });

    it('stamps the tempo-map tempo at the clip start, not the project base tempo', async () => {
        mutateCrdtDoc<{ tempoMap: { changes: unknown[] }; tracks: { tracks: { clips: { startBeat: number }[] }[] } }>({
            id: 'root',
            changeFn: (document) => {
                document.tempoMap = {
                    changes: [
                        { id: 'base', beat: 0, tempo: 120, curve: 'instant' },
                        { id: 'slow', beat: 4, tempo: 90, curve: 'instant' },
                    ],
                };
                const clip = document.tracks.tracks[0]?.clips[0];
                if (clip) {
                    clip.startBeat = 8;
                }
            },
        });
        hydrateTempoProjections();
        setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: null, markers: [] });
        await detectAndCommit({ tempo: 120, hits: [{ sampleOffset: 24000, confidence: 0.875 }] });
        expect(storedWarpState()).toMatchObject({
            originalTempo: 90,
            markers: [{ originalBeat: 0.75, warpedBeat: 0.75, origin: 'transient-auto', confidence: 0.875 }],
        });
    });

    it('refuses the commit when the clip-start tempo changes after planning', async () => {
        setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: null, markers: [] });
        installProspectiveWorker();
        const { transaction } = startDetection();
        try {
            const result = await transaction.value;
            expect(result?.status).toBe('written');
            const validation = result?.commitValidation;
            if (!validation) {
                throw new Error('Expected the Detect document validator');
            }
            mutateCrdtDoc<{ tempoMap: { changes: unknown[] } }>({
                id: 'root',
                changeFn: (document) => {
                    document.tempoMap = { changes: [{ id: 'slow', beat: 0, tempo: 90, curve: 'instant' }] };
                },
            });
            hydrateTempoProjections();
            transaction.validateDocument(validation.documentId, validation.validateDocument);
            expect(() => transaction.commit()).toThrow('Transient detection authority changed inside commit');
        } finally {
            transaction.abort();
        }
        expect(storedWarpState()).toEqual({
            enabled: true,
            stretchMode: 'repitch',
            originalTempo: null,
            markers: [],
        });
    });

    it('does not refuse the commit when the clip-start tempo changes after planning but a reference tempo is stored', async () => {
        setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: 120, markers: [] });
        installProspectiveWorker();
        const { transaction } = startDetection();
        try {
            const result = await transaction.value;
            expect(result?.status).toBe('written');
            const validation = result?.commitValidation;
            if (!validation) {
                throw new Error('Expected the Detect document validator');
            }
            mutateCrdtDoc<{ tempoMap: { changes: unknown[] } }>({
                id: 'root',
                changeFn: (document) => {
                    document.tempoMap = { changes: [{ id: 'slow', beat: 0, tempo: 90, curve: 'instant' }] };
                },
            });
            hydrateTempoProjections();
            transaction.validateDocument(validation.documentId, validation.validateDocument);
            transaction.commit();
        } finally {
            transaction.abort();
        }
        expect(storedWarpState()).toMatchObject({ originalTempo: 120 });
    });

    describe('reads the clip-start tempo through the sanitized projections playback uses', () => {
        const expectedBeat = (referenceTempo: number): number => ((24000 / 48000) * referenceTempo) / 60;

        function corruptDocument(corrupt: (document: Record<string, any>) => void): void {
            mutateCrdtDoc<Record<string, any>>({ id: 'root', changeFn: corrupt });
            hydrateTempoProjections();
        }

        it('ignores an out-of-range tempo-map row before the clip', async () => {
            corruptDocument((document) => {
                document.tempoMap = {
                    changes: [
                        { id: 'base', beat: 0, tempo: 90, curve: 'instant' },
                        { id: 'wild', beat: 4, tempo: 5000, curve: 'instant' },
                    ],
                };
                document.tracks.tracks[0].clips[0].startBeat = 8;
            });
            setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: null, markers: [] });
            await detectAndCommit({ tempo: 120, hits: defaultHits });
            expect(storedWarpState()).toMatchObject({
                originalTempo: 90,
                markers: [{ originalBeat: 0.75, warpedBeat: 0.75 }],
            });
        });

        it('drops a malformed tempo-map row and keeps the transport tempo', async () => {
            corruptDocument((document) => {
                document.transport.tempo = 100;
                document.tempoMap = { changes: [{ id: 'bad', beat: 'zero', tempo: 90, curve: 'instant' }] };
            });
            setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: null, markers: [] });
            await detectAndCommit({ tempo: 120, hits: defaultHits });
            expect(storedWarpState()).toMatchObject({
                originalTempo: 100,
                markers: [{ originalBeat: expectedBeat(100) }],
            });
        });

        it.each([
            [
                'the transport tempo is not a number',
                (document: Record<string, any>) => {
                    document.transport.tempo = 'fast';
                },
            ],
            [
                'the transport is missing',
                (document: Record<string, any>) => {
                    delete document.transport;
                },
            ],
        ])('stamps the default tempo when %s', async (_name, corrupt) => {
            corruptDocument(corrupt);
            setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: null, markers: [] });
            await detectAndCommit({ tempo: 120, hits: defaultHits });
            expect(storedWarpState()).toMatchObject({
                originalTempo: DEFAULT_TEMPO_BPM,
                markers: [{ originalBeat: expectedBeat(DEFAULT_TEMPO_BPM) }],
            });
        });
    });

    describe('refuses without writing when the clip cannot be found for the clip-start tempo', () => {
        const refusal = {
            status: 'conflict',
            reason: 'Transient detection was cancelled or its source changed',
        };
        const unreadableDocuments: [string, (document: Record<string, any>) => void][] = [
            [
                'the clip is absent from the document',
                (document) => {
                    document.tracks.tracks[0].clips = [];
                },
            ],
            [
                'the clip has no start beat',
                (document) => {
                    delete document.tracks.tracks[0].clips[0].startBeat;
                },
            ],
        ];

        function corruptDocument(corrupt: (document: Record<string, any>) => void): void {
            mutateCrdtDoc<Record<string, any>>({ id: 'root', changeFn: corrupt });
        }

        function refuseIfWorkerPosts(
            firstReply: ReturnType<typeof installProspectiveWorker>['firstReply'],
            completion: ReturnType<typeof startDetection>['transaction']['value']
        ) {
            return Promise.race([
                completion,
                firstReply.then(() => {
                    throw new Error('Detect posted a Worker request instead of refusing');
                }),
            ]);
        }

        it.each(unreadableDocuments)('at planning time when %s', async (_name, corrupt) => {
            const { firstReply, requests } = installProspectiveWorker();
            setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: null, markers: [] });
            flushAutomergeStorageWrites();
            corruptDocument(corrupt);
            const stored = storedWarpState();
            const saved = getCrdtDoc('root');
            const { transaction } = startDetection();
            try {
                expect(await refuseIfWorkerPosts(firstReply, transaction.value)).toEqual(refusal);
                expect(requests).toHaveLength(0);
                expect(getCrdtDoc('root')).toBe(saved);
                expect(storedWarpState()).toEqual(stored);
            } finally {
                transaction.abort();
            }
        });

        it.each(unreadableDocuments)(
            'at commit time on the ordinary write route when %s after planning',
            async (_name, corrupt) => {
                const { firstReply, requests } = installProspectiveWorker();
                const stored = { enabled: true, stretchMode: 'repitch' as const, originalTempo: null, markers: [] };
                setWarpState('clip-1', stored);
                flushAutomergeStorageWrites();
                // Planning sees an identical markerless state, so it prepares nothing; the stored state then gains
                // an auto marker, so the commit replan differs and takes the ordinary write route.
                const withAutoMarker = {
                    enabled: true,
                    stretchMode: 'repitch' as const,
                    originalTempo: null,
                    markers: [
                        {
                            id: 'auto',
                            originalBeat: 1,
                            warpedBeat: 1,
                            origin: 'transient-auto' as const,
                            locked: false,
                        },
                    ],
                };
                const { transaction } = startDetection({ tempo: 120, hits: [] }, false, () => {
                    setWarpState('clip-1', withAutoMarker);
                    corruptDocument(corrupt);
                });
                try {
                    expect(await refuseIfWorkerPosts(firstReply, transaction.value)).toEqual(refusal);
                    expect(requests).toHaveLength(0);
                } finally {
                    transaction.abort();
                }
                expect(storedWarpState()).toEqual(stored);
            }
        );
    });

    it('carries the reference tempo in the undo snapshots: null before, the stamped tempo after', async () => {
        trackStore.trySet({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [ClipDummy.create({ id: 'clip-1', trackId: 'track-1', audioBufferId: 'audio-1' })],
                }),
            ],
            selectedTrackId: null,
        });
        setWarpState('clip-1', { enabled: true, stretchMode: 'repitch', originalTempo: null, markers: [] });
        const description = await detectAndCommit({ tempo: 120, hits: defaultHits });
        const inverse = restoreSnapshots(description.inverseAction);
        const entries = inverse.replacement.flatMap((entry) => entry.clipSatellites);
        const expectedEntries = inverse.expected.flatMap((entry) => entry.clipSatellites);
        expect(entries.find((satellite) => satellite.clipId === 'clip-1')?.warpState?.originalTempo).toBeNull();
        expect(expectedEntries.find((satellite) => satellite.clipId === 'clip-1')?.warpState?.originalTempo).toBe(120);
    });

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
