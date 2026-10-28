import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { undoHistoryStore } from '#/modules/Command/stores';
import {
    captureProjectRevision,
    createCrdtDoc,
    hasCrdtDoc,
    registerCrdtStorageRuntime,
    mutateCrdtDoc,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { getSettledProjectId, projectStore } from '#/modules/Project/stores';
import { digest } from '#/utils/canonicalDigest';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type MeasurementAdmitter } from '../../models/MeasurementBudget';
import { encodeWireToolName } from '../../repositories/cloudLlm/cloudInference/encodeWireToolName';
import { admitAnswerInterpretation } from '../admitAnswerInterpretation';
import { getAgentToolCatalogSchemas } from '../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { remoteTransmissionDisclosure } from '../discloseRemoteTransmission';
import { getAgentToolCatalogEntries } from '../getAgentToolCatalogEntries';
import { getPlanningProviderToolSchemas } from '../getPlanningProviderToolSchemas';
import { getProjectContext } from '../getProjectContext';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';

import { advertisedAnswerIntake, advertisedAnswerCandidateId } from './answerWireFixture';
import { decodeReceiptContext, isRecord, readReceiptSummary } from './receiptContextFixture';

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
        'preserves complete cumulative receipts through the bounded carrier; native=%s',
        async (native) => {
            const requestTurn = vi.fn(
                async ({ turn }: Parameters<Parameters<typeof runApplicationOwnedToolLoop>[0]['requestTurn']>[0]) => {
                    const toolCalls = [];
                    if (turn < 3) {
                        toolCalls.push({ id: `page-${String(turn)}`, name: READ, arguments: { clipId: 'clip-1' } });
                    }
                    const result = { status: 'complete' as const, toolCalls };
                    if (native) {
                        return { ...result, providerTurn: { provider: 'openai' as const, assistantItems: null } };
                    }
                    return result;
                }
            );
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
            expect(result.status).toBe('complete');
            expect(requestTurn).toHaveBeenCalledTimes(3);
            const finalTurn = requestTurn.mock.calls[2]![0];
            expect(finalTurn.receiptContext).not.toBeNull();
            expect(finalTurn.receiptContext!.length).toBeLessThanOrEqual(4_096);
            expect(decodeReceiptContext(finalTurn.receiptContext!)).toEqual(result.receipts);
            if (native) {
                expect(finalTurn.history.flatMap((turn) => turn.receipts)).toEqual(result.receipts);
                expect(finalTurn.history.flatMap((turn) => turn.calls.map((call) => call.id))).toEqual([
                    'page-1',
                    'page-2',
                ]);
            } else {
                expect(finalTurn.history).toEqual([]);
            }
            // The default oversized real-project refusal belongs to receiptTextBudget.spec.ts.
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
        const catalog = prepareAnswerInterpretationCatalog({
            prompt: 'source onsets',
            context: getProjectContext(),
            projectRevision: 'revision',
        });
        catalog.scopes.push({ candidateId: 'clip:clip-1', kind: 'clips', objectIds: ['clip-1'], labels: ['Clip'] });
        const result = await runApplicationOwnedToolLoop({
            answerInterpretation: {
                admit: (call) => admitAnswerInterpretation({ catalog, call, projectRevision: 'revision' }),
            },
            loopId: 'onset-read',
            terminalToolNames: new Set(['answer.respond']),
            transientOnsetRead: {
                execute,
                readAnswerSource: () => ({
                    clipId: 'clip-1',
                    sourceRevisionDigest: digest('revision'),
                    timeAxis: 'source-buffer',
                    totalHitCount: 1,
                    coverage: { offset: 0, endOffset: 1 },
                    hits: [{ sourceSeconds: 512 / 48_000, confidence: 0.75 }],
                }),
            },
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'intake',
                            name: 'selectAnswerInterpretation',
                            arguments: {
                                catalogId: catalog.catalogId,
                                kind: 'source-onsets',
                                topicIds: [],
                                scopeCandidateIds: ['clip:clip-1'],
                                rangeCandidateId: null,
                                uncertainty: 'none',
                            },
                        },
                    ],
                })
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
                            arguments: {
                                intakeCallId: 'intake',
                                statements: [{ kind: 'source-onsets', callId: 'onsets-1' }],
                            },
                        },
                    ],
                }),
        });
        expect(execute).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ callId: 'onsets-1', turn: 2, call: expect.objectContaining({ name: READ }) })
        );
        expect(result).toMatchObject({
            status: 'complete',
            answer: {
                evidence: [
                    expect.objectContaining({ callId: 'intake' }),
                    expect.objectContaining({ callId: 'onsets-1' }),
                ],
            },
        });
        expect(result.receipts[1]).toMatchObject({ status: 'success', data: { kind: 'transient-onset-read' } });
    });
});

// The provider transport and Worker host are the only doubles: planning, source ownership,
// cursor/session logic, receipt serialization and revision checks below are production code.
const provider = vi.hoisted(() => ({
    backend: 'cloud' as 'cloud' | 'webllm',
    fallback: false,
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
vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => (provider.fallback ? ['cloud', 'webllm'] : [provider.backend]),
}));
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
        if (workerMode === 'error') {
            this.onerror?.();
        }
        if (workerMode === 'complete') {
            this.onmessage?.({ data: { status: 'complete', hits: detectedHits } });
        }
    });
    constructor() {
        workers.push(this);
    }
}
let sourceChannels: Float32Array[];
let cached: AudioBuffer;
function sourceBuffer(): AudioBuffer {
    return {
        length: 96_000,
        numberOfChannels: 2,
        sampleRate: 48_000,
        duration: 2,
        getChannelData: (channel: number) => sourceChannels[channel]!,
    } as AudioBuffer;
}
let revision: string;
let bodies: Array<{
    tools: { function: { name: string; parameters: unknown } }[];
    messages: { role: string; content: string | null; tool_call_id?: string }[];
}>;
let respond: (turn: number) => { id: string; name: string; arguments: Record<string, unknown> }[];
let cacheRead: MockInstance<typeof audioBufferCache.get>;

function readReceipt(callId: string): ApplicationToolReceipt {
    const message = bodies.at(-1)?.messages.find((entry) => entry.role === 'tool' && entry.tool_call_id === callId);
    if (typeof message?.content !== 'string') {
        throw new TypeError(`Missing correlated provider receipt ${callId}`);
    }
    return JSON.parse(message.content) as ApplicationToolReceipt;
}
function onsetCall(id = 'onsets-1', cursor?: string) {
    const argumentsValue: { clipId: string; cursor?: string } = { clipId: requestedClipId };
    if (cursor !== undefined) {
        argumentsValue.cursor = cursor;
    }
    return { id, name: READ, arguments: argumentsValue };
}
function answer(evidenceCallIds: string[] = []) {
    return [
        {
            id: 'answer',
            name: 'answer.respond',
            arguments: {
                intakeCallId: 'intake',
                statements:
                    evidenceCallIds.length === 0
                        ? [{ kind: 'limitation', code: 'bounded-evidence' }]
                        : evidenceCallIds.map((callId) => ({ kind: 'source-onsets', callId })),
            },
        },
    ];
}
function run(admit: MeasurementAdmitter = () => ({ status: 'admitted', settle: () => {} }), signal?: AbortSignal) {
    const intake = (params: unknown) =>
        advertisedAnswerIntake(params, {
            kind: 'source-onsets',
            topicIds: [],
            scopeCandidateIds: [advertisedAnswerCandidateId(params, requestedClipId)],
            rangeCandidateId: null,
            uncertainty: 'none',
        });
    if (provider.backend === 'webllm') {
        provider.completion.mockImplementationOnce(async (...params: unknown[]) => JSON.stringify([intake(params)]));
    } else {
        provider.request.mockImplementationOnce(
            async (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
                const body = JSON.parse(request.body);
                bodies.push(body);
                const call = intake(body);
                request.onBodyChunk(
                    new TextEncoder().encode(
                        JSON.stringify({
                            choices: [
                                {
                                    finish_reason: 'tool_calls',
                                    message: {
                                        role: 'assistant',
                                        content: null,
                                        tool_calls: [
                                            {
                                                id: call.id,
                                                type: 'function',
                                                function: {
                                                    name: encodeWireToolName(call.name),
                                                    arguments: JSON.stringify(call.arguments),
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        })
                    )
                );
                return { status: 200, contentType: 'application/json' };
            }
        );
    }
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
    provider.fallback = false;
    provider.sessions.length = 0;
    vi.stubGlobal('Worker', SourceWorker);
    if (!hasCrdtDoc('root')) {
        createCrdtDoc('root');
    }
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
    cached = sourceBuffer();
    cacheRead = vi
        .spyOn(audioBufferCache, 'get')
        .mockImplementation((id) => (id === RAW_BUFFER_ID ? cached : undefined));
    revision = settlePendingProjectWritesAndCaptureRevision();
    bodies = [];
    respond = (turn) => (turn === 0 ? [onsetCall()] : answer(['onsets-1']));
    provider.request.mockImplementation(async (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
        bodies.push(JSON.parse(request.body));
        if (bodies.length === 1) {
            expect(getSettledProjectId()).toBe('aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa');
        }
        const calls = respond(bodies.length - 2);
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
            if (turn === 0) {
                return [onsetCall()];
            }
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
                expect.objectContaining({ callId: 'intake' }),
                expect.objectContaining({ callId: 'onsets-1' }),
                expect.objectContaining({ callId: 'onsets-2' }),
            ],
        });
        expect(result.actions).toEqual([]);
        expect(result.requiresConfirmation).toBe(false);
        const first = result.applicationToolReceipts?.[1];
        expect(first).toMatchObject({
            status: 'success',
            data: { timeAxis: 'source-buffer', frameCount: 96_000, hits: expect.any(Array), totalHitCount: 65 },
        });
        expect(first).toBeDefined();
        const firstData = first!.data as { hits: unknown[] };
        expect(firstData.hits).toHaveLength(64);
        expect(firstData.hits[0]).toEqual({
            sourceSeconds: 512 / 48_000,
            confidence: 0.75,
        });
        expect(bodies[0]?.tools).toContainEqual(
            expect.objectContaining({ function: expect.objectContaining({ name: encodeWireToolName(READ) }) })
        );
        const wire = JSON.stringify(bodies);
        expect(wire).toContain('transient-onset-read');
        expect(wire).not.toContain(RAW_BUFFER_ID);
        expect(wire.includes(digest(RAW_BUFFER_ID))).toBe(false);
        expect(wire).not.toMatch(/\\?"bufferId\\?"/);
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
        expect(result.applicationToolReceipts?.[1]).toMatchObject({
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
            } else if (kind === 'missing-buffer') {
                cacheRead.mockReturnValue(undefined);
            } else {
                editRoot('onsetIntegrationMutation', true);
            }
            respond = (turn) => (turn === 0 ? [onsetCall()] : answer());
            const result = await run();
            expect(result.applicationToolReceipts?.[1]).toMatchObject({
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
                if (turn === 0) {
                    return [onsetCall()];
                }
                if (turn === 1) {
                    const cursor = (readReceipt('onsets-1').data as { nextCursor: string }).nextCursor;
                    if (change === 'buffer-replaced') {
                        cached = sourceBuffer();
                    } else if (change === 'checkpoint-only') {
                        editRoot('commandBatchIdempotency', { onsetProof: true });
                    } else {
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
            if (change === 'checkpoint-only') {
                expect(result.applicationToolReceipts?.[2]).toMatchObject({
                    status: 'success',
                    data: { complete: true },
                });
            } else {
                expect(result.applicationToolReceipts?.[2]).toMatchObject({
                    status: 'failure',
                    error: { code: 'stale-source' },
                });
            }
            expect(workers).toHaveLength(1);
        }
    );

    it('disposes its source session when provider planning throws after a successful page', async () => {
        respond = (turn) => {
            if (turn === 0) {
                return [onsetCall()];
            }
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
            const turn = provider.completion.mock.calls.length - 1;
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
            if (turn === 2) {
                return JSON.stringify([onsetCall()]);
            }
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
            const first = prior.receipts[2]!.data as { hits: unknown[]; nextCursor: string };
            expect(first.hits).toHaveLength(64);
            expect(first.hits[63]).toEqual({ sourceSeconds: (64 * 512) / 48_000, confidence: 0.75 });
            if (turn === 3) {
                return JSON.stringify([onsetCall('onsets-2', first.nextCursor)]);
            }
            expect(prior.receipts[3]).toMatchObject({
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
                expect.objectContaining({ callId: 'intake' }),
                expect.objectContaining({ callId: 'onsets-1' }),
                expect.objectContaining({ callId: 'onsets-2' }),
            ],
        });
        expect(result.applicationToolReceipts).toHaveLength(4);
        expect(result.applicationToolReceipts?.[1]).toMatchObject({
            status: 'success',
            toolName: 'agent.catalog.discover',
        });
        expect(result.applicationToolReceipts?.[2]).toMatchObject({
            status: 'success',
            data: { kind: 'transient-onset-read', hits: expect.any(Array) },
        });
        expect(provider.completion).toHaveBeenCalledTimes(5);
        const localContext = JSON.stringify(provider.completion.mock.calls);
        expect(localContext.includes(RAW_BUFFER_ID)).toBe(false);
        expect(localContext.includes(digest(RAW_BUFFER_ID))).toBe(false);
        expect(localContext).not.toMatch(/\\?"bufferId\\?"/);
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
        expect(result.applicationToolReceipts?.[1]).toMatchObject({
            status: 'failure',
            error: { code: 'analysis-failed' },
        });
        expect(workers[0]?.terminate).toHaveBeenCalledOnce();
        expect(settle).toHaveBeenCalledExactlyOnceWith({ renderJobs: 0, analyses: 1 });
    });
    it.each([
        { backend: 'webllm' as const, total: 65, fallback: false },
        { backend: 'webllm' as const, total: 128, fallback: false },
        { backend: 'cloud' as const, total: 128, fallback: false },
        { backend: 'cloud' as const, total: 128, fallback: true },
    ])(
        'preserves full maximal $total-hit receipts through local or native history: $backend; fallback=$fallback',
        async ({ backend, total, fallback }) => {
            provider.backend = backend;
            provider.fallback = fallback;
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
            let fallbackEvidenceTruncated: boolean | undefined;
            const localReceiptSnapshots: unknown[][] = [];
            const nativeReceiptSnapshots: ApplicationToolReceipt[][] = [];
            provider.completion.mockImplementation(async (_system: string, message: string) => {
                if (fallback) {
                    const evidence = JSON.parse(
                        message.split('relevant_evidence:\n')[1]?.split('\n\n')[0] ?? 'null'
                    ) as {
                        receipts: { summary: { truncated: boolean } }[];
                    };
                    fallbackEvidenceTruncated = evidence.receipts[0]?.summary.truncated;
                    return JSON.stringify(answer(['r'.repeat(256), 's'.repeat(256)]));
                }
                const turn = provider.completion.mock.calls.length - 1;
                if (turn === 1) {
                    return JSON.stringify([
                        {
                            id: 'discovery',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'analysis', names: [READ] },
                        },
                    ]);
                }
                if (turn === 2) {
                    return JSON.stringify([onsetCall('r'.repeat(256))]);
                }
                const summary = readReceiptSummary(message);
                expect(summary.truncated).toBe(false);
                const prior = decodeReceiptContext(summary.value);
                localReceiptSnapshots.push(prior);
                const firstReceipt = prior.find((receipt) => isRecord(receipt) && receipt.callId === 'r'.repeat(256));
                if (
                    !isRecord(firstReceipt) ||
                    !isRecord(firstReceipt.data) ||
                    !Array.isArray(firstReceipt.data.hits) ||
                    typeof firstReceipt.data.nextCursor !== 'string'
                ) {
                    throw new TypeError('Missing first onset page');
                }
                expect(firstReceipt.data.hits).toEqual(
                    detectedHits.slice(0, 64).map((hit) => ({
                        sourceSeconds: hit.sampleOffset / 48_000,
                        confidence: hit.confidence,
                    }))
                );
                firstCursor = firstReceipt.data.nextCursor;
                if (turn === 3) {
                    return JSON.stringify([onsetCall('s'.repeat(256), firstCursor)]);
                }
                expect(prior.find((receipt) => isRecord(receipt) && receipt.callId === 's'.repeat(256))).toMatchObject({
                    callId: 's'.repeat(256),
                    status: 'success',
                    data: {
                        complete: true,
                        hits: detectedHits.slice(64).map((hit) => ({
                            sourceSeconds: hit.sampleOffset / 48_000,
                            confidence: hit.confidence,
                        })),
                    },
                });
                return JSON.stringify(answer(['r'.repeat(256), 's'.repeat(256)]));
            });
            respond = (turn) => {
                if (turn === 0) {
                    return [
                        {
                            id: 'discovery',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'analysis', names: [READ] },
                        },
                    ];
                }
                if (turn === 1) {
                    return [onsetCall('r'.repeat(256))];
                }
                if (turn === 2) {
                    const first = readReceipt('r'.repeat(256));
                    nativeReceiptSnapshots.push([readReceipt('intake'), readReceipt('discovery'), first]);
                    firstCursor = (first.data as { nextCursor: string }).nextCursor;
                    return [onsetCall('s'.repeat(256), firstCursor)];
                }
                const second = readReceipt('s'.repeat(256));
                nativeReceiptSnapshots.push([
                    readReceipt('intake'),
                    readReceipt('discovery'),
                    readReceipt('r'.repeat(256)),
                    second,
                ]);
                expect((second.data as { hits: unknown[] }).hits).toEqual(
                    detectedHits.slice(64).map((hit) => ({
                        sourceSeconds: hit.sampleOffset / 48_000,
                        confidence: hit.confidence,
                    }))
                );
                if (fallback) {
                    throw new Error('Synthetic hosted transport failure before fallback');
                }
                return answer(['r'.repeat(256), 's'.repeat(256)]);
            };
            const before = {
                revision: captureProjectRevision(),
                tracks: JSON.stringify(trackStore.value),
                history: JSON.stringify(undoHistoryStore.value),
                pcm: sourceChannels.map((channel) => new Float32Array(channel)),
            };
            const result = await run();
            if (fallback) {
                expect({
                    rejection: result.rejectionReason,
                    localRequests: provider.completion.mock.calls.length,
                    receivedTruncatedEvidence: fallbackEvidenceTruncated,
                }).toEqual({
                    rejection: expect.stringContaining('bounded text context budget'),
                    localRequests: 0,
                    receivedTruncatedEvidence: undefined,
                });
            } else if (backend === 'webllm' && total === 128) {
                expect(result.rejectionReason).toBe(
                    'Provider planning rejected: Application tool receipts exceeded the bounded text context budget.'
                );
                expect(provider.completion).toHaveBeenCalledTimes(4);
                expect(provider.request).not.toHaveBeenCalled();
                expect(localReceiptSnapshots).toEqual([result.applicationToolReceipts?.slice(0, 3)]);
            } else if (backend === 'webllm') {
                expect(result.rejectionReason).toBeUndefined();
                expect(result.planningOutcome).toMatchObject({
                    kind: 'answer',
                    evidence: [
                        expect.objectContaining({ callId: 'intake' }),
                        expect.objectContaining({ callId: 'r'.repeat(256) }),
                        expect.objectContaining({ callId: 's'.repeat(256) }),
                    ],
                });
                expect(provider.completion).toHaveBeenCalledTimes(5);
                expect(provider.request).not.toHaveBeenCalled();
                expect(localReceiptSnapshots).toEqual([
                    result.applicationToolReceipts?.slice(0, 3),
                    result.applicationToolReceipts,
                ]);
                const localContext = JSON.stringify(provider.completion.mock.calls);
                expect(localContext).not.toContain(RAW_BUFFER_ID);
                expect(localContext).not.toContain(digest(RAW_BUFFER_ID));
                expect(localContext).not.toMatch(/\\?"bufferId\\?"/);
            } else {
                expect(result.rejectionReason).toBeUndefined();
                expect(result.planningOutcome).toMatchObject({
                    kind: 'answer',
                    evidence: [
                        expect.objectContaining({ callId: 'intake' }),
                        expect.objectContaining({ callId: 'r'.repeat(256) }),
                        expect.objectContaining({ callId: 's'.repeat(256) }),
                    ],
                });
                expect(provider.request).toHaveBeenCalledTimes(5);
                expect(provider.completion).not.toHaveBeenCalled();
            }
            if (backend === 'cloud') {
                expect(nativeReceiptSnapshots).toEqual([
                    result.applicationToolReceipts?.slice(0, 3),
                    result.applicationToolReceipts,
                ]);
            }
            expect(result.applicationToolReceipts).toHaveLength(4);
            const first = result.applicationToolReceipts?.find((receipt) => receipt.callId === 'r'.repeat(256))
                ?.data as {
                hits: unknown[];
            };
            const second = result.applicationToolReceipts?.find((receipt) => receipt.callId === 's'.repeat(256))
                ?.data as {
                hits: unknown[];
                complete: boolean;
            };
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
