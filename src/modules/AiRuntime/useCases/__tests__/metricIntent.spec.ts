import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCanonicalTrackRole } from '#/modules/Project/useCases';

import { projectOpenAiStrictToolSchema } from '../../repositories/cloudLlm/cloudInference/projectOpenAiStrictToolSchema';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { admitPlanningInterpretation } from '../admitPlanningInterpretation';
import { APPLICATION_OWNED_TOOL_LOOP_LIMITS, runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { buildAgentContext } from '../buildAgentContext';
import { createPlanningInterpretationToolSchema } from '../createPlanningInterpretationToolSchema';
import { expandMixRecipe } from '../expandMixRecipe';
import { getPlanningProviderToolSchemas } from '../getPlanningProviderToolSchemas';
import { getProjectContext } from '../getProjectContext';
import * as projectContextModule from '../getProjectContext';
import { getHostedProposalWireToolSchema } from '../llmOrchestration/getHostedProposalWireToolSchema';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { OBJECTIVE_METRIC_UNITS } from '../objectiveMetricProjection';
import { parsePromptToActions } from '../parsePromptToActions';
import { planPromptActions } from '../planPromptActions';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';
import { prepareMetricIntentCatalog } from '../prepareMetricIntentCatalog';
import { projectPlanningProviderToolSchemas } from '../projectPlanningProviderToolSchemas';

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

function fixture(prompt = 'Set Lead Vocal gain to 70%') {
    const context = createPlanningProject(getProjectContext(), 3);
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
        const value = fixture('Make Lead Vocal warmer');
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
        if (
            admitted.status !== 'admitted' ||
            admitted.kind !== 'creative' ||
            !('metricAuthority' in admitted) ||
            admitted.metricAuthority === undefined
        ) {
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
        const value = fixture('Make Lead Vocal warmer with the selected authored objectives');
        const call = control(value, 24);
        const admission = admitPlanningInterpretation({ ...value, call, projectRevision: 'metric-revision', turn: 1 });
        if (
            admission.status !== 'admitted' ||
            admission.kind !== 'creative' ||
            admission.metricAuthority === undefined
        ) {
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
            const value = fixture('Make Lead Vocal warmer');
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
            if (
                admission.status !== 'admitted' ||
                admission.kind !== 'creative' ||
                admission.metricAuthority === undefined
            ) {
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
            const value = fixture('Make Lead Vocal warmer with the selected authored objectives');
            const targetId = value.context.tracks[2]!.id;
            vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
                if (vi.mocked(generateToolPlanningOutcome).mock.calls.length > 1) {
                    return {
                        status: 'complete',
                        toolCalls: [{ name: 'setTrackGain', arguments: { trackId: targetId, gain: 0.7 } }],
                    };
                }
                const schema = schemas.find((candidate) => candidate.function.name === 'selectCreativeInterpretation');
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
