import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { projectStore } from '#/modules/Project/stores';
import { digest } from '#/utils/canonicalDigest';

import {
    BASS_ID,
    BRIEF_REVISION,
    BRIEF_ROUTE,
    DRUMS_ID,
    PLANNED_BRIEF_REVISION,
    PROMPT,
    VOCAL_ID,
    briefIntake,
    cardContent,
    confirmBrief,
    editBrief,
    lastMessage,
    liveBriefRevision,
    proposeBrief,
    proposedCards,
    renderTrack,
    requireOnlyProposedCard,
    resetVibeRunFixture,
    scriptPlanningTurns,
    sendChatMessage,
    tearDownVibeRunFixture,
    trackDeviceTypes,
    type Confirmation,
    type RenderInput,
} from '../../__tests__/vibeRunWorkflowFixture';
import { agentResourceLimitsStore, readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { chatStore, clearChatMessages } from '../../stores/chatStore';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { groundVibeRunBatch } from '../agentRequestOrchestration/groundVibeRunBatch';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import * as briefCompiler from '../executeBriefCompile';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getBriefMixIntentCatalog } from '../getBriefMixIntentCatalog';
import { getProjectContext } from '../getProjectContext';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { reproposePendingChatActions } from '../reproposePendingChatActions';
import { revertVibeRun } from '../revertVibeRun';
import { skipPendingVibeBatch } from '../skipPendingVibeBatch';

import { landProjectEdit } from './landProjectEdit';
import { decodeReceiptContext, readReceiptSummary } from './receiptContextFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * AC-003 of #4372: a whole-project request plans a measured run of recipe batches behind its brief.
 * The brief is confirmed first; each batch is then grounded at the revision the batch before it left,
 * previewed and measured, and approved on its own, and the run stops cleanly on a reject or a refusal.
 */
const runtimeMocks = vi.hoisted(() => ({ backend: { value: 'cloud' } }));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => ({ provider: 'openai', model: 'hosted-model', baseUrl: 'https://api.openai.com/v1' }),
}));

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(async () => {
        throw new Error('Unscripted provider planning request.');
    }),
}));

// A committed batch builds a live strip and its EQ filters on this context, whose stubbed params
// carry no schedulable timeline, so only the per-parameter write to a live node is stubbed below.
vi.hoisted(() => {
    const OriginalAudioContext = globalThis.AudioContext;
    const createAudioParam = (value: number) => ({
        value,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
        setTargetAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
    });
    const createNode = () => ({
        connect: (destination: unknown) => destination,
        disconnect: () => undefined,
    });
    function AudioContextWithDeviceNodes(options?: AudioContextOptions): AudioContext {
        const context = new OriginalAudioContext(options);
        return Object.assign(context, {
            currentTime: 0,
            createStereoPanner: () => ({ ...createNode(), pan: createAudioParam(0) }),
            createBiquadFilter: () => ({
                ...createNode(),
                type: 'lowpass',
                frequency: createAudioParam(350),
                Q: createAudioParam(1),
                gain: createAudioParam(0),
                detune: createAudioParam(0),
            }),
        });
    }
    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        writable: true,
        value: AudioContextWithDeviceNodes,
    });
    const OriginalAudioWorkletNode = globalThis.AudioWorkletNode;
    class AudioWorkletNodeWithClosablePort extends OriginalAudioWorkletNode {
        constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
            super(context, name, options);
            if (typeof this.port.close !== 'function') {
                Object.defineProperty(this.port, 'close', { configurable: true, value: () => undefined });
            }
        }
    }
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        writable: true,
        value: AudioWorkletNodeWithClosablePort,
    });
});

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
    updateDeviceParam: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

beforeEach(() => {
    resetVibeRunFixture(audio, runtimeMocks.backend);
});

afterEach(() => {
    tearDownVibeRunFixture();
});

describe('a whole-project vibe run of measured recipe batches (AC-003 of #4372)', () => {
    it('schedules the selected width for a contrast request', async () => {
        const catalog = getMixRecipeCatalog();
        const mixIntent = {
            catalogId: digest({ version: catalog.version, descriptors: [...catalog.descriptors].sort() }),
            requestedDescriptors: ['wide'],
        };
        scriptPlanningTurns([
            briefIntake,
            () => [{ id: 'brief-compile', name: 'brief.compile', arguments: { vision: 'A wider mix', mixIntent } }],
            proposeBrief,
        ]);
        await sendChatMessage('make this mix not so much warmer as wider');
        const brief = requireOnlyProposedCard();
        expect(cardContent(brief)).toContain('wide drums');
        expect(cardContent(brief)).not.toContain('warm drums');
    });

    it.each([
        ...['only', 'just', 'merely', 'simply', 'solely', 'exclusively'].map(
            (focus): readonly [string, readonly string[]] => [
                `make this mix not ${focus} warmer but also wider`,
                ['warm', 'wide'],
            ]
        ),
        ['make this mix not only warmer, but wider', ['warm', 'wide']],
        ['make this mix warmer rather than wider', ['warm']],
        ['make this mix warmer instead of wider', ['warm']],
        ['make this mix warmer as opposed to wider', ['warm']],
        ['make this mix not so much warmer as wider', ['wide']],
        ['make it warmer but not brighter', ['warm']],
        ['keep the drums punchy and make the vocal warmer', ['warm']],
        ['make it warmer and less muddy', ['warm', 'muddy']],
        ['make the whole mix warmer around the track called Wider', ['warm']],
        ['make the whole mix warmer around "Wider"', ['warm']],
        ['make this mix warmer and more open', ['wide']],
        ['make this mix not so much warmer as wider', ['warm']],
    ] satisfies readonly (readonly [string, readonly string[]])[])(
        'uses the explicit selection for %s',
        async (prompt, requestedDescriptors) => {
            if (prompt.includes('Wider')) {
                landProjectEdit(() => {
                    const state = trackStore.value;
                    if (state === null) {
                        throw new Error('Expected project tracks');
                    }
                    trackStore.set({
                        ...state,
                        tracks: state.tracks.map((track) =>
                            track.id === DRUMS_ID ? { ...track, name: 'Wider' } : track
                        ),
                    });
                });
            }
            scriptPlanningTurns([
                briefIntake,
                () => [
                    {
                        id: 'brief-compile',
                        name: 'brief.compile',
                        arguments: {
                            vision: 'A chosen sound',
                            mixIntent: { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors },
                        },
                    },
                ],
                proposeBrief,
            ]);
            await sendChatMessage(prompt);
            const brief = requireOnlyProposedCard();
            const schedule = agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule;
            if (schedule?.kind !== 'vibe-run') {
                throw new Error('Expected a scheduled vibe run');
            }
            const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
            expect(plan).not.toBeNull();
            expect([...new Set(plan?.batches.flatMap((batch) => batch.objective.descriptors))].sort()).toEqual(
                [...requestedDescriptors].sort()
            );
            const vocalRecipes =
                plan?.batches.flatMap((batch) =>
                    batch.targets.filter((target) => target.targetId === VOCAL_ID).flatMap((target) => target.recipeIds)
                ) ?? [];
            for (const descriptor of requestedDescriptors) {
                expect(vocalRecipes).toContain(`vocal-${descriptor}`);
            }
            expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(
                plan?.batches.reduce((total, batch) => total + batch.targetIds.length, 0) ?? 0
            );
            expect(plan?.schemaVersion).toBe(2);
        }
    );

    it('refuses a successful compilation whose retained intent is missing', async () => {
        const compile = briefCompiler.executeBriefCompile;
        vi.spyOn(briefCompiler, 'executeBriefCompile').mockImplementation((input) => {
            const result = compile(input);
            Reflect.deleteProperty(result, 'mixIntent');
            return result;
        });
        const requests = scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        expect(proposedCards()).toEqual([]);
        expect(requests).toHaveLength(3);
        expect(vi.mocked(briefCompiler.executeBriefCompile).mock.results[0]?.value.receipt.status).toBe('success');
        expect(lastMessage()).toContain('Provider referenced an unknown, duplicate, or failed transform compilation');
    });

    it('refuses a brief compilation with a stale retained revision', async () => {
        const compile = briefCompiler.executeBriefCompile;
        vi.spyOn(briefCompiler, 'executeBriefCompile').mockImplementation((input) => {
            const result = compile(input);
            return { ...result, receipt: { ...result.receipt, revision: 'stale-revision' } };
        });
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        expect(proposedCards()).toEqual([]);
        expect(lastMessage()).toContain('Provider referenced a stale transform compilation');
    });

    it('does not schedule a reduced quality when the typed selection is empty', async () => {
        scriptPlanningTurns([
            briefIntake,
            () => [
                {
                    id: 'brief-compile',
                    name: 'brief.compile',
                    arguments: {
                        vision: 'Less punch',
                        mixIntent: { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors: [] },
                    },
                },
            ],
            proposeBrief,
        ]);
        await sendChatMessage('make the drums less punchy');
        const brief = requireOnlyProposedCard();
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toBeUndefined();
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it.each([
        {
            callId: 'brief-compile',
            vision: 'First vision',
            descriptor: 'wide',
            excluded: 'warm',
            role: 'bass',
            stemRecipe: 'bass-wide',
        },
        {
            callId: 'later-compile',
            vision: 'Later vision',
            descriptor: 'warm',
            excluded: 'wide',
            role: 'lead vocal',
            stemRecipe: 'vocal-warm',
        },
    ])(
        'adopts $callId with its own brief and mix selection',
        async ({ callId, vision, descriptor, excluded, role, stemRecipe }) => {
            landProjectEdit(() => {
                const state = trackStore.value;
                if (state === null) {
                    throw new Error('Expected project tracks');
                }
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => (track.id === BASS_ID ? { ...track, name: 'Stem 7' } : track)),
                });
            });
            expect(getProjectContext().tracks.find((track) => track.id === BASS_ID)?.canonicalRole?.source).not.toBe(
                'authored'
            );
            expect(getProjectContext().tracks.find((track) => track.id === BASS_ID)?.canonicalRole?.role).toBe(
                'unknown'
            );
            expect(projectStore.value?.productionBrief.trackRoles).toEqual([]);
            const intent = (requestedDescriptors: readonly string[]) => ({
                catalogId: getBriefMixIntentCatalog().catalogId,
                requestedDescriptors,
            });
            const requests = scriptPlanningTurns([
                briefIntake,
                () => [
                    {
                        id: 'brief-compile',
                        name: 'brief.compile',
                        arguments: {
                            vision: 'First vision',
                            trackRoles: [{ trackId: BASS_ID, role: 'bass' }],
                            mixIntent: intent(['wide']),
                        },
                    },
                ],
                () => [
                    {
                        id: 'later-compile',
                        name: 'brief.compile',
                        arguments: {
                            vision: 'Later vision',
                            trackRoles: [{ trackId: BASS_ID, role: 'lead vocal' }],
                            mixIntent: intent(['warm']),
                        },
                    },
                ],
                (request) =>
                    proposeBrief(request).map((call) => ({
                        ...call,
                        arguments: { ...call.arguments, compiledCallIds: [callId] },
                    })),
            ]);
            await sendChatMessage('make the whole mix warmer or wider; Stem 7 is bass or lead vocal');
            for (const [index, callId] of [
                [2, 'brief-compile'],
                [3, 'later-compile'],
            ] as const) {
                const request = requests[index];
                if (request === undefined) {
                    throw new Error('Expected the compiler receipt turn');
                }
                expect(decodeReceiptContext(readReceiptSummary(request.userMessage).value)).toEqual(
                    expect.arrayContaining([expect.objectContaining({ callId, status: 'success' })])
                );
            }
            const brief = requireOnlyProposedCard();
            expect(brief.actions).toMatchObject([
                {
                    type: 'setProductionBrief',
                    payload: { brief: { vision, trackRoles: [expect.objectContaining({ trackId: BASS_ID, role })] } },
                },
            ]);
            expect(cardContent(brief)).toContain(`${descriptor} drums`);
            expect(cardContent(brief)).not.toContain(`${excluded} drums`);
            const schedule = agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule;
            if (schedule?.kind !== 'vibe-run') {
                throw new Error('Expected a scheduled vibe run');
            }
            const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
            expect(plan).not.toBeNull();
            expect([...new Set(plan?.batches.flatMap((batch) => batch.objective.descriptors))]).toEqual([descriptor]);
            expect(plan?.batches.flatMap((batch) => batch.targets.flatMap((target) => target.recipeIds))).toContain(
                `drums-${descriptor}`
            );
            const stemTargets =
                plan?.batches.flatMap((batch) => batch.targets.filter((target) => target.targetId === BASS_ID)) ?? [];
            expect(stemTargets).toHaveLength(1);
            expect(stemTargets[0]?.recipeIds).toContain(stemRecipe);
            expect(stemTargets[0]?.recipeIds).not.toContain(`${role === 'bass' ? 'vocal' : 'bass'}-${descriptor}`);
        }
    );

    it('lists the planned batches on the brief card and applies nothing before Confirm', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);

        await sendChatMessage(PROMPT);

        const brief = requireOnlyProposedCard();
        expect(brief.actions.map((action) => action.type)).toEqual(['setProductionBrief']);
        expect(cardContent(brief)).toContain(
            [
                'After the brief, 3 batches follow, each measured, previewed and approved on its own:',
                '- Batch 2 of 4: warm drums — Drums',
                '- Batch 3 of 4: warm vocal — Vocal',
                '- Batch 4 of 4: warm bass — Bass',
            ].join('\n')
        );
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toMatchObject({
            kind: 'vibe-run',
            position: 1,
            total: 4,
            briefRevision: PLANNED_BRIEF_REVISION,
        });
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(3);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
    });

    it('approves each batch in turn, each grounded at the revision the batch before it left', async () => {
        const brief = await confirmBrief();
        const seen: Confirmation[] = [];

        for (const [index, targetId] of [DRUMS_ID, VOCAL_ID, BASS_ID].entries()) {
            const position = index + 2;
            const card = requireOnlyProposedCard();
            seen.push(card);
            expect(card.runId).toBe(brief.runId);
            expect(card.approvalSnapshot.batchPosition).toEqual({ index: position, total: 4 });
            // Grounded after the batch before it committed, at the revision that commit left.
            expect(card.projectRevision).toBe(captureProjectRevision());
            expect(card.approvalSnapshot.adoptedRecipes?.map((recipe) => recipe.targetId)).toEqual([targetId]);
            expect(cardContent(card)).toMatch(new RegExp(`^Batch ${String(position)} of 4: `, 'u'));
            expect(cardContent(card)).toContain('Fresh approval preview on ');
            expect(cardContent(card)).not.toContain('(blocked)');
            const state = metricGoalStateCodec(card.approvalSnapshot.metricGoalState);
            expect(state?.authorities.map((authority) => authority.origin)).toEqual(['vibe-run-plan']);
            expect(state?.proofs.length).toBeGreaterThan(0);
            expect(trackDeviceTypes(targetId)).toEqual([]);

            await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({
                status: 'executed',
            });
            expect(trackDeviceTypes(targetId)).toEqual(['builtin-eq']);
        }

        expect(new Set(seen.map((card) => card.projectRevision)).size).toBe(3);
        expect(proposedCards()).toEqual([]);
        expect(lastMessage()).toMatch(
            /^The vibe run finished: the brief and 3 of 3 batches were applied\.\n- Batch 2 \(warm drums\): .+\n- Batch 3 \(warm vocal\): .+\n- Batch 4 \(warm bass\): .+$/u
        );
        expect(lastMessage()).toContain('on Drums');
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('completed');
    });

    it('stops on a rejected batch, saying which batches stayed applied, and proposes no later batch', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'executed',
        });
        const vocal = requireOnlyProposedCard();

        await expect(cancelPendingChatActions({ confirmationId: vocal.id })).resolves.toEqual({
            status: 'cancelled',
        });

        expect(cardContent(vocal)).toMatch(/^Cancelled pending actions:\n\n- .+\n\nBatches 1–2 remain applied\.$/su);
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
        expect(trackDeviceTypes(BASS_ID)).toEqual([]);
        expect(liveBriefRevision()).toBe(PLANNED_BRIEF_REVISION);
        // The run committed the brief and one batch, so it ends partially completed, not cancelled whole.
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
    });

    it.each([
        { settlement: 'reject', cleared: false, stop: 'cancelled' },
        { settlement: 'resolve', cleared: false, stop: 'cancelled' },
        { settlement: 'reject', cleared: true, stop: 'cancelled' },
        { settlement: 'resolve', cleared: true, stop: 'cancelled' },
        { settlement: 'reject', cleared: false, stop: 'failed' },
        { settlement: 'resolve', cleared: false, stop: 'failed' },
        { settlement: 'reject', cleared: true, stop: 'failed' },
        { settlement: 'resolve', cleared: true, stop: 'failed' },
    ] as const)(
        'settles a $stop later preview with $settlement (chat cleared: $cleared)',
        async ({ settlement, cleared, stop }) => {
            const brief = await confirmBrief();
            const drums = requireOnlyProposedCard();
            let admitted!: () => void;
            const admission = new Promise<void>((resolve) => {
                admitted = resolve;
            });
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            audio.renderTrackSubgraphOffline.mockImplementationOnce(async (input: RenderInput) => {
                admitted();
                await held;
                if (settlement === 'reject') {
                    throw new Error('held preview failed');
                }
                return renderTrack(input);
            });
            const confirmation = confirmPendingChatActions({ confirmationId: drums.id });
            await admission;
            if (stop === 'cancelled') {
                await expect(
                    agentRunCancellation.cancel({ runId: brief.runId, reason: 'Cancelled by user' })
                ).resolves.toMatchObject({
                    status: 'cancelled',
                    phase: 'partially-completed',
                });
            } else {
                const batchId = agentRunLifecycle.get(brief.runId)?.batches.at(-1)?.batchId;
                if (batchId === undefined) {
                    throw new TypeError('Expected a preparing batch');
                }
                agentRunLifecycle.recordError({
                    runId: brief.runId,
                    terminal: true,
                    error: normalizeAgentFailure({
                        category: 'render',
                        source: 'command-execution',
                        related: { workIds: [batchId] },
                    }),
                });
                expect(agentRunLifecycle.get(brief.runId)?.cancellation.requestedAt).toBeNull();
            }
            const stopped = agentRunLifecycle.get(brief.runId);
            expect(stopped?.batches.at(-1)?.status).toBe(stop);
            const errors = structuredClone(stopped?.errors);
            const revision = captureProjectRevision();
            const tracks = structuredClone(trackStore.value);
            const history = structuredClone(undoHistoryStore.value);
            const preparing = chatStore.value?.messages.find((message) =>
                message.content.startsWith('Preparing batch 3 of 4')
            );
            expect(preparing).toBeDefined();
            const otherMessages = chatStore.value?.messages.filter((message) => message.id !== preparing?.id);
            if (cleared) {
                clearChatMessages();
            }
            release();
            await expect(confirmation).resolves.toEqual({ status: 'executed' });
            const settled = agentRunLifecycle.get(brief.runId);
            expect(settled?.phase).toBe('partially-completed');
            expect(settled?.batches.at(-1)?.status).toBe(stop);
            expect(settled?.errors).toEqual(errors);
            expect(captureProjectRevision()).toBe(revision);
            expect(trackStore.value).toEqual(tracks);
            expect(undoHistoryStore.value).toEqual(history);
            if (cleared) {
                expect(chatStore.value?.messages).toEqual([]);
            } else {
                expect(chatStore.value?.messages.find((message) => message.id === preparing?.id)).toMatchObject({
                    content: `${stop === 'cancelled' ? 'Cancelled' : 'Stopped'} preparation of batch 3 of 4. Batches 1–2 remain applied.`,
                    pendingActionConfirmationStatus: stop === 'cancelled' ? 'cancelled' : undefined,
                    stoppableRunId: undefined,
                });
                expect(chatStore.value?.messages.filter((message) => message.id !== preparing?.id)).toEqual(
                    otherMessages
                );
            }
            expect(chatStore.value?.messages.some((message) => message.content.startsWith('Preparing batch'))).toBe(
                false
            );
            expect(proposedCards()).toEqual([]);
            expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
            expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
            expect(trackDeviceTypes(BASS_ID)).toEqual([]);
        }
    );

    it('names the target and document a batch preview renders, and its Stop ends the run with the earlier batches applied', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        const seen: string[] = [];
        let admitted!: () => void;
        const admission = new Promise<void>((resolve) => {
            admitted = resolve;
        });
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => {
            const preparing = chatStore.value?.messages.find((message) =>
                message.content.startsWith('Preparing batch 3')
            );
            seen.push(preparing?.content ?? '');
            if (seen.length === 2) {
                admitted();
                await held;
            }
            return renderTrack(input);
        });
        const confirmation = confirmPendingChatActions({ confirmationId: drums.id });
        await admission;
        // The live project rendered first, then the batch, each named as it began.
        expect(seen).toEqual([
            'Preparing batch 3 of 4: rendering Vocal as it is now...',
            'Preparing batch 3 of 4: rendering Vocal with the whole batch applied...',
        ]);
        const preparing = chatStore.value?.messages.find((message) => message.content.startsWith('Preparing batch 3'));
        expect(preparing?.stoppableRunId).toBe(brief.runId);

        // What the panel's Stop does.
        await agentRunCancellation.cancel({ runId: brief.runId, reason: 'Cancelled by user' });
        release();
        await expect(confirmation).resolves.toEqual({ status: 'executed' });

        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
        expect(chatStore.value?.messages.find((message) => message.id === preparing?.id)).toMatchObject({
            content: 'Cancelled preparation of batch 3 of 4. Batches 1–2 remain applied.',
            pendingActionConfirmationStatus: 'cancelled',
            stoppableRunId: undefined,
        });
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
    });

    it('settles a batch preview the project moved under to a final line, with no progress left on it', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => {
            // The project moves while the batch preview renders, so the preview cannot stand.
            landProjectEdit(() => {
                const state = trackStore.value;
                if (state === null) {
                    throw new TypeError('Expected an open project with tracks');
                }
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) =>
                        track.id === BASS_ID ? { ...track, name: `${track.name} moved` } : track
                    ),
                });
            });
            return renderTrack(input);
        });

        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({ status: 'executed' });

        const messages = chatStore.value?.messages ?? [];
        expect(messages.filter((message) => message.content.includes('rendering'))).toEqual([]);
        expect(messages.filter((message) => message.stoppableRunId !== undefined)).toEqual([]);
        expect(messages.find((message) => message.content.startsWith('Stopped preparation of batch 3'))).toMatchObject({
            content: 'Stopped preparation of batch 3 of 4. Batches 1–2 remain applied.',
            stoppableRunId: undefined,
        });
        expect(proposedCards()).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
    });

    it('re-previews a stale batch card with its progress line and Stop, which ends the run as a scheduled preview’s does', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        const cardMessage = () => chatStore.value?.messages.find((message) => message.id === drums.assistantMessageId);
        const cardText = cardMessage()?.content;
        // The card goes stale: the project moved since it was previewed.
        landProjectEdit(() => {
            const state = trackStore.value;
            if (state === null) {
                throw new TypeError('Expected an open project with tracks');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) =>
                    track.id === BASS_ID ? { ...track, name: `${track.name} moved` } : track
                ),
            });
        });
        const seen: { content: string | undefined; stoppableRunId: string | undefined }[] = [];
        let admitted!: () => void;
        const admission = new Promise<void>((resolve) => {
            admitted = resolve;
        });
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => {
            const card = cardMessage();
            seen.push({ content: card?.content, stoppableRunId: card?.stoppableRunId });
            if (seen.length === 1) {
                admitted();
                await held;
            }
            return renderTrack(input);
        });

        const repreview = reproposePendingChatActions({ confirmationId: drums.id });
        await admission;
        expect(seen).toEqual([
            { content: 'Preparing batch 2 of 4: rendering Drums as it is now...', stoppableRunId: brief.runId },
        ]);
        expect(cardText).not.toBe(seen[0]?.content);

        // What the panel's Stop does.
        await agentRunCancellation.cancel({ runId: brief.runId, reason: 'Cancelled by user' });
        release();
        await expect(repreview).resolves.toMatchObject({ status: 'rejected' });

        // The brief committed, so the stopped run ends partially completed, as a stopped scheduled preview leaves it.
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
        expect(cardMessage()).toMatchObject({
            content: 'Cancelled preparation of batch 2 of 4. Batch 1 remains applied.',
            pendingActionConfirmationStatus: 'cancelled',
            stoppableRunId: undefined,
        });
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
    });

    it('takes the progress line and Stop off a batch card whose re-preview finished', async () => {
        await confirmBrief();
        const drums = requireOnlyProposedCard();
        const cardText = chatStore.value?.messages.find((message) => message.id === drums.assistantMessageId)?.content;

        await expect(reproposePendingChatActions({ confirmationId: drums.id })).resolves.toMatchObject({
            status: 'reproposed',
        });

        const messages = chatStore.value?.messages ?? [];
        expect(messages.filter((message) => message.stoppableRunId !== undefined)).toEqual([]);
        expect(messages.filter((message) => message.content.includes('rendering'))).toEqual([]);
        expect(cardText).toBeDefined();
    });

    it('names the target the initial measurement renders, and its Stop cancels the run before any card', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        let admitted!: (trackId: string) => void;
        const admission = new Promise<string>((resolve) => {
            admitted = resolve;
        });
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        audio.renderTrackSubgraphOffline.mockImplementationOnce(async (input: RenderInput) => {
            admitted(input.targetTrackId);
            await held;
            return renderTrack(input);
        });
        const sending = sendChatMessage(PROMPT);
        const trackId = await admission;
        const name = trackStore.value?.tracks.find((track) => track.id === trackId)?.name;
        const progress = chatStore.value?.messages.filter((message) => message.stoppableRunId !== undefined);
        expect(progress?.map((message) => message.content)).toEqual([
            `Measuring the starting point: rendering ${String(name)}...`,
        ]);
        const runId = progress?.[0]?.stoppableRunId;
        if (runId === undefined) {
            throw new TypeError('Expected the progress message to name its run');
        }

        // What the panel's Stop does.
        await agentRunCancellation.cancel({ runId, reason: 'Cancelled by user' });
        release();
        await sending;

        expect(
            chatStore.value?.messages.some((message) => message.content.startsWith('Measuring the starting point'))
        ).toBe(false);
        expect(proposedCards()).toEqual([]);
        expect(agentRunLifecycle.get(runId)?.phase).toBe('cancelled');
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
    });

    it('blocks approval and retains the failure receipt when a later preview render fails', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        audio.renderTrackSubgraphOffline.mockRejectedValueOnce(new Error('preview failed'));

        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({ status: 'executed' });

        const card = requireOnlyProposedCard();
        expect(getAgentApprovalView({ confirmationId: card.id })).toMatchObject({
            canConfirm: false,
            metricGoals: { status: 'blocked' },
        });
        const run = agentRunLifecycle.get(brief.runId);
        expect(run?.phase).toBe('waiting-for-approval');
        expect(run?.plan?.applicationToolReceipts).toContainEqual(
            expect.objectContaining({
                status: 'failure',
                error: expect.objectContaining({ code: 'render-failed', retryable: false }),
            })
        );
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
        expect(trackDeviceTypes(BASS_ID)).toEqual([]);
    });

    it('stops on the first batch rejected, saying the brief alone stayed applied', async () => {
        await confirmBrief();
        const drums = requireOnlyProposedCard();

        await expect(cancelPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'cancelled',
        });

        expect(cardContent(drums)).toMatch(/^Cancelled pending actions:\n\n- .+\n\nBatch 1 remains applied\.$/su);
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
    });

    it('stops on a batch whose target was frozen since planning, with the earlier batches applied', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        // The plan was read with the Vocal open; it freezes before the brief is confirmed, so the
        // brief card asks once to be approved again and the plan still names the Vocal.
        landProjectEdit(() => {
            const state = trackStore.value;
            if (state === null) {
                throw new TypeError('Expected an open project with tracks');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => (track.id === VOCAL_ID ? { ...track, frozen: true } : track)),
            });
        });
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toMatchObject({
            status: 'reapproval_required',
        });
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
            status: 'executed',
        });
        const drums = requireOnlyProposedCard();
        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(chatStore.value?.messages.at(-2)?.content).toBe(
            'Batch 3 of 4 was not proposed: its target “Vocal” is frozen. Batches 1–2 remain applied.'
        );
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(trackDeviceTypes(BASS_ID)).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
    });

    it('refuses a later batch once the brief changed since the run was planned', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();

        await editBrief();

        await expect(reproposePendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'rejected',
            reason: `The production brief changed since this run was planned (rev ${String(PLANNED_BRIEF_REVISION)} → ${String(PLANNED_BRIEF_REVISION + 1)}).`,
        });
        const run = agentRunLifecycle.get(brief.runId);
        const schedule = run?.plan?.batchSchedule;
        if (run === null || schedule?.kind !== 'vibe-run') {
            throw new TypeError('Expected the vibe run and its schedule');
        }
        expect(groundVibeRunBatch(run, schedule, 3)).toEqual({
            status: 'rejected',
            reason: `production brief changed since this run was planned (rev ${String(PLANNED_BRIEF_REVISION)} → ${String(PLANNED_BRIEF_REVISION + 1)})`,
        });
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
    });

    it('refuses Confirm of a parked batch once the brief changed, before asking for any re-approval', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        await editBrief();

        const reason = `The production brief changed since this run was planned (rev ${String(PLANNED_BRIEF_REVISION)} → ${String(PLANNED_BRIEF_REVISION + 1)}).`;
        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'failed',
            reason,
        });

        expect(cardContent(drums)).toContain(reason);
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
    });

    it('waits for each batch’s own approval under the most permissive trust ceiling', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT, { mode: 'apply', trustCeiling: 'destructive-commit' });
        const brief = requireOnlyProposedCard();
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toMatchObject({
            kind: 'vibe-run',
            trustCeiling: 'destructive-commit',
        });

        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
            status: 'executed',
        });

        const drums = requireOnlyProposedCard();
        expect(drums.approvalSnapshot.batchPosition).toEqual({ index: 2, total: 4 });
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('waiting-for-approval');
    });

    it('plans no batch for a quality the request withholds', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);

        await sendChatMessage("make this mix warmer but don't let the vocal get brighter");

        const content = cardContent(requireOnlyProposedCard());
        expect(content).toContain(
            [
                'After the brief, 3 batches follow, each measured, previewed and approved on its own:',
                '- Batch 2 of 4: warm drums — Drums',
                '- Batch 3 of 4: warm vocal — Vocal',
                '- Batch 4 of 4: warm bass — Bass',
            ].join('\n')
        );
        expect(content).not.toContain('bright');
    });

    it('proposes warmth without widening for a contrastive request, with each batch still awaiting approval', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);

        await sendChatMessage('make this mix warmer rather than wider');

        const brief = requireOnlyProposedCard();
        expect(cardContent(brief)).toContain(
            [
                'After the brief, 3 batches follow, each measured, previewed and approved on its own:',
                '- Batch 2 of 4: warm drums — Drums',
                '- Batch 3 of 4: warm vocal — Vocal',
                '- Batch 4 of 4: warm bass — Bass',
            ].join('\n')
        );
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
            status: 'executed',
        });

        const drums = requireOnlyProposedCard();
        expect(drums.approvalSnapshot.batchPosition).toEqual({ index: 2, total: 4 });
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'executed',
        });
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        const vocal = requireOnlyProposedCard();
        expect(vocal.approvalSnapshot.batchPosition).toEqual({ index: 3, total: 4 });
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('waiting-for-approval');
    });

    it('schedules nothing when the render budget cannot preview every batch, and says why', async () => {
        agentResourceLimitsStore.set({ ...readAgentResourceLimits(), maxRenderJobs: 4 });
        scriptPlanningTurns(BRIEF_ROUTE);

        await sendChatMessage(PROMPT);

        const brief = requireOnlyProposedCard();
        expect(cardContent(brief)).toContain(
            "No batches were scheduled after the brief: initial measurements and previewing every batch need 9 renders, more than the 4 this run's maxRenderJobs budget has left; the drums family (1 track) fits."
        );
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toBeUndefined();
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
            status: 'executed',
        });
        expect(proposedCards()).toEqual([]);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('completed');
    });

    it('keeps a vibe-run schedule through a store round trip and drops a tampered one', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        const schedule = agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule;
        expect(schedule?.kind).toBe('vibe-run');

        // The run state persists as JSON, so the schedule must survive being written as text.
        const persistedText = JSON.stringify(readAgentRunState());
        const restored = sanitizeAgentRunState(JSON.parse(persistedText));
        expect(restored.runs.find((run) => run.runId === brief.runId)?.plan?.batchSchedule).toEqual(schedule);

        const tampered = structuredClone(readAgentRunState());
        const stored = tampered.runs.find((run) => run.runId === brief.runId)?.plan?.batchSchedule;
        if (stored?.kind !== 'vibe-run') {
            throw new TypeError('Expected the stored vibe-run schedule');
        }
        // A plan read from another brief revision than the schedule records is refused whole.
        stored.briefRevision = PLANNED_BRIEF_REVISION + 1;
        expect(
            sanitizeAgentRunState(tampered).runs.find((run) => run.runId === brief.runId)?.plan?.batchSchedule
        ).toBeUndefined();
    });
    describe('the one summary a run ends with, and reverting the whole run', () => {
        function summaryMessages() {
            return (chatStore.value?.messages ?? []).filter((message) => message.content.startsWith('The vibe run '));
        }

        async function confirmCard(): Promise<Confirmation> {
            const card = requireOnlyProposedCard();
            await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({
                status: 'executed',
            });
            return card;
        }

        async function skipCard(): Promise<Confirmation> {
            const card = requireOnlyProposedCard();
            await expect(skipPendingVibeBatch({ confirmationId: card.id })).resolves.toEqual({ status: 'skipped' });
            return card;
        }

        it('posts one summary after the card text when the run is stopped at batch 3', async () => {
            await confirmBrief();
            await confirmCard();
            const vocal = requireOnlyProposedCard();

            await expect(cancelPendingChatActions({ confirmationId: vocal.id })).resolves.toEqual({
                status: 'cancelled',
            });

            expect(cardContent(vocal)).toMatch(
                /^Cancelled pending actions:\n\n- .+\n\nBatches 1–2 remain applied\.$/su
            );
            const summaries = summaryMessages();
            expect(summaries).toHaveLength(1);
            expect(lastMessage()).toBe(summaries[0]?.content);
            expect(summaries[0]?.content).toMatch(
                /^The vibe run stopped: the brief and 1 of 3 batches were applied\.\n- Batch 2 \(warm drums\): .+ on Drums .+\.\n- Batch 3 \(warm vocal\): not applied, the run stopped here\.\n- Batch 4 \(warm bass\): not proposed\.$/u
            );
        });

        it('follows a refusal at grounding with one summary listing that batch refused', async () => {
            scriptPlanningTurns(BRIEF_ROUTE);
            await sendChatMessage(PROMPT);
            const brief = requireOnlyProposedCard();
            landProjectEdit(() => {
                const state = trackStore.value;
                if (state === null) {
                    throw new TypeError('Expected an open project with tracks');
                }
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => (track.id === VOCAL_ID ? { ...track, frozen: true } : track)),
                });
            });
            await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toMatchObject({
                status: 'reapproval_required',
            });
            await confirmCard();
            await confirmCard();

            const messages = chatStore.value?.messages ?? [];
            expect(messages.at(-2)?.content).toBe(
                'Batch 3 of 4 was not proposed: its target “Vocal” is frozen. Batches 1–2 remain applied.'
            );
            expect(summaryMessages()).toHaveLength(1);
            expect(lastMessage()).toMatch(
                /^The vibe run stopped: the brief and 1 of 3 batches were applied\.\n- Batch 2 \(warm drums\): .+\.\n- Batch 3 \(warm vocal\): refused: its target “Vocal” is frozen\.\n- Batch 4 \(warm bass\): not proposed\.$/u
            );
            expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
        });

        it('lists a skipped batch between two applied ones', async () => {
            const brief = await confirmBrief();
            await confirmCard();
            await skipCard();
            await confirmCard();

            expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('completed');
            expect(summaryMessages()).toHaveLength(1);
            expect(lastMessage()).toMatch(
                /^The vibe run finished: the brief and 2 of 3 batches were applied\.\n- Batch 2 \(warm drums\): .+ on Drums .+\.\n- Batch 3 \(warm vocal\): skipped, not applied\.\n- Batch 4 \(warm bass\): .+ on Bass .+\.$/u
            );
            expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
        });

        it('reverts every applied batch together in one replay and keeps the brief', async () => {
            const brief = await confirmBrief();
            await confirmCard();
            await skipCard();
            await confirmCard();
            const run = agentRunLifecycle.get(brief.runId);
            const groupIds = (run?.receipts ?? []).flatMap((receipt) => receipt.revertGroupId ?? []);
            const briefRevision = liveBriefRevision();

            await expect(revertVibeRun({ runId: brief.runId })).resolves.toMatchObject({ status: 'reverted' });

            expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
            expect(trackDeviceTypes(BASS_ID)).toEqual([]);
            expect(liveBriefRevision()).toBe(briefRevision);
            expect(liveBriefRevision()).toBe(PLANNED_BRIEF_REVISION);
            const batchGroups = groupIds.filter((groupId) =>
                (undoHistoryStore.value?.future ?? []).some((entry) => entry.groupId === groupId)
            );
            expect(batchGroups).toHaveLength(2);
            for (const groupId of batchGroups) {
                expect((undoHistoryStore.value?.past ?? []).some((entry) => entry.groupId === groupId)).toBe(false);
            }
            expect(lastMessage()).toBe(
                'Reverted the vibe run: batch 2 (warm drums), batch 4 (warm bass) undone together. The production brief stays as written.'
            );
        });

        it('undoes nothing when one applied batch can no longer be reverted, and says why', async () => {
            const brief = await confirmBrief();
            await confirmCard();
            await skipCard();
            await confirmCard();
            const drumsDevice = trackStore.value?.tracks.find((track) => track.id === DRUMS_ID)?.devices[0];
            if (drumsDevice === undefined) {
                throw new TypeError('Expected the Drums batch device');
            }
            // A later edit of the project removes what batch 2 added, so its inverse conflicts.
            await executeAppAction({ type: 'removeDevice', payload: { deviceId: drumsDevice.id } });
            const history = structuredClone(undoHistoryStore.value);
            const tracks = structuredClone(trackStore.value);

            await expect(revertVibeRun({ runId: brief.runId })).resolves.toMatchObject({ status: 'refused' });

            expect(trackDeviceTypes(BASS_ID)).toEqual(['builtin-eq']);
            expect(trackStore.value).toEqual(tracks);
            expect(undoHistoryStore.value).toEqual(history);
            expect(lastMessage()).toMatch(/^The vibe run was not reverted; nothing was undone: .+\.$/u);
        });

        it('undoes nothing, not even the older batch, when the newest applied batch can no longer be reverted', async () => {
            const brief = await confirmBrief();
            await confirmCard();
            await skipCard();
            await confirmCard();
            const bassDevice = trackStore.value?.tracks.find((track) => track.id === BASS_ID)?.devices[0];
            if (bassDevice === undefined) {
                throw new TypeError('Expected the Bass batch device');
            }
            // A later edit of the project removes what batch 4 added, so its inverse conflicts.
            await executeAppAction({ type: 'removeDevice', payload: { deviceId: bassDevice.id } });
            const history = structuredClone(undoHistoryStore.value);
            const tracks = structuredClone(trackStore.value);

            await expect(revertVibeRun({ runId: brief.runId })).resolves.toMatchObject({ status: 'refused' });

            expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
            expect(trackStore.value).toEqual(tracks);
            expect(undoHistoryStore.value).toEqual(history);
            expect(lastMessage()).toMatch(/^The vibe run was not reverted; nothing was undone: .+\.$/u);
        });

        it('still refuses the batch after a skipped one once the brief changed', async () => {
            const brief = await confirmBrief();
            await skipCard();
            await editBrief();
            const vocal = requireOnlyProposedCard();

            await expect(skipPendingVibeBatch({ confirmationId: vocal.id })).resolves.toEqual({ status: 'skipped' });

            expect(proposedCards()).toEqual([]);
            expect(chatStore.value?.messages.at(-2)?.content).toBe(
                `Batch 4 of 4 was not proposed: production brief changed since this run was planned (rev ${String(PLANNED_BRIEF_REVISION)} → ${String(PLANNED_BRIEF_REVISION + 1)}). Only batch 1 remains applied.`
            );
            expect(trackDeviceTypes(BASS_ID)).toEqual([]);
            expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
        });
    });
});
