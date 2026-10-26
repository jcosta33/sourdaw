import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    captureProjectRevision,
    createCrdtDoc,
    hasCrdtDoc,
    registerCrdtStorageRuntime,
    mutateCrdtDoc,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { getSettledProjectId, projectStore } from '#/modules/Project/stores';
import { undoHistoryStore } from '#/modules/Command/stores';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type MeasurementAdmitter } from '../../models/MeasurementBudget';
import { remoteTransmissionDisclosure } from '../discloseRemoteTransmission';
import { getProjectContext } from '../getProjectContext';
import { parsePromptToActions } from '../parsePromptToActions';
import { encodeWireToolName } from '../../repositories/cloudLlm/cloudInference/encodeWireToolName';

import { getAgentToolCatalogSchemas } from '../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { getAgentToolCatalogEntries } from '../getAgentToolCatalogEntries';
import { getPlanningProviderToolSchemas } from '../getPlanningProviderToolSchemas';

const READ = 'analysis.detectTransients';

describe('planner transient read contract', () => {
    it('publishes a strict bounded source read schema to the provider and analysis catalog', () => {
        const schema = getAgentToolCatalogSchemas().find((entry) => entry.function.name === READ);
        expect(schema).toMatchObject({
            function: {
                name: READ,
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['clipId'],
                    properties: {
                        clipId: { type: 'string', minLength: 1, maxLength: 256 },
                        sensitivity: { type: 'number', minimum: 0, maximum: 1 },
                        cursor: { type: 'string', minLength: 1, maxLength: 128 },
                    },
                },
            },
        });
        expect(schema?.function.description).toContain('source-buffer');
        expect(getPlanningProviderToolSchemas()).toContainEqual(schema);
        expect(getAgentToolCatalogEntries({ category: 'analysis', names: [READ] }).items).toEqual([schema]);
    });

    it('keeps the source read unavailable without a bound session', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'unbound-onsets',
            terminalToolNames: new Set(['answer.respond']),
            requestTurn: vi.fn().mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ name: READ, arguments: { clipId: 'clip-1' } }],
            }),
        });
        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider requested an unavailable application tool.',
        });
    });

    it('bounds a thrown source-read executor as a correlated failure', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'throwing-onsets',
            terminalToolNames: new Set(['answer.respond']),
            transientOnsetRead: {
                execute: async () => {
                    throw new Error('private source path');
                },
            },
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [{ id: 'onsets-1', name: READ, arguments: { clipId: 'clip-1' } }],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });
        expect(result.receipts[0]).toMatchObject({
            callId: 'onsets-1',
            status: 'failure',
            error: { code: 'tool-execution-failed' },
        });
        expect(JSON.stringify(result.receipts)).not.toContain('private source path');
    });

    it.each([false, true])(
        'admits full cumulative receipts only when their carrier can hold them; native=%s',
        async (native) => {
            const requestTurn = vi.fn(async ({ turn }: { turn: number }) => ({
                status: 'complete' as const,
                toolCalls:
                    turn < 3 ? [{ id: `page-${String(turn)}`, name: READ, arguments: { clipId: 'clip-1' } }] : [],
                ...(native ? { providerTurn: { provider: 'openai' as const, assistantItems: null } } : {}),
            }));
            const result = await runApplicationOwnedToolLoop({
                loopId: 'text-receipt-cap',
                terminalToolNames: new Set(['answer.respond']),
                textReceiptCharacterBudget: 4_096,
                transientOnsetRead: {
                    execute: async ({ callId, turn }) => ({
                        schema: 'sourdaw.application-tool-receipt',
                        schemaVersion: 1,
                        callId,
                        toolName: READ,
                        turn,
                        status: 'success',
                        revision: 'revision',
                        data: { kind: 'transient-onset-read', evidence: 'x'.repeat(2_500) },
                        summary: 'Source evidence.',
                        warnings: [],
                        error: null,
                    }),
                },
                requestTurn,
            });
            expect(result.receipts).toHaveLength(2);
            expect(
                result.receipts.every(
                    (receipt) =>
                        receipt.status === 'success' && (receipt.data as { evidence: string }).evidence.length === 2_500
                )
            ).toBe(true);
            if (native) {
                expect(result.status).toBe('complete');
                expect(requestTurn).toHaveBeenCalledTimes(3);
            } else {
                expect(result).toMatchObject({
                    status: 'rejected',
                    reason: 'Application tool receipts exceeded the bounded text context budget.',
                });
                expect(requestTurn).toHaveBeenCalledTimes(2);
            }
        }
    );

    it('executes the dedicated read callback and lets an answer cite its numeric receipt', async () => {
        const execute = vi.fn(async ({ callId, turn }: { callId: string; turn: number }) => ({
            schema: 'sourdaw.application-tool-receipt' as const,
            schemaVersion: 1 as const,
            callId,
            toolName: READ,
            turn,
            status: 'success' as const,
            revision: 'revision-digest',
            data: {
                kind: 'transient-onset-read',
                timeAxis: 'source-buffer',
                hits: [{ sourceSeconds: 512 / 48_000, confidence: 0.75 }],
            },
            summary: 'Read source-buffer onsets.',
            warnings: [],
            error: null,
        }));
        const result = await runApplicationOwnedToolLoop({
            loopId: 'onset-read',
            terminalToolNames: new Set(['answer.respond']),
            transientOnsetRead: { execute },
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [{ id: 'onsets-1', name: READ, arguments: { clipId: 'clip-1' } }],
                })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'answer-1',
                            name: 'answer.respond',
                            arguments: { text: 'Source onsets are available.', evidenceCallIds: ['onsets-1'] },
                        },
                    ],
                }),
        });
        expect(execute).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ callId: 'onsets-1', turn: 1, call: expect.objectContaining({ name: READ }) })
        );
        expect(result).toMatchObject({
            status: 'complete',
            answer: { evidence: [expect.objectContaining({ callId: 'onsets-1' })] },
        });
        expect(result.receipts[0]).toMatchObject({ status: 'success', data: { kind: 'transient-onset-read' } });
    });
});

// The provider transport and Worker host are the only doubles: planning, source ownership,
// cursor/session logic, receipt serialization and revision checks below are production code.
const provider = vi.hoisted(() => ({
    backend: 'cloud' as 'cloud' | 'webllm',
    completion: vi.fn(),
    request: vi.fn(),
    sessions: [] as {
        execute: (input: {
            call: { name: string; arguments: Record<string, unknown> };
            callId: string;
            turn: number;
        }) => Promise<unknown>;
        dispose: () => void;
    }[],
}));
vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({ getBackendChain: () => [provider.backend] }));
vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: provider.completion,
}));
vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => ({
        provider: 'openai-compatible',
        model: 'onset-proof',
        baseUrl: 'http://localhost:1234/v1',
        authentication: 'none',
    }),
}));
vi.mock('../../repositories/cloudLlm/getCloudProviderRuntime', () => ({
    getCloudProviderRuntime: () => ({
        provider: 'openai-compatible',
        model: 'onset-proof',
        base_url: 'http://localhost:1234/v1',
        authentication: 'none',
        session_id: null,
        strict_tool_schemas: false,
    }),
}));
vi.mock('../../repositories/cloudLlm/usesStrictCloudToolSchemas', () => ({ usesStrictCloudToolSchemas: () => false }));
vi.mock('../../repositories/cloudLlm/cloudInference/requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: provider.request,
}));
vi.mock('../executeTransientOnsetRead', async (importOriginal) => {
    const original = await importOriginal<typeof import('../executeTransientOnsetRead')>();
    return {
        executeTransientOnsetRead: (input: Parameters<typeof original.executeTransientOnsetRead>[0]) => {
            const session = original.executeTransientOnsetRead(input);
            provider.sessions.push(session);
            return session;
        },
    };
});

const CLIP_ID = 'source-clip';
const RAW_BUFFER_ID = '/private/source/drums.wav';
const ONSET_HITS = Array.from({ length: 65 }, (_, index) => ({ sampleOffset: (index + 1) * 512, confidence: 0.75 }));
const workers: SourceWorker[] = [];
let detectedHits = ONSET_HITS;
let requestedClipId = CLIP_ID;
let workerMode: 'complete' | 'pending' | 'error';
let onWorkerStarted: (() => void) | undefined;
class SourceWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    postMessage = vi.fn((request: { channels: Float32Array[] }, transfer: Transferable[]) => {
        expect(request.channels).toHaveLength(2);
        expect(transfer).toEqual(request.channels.map((channel) => channel.buffer));
        expect(request.channels[0]).not.toBe(sourceChannels[0]);
        expect(request.channels[0]).toEqual(sourceChannels[0]);
        onWorkerStarted?.();
        if (workerMode === 'error') this.onerror?.();
        if (workerMode === 'complete') this.onmessage?.({ data: { status: 'complete', hits: detectedHits } });
    });
    constructor() {
        workers.push(this);
    }
}
let sourceChannels: Float32Array[];
let cached: AudioBuffer;
let revision: string;
let bodies: Array<{
    tools: { function: { name: string; parameters: unknown } }[];
    messages: { role: string; content: string | null; tool_call_id?: string }[];
}>;
let respond: (turn: number) => { id: string; name: string; arguments: Record<string, unknown> }[];
let cacheRead: MockInstance<typeof audioBufferCache.get>;

function readReceipt(callId: string): ApplicationToolReceipt {
    const message = bodies.at(-1)?.messages.find((entry) => entry.role === 'tool' && entry.tool_call_id === callId);
    if (typeof message?.content !== 'string') throw new Error(`Missing correlated provider receipt ${callId}`);
    return JSON.parse(message.content) as ApplicationToolReceipt;
}
function onsetCall(id = 'onsets-1', cursor?: string) {
    return { id, name: READ, arguments: { clipId: requestedClipId, ...(cursor === undefined ? {} : { cursor }) } };
}
function answer(evidenceCallIds: string[] = []) {
    return [
        {
            id: 'answer',
            name: 'answer.respond',
            arguments: { text: 'Source onset evidence is available.', evidenceCallIds },
        },
    ];
}
function run(admit: MeasurementAdmitter = () => ({ status: 'admitted', settle: () => {} }), signal?: AbortSignal) {
    return parsePromptToActions({
        prompt: 'Show the source onset times of the selected clip without changing anything.',
        context: getProjectContext(),
        projectRevision: revision,
        onMeasurementAttempt: admit,
        signal,
    });
}
function editRoot(key: string, value: unknown) {
    mutateCrdtDoc<Record<string, unknown>>({
        id: 'root',
        changeFn: (document) => {
            document[key] = value;
        },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    workers.length = 0;
    workerMode = 'complete';
    detectedHits = ONSET_HITS;
    requestedClipId = CLIP_ID;
    onWorkerStarted = undefined;
    provider.backend = 'cloud';
    provider.sessions.length = 0;
    vi.stubGlobal('Worker', SourceWorker);
    if (!hasCrdtDoc('root')) createCrdtDoc('root');
    registerCrdtStorageRuntime();
    projectStore.set({
        ...projectStore.value!,
        projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
        initialized: true,
        loading: false,
        identityMigrationPending: false,
        identityPersistencePending: false,
    });
    const track = createTrack({ id: 'track-onsets', name: 'Drums', kind: 'audio' });
    track.clips = [
        {
            id: CLIP_ID,
            trackId: track.id,
            name: 'Drums source',
            type: 'audio',
            audioBufferId: RAW_BUFFER_ID,
            startBeat: 0,
            endBeat: 8,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ffffff',
            locked: false,
            muted: false,
        },
    ];
    trackStore.set({ tracks: [track], ghostClips: [], selectedTrackId: track.id });
    sourceChannels = [new Float32Array(96_000), new Float32Array(96_000)];
    sourceChannels[0]![512] = 1;
    cached = {
        length: 96_000,
        numberOfChannels: 2,
        sampleRate: 48_000,
        duration: 2,
        getChannelData: (channel: number) => sourceChannels[channel]!,
    } as AudioBuffer;
    cacheRead = vi
        .spyOn(audioBufferCache, 'get')
        .mockImplementation((id) => (id === RAW_BUFFER_ID ? cached : undefined));
    revision = settlePendingProjectWritesAndCaptureRevision();
    bodies = [];
    respond = (turn) => (turn === 0 ? [onsetCall()] : answer(['onsets-1']));
    provider.request.mockImplementation(async (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
        bodies.push(JSON.parse(request.body));
        if (bodies.length === 1) expect(getSettledProjectId()).toBe('aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa');
        const calls = respond(bodies.length - 1);
        request.onBodyChunk(
            new TextEncoder().encode(
                JSON.stringify({
                    choices: [
                        {
                            finish_reason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: null,
                                tool_calls: calls.map((call) => ({
                                    id: call.id,
                                    type: 'function',
                                    function: {
                                        name: encodeWireToolName(call.name),
                                        arguments: JSON.stringify(call.arguments),
                                    },
                                })),
                            },
                        },
                    ],
                })
            )
        );
        return { status: 200, contentType: 'application/json' };
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('actual hosted planner, source owner and disposable read session', () => {
    it('returns two numeric pages on the provider wire, spends one analysis and changes no project, history, markers or PCM', async () => {
        respond = (turn) => {
            if (turn === 0) return [onsetCall()];
            if (turn === 1) {
                const receipt = readReceipt('onsets-1');
                expect(receipt).toMatchObject({
                    status: 'success',
                    data: { hits: expect.any(Array), complete: false, timeAxis: 'source-buffer' },
                });
                const cursor = (receipt.data as { nextCursor: string }).nextCursor;
                return [onsetCall('onsets-2', cursor)];
            }
            expect(readReceipt('onsets-2')).toMatchObject({
                status: 'success',
                data: { complete: true, nextCursor: null, coverage: { offset: 64, endOffset: 65 } },
            });
            return answer(['onsets-1', 'onsets-2']);
        };
        const before = {
            tracks: JSON.stringify(trackStore.value),
            history: JSON.stringify(undoHistoryStore.value),
            revision: captureProjectRevision(),
            pcm: sourceChannels.map((channel) => new Float32Array(channel)),
        };
        const settle = vi.fn();
        const admit = vi.fn(() => ({ status: 'admitted' as const, settle }));
        const disclosure = vi.spyOn(remoteTransmissionDisclosure, 'prepare');
        const result = await run(admit);
        expect(result.planningOutcome).toMatchObject({
            kind: 'answer',
            evidence: [
                expect.objectContaining({ callId: 'onsets-1' }),
                expect.objectContaining({ callId: 'onsets-2' }),
            ],
        });
        expect(result.actions).toEqual([]);
        expect(result.requiresConfirmation).toBe(false);
        const first = result.applicationToolReceipts?.[0];
        expect(first).toMatchObject({
            status: 'success',
            data: { timeAxis: 'source-buffer', frameCount: 96_000, hits: expect.any(Array), totalHitCount: 65 },
        });
        expect((first?.data as { hits: unknown[] }).hits).toHaveLength(64);
        expect((first?.data as { hits: unknown[] }).hits[0]).toEqual({
            sourceSeconds: 512 / 48_000,
            confidence: 0.75,
        });
        expect(bodies[0]?.tools).toContainEqual(
            expect.objectContaining({ function: expect.objectContaining({ name: encodeWireToolName(READ) }) })
        );
        const wire = JSON.stringify(bodies);
        expect(wire).toContain('transient-onset-read');
        expect(wire).not.toContain(RAW_BUFFER_ID);
        expect(wire).not.toMatch(/"(?:channels|pcm|channelData|getChannelData|fileId|audioBufferId)"/);
        expect(disclosure.mock.calls.at(-1)?.[0].categories).toContain('measurement');
        expect(admit).toHaveBeenCalledExactlyOnceWith({ renderJobs: 0, analyses: 1 });
        expect(settle).toHaveBeenCalledExactlyOnceWith({ renderJobs: 0, analyses: 1 });
        expect(workers).toHaveLength(1);
        expect(workers[0]?.terminate).toHaveBeenCalledOnce();
        expect(JSON.stringify(trackStore.value)).toBe(before.tracks);
        expect(JSON.stringify(undoHistoryStore.value)).toBe(before.history);
        expect(captureProjectRevision()).toBe(before.revision);
        expect(sourceChannels).toEqual(before.pcm);
        expect(await provider.sessions[0]?.execute({ call: onsetCall(), callId: 'late', turn: 4 })).toMatchObject({
            status: 'failure',
            error: { code: 'cancelled' },
        });
    });

    it('refuses run budget before any source cache access', async () => {
        respond = (turn) => (turn === 0 ? [onsetCall()] : answer());
        const result = await run(() => ({ status: 'refused', category: 'localAnalysis' }));
        expect(result.applicationToolReceipts?.[0]).toMatchObject({
            status: 'failure',
            error: { code: 'measurement-budget-exhausted' },
        });
        expect(cacheRead).not.toHaveBeenCalled();
        expect(workers).toHaveLength(0);
    });

    it.each(['midi', 'missing-buffer', 'stale-source'] as const)(
        'refuses %s through the actual parser read route',
        async (kind) => {
            if (kind === 'midi') {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) => ({ ...clip, type: 'midi' as const })),
                    })),
                });
                revision = settlePendingProjectWritesAndCaptureRevision();
            } else if (kind === 'missing-buffer') cacheRead.mockReturnValue(undefined);
            else editRoot('onsetIntegrationMutation', true);
            respond = (turn) => (turn === 0 ? [onsetCall()] : answer());
            const result = await run();
            expect(result.applicationToolReceipts?.[0]).toMatchObject({
                status: 'failure',
                error: { code: kind === 'midi' ? 'clip-not-audio' : kind },
            });
            expect(workers).toHaveLength(0);
        }
    );

    it.each(['real-edit-reverted', 'buffer-replaced', 'checkpoint-only'] as const)(
        'rechecks source identity between pages: %s',
        async (change) => {
            respond = (turn) => {
                if (turn === 0) return [onsetCall()];
                if (turn === 1) {
                    const cursor = (readReceipt('onsets-1').data as { nextCursor: string }).nextCursor;
                    if (change === 'buffer-replaced') cached = { ...cached };
                    else if (change === 'checkpoint-only') editRoot('commandBatchIdempotency', { onsetProof: true });
                    else {
                        editRoot('onsetHiddenEdit', true);
                        mutateCrdtDoc<Record<string, unknown>>({
                            id: 'root',
                            changeFn: (document) => {
                                delete document.onsetHiddenEdit;
                            },
                        });
                    }
                    return [onsetCall('onsets-2', cursor)];
                }
                return answer(change === 'checkpoint-only' ? ['onsets-2'] : []);
            };
            const result = await run();
            expect(result.applicationToolReceipts?.[1]).toMatchObject(
                change === 'checkpoint-only'
                    ? { status: 'success', data: { complete: true } }
                    : { status: 'failure', error: { code: 'stale-source' } }
            );
            expect(workers).toHaveLength(1);
        }
    );

    it('disposes its source session when provider planning throws after a successful page', async () => {
        respond = (turn) => {
            if (turn === 0) return [onsetCall()];
            throw new Error('Transport ended after the first page');
        };
        await run().catch(() => undefined);
        expect(workers).toHaveLength(1);
        expect(await provider.sessions[0]?.execute({ call: onsetCall(), callId: 'late', turn: 2 })).toMatchObject({
            status: 'failure',
            error: { code: 'cancelled' },
        });
    });
    it('uses the actual local parser and provider loop to discover, read and cite two complete numeric pages', async () => {
        provider.backend = 'webllm';
        provider.completion.mockImplementation(async (system: string, message: string) => {
            const turn = provider.completion.mock.calls.length;
            if (turn === 1) {
                expect(system).toContain(
                    'For drum timing or clip onsets, request analysis.detectTransients in category analysis.'
                );
                expect(system).not.toContain(`- ${READ}:`);
                return JSON.stringify([
                    {
                        id: 'local-discovery',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'analysis', names: [READ] },
                    },
                ]);
            }
            expect(system).toContain(`- ${READ}:`);
            if (turn === 2) return JSON.stringify([onsetCall()]);
            expect(message).toContain('transient-onset-read');
            expect(message).toContain('source-buffer');
            expect(message).not.toContain(RAW_BUFFER_ID);
            const relevant = JSON.parse(message.split('relevant_evidence:\n')[1]?.split('\n\n')[0] ?? 'null') as {
                receipts: { summary: { value: string; truncated: boolean } }[];
            };
            expect(relevant.receipts[0]?.summary.truncated).toBe(false);
            const prior = JSON.parse(relevant.receipts[0]!.summary.value.split('\n').at(-1)!) as {
                receipts: ApplicationToolReceipt[];
            };
            const first = prior.receipts[1]!.data as { hits: unknown[]; nextCursor: string };
            expect(first.hits).toHaveLength(64);
            expect(first.hits[63]).toEqual({ sourceSeconds: (64 * 512) / 48_000, confidence: 0.75 });
            if (turn === 3) return JSON.stringify([onsetCall('onsets-2', first.nextCursor)]);
            expect(prior.receipts[2]).toMatchObject({
                status: 'success',
                data: { complete: true, hits: [{ sourceSeconds: (65 * 512) / 48_000, confidence: 0.75 }] },
            });
            return JSON.stringify(answer(['onsets-1', 'onsets-2']));
        });
        const before = captureProjectRevision();
        const result = await run();
        expect(result.planningOutcome).toMatchObject({
            kind: 'answer',
            evidence: [
                expect.objectContaining({ callId: 'onsets-1' }),
                expect.objectContaining({ callId: 'onsets-2' }),
            ],
        });
        expect(result.applicationToolReceipts).toHaveLength(3);
        expect(result.applicationToolReceipts?.[0]).toMatchObject({
            status: 'success',
            toolName: 'agent.catalog.discover',
        });
        expect(result.applicationToolReceipts?.[1]).toMatchObject({
            status: 'success',
            data: { kind: 'transient-onset-read', hits: expect.any(Array) },
        });
        expect(provider.completion).toHaveBeenCalledTimes(4);
        expect(provider.request).not.toHaveBeenCalled();
        expect(workers).toHaveLength(1);
        expect(result.actions).toEqual([]);
        expect(captureProjectRevision()).toBe(before);
    });

    it('terminates a pending source Worker and disposes the run when cancelled at the analysis boundary', async () => {
        workerMode = 'pending';
        const started = new Promise<void>((resolve) => {
            onWorkerStarted = resolve;
        });
        const controller = new AbortController();
        const settle = vi.fn();
        const result = run(() => ({ status: 'admitted', settle }), controller.signal);
        await started;
        controller.abort();
        expect((await result).actions).toEqual([]);
        expect(workers[0]?.terminate).toHaveBeenCalledOnce();
        expect(settle).toHaveBeenCalledExactlyOnceWith({ renderJobs: 0, analyses: 1 });
        expect(await provider.sessions[0]?.execute({ call: onsetCall(), callId: 'late', turn: 2 })).toMatchObject({
            status: 'failure',
            error: { code: 'cancelled' },
        });
    });

    it('returns a typed Worker failure, settles actual work and destroys the Worker', async () => {
        workerMode = 'error';
        respond = (turn) => (turn === 0 ? [onsetCall()] : answer());
        const settle = vi.fn();
        const result = await run(() => ({ status: 'admitted', settle }));
        expect(result.applicationToolReceipts?.[0]).toMatchObject({
            status: 'failure',
            error: { code: 'analysis-failed' },
        });
        expect(workers[0]?.terminate).toHaveBeenCalledOnce();
        expect(settle).toHaveBeenCalledExactlyOnceWith({ renderJobs: 0, analyses: 1 });
    });
    it.each([
        { backend: 'webllm' as const, total: 65 },
        { backend: 'webllm' as const, total: 128 },
        { backend: 'cloud' as const, total: 128 },
    ])(
        'keeps full maximal $total-hit receipts with explicit text-carrier refusal and native history intact: $backend',
        async ({ backend, total }) => {
            provider.backend = backend;
            requestedClipId = 'c'.repeat(256);
            const state = trackStore.value!;
            const original = state.tracks[0]!;
            const trackId = 't'.repeat(256);
            trackStore.set({
                ...state,
                selectedTrackId: trackId,
                tracks: [
                    {
                        ...original,
                        id: trackId,
                        clips: [],
                        alternatives: [
                            {
                                id: 'a'.repeat(256),
                                name: 'Source alternative',
                                clips: [{ ...original.clips[0]!, id: requestedClipId, trackId }],
                            },
                        ],
                    },
                ],
            });
            revision = settlePendingProjectWritesAndCaptureRevision();
            detectedHits = Array.from({ length: total }, (_, index) => ({
                sampleOffset: (index + 1) * 512,
                confidence: 0.10000000000000002,
            }));
            let firstCursor: string;
            provider.completion.mockImplementation(async (_system: string, message: string) => {
                const turn = provider.completion.mock.calls.length;
                if (turn === 1)
                    return JSON.stringify([
                        {
                            id: 'discovery',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'analysis', names: [READ] },
                        },
                    ]);
                if (turn === 2) return JSON.stringify([onsetCall('r'.repeat(256))]);
                const relevant = JSON.parse(message.split('relevant_evidence:\n')[1]?.split('\n\n')[0] ?? 'null') as {
                    receipts: { summary: { value: string; truncated: boolean } }[];
                };
                expect(relevant.receipts[0]?.summary.truncated).toBe(false);
                const prior = JSON.parse(relevant.receipts[0]!.summary.value.split('\n').at(-1)!) as {
                    receipts: ApplicationToolReceipt[];
                };
                const first = prior.receipts[1]!.data as {
                    hits: { sourceSeconds: number; confidence: number }[];
                    nextCursor: string;
                };
                expect(first.hits).toHaveLength(64);
                expect(first.hits[63]).toEqual({ sourceSeconds: (64 * 512) / 48_000, confidence: 0.10000000000000002 });
                firstCursor = first.nextCursor;
                return JSON.stringify([onsetCall('s'.repeat(256), firstCursor)]);
            });
            respond = (turn) => {
                if (turn === 0)
                    return [
                        {
                            id: 'discovery',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'analysis', names: [READ] },
                        },
                    ];
                if (turn === 1) return [onsetCall('r'.repeat(256))];
                if (turn === 2) {
                    firstCursor = (readReceipt('r'.repeat(256)).data as { nextCursor: string }).nextCursor;
                    return [onsetCall('s'.repeat(256), firstCursor)];
                }
                expect((readReceipt('s'.repeat(256)).data as { hits: unknown[] }).hits).toHaveLength(total - 64);
                return answer(['r'.repeat(256), 's'.repeat(256)]);
            };
            const before = {
                revision: captureProjectRevision(),
                tracks: JSON.stringify(trackStore.value),
                history: JSON.stringify(undoHistoryStore.value),
                pcm: sourceChannels.map((channel) => new Float32Array(channel)),
            };
            const result = await run();
            if (backend === 'webllm') {
                expect(result.rejectionReason).toContain(
                    'Application tool receipts exceeded the bounded text context budget.'
                );
                expect(provider.completion).toHaveBeenCalledTimes(3);
                expect(provider.request).not.toHaveBeenCalled();
            } else {
                expect(result.rejectionReason).toBeUndefined();
                expect(result.planningOutcome).toMatchObject({
                    kind: 'answer',
                    evidence: [
                        expect.objectContaining({ callId: 'r'.repeat(256) }),
                        expect.objectContaining({ callId: 's'.repeat(256) }),
                    ],
                });
                expect(provider.request).toHaveBeenCalledTimes(4);
                expect(provider.completion).not.toHaveBeenCalled();
            }
            expect(result.applicationToolReceipts).toHaveLength(3);
            const first = result.applicationToolReceipts?.[1]?.data as { hits: unknown[] };
            const second = result.applicationToolReceipts?.[2]?.data as { hits: unknown[]; complete: boolean };
            expect(first.hits).toHaveLength(64);
            expect(second.hits).toHaveLength(total - 64);
            expect(second.complete).toBe(true);
            expect(result.actions).toEqual([]);
            expect(result.requiresConfirmation).toBe(false);
            expect(captureProjectRevision()).toBe(before.revision);
            expect(JSON.stringify(trackStore.value)).toBe(before.tracks);
            expect(JSON.stringify(undoHistoryStore.value)).toBe(before.history);
            expect(sourceChannels).toEqual(before.pcm);
            expect(workers[0]?.terminate).toHaveBeenCalledOnce();
            expect(
                await provider.sessions[0]?.execute({ call: onsetCall('late', firstCursor!), callId: 'late', turn: 4 })
            ).toMatchObject({ status: 'failure', error: { code: 'cancelled' } });
        }
    );
});
