import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import { executeVersionedCommandBatchEnvelope, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { chatStore } from '../../stores/chatStore';
import { getPendingActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { materializePromptCommandPlan } from '../agentRequestOrchestration/materializePromptCommandPlan';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { collectMetricGoalProof } from '../collectMetricGoalProof';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';
import { reproposePendingChatActions } from '../reproposePendingChatActions';

import { advertisedAnswerCandidateId } from './answerWireFixture';
import {
    isRecord,
    readCreativeInterpretationCatalog,
    selectCreativeInterpretationCall,
} from './highLevelIntentWorkflowFixture';
import {
    configureMetricGoalProject,
    metricGoalAudioBuffer,
    metricGoalProviderPlan,
    readMetricPublication,
    resetMetricGoalProject,
} from './metricGoalWorkflowFixture';
import { decodeReceiptContext, readReceiptSummary } from './receiptContextFixture';

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
vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(async () => {
        throw new Error('Unscripted measured plan provider request.');
    }),
}));

const PROMPT = 'Make Lead Vocal warmer over Chorus';
const SECTION_ID = 'private-warm-vocal-section';
const RUN_ID = 'measured-warm-vocal';

beforeEach(() => {
    configureMetricGoalProject({
        label: 'measured warm vocal',
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            createTrack({ id: 'vocal', name: 'Lead Vocal', kind: 'audio' }),
        ],
        sections: [{ id: SECTION_ID, name: 'Chorus', startBeat: 0, endBeat: 4, color: '#ffffff' }],
    });
    vi.mocked(generateToolPlanningOutcome).mockReset();
    for (const port of Object.values(audio)) {
        port.mockReset();
    }
    audio.renderOffline.mockImplementation(async () => {
        throw new Error('Named vocal must use its isolated project render.');
    });
    audio.renderOfflineInput.mockImplementation(async () => {
        throw new Error('Named vocal must use its isolated preview render.');
    });
});
afterEach(() => {
    vi.restoreAllMocks();
    resetMetricGoalProject();
});

describe('configured mixing plan with actual measurements', () => {
    it.each([
        'matched',
        'contradicted',
        'render-failed',
        'two-recipes',
        'two-recipes-parameter-drift',
        'two-recipes-order-drift',
    ] as const)('keeps the real five-turn warm-vocal plan visible and verifies %s evidence', async (mode) => {
        const multipleRecipes = mode.startsWith('two-recipes');
        const targets = ['vocal'];
        const recipeIds = multipleRecipes ? ['vocal-warm', 'vocal-dark'] : ['vocal-warm'];
        const expectedCommands = multipleRecipes ? 11 : 5;
        let prompt = PROMPT;
        if (multipleRecipes) {
            prompt = 'Make Lead Vocal warmer and darker over Chorus';
        }
        flushAutomergeStorageWrites();
        let renderStarts = 0;
        audio.renderTrackSubgraphOffline.mockImplementation(
            async (input: Parameters<typeof renderTrackSubgraphOffline>[0]) => {
                renderStarts += 1;
                const vocal = input.renderTracks.find((track) => track.id === input.targetTrackId);
                if (vocal === undefined) {
                    throw new Error('Missing actual isolated target.');
                }
                const equalizers = vocal.devices.filter((device) => device.type === 'builtin-eq');
                const eq = equalizers[0];
                if (eq !== undefined && mode === 'render-failed') {
                    throw new Error('Controlled preview renderer unavailable.');
                }
                let lowDb = 0;
                let highDb = 0;
                if (mode !== 'contradicted') {
                    lowDb = equalizers.reduce(
                        (total, device) => total + (device.parameterValues['eq-low-gain'] ?? 0),
                        0
                    );
                    highDb = equalizers.reduce(
                        (total, device) => total + (device.parameterValues['eq-high-gain'] ?? 0),
                        0
                    );
                }
                const low = 0.2 * 10 ** (lowDb / 20);
                const high = (multipleRecipes ? 0.1 : 0.2) * 10 ** (highDb / 20);
                const midDb = equalizers.reduce(
                    (total, device) => total + (device.parameterValues['eq-mid-gain'] ?? 0),
                    0
                );
                const mid = multipleRecipes ? 0.3 * 10 ** (midDb / 20) : 0;
                return metricGoalAudioBuffer(
                    (seconds) =>
                        low * Math.sin(2 * Math.PI * 150 * seconds) +
                        high * Math.sin(2 * Math.PI * 10000 * seconds) +
                        mid * Math.sin(2 * Math.PI * 4500 * seconds),
                    (input.endBeat - input.startBeat) / 2
                );
            }
        );
        expect(
            agentRunLifecycle.create({
                runId: RUN_ID,
                request: prompt,
                mode: 'apply',
                createdRevision: captureProjectRevision(),
            })
        ).toEqual({ status: 'created' });
        agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
        chatStore.set({
            messages: [{ id: 'warm-assistant', role: 'assistant', content: 'Planning', timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
        const context = getProjectContext();
        const revision = captureProjectRevision();
        const before = {
            revision,
            tracks: structuredClone(trackStore.value),
            undo: structuredClone(undoHistoryStore.value),
            transport: structuredClone(transportStore.value),
        };
        const turns: string[] = [];
        vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
            turns.push(userMessage);
            expect(JSON.stringify(schemas)).not.toContain(SECTION_ID);
            expect(userMessage).not.toContain(SECTION_ID);
            expect(userMessage).not.toContain('recipeDigest');
            const turn = turns.length;
            if (turn === 1) {
                const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
                const base = selectCreativeInterpretationCall({
                    catalog,
                    modeId: 'edit',
                    targetObjectIds: targets,
                    dimensions: ['processing'],
                    creationSlotObjectTypes: ['device'],
                });
                const schema = schemas.find((candidate) => candidate.function.name === base.name);
                if (schema === undefined) {
                    throw new Error('Missing actual joint schema.');
                }
                const objective = readMetricPublication(schema).find(
                    (candidate) => candidate.recipeId === 'vocal-warm'
                );
                if (objective === undefined) {
                    throw new Error('Missing actual authored vocal criterion.');
                }
                const call = {
                    ...base,
                    id: 'warm-intake',
                    arguments: {
                        ...base.arguments,
                        creationSlotIds: catalog.creationSlots
                            .filter(
                                (slot) =>
                                    slot.objectType === 'device' &&
                                    catalog.targets.some(
                                        (target) =>
                                            target.candidateId === slot.parentCandidateId &&
                                            target.objectIds.length === 1 &&
                                            targets.includes(target.objectIds[0]!)
                                    )
                            )
                            .map((slot) => slot.candidateId),
                        answer: null,
                        metricIntent: {
                            kind: 'perceptual',
                            uncertainty: 'none',
                            objectives: recipeIds.map((recipeId) => {
                                const selected = readMetricPublication(schema).find(
                                    (candidate) => candidate.recipeId === recipeId
                                );
                                if (selected === undefined) {
                                    throw new Error('Missing actual authored objective.');
                                }
                                return {
                                    objectiveId: selected.id,
                                    scopeCandidateId: advertisedAnswerCandidateId([schemas, userMessage], 'vocal'),
                                    referenceScopeCandidateId: null,
                                    rangeCandidateId: advertisedAnswerCandidateId(
                                        [schemas, userMessage],
                                        'Chorus',
                                        'ranges'
                                    ),
                                };
                            }),
                        },
                    },
                };
                expect(matchesJsonSchema(call.arguments, schema.function.parameters)).toBe(true);
                return { status: 'complete', toolCalls: [call] };
            }
            if (turn === 2) {
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'warm-baseline',
                            name: 'analysis.measure',
                            arguments: {
                                scope: { kind: 'tracks', ids: ['vocal'] },
                                range: { startBeat: 0, endBeat: 4 },
                                metrics: ['frequencyBandEnergy', 'spectralCentroid'],
                            },
                        },
                        {
                            id: 'warm-discovery',
                            name: 'recipe.discover',
                            arguments: {
                                descriptors: multipleRecipes ? ['warm', 'dark'] : ['warm'],
                                targetId: 'vocal',
                                limit: 2,
                            },
                        },
                    ].filter((call) => !multipleRecipes || call.id !== 'warm-baseline'),
                };
            }
            if (turn === 3) {
                const receipt = decodeReceiptContext(readReceiptSummary(userMessage).value).find(
                    (entry) => isRecord(entry) && entry.callId === 'warm-discovery'
                );
                expect(receipt).toMatchObject({ status: 'success' });
                return {
                    status: 'complete',
                    toolCalls: recipeIds.map((recipeId, index) => ({
                        id: index === 0 ? 'warm-expansion' : 'warm-backing-expansion',
                        name: 'recipe.expand',
                        arguments: { recipeId, targetId: 'vocal' },
                    })),
                };
            }
            if (turn === 4) {
                if (multipleRecipes) {
                    const summary = readReceiptSummary(userMessage);
                    expect(summary.truncated).toBe(false);
                    const expansions = decodeReceiptContext(summary.value).filter(
                        (entry) => isRecord(entry) && entry.toolName === 'recipe.expand'
                    );
                    expect(expansions).toHaveLength(2);
                    const items = expansions.flatMap((receipt, expansion) => {
                        if (!isRecord(receipt) || !isRecord(receipt.data) || !Array.isArray(receipt.data.commands)) {
                            throw new TypeError('Missing actual successful expansion commands.');
                        }
                        expect(receipt.status).toBe('success');
                        return receipt.data.commands.map((command: unknown, index: number) => {
                            if (
                                !isRecord(command) ||
                                typeof command.name !== 'string' ||
                                !isRecord(command.arguments)
                            ) {
                                throw new TypeError('Malformed published compiler command.');
                            }
                            if (command.name === 'addDevice') {
                                const { trackId: _trackId, ...argumentsValue } = command.arguments;
                                return {
                                    id: `recipe-${String(expansion)}-${String(index)}`,
                                    name: command.name,
                                    arguments: argumentsValue,
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { name: 'Lead Vocal' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                };
                            }
                            let argumentsValue = command.arguments;
                            if (
                                mode === 'two-recipes-parameter-drift' &&
                                expansion === 0 &&
                                argumentsValue.paramId === 'eq-low-gain'
                            ) {
                                argumentsValue = { ...argumentsValue, value: 2.5 };
                            }
                            return {
                                id: `recipe-${String(expansion)}-${String(index)}`,
                                name: command.name,
                                arguments: argumentsValue,
                                dependsOn: [`recipe-${String(expansion)}-0`],
                            };
                        });
                    });
                    if (mode === 'two-recipes-order-drift') {
                        const firstParameter = items[1];
                        const lastParameter = items[4];
                        if (firstParameter === undefined || lastParameter === undefined) {
                            throw new Error('Missing actual first recipe parameter commands.');
                        }
                        items[1] = lastParameter;
                        items[4] = firstParameter;
                    }
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'warm-preview',
                                name: 'analysis.measure',
                                arguments: {
                                    subject: 'preview',
                                    scope: { kind: 'tracks', ids: targets },
                                    range: { startBeat: 0, endBeat: 4 },
                                    metrics: ['frequencyBandEnergy', 'spectralCentroid'],
                                    proposal: { schemaVersion: 1, items },
                                },
                            },
                        ],
                    };
                }
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'warm-preview',
                            name: 'analysis.measure',
                            arguments: {
                                subject: 'preview',
                                recipeCallId: 'warm-expansion',
                                scope: { kind: 'tracks', ids: ['vocal'] },
                                range: { startBeat: 0, endBeat: 4 },
                                metrics: ['frequencyBandEnergy', 'spectralCentroid'],
                            },
                        },
                    ],
                };
            }
            if (turn === 5) {
                if (multipleRecipes) {
                    const summary = readReceiptSummary(userMessage);
                    expect(summary.truncated).toBe(false);
                    expect(summary.value.length).toBeLessThanOrEqual(8192);
                    expect(decodeReceiptContext(summary.value)).toHaveLength(5);
                }
                let adopted = 'warm-preview';
                if (mode === 'render-failed') {
                    adopted = 'warm-expansion';
                }
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'warm-proposal',
                            name: 'command.batch.propose',
                            arguments: {
                                commands: [],
                                compiledCallIds: [adopted],
                                plan: metricGoalProviderPlan(prompt, ['vocal']),
                            },
                        },
                    ],
                };
            }
            throw new Error('Mix plan exceeded the earned fifth turn.');
        });
        const planned = await parsePromptToActions({
            prompt,
            context,
            projectRevision: revision,
            streamIdentity: { runId: RUN_ID, requestId: 'warm-request', cancellationGeneration: 0 },
            onMeasurementAttempt: agentWorkBudget.admitMeasurement(RUN_ID),
        });

        expect(planned.rejectionReason, JSON.stringify(planned.applicationToolReceipts)).toBeUndefined();
        expect(turns).toHaveLength(5);
        expect(planned.actions).toHaveLength(expectedCommands);
        expect(planned.actions[0]).toMatchObject({
            type: 'addDevice',
            payload: { trackId: 'vocal', deviceType: 'builtin-eq' },
        });
        expect(renderStarts).toBe(multipleRecipes ? 2 : 3);
        expect({
            revision: captureProjectRevision(),
            tracks: trackStore.value,
            undo: undoHistoryStore.value,
            transport: transportStore.value,
        }).toEqual(before);
        const materialized = materializePromptCommandPlan({
            userText: prompt,
            runId: RUN_ID,
            assistantMessageId: 'warm-assistant',
            interactionMode: 'apply',
            resume: undefined,
            onResumedPlanAccepted: undefined,
            projectRevision: revision,
            context,
            result: { ...planned, planningOutcome: { kind: 'proposal' } },
            actionLabels: planned.actions.map((action) => action.type),
            protectedTargetIds: [],
        });
        if (materialized.status === 'terminal') {
            await materialized.completion;
            throw new Error('The real measured plan must remain available for approval.');
        }
        const compiled = materialized.compiledActionExecution;
        expect(agentRunLifecycle.get(RUN_ID)?.plan?.expectedImpact.audible.status).toBe('not-claimed');
        expect(agentRunLifecycle.get(RUN_ID)?.plan?.metricGoalState).toBe(compiled.metricGoalState);
        const state = metricGoalStateCodec(compiled.metricGoalState);
        if (multipleRecipes) {
            expect(
                state?.binding?.prefixes,
                JSON.stringify({ steps: state?.steps, binding: state?.binding })
            ).toHaveLength(mode === 'two-recipes' ? 2 : 0);
        }
        expect(state?.authorities[0]?.goals.slice(0, 2)).toMatchObject([
            {
                metricId: 'frequencyBandEnergy',
                band: 'bass',
                relation: 'increase',
                targetIds: ['vocal'],
                range: { sectionId: SECTION_ID },
                source: { kind: 'recipe', recipeId: 'vocal-warm', recipeDigest: expect.any(String) },
            },
            { metricId: 'spectralCentroid', relation: 'decrease', targetIds: ['vocal'] },
        ]);
        expect(state?.authorities[0]?.goals).toHaveLength(multipleRecipes ? 4 : 2);
        if (multipleRecipes) {
            expect(state?.authorities[0]?.goals.slice(2)).toMatchObject([
                { metricId: 'spectralCentroid', relation: 'decrease', source: { recipeId: 'vocal-dark' } },
                {
                    metricId: 'frequencyBandEnergy',
                    band: 'presence',
                    relation: 'decrease',
                    source: { recipeId: 'vocal-dark' },
                },
            ]);
        }
        const evaluation = evaluateMetricGoalAdmission({
            state,
            commandBatch: compiled.commandBatch,
            currentRevision: revision,
        });
        if (mode === 'matched') {
            expect(evaluation).toMatchObject({
                status: 'verified',
                criteria: [
                    { status: 'verified', unit: 'ratio' },
                    { status: 'verified', unit: 'hertz' },
                ],
            });
            expect(state?.proofs).toHaveLength(1);
        } else {
            expect(evaluation.status).toBe('blocked');
            expect(state?.proofs).toHaveLength(mode === 'render-failed' ? 0 : 1);
        }
        expect(compiled.requiresConfirmation).toBe(true);
        if (compiled.agentApproval === null) {
            throw new Error('Expected real recipe approval.');
        }
        const parsed = parseVersionedCommandBatchEnvelope(
            compiled.commandBatch.serialized,
            compiled.commandBatch.authority
        );
        if (parsed.status !== 'valid') {
            throw new Error('Expected actual bound command batch.');
        }
        const confirmationId = persistPromptActionConfirmation({
            runId: RUN_ID,
            prompt,
            assistantMessageId: 'warm-assistant',
            actions: planned.actions,
            actionLabels: planned.actions.map((action) => action.type),
            commandEnvelopes: compiled.commandEnvelopes,
            commandBatch: compiled.commandBatch,
            agentApproval: compiled.agentApproval,
            metricGoalState: compiled.metricGoalState,
            affectedIds: ['vocal'],
            protectedUnchanged: [],
            measuredPreview: planned.measuredPreview,
            adoptedRecipes: planned.adoptedRecipes,
            executionMode: 'atomic',
            group: materialized.commandGroup,
            projectRevision: revision,
            parsedCommandBatch: parsed,
            content: 'Warm vocal proposal',
        });
        if (confirmationId === null) {
            throw new Error('Expected visible retained proposal.');
        }
        const view = getAgentApprovalView({ confirmationId });
        expect(view).not.toBeNull();
        expect(view?.actionLabels).toHaveLength(expectedCommands);
        expect(view?.canConfirm).toBe(mode === 'matched');
        expect(view?.metricGoals.criteria[0]?.criterionText).toContain('frequency-band energy');
        expect(view?.metricGoals.criteria[0]?.criterionText).toContain('Lead Vocal');
        expect(view?.metricGoals.criteria[0]?.criterionText).not.toContain('recipeDigest');
        expect(
            agentRunLifecycle.get(RUN_ID)?.budgetAttempts.some((attempt) => attempt.category === 'localAnalysis')
        ).toBe(true);
        if (multipleRecipes) {
            expect(state?.steps.map((step) => step.stepId)).toEqual([
                'recipe:vocal-warm:vocal',
                'recipe:vocal-dark:vocal',
            ]);
            expect(state?.steps.every((step) => step.recipePrefixHash !== null)).toBe(true);
            expect(state?.binding?.prefixes).toHaveLength(mode === 'two-recipes' ? 2 : 0);
            expect(planned.measuredPreview?.recipeSource).toBeUndefined();
            // A complete final preview cannot substitute for the first independent recipe prefix.
            expect(evaluation).toMatchObject({
                status: 'blocked',
                failure: mode === 'two-recipes' ? 'incomparable' : 'missing',
            });
            if (state === null) {
                throw new Error('Missing actual bound goal state.');
            }
            const replacement = await reproposePendingChatActions({ confirmationId });
            expect(replacement).toMatchObject({ status: 'reproposed' });
            if (replacement.status !== 'reproposed') {
                throw new Error('Expected real explicit Re-preview to replace the visible proposal.');
            }
            const refreshed = getPendingActionConfirmation(replacement.confirmationId);
            const refreshedState = metricGoalStateCodec(refreshed?.approvalSnapshot.metricGoalState);
            expect(refreshedState?.steps).toEqual(state?.steps);
            expect(
                new Set(refreshedState?.proofs.map((proof) => proof.preview.batchContentHash)).size,
                JSON.stringify(agentRunLifecycle.get(RUN_ID)?.plan?.applicationToolReceipts)
            ).toBe(mode === 'two-recipes' ? 2 : 1);
            expect(getAgentApprovalView({ confirmationId: replacement.confirmationId })?.canConfirm).toBe(
                mode === 'two-recipes'
            );
            const hydrated = sanitizeAgentRunState(readAgentRunState()).runs.find((run) => run.runId === RUN_ID);
            expect(hydrated?.plan?.metricGoalState).toBe(refreshed?.approvalSnapshot.metricGoalState);
            const verificationReceipts = hydrated?.plan?.applicationToolReceipts?.filter(
                (receipt) => receipt.origin === 'application-verification'
            );
            expect(verificationReceipts).toHaveLength(mode === 'two-recipes' ? 2 : 1);
            expect(
                verificationReceipts?.every((receipt) => receipt.turn === 0 && receipt.toolName === 'analysis.measure')
            ).toBe(true);
            expect(
                collectMetricGoalProof({
                    authorities: state.authorities,
                    compilations: [],
                    receipts: verificationReceipts ?? [],
                })
            ).toEqual([]);
            if (mode === 'two-recipes') {
                if (refreshedState === null || refreshed?.approvalSnapshot.commandBatch === undefined) {
                    throw new Error('Expected actual hydrated prefix proof and batch.');
                }
                for (const prefix of refreshedState.binding?.prefixes ?? []) {
                    const incomplete = {
                        ...refreshedState,
                        proofs: refreshedState.proofs.filter(
                            (proof) => proof.preview.batchContentHash !== prefix.after
                        ),
                    };
                    expect(
                        evaluateMetricGoalAdmission({
                            state: incomplete,
                            commandBatch: refreshed.approvalSnapshot.commandBatch,
                            currentRevision: revision,
                        })
                    ).toMatchObject({ status: 'blocked', failure: 'incomparable' });
                }
                expect(
                    metricGoalStateCodec(
                        JSON.stringify({
                            ...refreshedState,
                            steps: refreshedState.steps.map(({ recipePrefixHash: _missing, ...step }) => step),
                        })
                    )
                ).toBeNull();
                expect(
                    metricGoalStateCodec(
                        JSON.stringify({
                            ...refreshedState,
                            steps: refreshedState.steps.map((step) => ({ ...step, recipePrefixHash: null })),
                        })
                    )
                ).toBeNull();
                const staleSource = {
                    ...refreshedState,
                    authorities: refreshedState.authorities.map((authority) => ({
                        ...authority,
                        goals: authority.goals.map((goal) => {
                            if (goal.source.kind !== 'recipe') {
                                return goal;
                            }
                            return {
                                ...goal,
                                source: { ...goal.source, catalogVersion: goal.source.catalogVersion + 1 },
                            };
                        }),
                    })),
                };
                expect(
                    evaluateMetricGoalAdmission({
                        state: staleSource,
                        commandBatch: refreshed.approvalSnapshot.commandBatch,
                        currentRevision: revision,
                    })
                ).toMatchObject({ status: 'blocked', failure: 'stale' });
                const driftedActions = planned.actions.map((action) => {
                    if (action.type === 'setDeviceParameter' && action.payload.paramId === 'eq-low-gain') {
                        return { ...action, payload: { ...action.payload, value: 2.5 } };
                    }
                    return action;
                });
                const drifted = compileAgentActionExecution({
                    actions: driftedActions,
                    actionLabels: driftedActions.map((action) => action.type),
                    actionCommandGraph: planned.actionCommandGraph,
                    context,
                    intent: prompt,
                    projectRevision: revision,
                    runId: RUN_ID,
                    requiresConfirmation: true,
                    group: { groupId: 'app-parameter-drift', groupLabel: prompt },
                    metricGoalState: compiled.metricGoalState,
                });
                const driftedState = metricGoalStateCodec(drifted.metricGoalState);
                if (driftedState === null) {
                    throw new Error('The different batch must keep its frozen intent.');
                }
                const driftedProof = await prepareMetricGoalPreview({
                    state: driftedState,
                    commandBatch: drifted.commandBatch,
                    context,
                    prompt,
                    runId: RUN_ID,
                });
                expect(
                    driftedProof.receipts.every((receipt) => receipt.status === 'success'),
                    JSON.stringify(driftedProof.receipts)
                ).toBe(true);
                expect(driftedProof.state.proofs).toHaveLength(1);
                const actual = driftedProof.state.proofs[0]?.preview.targets[0];
                expect(actual?.baseline.spectralCentroid?.status).toBe('measured');
                expect(actual?.preview.spectralCentroid?.status).toBe('measured');
                if (
                    actual?.baseline.spectralCentroid?.status !== 'measured' ||
                    actual.preview.spectralCentroid?.status !== 'measured' ||
                    typeof actual.preview.spectralCentroid.value !== 'number' ||
                    typeof actual.baseline.spectralCentroid.value !== 'number'
                ) {
                    throw new Error('Expected actual finite compatible centroid measurements.');
                }
                expect(actual.preview.spectralCentroid.value).toBeLessThan(actual.baseline.spectralCentroid.value);
                expect(
                    evaluateMetricGoalAdmission({
                        state: driftedProof.state,
                        commandBatch: drifted.commandBatch,
                        currentRevision: revision,
                    })
                ).toMatchObject({ status: 'blocked', failure: 'missing' });
                expect(driftedProof.state.binding?.prefixes).toEqual([]);
                expect(trackStore.value).toEqual(before.tracks);
                expect(undoHistoryStore.value).toEqual(before.undo);
            }
        }
        // Even verified criteria do not self-approve an otherwise confirmation-required recipe.
        expect((await executeVersionedCommandBatchEnvelope(compiled.commandBatch)).status).toBe('rejected');
        expect(trackStore.value).toEqual(before.tracks);
        expect(undoHistoryStore.value).toEqual(before.undo);
    });
});
