import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { getCanonicalTrackRole } from '#/modules/Project/useCases';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { createWorkflowCapabilityToolSchema, WORKFLOW_CAPABILITY_IDS } from '../../models/WorkflowCapability';
import { projectOpenAiStrictToolSchema } from '../../repositories/cloudLlm/cloudInference/projectOpenAiStrictToolSchema';
import {
    admitTurnReadReceipts,
    boundReceipt,
    serializeReceiptContext,
} from '../../services/applicationToolReceiptBudget';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { admitPlanningInterpretation } from '../admitPlanningInterpretation';
import { admitWorkflowMetricIntake } from '../admitWorkflowMetricIntake';
import { getSidechainRoutingPromptScope } from '../agentReference/getSidechainRoutingPromptScope';
import { APPLICATION_OWNED_TOOL_LOOP_LIMITS, runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { buildAgentContext } from '../buildAgentContext';
import { collectMetricGoalProof } from '../collectMetricGoalProof';
import { compilePreviewMeasurementProposal } from '../compilePreviewMeasurementProposal';
import { createPlanningInterpretationToolSchema } from '../createPlanningInterpretationToolSchema';
import { executeRecipeExpansion } from '../executeRecipeExpansion';
import { expandMixRecipe } from '../expandMixRecipe';
import { getPlanningProviderToolSchemas } from '../getPlanningProviderToolSchemas';
import { getProjectContext } from '../getProjectContext';
import * as projectContextModule from '../getProjectContext';
import { getHostedProposalWireToolSchema } from '../llmOrchestration/getHostedProposalWireToolSchema';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { OBJECTIVE_METRIC_UNITS } from '../objectiveMetricProjection';
import { parsePromptToActions } from '../parsePromptToActions';
import { getPlanningProviderSchemaContract } from '../planningProviderSchema';
import { planPromptActions } from '../planPromptActions';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';
import { prepareMetricIntentCatalog } from '../prepareMetricIntentCatalog';
import { prepareWorkflowMetricScopes } from '../prepareWorkflowMetricScopes';
import { projectPlanningProviderToolSchemas } from '../projectPlanningProviderToolSchemas';
import { projectWorkflowMetricToolSchemas } from '../projectWorkflowMetricToolSchemas';

import { readCreativeInterpretationCatalog, selectCreativeInterpretationCall } from './highLevelIntentWorkflowFixture';
import { readMetricPublication } from './metricGoalWorkflowFixture';
import { createPlanningProject } from './planningProjectFixture';

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(async () => {
        throw new Error('Unscripted metric provider request.');
    }),
}));

afterEach(() => {
    vi.mocked(generateToolPlanningOutcome).mockReset();
    vi.restoreAllMocks();
});

function hasMetricAuthority(result: ReturnType<typeof admitPlanningInterpretation>): result is ReturnType<
    typeof admitPlanningInterpretation
> & {
    metricAuthority: Extract<
        ReturnType<typeof import('../admitMetricIntent').admitMetricIntent>,
        { status: 'admitted' }
    >['authority'];
} {
    return 'metricAuthority' in result && result.metricAuthority !== undefined && result.metricAuthority !== null;
}

function fixture(prompt = 'Set Lead Vocal gain to 70%', options: { writableLeadVocal?: boolean } = {}) {
    const context = createPlanningProject(getProjectContext(), 3);
    if (options.writableLeadVocal === true) {
        const leadVocalId = context.tracks[2]?.id;
        const brief = context.productionBrief;
        if (leadVocalId === undefined || brief === undefined) {
            throw new Error('Expected the typed lead-vocal fixture and production brief.');
        }
        const leadVocalLocks = brief.locks.filter(
            (lock) => lock.scope.kind === 'track' && lock.scope.trackId === leadVocalId
        );
        if (leadVocalLocks.length !== 1) {
            throw new Error('Expected one exact lead-vocal track lock.');
        }
        const leadVocalLock = leadVocalLocks[0]!;
        context.productionBrief = {
            ...brief,
            locks: brief.locks.filter((lock) => lock.id !== leadVocalLock.id),
        };
    }
    const creative = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: 'metric-revision' });
    const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: 'metric-revision' });
    const metric = prepareMetricIntentCatalog({ prompt, answer });
    const built = buildAgentContext({ fixedPolicy: 'policy', prompt, context, projectRevision: 'metric-revision' });
    const schema = createPlanningInterpretationToolSchema({ creative, answer, metric, binding: built.planningBinding });
    const call = {
        id: 'joint-intake',
        name: 'selectCreativeInterpretation',
        arguments: {
            catalogId: creative.catalogId,
            modeId: 'literal',
            targetCandidateIds: [],
            editDimensionCandidateIds: [],
            constraintCandidateIds: [],
            creationSlotIds: [],
            uncertainty: 'none',
            answer: null,
            metricIntent: { kind: 'literal', objectives: [], uncertainty: 'none' },
        },
    };
    return { context, creative, answer, metric, schema, call };
}

it('keeps the locked vocal out of real creative targets while the writable control fixture publishes it', () => {
    const prompt = 'Make Lead Vocal warmer';
    const locked = fixture(prompt);
    const writable = fixture(prompt, { writableLeadVocal: true });
    const leadVocalId = locked.context.tracks[2]?.id;
    if (leadVocalId === undefined) {
        throw new Error('Expected the fixture lead-vocal track.');
    }

    expect(locked.creative.targets.flatMap((target) => target.objectIds)).not.toContain(leadVocalId);
    expect(writable.creative.targets.flatMap((target) => target.objectIds)).toContain(leadVocalId);
    expect(locked.metric.scopes.flatMap((scope) => scope.objectIds)).toContain(leadVocalId);
});

describe('positive whole-request metric intent', () => {
    it('admits the actual local and strict hosted literal branch without creative mutation authority', () => {
        const value = fixture();
        const projected = projectOpenAiStrictToolSchema(value.schema);
        expect(matchesJsonSchema(value.call.arguments, value.schema.function.parameters)).toBe(true);
        expect(matchesJsonSchema(value.call.arguments, projected.function.parameters)).toBe(true);
        const admitted = admitPlanningInterpretation({
            ...value,
            call: value.call,
            projectRevision: 'metric-revision',
            turn: 1,
        });
        expect(admitted).toMatchObject({
            status: 'admitted',
            kind: 'literal',
            metricAuthority: {
                origin: 'configured-joint-intake',
                callId: 'joint-intake',
                turn: 1,
                kind: 'literal',
                goals: [],
                creativeAuthority: null,
            },
        });
        expect(admitted).not.toHaveProperty('authority');
    });

    it.each([false, 3, 'literal', [], { kind: 'literal', objectives: [], uncertainty: 'none', value: 1 }])(
        'refuses malformed non-null intent %j before falling back to creative admission',
        (metricIntent) => {
            const value = fixture();
            const call = { ...value.call, arguments: { ...value.call.arguments, metricIntent } };
            expect(
                admitPlanningInterpretation({ ...value, call, projectRevision: 'metric-revision', turn: 1 }).status
            ).toBe('rejected');
        }
    );

    it('refuses mixed answer and mutation intent, forged objectives and literal acoustic objectives', () => {
        const value = fixture();
        const mixed = { ...value.call, arguments: { ...value.call.arguments, answer: { kind: 'project-facts' } } };
        expect(
            admitPlanningInterpretation({ ...value, call: mixed, projectRevision: 'metric-revision', turn: 1 }).status
        ).toBe('rejected');
        const forged = {
            ...value.call,
            arguments: {
                ...value.call.arguments,
                metricIntent: {
                    kind: 'literal',
                    uncertainty: 'none',
                    objectives: [
                        {
                            objectiveId: 'provider-value',
                            scopeCandidateId: 'master',
                            referenceScopeCandidateId: null,
                            rangeCandidateId: null,
                        },
                    ],
                },
            },
        };
        expect(matchesJsonSchema(forged.arguments, value.schema.function.parameters)).toBe(false);
        expect(
            admitPlanningInterpretation({ ...value, call: forged, projectRevision: 'metric-revision', turn: 1 }).status
        ).toBe('rejected');
    });

    it('freezes an authored recipe criterion, actual target and named range before any preview', () => {
        const value = fixture('Make Lead Vocal warmer', { writableLeadVocal: true });
        const target = value.creative.targets.find((entry) => entry.objectIds.includes(value.context.tracks[2]!.id));
        const objective = value.metric.objectives.find(
            (entry) =>
                entry.goals.some((goal) => goal.source.kind === 'recipe') &&
                entry.eligibleScopeIds.some((id) =>
                    value.metric.scopes
                        .find((scope) => scope.candidateId === id)
                        ?.objectIds.includes(value.context.tracks[2]!.id)
                )
        );
        const scope = value.metric.scopes.find(
            (entry) => entry.objectIds.length === 1 && entry.objectIds[0] === value.context.tracks[2]!.id
        );
        const range = value.metric.ranges[0];
        if (target === undefined || objective === undefined || scope === undefined || range === undefined) {
            throw new Error('Expected actual vocal recipe candidates.');
        }
        const call = {
            ...value.call,
            arguments: {
                ...value.call.arguments,
                modeId: 'edit',
                targetCandidateIds: [target.candidateId],
                editDimensionCandidateIds: value.creative.dimensions.map((entry) => entry.candidateId),
                metricIntent: {
                    kind: 'perceptual',
                    uncertainty: 'none',
                    objectives: [
                        {
                            objectiveId: objective.id,
                            scopeCandidateId: scope.candidateId,
                            referenceScopeCandidateId: null,
                            rangeCandidateId: range.candidateId,
                        },
                    ],
                },
            },
        };
        const admitted = admitPlanningInterpretation({ ...value, call, projectRevision: 'metric-revision', turn: 1 });
        if (admitted.status !== 'admitted' || admitted.kind !== 'creative' || !hasMetricAuthority(admitted)) {
            throw new Error('Expected admitted bounded metric intent.');
        }
        expect(admitted.metricAuthority.goals).toHaveLength(objective.goals.length);
        expect(admitted.metricAuthority.goals[0]).toMatchObject({
            targetIds: scope.objectIds,
            range: { startBeat: range.startBeat, endBeat: range.endBeat, sectionId: range.sectionId },
            source: objective.goals[0]!.source,
        });
        expect(JSON.stringify(value.schema)).not.toContain(range.sectionId);
        const state = {
            schemaVersion: 1,
            authorities: [admitted.metricAuthority],
            steps: [],
            proofs: [],
            binding: null,
        };
        expect(metricGoalStateCodec(JSON.stringify(state))?.authorities[0]?.goals).toEqual(
            admitted.metricAuthority.goals
        );
        expect(metricGoalStateCodec(JSON.stringify({ ...state, verified: true }))).toBeNull();
    });

    it('does not classify no reads, an action-shaped document or unknown legacy state as literal', () => {
        expect(metricGoalStateCodec(undefined)).toBeNull();
        expect(metricGoalStateCodec(JSON.stringify({ actions: [], kind: 'literal', verified: true }))).toBeNull();
        expect(
            metricGoalStateCodec(
                JSON.stringify({ schemaVersion: 2, authorities: [], steps: [], proofs: [], binding: null })
            )
        ).toBeNull();
    });
    it.each(['full', 'delta', 'capped', 'known-roles', 'frozen'] as const)(
        'reconstructs complete metric semantics and conditional eligibility from the actual %s publication',
        (mode) => {
            const context = createPlanningProject(getProjectContext(), mode === 'capped' ? 65 : 5);
            if (mode === 'known-roles') {
                context.tracks = context.tracks.map((track) => ({
                    ...track,
                    canonicalRole: getCanonicalTrackRole({
                        track: { id: track.id, name: track.name, kind: track.kind, clips: [], devices: [] },
                    }),
                }));
            }
            if (mode === 'frozen') {
                context.tracks[2]!.frozen = true;
            }
            const prompt = 'Make Lead Vocal warmer; compare loudness to Bass at -14 LUFS';
            const prior = buildAgentContext({ fixedPolicy: 'policy', prompt, context, projectRevision: 'before' });
            const revision = mode === 'delta' ? 'after' : 'before';
            const built = buildAgentContext({
                fixedPolicy: 'policy',
                prompt,
                context,
                projectRevision: revision,
                priorEvidence: mode === 'delta' ? prior.evidence : undefined,
            });
            const creative = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: revision });
            const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: revision });
            const metric = prepareMetricIntentCatalog({ prompt, answer });
            const schema = createPlanningInterpretationToolSchema({
                creative,
                answer,
                metric,
                binding: built.planningBinding,
            });
            const expected = metric.objectives.map((objective) => {
                const source = objective.goals[0]!.source;
                return {
                    id: objective.id,
                    kind: source.kind,
                    recipeId: source.kind === 'recipe' ? source.recipeId : null,
                    label: objective.label,
                    eligibleScopeIds: objective.eligibleScopeIds,
                    defaultScopeIds: objective.defaultScopeIds,
                    roles: objective.roles,
                    goals: objective.goals.map((goal) => ({
                        metricName: goal.metricName,
                        unit: goal.metricId === null ? null : OBJECTIVE_METRIC_UNITS[goal.metricId],
                        band: goal.band,
                        relation: goal.relation,
                        targetValue: goal.targetValue,
                        tolerance: goal.tolerance,
                        policyId: goal.source.kind === 'policy' ? goal.source.policyId : null,
                    })),
                };
            });
            expect(readMetricPublication(schema)).toEqual(expected);
            expect(readMetricPublication(projectOpenAiStrictToolSchema(schema))).toEqual(expected);
            for (const objective of metric.objectives) {
                for (const goal of objective.goals) {
                    if (goal.source.kind === 'recipe') {
                        expect(schema.function.description).not.toContain(goal.source.recipeDigest);
                    }
                }
            }
            for (const section of context.sections ?? []) {
                expect(schema.function.description).not.toContain(section.id);
            }
            if (mode === 'frozen') {
                const frozenScopes = answer.scopes
                    .filter((scope) => scope.objectIds.includes(context.tracks[2]!.id))
                    .map((scope) => scope.candidateId);
                expect(
                    metric.objectives
                        .filter((objective) => objective.roles.length > 0)
                        .every((objective) => objective.eligibleScopeIds.every((id) => !frozenScopes.includes(id)))
                ).toBe(true);
            }
            if (mode === 'delta') {
                expect(built.planningBinding.mode).toBe('delta');
            }
        }
    );

    it('discloses unknown-role eligibility as conditional and preserves the actual expansion refusal', () => {
        const value = fixture('Make Lead Vocal warmer');
        const targetId = value.context.tracks[2]!.id;
        const scope = value.metric.scopes.find(
            (entry) => entry.objectIds.length === 1 && entry.objectIds[0] === targetId
        );
        const objective = value.metric.objectives.find(
            (entry) => entry.goals[0]?.source.kind === 'recipe' && entry.goals[0].source.recipeId === 'vocal-warm'
        );
        if (scope === undefined || objective === undefined) {
            throw new Error('Expected conditional authored vocal recipe.');
        }
        expect(objective.eligibleScopeIds).toContain(scope.candidateId);
        expect(objective.defaultScopeIds).not.toContain(scope.candidateId);
        expect(objective.roles).toContain('vocal');
        expect(
            expandMixRecipe({ recipeId: 'vocal-warm', targetId, role: null, values: [] }, value.context, 1)
        ).toMatchObject({ status: 'refused', reason: expect.stringContaining('pass a role argument') });
        expect(
            expandMixRecipe({ recipeId: 'vocal-warm', targetId, role: 'vocal', values: [] }, value.context, 1)
        ).toMatchObject({ status: 'expanded', recipe: { recipeId: 'vocal-warm', targetId } });
    });

    it('rejects mismatched metric catalog revision or selection before authority or fallback disclosure', () => {
        const value = fixture();
        const stale = { ...value.metric, revision: 'another-revision' };
        expect(
            admitPlanningInterpretation({
                ...value,
                metric: stale,
                call: value.call,
                projectRevision: 'metric-revision',
                turn: 1,
            }).status
        ).toBe('rejected');
        expect(() =>
            createPlanningInterpretationToolSchema({
                ...value,
                metric: stale,
                binding: buildAgentContext({
                    fixedPolicy: 'policy',
                    prompt: 'Set Lead Vocal gain to 70%',
                    context: value.context,
                    projectRevision: 'metric-revision',
                }).planningBinding,
            })
        ).toThrow('complete printed context');
    });
});

describe('bounded metric control admission', () => {
    function control(value: ReturnType<typeof fixture>, count: number) {
        const targetId = value.context.tracks[2]!.id;
        const scope = value.metric.scopes.find(
            (candidate) => candidate.objectIds.length === 1 && candidate.objectIds[0] === targetId
        );
        const target = value.creative.targets.find(
            (candidate) => candidate.objectIds.length === 1 && candidate.objectIds[0] === targetId
        );
        if (scope === undefined || target === undefined) {
            throw new Error('Expected published vocal target.');
        }
        const objectives = readMetricPublication(value.schema)
            .filter(
                (candidate) => candidate.kind === 'recipe' && candidate.eligibleScopeIds.includes(scope.candidateId)
            )
            .slice(0, count);
        expect(objectives).toHaveLength(count);
        const call = {
            ...value.call,
            arguments: {
                ...value.call.arguments,
                modeId: 'edit',
                targetCandidateIds: [target.candidateId],
                editDimensionCandidateIds: value.creative.dimensions.map((dimension) => dimension.candidateId),
                metricIntent: {
                    kind: 'perceptual',
                    uncertainty: 'none',
                    objectives: objectives.map((objective) => ({
                        objectiveId: objective.id,
                        scopeCandidateId: scope.candidateId,
                        referenceScopeCandidateId: null,
                        rangeCandidateId: null,
                    })),
                },
            },
        };
        expect(matchesJsonSchema(call.arguments, value.schema.function.parameters)).toBe(true);
        return call;
    }

    it('rejects a real oversized admitted control before a following measurement or terminal turn', async () => {
        const value = fixture('Make Lead Vocal warmer with the selected authored objectives', {
            writableLeadVocal: true,
        });
        const call = control(value, 24);
        const admission = admitPlanningInterpretation({ ...value, call, projectRevision: 'metric-revision', turn: 1 });
        if (admission.status !== 'admitted' || admission.kind !== 'creative' || !hasMetricAuthority(admission)) {
            throw new Error('Expected genuine authored metric admission.');
        }
        const data = {
            kind: 'metric-intent',
            catalogId: value.metric.catalogId,
            intentKind: admission.metricAuthority.kind,
            goals: admission.metricAuthority.goals,
            authorityId: admission.authority.authorityId,
            mode: admission.authority.mode,
            targets: admission.authority.targets,
            editDimensions: admission.authority.editDimensions,
            prohibitions: admission.authority.prohibitions,
            creationSlots: admission.authority.creationSlots,
        };
        expect(new TextEncoder().encode(JSON.stringify(data)).byteLength).toBeGreaterThan(
            APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerCall
        );
        const execute = vi.fn(async () => {
            throw new Error('An oversized control must not enable measurement.');
        });
        const requestTurn = vi.fn(async ({ turn }: { turn: number }) => ({
            status: 'complete' as const,
            toolCalls:
                turn === 1 ? [call] : [{ id: 'read-after-failed-control', name: 'analysis.measure', arguments: {} }],
        }));
        const result = await runApplicationOwnedToolLoop({
            loopId: 'oversized-metric-control',
            requireWholeRequestIntake: true,
            terminalToolNames: new Set(['setTrackGain']),
            interpretation: {
                toolName: call.name,
                admit: () => ({
                    status: 'admitted',
                    receipt: {
                        data,
                        summary:
                            'Creative interpretation admitted; acoustic goals require actual compatible preview proof before approval.',
                    },
                    providerProjection: { kind: 'metric-intent', catalogId: value.metric.catalogId },
                }),
            },
            measurement: { toolName: 'analysis.measure', revision: 'metric-revision', execute },
            requestTurn,
        });
        expect(result).toMatchObject({
            status: 'rejected',
            turns: 1,
            receipts: [
                {
                    callId: call.id,
                    status: 'failure',
                    error: {
                        code: 'tool-receipt-too-large',
                        safeMessage: 'Tool receipt exceeded the per-call budget; request a narrower page.',
                    },
                },
            ],
        });
        expect(requestTurn).toHaveBeenCalledTimes(1);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each(['local', 'hosted'] as const)(
        'retains a genuine in-budget control and projects only the %s receipt copy',
        async (provider) => {
            const value = fixture('Make Lead Vocal warmer', { writableLeadVocal: true });
            const baseCall = control(value, 1);
            const range = value.metric.ranges[0];
            if (range === undefined) {
                throw new Error('Expected named range.');
            }
            const call = {
                ...baseCall,
                arguments: {
                    ...baseCall.arguments,
                    metricIntent: {
                        ...baseCall.arguments.metricIntent,
                        objectives: baseCall.arguments.metricIntent.objectives.map((objective) => ({
                            ...objective,
                            rangeCandidateId: range.candidateId,
                        })),
                    },
                },
            };
            const schema = provider === 'hosted' ? projectOpenAiStrictToolSchema(value.schema) : value.schema;
            expect(matchesJsonSchema(call.arguments, schema.function.parameters)).toBe(true);
            const admission = admitPlanningInterpretation({
                ...value,
                call,
                projectRevision: 'metric-revision',
                turn: 1,
            });
            if (admission.status !== 'admitted' || admission.kind !== 'creative' || !hasMetricAuthority(admission)) {
                throw new Error('Expected real in-budget admission.');
            }
            const data = {
                kind: 'metric-intent',
                catalogId: value.metric.catalogId,
                intentKind: admission.metricAuthority.kind,
                goals: admission.metricAuthority.goals,
                authorityId: admission.authority.authorityId,
            };
            const original = structuredClone(data);
            const assistantItems = [
                { type: 'function_call', call_id: call.id, arguments: JSON.stringify(call.arguments) },
            ];
            const requestTurn = vi.fn(
                async (input: Parameters<Parameters<typeof runApplicationOwnedToolLoop>[0]['requestTurn']>[0]) => {
                    if (input.turn === 1) {
                        if (provider === 'hosted') {
                            return {
                                status: 'complete' as const,
                                toolCalls: [call],
                                providerTurn: { provider: 'openai' as const, assistantItems },
                            };
                        }
                        return { status: 'complete' as const, toolCalls: [call] };
                    }
                    expect(input.wholeRequestIntake).toBe('admitted');
                    let outgoing = input.receiptContext ?? '';
                    if (provider === 'hosted') {
                        outgoing = JSON.stringify(input.history[0]?.receipts);
                        expect(input.history[0]?.assistantItems).toBe(assistantItems);
                    }
                    expect(outgoing).toContain('metric-intent');
                    expect(outgoing).not.toContain(range.sectionId);
                    for (const goal of admission.metricAuthority!.goals) {
                        if (goal.source.kind === 'recipe') {
                            expect(outgoing).not.toContain(goal.source.recipeDigest);
                        }
                    }
                    return {
                        status: 'complete' as const,
                        toolCalls: [
                            {
                                id: 'terminal-after-admitted-control',
                                name: 'setTrackGain',
                                arguments: { trackId: value.context.tracks[2]!.id, gain: 0.7 },
                            },
                        ],
                    };
                }
            );
            const result = await runApplicationOwnedToolLoop({
                loopId: `in-budget-${provider}`,
                requireWholeRequestIntake: true,
                terminalToolNames: new Set(['setTrackGain']),
                interpretation: {
                    toolName: call.name,
                    admit: () => ({
                        status: 'admitted',
                        receipt: { data, summary: 'Actual bounded metric intake.' },
                        providerProjection: { kind: 'metric-intent', catalogId: value.metric.catalogId },
                    }),
                },
                requestTurn,
            });
            expect(result).toMatchObject({ status: 'complete', interpretation: 'admitted', turns: 2 });
            expect(result.receipts[0]?.data).toEqual(original);
            expect(data).toEqual(original);
            expect(JSON.stringify(result.receipts[0]?.data)).toContain(range.sectionId);
            expect(requestTurn).toHaveBeenCalledTimes(2);
        }
    );

    it.each(['parser', 'correction-orchestrator'] as const)(
        'does not let the actual %s carry failed control authority into a following proposal',
        async (route) => {
            const value = fixture('Make Lead Vocal warmer with the selected authored objectives', {
                writableLeadVocal: true,
            });
            const targetId = value.context.tracks[2]!.id;
            vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
                if (vi.mocked(generateToolPlanningOutcome).mock.calls.length > 1) {
                    return {
                        status: 'complete',
                        toolCalls: [{ name: 'setTrackGain', arguments: { trackId: targetId, gain: 0.7 } }],
                    };
                }
                const schema = schemas.find(
                    (candidate: Parameters<typeof generateToolPlanningOutcome>[2][number]) =>
                        candidate.function.name === 'selectCreativeInterpretation'
                );
                if (schema === undefined) {
                    throw new Error('Expected actual published joint intake.');
                }
                const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
                const base = selectCreativeInterpretationCall({
                    catalog,
                    modeId: 'edit',
                    targetObjectIds: [targetId],
                    dimensions: catalog.dimensions.map((dimension) => dimension.dimension),
                });
                const published = readMetricPublication(schema);
                const candidates = published.filter((objective) => objective.kind === 'recipe');
                const selectedScope = candidates
                    .flatMap((objective) => objective.eligibleScopeIds)
                    .find(
                        (id) => candidates.filter((objective) => objective.eligibleScopeIds.includes(id)).length >= 24
                    );
                if (selectedScope === undefined) {
                    throw new Error('Expected bounded common recipe scope.');
                }
                // This fixture has one actual target only, so its complete scope is the same named subject.
                const objectives = candidates
                    .filter((objective) => objective.eligibleScopeIds.includes(selectedScope))
                    .slice(0, 24)
                    .map((objective) => ({
                        objectiveId: objective.id,
                        scopeCandidateId: selectedScope,
                        referenceScopeCandidateId: null,
                        rangeCandidateId: null,
                    }));
                const call = {
                    ...base,
                    id: 'oversized-parser-control',
                    arguments: {
                        ...base.arguments,
                        answer: null,
                        metricIntent: { kind: 'perceptual', objectives, uncertainty: 'none' },
                    },
                };
                expect(matchesJsonSchema(call.arguments, schema.function.parameters)).toBe(true);
                return { status: 'complete', toolCalls: [call] };
            });
            value.context.tracks = [value.context.tracks[2]!];
            const prompt = 'Make Lead Vocal warmer with the selected authored objectives';
            let result;
            if (route === 'parser') {
                result = await parsePromptToActions({
                    prompt,
                    context: value.context,
                    projectRevision: 'metric-revision',
                });
            } else {
                vi.spyOn(projectContextModule, 'getProjectContext').mockReturnValue(value.context);
                result = (await planPromptActions({ prompt, onProviderAttempt: () => ({ status: 'admitted' }) }))
                    .result;
            }
            expect({
                rejectionReason: result.rejectionReason,
                actions: result.actions,
                authorityEscaped: result.creativeAuthority !== undefined,
                requests: vi.mocked(generateToolPlanningOutcome).mock.calls.length,
            }).toMatchObject({
                rejectionReason: expect.stringContaining('Tool receipt exceeded the per-call budget'),
                actions: [],
                authorityEscaped: false,
                requests: 1,
            });
            expect(result.actions).toEqual([]);
            expect(result).not.toHaveProperty('creativeAuthority');
            expect(result).not.toHaveProperty('metricGoalState');
            expect(result.applicationToolReceipts).toMatchObject([
                { callId: 'oversized-parser-control', status: 'failure', error: { code: 'tool-receipt-too-large' } },
            ]);
            expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(1);
        }
    );
});

describe('whole-request schema and dispatch phases', () => {
    it('publishes complete semantic intake and safe reads before restoring exact effectful contracts after success', () => {
        const value = fixture('Make Lead Vocal warmer');
        const canonical = [...getPlanningProviderToolSchemas(), value.schema];
        const pending = projectPlanningProviderToolSchemas(canonical, 'planning', undefined, 'pending');
        const admitted = projectPlanningProviderToolSchemas(canonical, 'planning', undefined, 'admitted');
        expect(pending.map((schema) => schema.function.name)).toEqual(canonical.map((schema) => schema.function.name));
        expect(admitted.map((schema) => schema.function.name)).toEqual(canonical.map((schema) => schema.function.name));
        for (const name of ['setTrackGain', 'command.batch.propose', 'transform.compile', 'recipe.expand']) {
            const original = canonical.find((schema) => schema.function.name === name);
            const before = pending.find((schema) => schema.function.name === name);
            const after = admitted.find((schema) => schema.function.name === name);
            if (original === undefined || before === undefined) {
                throw new Error('Expected actual effectful contract.');
            }
            expect(after).toEqual(original);
            expect(matchesJsonSchema({}, before.function.parameters)).toBe(true);
            expect(matchesJsonSchema({ forged: true }, before.function.parameters)).toBe(false);
            expect(matchesJsonSchema({ forged: true }, projectOpenAiStrictToolSchema(before).function.parameters)).toBe(
                false
            );
        }
        for (const name of [
            'project.query',
            'project.discover',
            'agent.catalog.discover',
            'agent.command-index.search',
            'recipe.discover',
            'command.batch.decline',
            'selectWorkflowCapability',
        ]) {
            const original = canonical.find((schema) => schema.function.name === name);
            expect(original).toBeDefined();
            expect(pending.find((schema) => schema.function.name === name)).toEqual(original);
        }
        const intakeBefore = pending.find((schema) => schema.function.name === value.call.name);
        const intakeAfter = admitted.find((schema) => schema.function.name === value.call.name);
        expect(intakeBefore).toEqual(value.schema);
        expect(readMetricPublication(intakeBefore!)).toEqual(readMetricPublication(value.schema));
        expect(matchesJsonSchema(value.call.arguments, intakeAfter!.function.parameters)).toBe(false);
        expect(matchesJsonSchema({}, intakeAfter!.function.parameters)).toBe(true);
        const measure = pending.find((schema) => schema.function.name === 'analysis.measure');
        expect(
            matchesJsonSchema(
                { scope: { kind: 'master' }, range: { startBeat: 0, endBeat: 4 } },
                measure!.function.parameters
            )
        ).toBe(true);
        expect(
            matchesJsonSchema(
                {
                    subject: 'preview',
                    scope: { kind: 'master' },
                    range: { startBeat: 0, endBeat: 4 },
                    recipeCallId: 'forged',
                },
                measure!.function.parameters
            )
        ).toBe(false);
    });

    it.each(['setTrackGain', 'command.batch.propose', 'transform.compile', 'recipe.expand', 'analysis.measure'])(
        'refuses forged pre-intake %s even when its empty entry grammar matches',
        async (name) => {
            const requestTurn = vi.fn(async () => ({
                status: 'complete' as const,
                toolCalls: [
                    {
                        id: 'pre-intake-forgery',
                        name,
                        arguments: name === 'analysis.measure' ? { subject: 'preview' } : {},
                    },
                ],
            }));
            const effect = vi.fn(async () => {
                throw new Error('Pre-intake effects must never dispatch.');
            });
            const result = await runApplicationOwnedToolLoop({
                loopId: 'pending-intake-forgery',
                requireWholeRequestIntake: true,
                terminalToolNames: new Set(['setTrackGain', 'command.batch.propose']),
                measurement: { toolName: 'analysis.measure', revision: 'metric-revision', execute: effect },
                requestTurn,
            });
            expect(result).toMatchObject({
                status: 'rejected',
                turns: 1,
                receipts: [],
                reason: 'Whole-request intake is required before preparation, compilation or proposal.',
            });
            expect(effect).not.toHaveBeenCalled();
            expect(requestTurn).toHaveBeenCalledTimes(1);
        }
    );
});

describe('strict hosted projection consumes the actual live phase', () => {
    it('keeps pending entries and baseline reads unchanged while rejecting malformed full leaves', () => {
        const value = fixture();
        const canonical = [...getPlanningProviderToolSchemas(), value.schema];
        const pending = projectPlanningProviderToolSchemas(canonical, 'planning', undefined, 'pending');
        for (const name of ['command.batch.propose', 'analysis.measure']) {
            const schema = pending.find((candidate) => candidate.function.name === name);
            if (schema === undefined) {
                throw new Error('Missing actual live schema.');
            }
            expect(getHostedProposalWireToolSchema(schema)).toBe(schema);
        }
        const proposal = canonical.find((candidate) => candidate.function.name === 'command.batch.propose');
        const measure = canonical.find((candidate) => candidate.function.name === 'analysis.measure');
        if (proposal === undefined || measure === undefined) {
            throw new Error('Missing full canonical schemas.');
        }
        const malformedProposal = {
            ...proposal,
            function: {
                ...proposal.function,
                parameters: { ...proposal.function.parameters, properties: { commands: null } },
            },
        };
        const malformedMeasure = {
            ...measure,
            function: {
                ...measure.function,
                parameters: {
                    ...measure.function.parameters,
                    properties: { ...measure.function.parameters.properties, proposal: null },
                },
            },
        };
        expect(() => getHostedProposalWireToolSchema(malformedProposal)).toThrow('missing commands');
        expect(() => getHostedProposalWireToolSchema(malformedMeasure)).toThrow('missing proposal');
    });
});

describe('retained recipe and verification receipt boundaries', () => {
    it.each(['default', 'explicit-role', 'frozen'] as const)(
        'uses the one actual catalog snapshot with unchanged %s expansion eligibility',
        (mode) => {
            const value = fixture('Make Lead Vocal warmer');
            const track = value.context.tracks[2];
            if (track === undefined) {
                throw new Error('Expected the actual named vocal fixture.');
            }
            track.canonicalRole = getCanonicalTrackRole({
                track: { id: track.id, name: track.name, kind: track.kind, clips: [], devices: [] },
            });
            if (mode === 'frozen') {
                track.frozen = true;
            }
            const input = {
                recipeId: 'vocal-warm',
                targetId: track.id,
                role: mode === 'explicit-role' ? 'vocal' : null,
                values: [],
            };
            const snapshot = getMixRecipeCatalog();
            const explicit = expandMixRecipe(input, value.context, 1, snapshot);
            expect(explicit).toEqual(expandMixRecipe(input, value.context, 1));
            expect(explicit.status).toBe(mode === 'frozen' ? 'refused' : 'expanded');
        }
    );

    it('refuses a genuine successful retained expansion from an older revision before compiling a prefix', () => {
        const value = fixture('Make Lead Vocal warmer');
        const targetId = value.context.tracks[2]?.id;
        const objective = value.metric.objectives.find((entry) =>
            entry.goals.some((goal) => goal.source.kind === 'recipe' && goal.source.recipeId === 'vocal-warm')
        );
        const source = objective?.goals.find((goal) => goal.source.kind === 'recipe')?.source;
        const scope = value.metric.scopes.find((entry) => targetId !== undefined && entry.objectIds.includes(targetId));
        if (source?.kind !== 'recipe' || scope === undefined || targetId === undefined) {
            throw new Error('Expected an actual published conditional authored recipe and target.');
        }
        expect(objective?.eligibleScopeIds).toContain(scope.candidateId);
        expect(objective?.roles).toContain('vocal');
        const expanded = executeRecipeExpansion({
            call: { name: 'recipe.expand', arguments: { recipeId: source.recipeId, targetId, role: 'vocal' } },
            callId: 'old-expansion',
            turn: 2,
            ordinal: 1,
            context: value.context,
            revision: 'metric-revision',
        });
        expect(expanded.receipt.status).toBe('success');
        if (expanded.commands === null || expanded.recipe === null) {
            throw new Error('Expected real expansion commands.');
        }
        expect(
            compilePreviewMeasurementProposal({
                callId: 'new-prefix',
                context: value.context,
                prompt: 'Make Lead Vocal warmer',
                revision: 'new-revision',
                runId: 'stale-prefix',
                creativeAuthority: undefined,
                source: {
                    retained: [{ callId: 'old-expansion', revision: 'metric-revision', commands: expanded.commands }],
                },
            })
        ).toEqual({ status: 'rejected', reason: 'The retained prefix has another revision or no producer commands.' });
    });

    it('keeps application verification identity on genuine byte refusals without trusting a matching raw carrier', () => {
        const raw: ApplicationToolReceipt = {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId: 'goal-measure-oversized',
            toolName: 'analysis.measure',
            turn: 0,
            origin: 'application-verification',
            status: 'success',
            revision: 'metric-revision',
            data: { payload: 'x'.repeat(20_000) },
            summary: 'Untrusted receipt-shaped data.',
            warnings: [],
            error: null,
        };
        const perCall = boundReceipt(raw, APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerCall);
        expect(perCall).toMatchObject({
            status: 'failure',
            origin: 'application-verification',
            turn: 0,
            error: { code: 'tool-receipt-too-large' },
        });
        const perRun = admitTurnReadReceipts({
            realReceipts: [raw],
            turn: 0,
            totalReceiptBytesSoFar: 0,
            maxReceiptBytesPerTurn: 1000,
            maxTotalReceiptBytes: 1000,
        });
        expect(perRun).toMatchObject([
            {
                status: 'failure',
                origin: 'application-verification',
                turn: 0,
                error: { code: 'run-receipt-budget-spent' },
            },
        ]);
        expect(new TextEncoder().encode(serializeReceiptContext(perRun, 0)).byteLength).toBeLessThanOrEqual(1000);
        expect(
            collectMetricGoalProof({ authorities: [], compilations: [], receipts: [raw, perCall, ...perRun] })
        ).toEqual([]);
    });
});

describe('finite workflow metric intake', () => {
    function workflowFixture() {
        const prompt = 'Reduce kick/bass masking without replacing either basic sound.';
        const context = createPlanningProject(getProjectContext(), 3);
        context.tracks[1]!.devices = [{ id: 'bass-sidechain', type: 'builtin-sidechain-compressor', bypassed: false }];
        context.selectedTrackId = getProjectContext().selectedTrackId;
        context.selectedClipId = getProjectContext().selectedClipId;
        context.selectedClipIds = [...getProjectContext().selectedClipIds];
        const revision = captureProjectRevision();
        const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: revision });
        const catalog = prepareMetricIntentCatalog({ prompt, answer });
        const scopes = prepareWorkflowMetricScopes({
            sidechain: getSidechainRoutingPromptScope(prompt, context, revision),
            wholeProject: null,
        });
        const schema = projectWorkflowMetricToolSchemas({
            schemas: [createWorkflowCapabilityToolSchema(WORKFLOW_CAPABILITY_IDS)],
            phase: 'pending',
            catalog,
            scopes,
        })[0]!;
        const objective = catalog.objectives.find((entry) =>
            entry.goals.every((goal) => goal.source.kind === 'unsupported')
        );
        if (objective === undefined || scopes.length !== 1) {
            throw new Error('Expected the real finite sidechain scope and unsupported objective.');
        }
        const call = {
            id: 'actual-workflow-intake',
            name: 'selectWorkflowCapability',
            arguments: {
                capabilityId: 'sidechain-routing',
                catalogId: catalog.catalogId,
                metricIntent: {
                    kind: 'perceptual',
                    uncertainty: 'none',
                    objectives: [
                        {
                            objectiveId: objective.id,
                            scopeCandidateId: null,
                            referenceScopeCandidateId: null,
                            rangeCandidateId: null,
                        },
                    ],
                },
            },
        };
        return { catalog, scopes, schema, call, turn: 1 };
    }

    it('admits the actual finite scope through local and hosted schemas without creative authority', () => {
        const value = workflowFixture();
        expect(matchesJsonSchema(value.call.arguments, value.schema.function.parameters)).toBe(true);
        expect(
            matchesJsonSchema(value.call.arguments, projectOpenAiStrictToolSchema(value.schema).function.parameters)
        ).toBe(true);
        const result = admitWorkflowMetricIntake(value);
        expect(result).toMatchObject({
            status: 'admitted',
            authority: {
                origin: 'admitted-workflow',
                kind: 'perceptual',
                callId: value.call.id,
                turn: 1,
                creativeAuthority: null,
                goals: [{ relation: 'unsupported' }],
            },
        });
        expect(result).not.toHaveProperty('commandBatch');
    });

    it('refuses unknown scope, stale catalog, extra fields, unbound receipt identity and literal relabeling', () => {
        const value = workflowFixture();
        for (const call of [
            { ...value.call, arguments: { ...value.call.arguments, capabilityId: 'shared-vocal-fx-buses' } },
            { ...value.call, arguments: { ...value.call.arguments, catalogId: 'stale' } },
            { ...value.call, arguments: { ...value.call.arguments, targetIds: ['forged'] } },
            { ...value.call, id: '' },
            {
                ...value.call,
                arguments: {
                    ...value.call.arguments,
                    metricIntent: { kind: 'literal', uncertainty: 'none', objectives: [] },
                },
            },
        ]) {
            expect(admitWorkflowMetricIntake({ ...value, call }).status).toBe('rejected');
        }
        expect(admitWorkflowMetricIntake({ ...value, catalog: { ...value.catalog, revision: 'stale' } }).status).toBe(
            'rejected'
        );
        const outside = value.catalog.scopes.find((scope) =>
            scope.objectIds.some((id) => !value.scopes[0]!.targetIds.includes(id))
        );
        if (outside === undefined) {
            throw new Error('Expected a published subject outside the sidechain scope.');
        }
        const widened = {
            ...value.call,
            arguments: {
                ...value.call.arguments,
                metricIntent: {
                    ...value.call.arguments.metricIntent,
                    objectives: [
                        { ...value.call.arguments.metricIntent.objectives[0]!, scopeCandidateId: outside.candidateId },
                    ],
                },
            },
        };
        expect(admitWorkflowMetricIntake({ ...value, call: widened }).status).toBe('rejected');
        expect(
            admitWorkflowMetricIntake({
                ...value,
                catalog: {
                    ...value.catalog,
                    selection: { ...value.catalog.selection, trackId: 'changed-selection' },
                },
            }).status
        ).toBe('rejected');
    });

    it('keeps later execution selection after generic intake and consumes selection after workflow intake', () => {
        const value = workflowFixture();
        expect(
            projectWorkflowMetricToolSchemas({
                schemas: [value.schema],
                phase: 'pending',
                catalog: value.catalog,
                scopes: [],
            })
        ).toEqual([]);
        const schema = createWorkflowCapabilityToolSchema(['sidechain-routing', 'shared-vocal-fx-buses']);
        const afterGeneric = projectPlanningProviderToolSchemas([schema], 'planning', undefined, 'admitted');
        const afterWorkflow = projectPlanningProviderToolSchemas([schema], 'planning', undefined, 'workflow-admitted');
        expect(matchesJsonSchema({ capabilityId: 'shared-vocal-fx-buses' }, afterGeneric[0]!.function.parameters)).toBe(
            true
        );
        expect(matchesJsonSchema({ capabilityId: 'sidechain-routing' }, afterGeneric[0]!.function.parameters)).toBe(
            false
        );
        expect(
            matchesJsonSchema(
                { capabilityId: 'shared-vocal-fx-buses', metricIntent: {} },
                afterGeneric[0]!.function.parameters
            )
        ).toBe(false);
        expect(matchesJsonSchema({ capabilityId: 'sidechain-routing' }, afterWorkflow[0]!.function.parameters)).toBe(
            false
        );
        expect(projectPlanningProviderToolSchemas([schema], 'planning', 'readonly-answer', 'pending')).toEqual([]);
        const contract = getPlanningProviderSchemaContract();
        expect(contract.identity).toContain('workflowIntake');
        expect(contract.identity).not.toBe(
            JSON.stringify(
                contract.schemas.map((schema) => ({
                    name: schema.function.name,
                    parameters: schema.function.parameters,
                }))
            )
        );
        expect(getPlanningProviderSchemaContract().identity).toBe(contract.identity);
    });

    it('rejects mixed initial workflow intake and proposal before any admission', async () => {
        const value = workflowFixture();
        const admit = vi.fn(() => {
            throw new Error('Mixed initial control must never be admitted.');
        });
        const outcome = await runApplicationOwnedToolLoop({
            loopId: 'mixed-workflow-intake',
            requireWholeRequestIntake: true,
            terminalToolNames: new Set(['command.batch.propose']),
            interpretation: {
                toolName: 'selectCreativeInterpretation',
                workflowToolName: 'selectWorkflowCapability',
                admit,
            },
            requestTurn: async () => ({
                status: 'complete',
                toolCalls: [value.call, { name: 'command.batch.propose', arguments: {} }],
            }),
        });
        expect(outcome).toMatchObject({
            status: 'rejected',
            reason: 'Whole-request intake is required before preparation, compilation or proposal.',
        });
        expect(admit).not.toHaveBeenCalled();
    });
});

describe('workflow selection dispatch preserves the first whole-request intake', () => {
    function admission(value: ReturnType<typeof fixture>) {
        const result = admitPlanningInterpretation({
            ...value,
            call: value.call,
            projectRevision: 'metric-revision',
            turn: 1,
        });
        if (result.status !== 'admitted' || !hasMetricAuthority(result)) {
            throw new Error('Expected actual positive intake.');
        }
        return result.metricAuthority;
    }

    it('keeps generic intake frozen when a later terminal turn selects a workflow', async () => {
        const value = fixture();
        const authority = admission(value);
        const frozen = JSON.stringify(authority);
        const admit = vi.fn(() => ({
            status: 'admitted' as const,
            receipt: {
                data: { kind: 'metric-intent', goals: authority.goals },
                summary: 'Whole literal request admitted.',
            },
            providerProjection: { kind: 'metric-intent' as const, catalogId: value.metric.catalogId },
        }));
        const outcome = await runApplicationOwnedToolLoop({
            loopId: 'generic-then-workflow',
            requireWholeRequestIntake: true,
            terminalToolNames: new Set(['selectWorkflowCapability']),
            interpretation: {
                toolName: 'selectCreativeInterpretation',
                workflowToolName: 'selectWorkflowCapability',
                admit,
            },
            requestTurn: async ({ turn, wholeRequestIntake }) => {
                if (turn === 1) {
                    return { status: 'complete', toolCalls: [value.call] };
                }
                expect(wholeRequestIntake).toBe('admitted');
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'execution-selection',
                            name: 'selectWorkflowCapability',
                            arguments: { capabilityId: 'shared-vocal-fx-buses' },
                        },
                    ],
                };
            },
        });
        expect(outcome).toMatchObject({
            status: 'complete',
            turns: 2,
            toolCalls: [{ name: 'selectWorkflowCapability' }],
        });
        expect(admit).toHaveBeenCalledOnce();
        expect(JSON.stringify(authority)).toBe(frozen);
    });

    it.each(['workflow', 'metric-after-generic'] as const)('refuses a repeated control: %s', async (mode) => {
        const value = fixture();
        const first = { ...value.call, name: mode === 'workflow' ? 'selectWorkflowCapability' : value.call.name };
        let capturedPhase: string | undefined;
        const admit = vi.fn(() => ({
            status: 'admitted' as const,
            receipt: { data: { kind: 'metric-intent' }, summary: 'Intake admitted.' },
            providerProjection: { kind: 'metric-intent' as const, catalogId: value.metric.catalogId },
        }));
        const outcome = await runApplicationOwnedToolLoop({
            loopId: `repeat-${mode}`,
            requireWholeRequestIntake: true,
            terminalToolNames: new Set(['selectWorkflowCapability']),
            interpretation: {
                toolName: 'selectCreativeInterpretation',
                workflowToolName: 'selectWorkflowCapability',
                admit,
            },
            requestTurn: async ({ turn, wholeRequestIntake }) => {
                if (turn === 1) {
                    return { status: 'complete', toolCalls: [first] };
                }
                capturedPhase = wholeRequestIntake;
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'repeated-workflow',
                            name: 'selectWorkflowCapability',
                            arguments: { capabilityId: 'shared-vocal-fx-buses', metricIntent: {} },
                        },
                    ],
                };
            },
        });
        expect(capturedPhase).toBe(mode === 'workflow' ? 'workflow-admitted' : 'admitted');
        expect(outcome).toMatchObject({ status: 'rejected', reason: 'Provider repeated the creative interpretation.' });
        expect(admit).toHaveBeenCalledOnce();
    });
});
