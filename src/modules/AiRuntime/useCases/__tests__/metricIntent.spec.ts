import { describe, expect, it } from 'vitest';

import { projectOpenAiStrictToolSchema } from '../../repositories/cloudLlm/cloudInference/projectOpenAiStrictToolSchema';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { admitPlanningInterpretation } from '../admitPlanningInterpretation';
import { buildAgentContext } from '../buildAgentContext';
import { createPlanningInterpretationToolSchema } from '../createPlanningInterpretationToolSchema';
import { getProjectContext } from '../getProjectContext';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';
import { prepareMetricIntentCatalog } from '../prepareMetricIntentCatalog';

import { createPlanningProject } from './planningProjectFixture';

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
                entry.id.startsWith('recipe:') &&
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
        if (target === undefined || objective === undefined || scope === undefined || range === undefined)
            throw new Error('Expected actual vocal recipe candidates.');
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
        )
            throw new Error('Expected admitted bounded metric intent.');
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
});
