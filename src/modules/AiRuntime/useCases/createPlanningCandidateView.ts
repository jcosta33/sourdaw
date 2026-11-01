import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';
import { type CreativeInterpretationCatalog } from '../models/CreativeInterpretation';
import { type PlanningContextBinding, type PlanningContextObject } from '../models/PlanningContextBinding';

import { OBJECTIVE_METRIC_UNITS } from './objectiveMetricProjection';
import { type MetricIntentCatalog } from './prepareMetricIntentCatalog';

function collectCandidateObjectFacts(
    creative: CreativeInterpretationCatalog,
    answer: AnswerInterpretationCatalog
): Map<string, PlanningContextObject> {
    const facts = new Map<string, PlanningContextObject>();
    for (const track of answer.context.tracks) {
        facts.set(track.id, {
            reference: '',
            id: track.id,
            label: track.name,
            kind: track.kind,
            parentId: null,
            startBeat: null,
            endBeat: null,
        });
        for (const clip of track.clips) {
            facts.set(clip.id, {
                reference: '',
                id: clip.id,
                label: clip.name,
                kind: clip.type,
                parentId: track.id,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
            });
        }
        for (const id of track.alternativeClipIds ?? []) {
            if (!facts.has(id)) {
                facts.set(id, {
                    reference: '',
                    id,
                    label: id,
                    kind: 'clip',
                    parentId: track.id,
                    startBeat: null,
                    endBeat: null,
                });
            }
        }
    }
    for (const target of creative.targets) {
        for (const id of target.objectIds) {
            if (!facts.has(id)) {
                facts.set(id, {
                    reference: '',
                    id,
                    label: target.objectIds.length === 1 ? target.label : id,
                    kind: target.objectType,
                    parentId: target.parentTrackId,
                    startBeat: null,
                    endBeat: null,
                });
            }
        }
    }
    for (const constraint of creative.constraints) {
        if (constraint.kind === 'protect-object' && !facts.has(constraint.objectId)) {
            facts.set(constraint.objectId, {
                reference: '',
                id: constraint.objectId,
                label: constraint.label,
                kind: 'object',
                parentId: null,
                startBeat: null,
                endBeat: null,
            });
        }
    }
    return facts;
}

function assertCandidateBinding(
    creative: CreativeInterpretationCatalog,
    answer: AnswerInterpretationCatalog,
    binding: PlanningContextBinding,
    metric?: MetricIntentCatalog
): void {
    if (!binding.authorityComplete) {
        throw new Error('Incomplete production authority cannot be disclosed through candidate fallback.');
    }
    if (
        (binding.revision ?? '') !== answer.revision ||
        creative.revision !== answer.revision ||
        creative.requestDigest !== answer.requestDigest ||
        JSON.stringify(creative.selection) !== JSON.stringify(answer.selection) ||
        JSON.stringify(binding.selection) !==
            JSON.stringify({
                trackId: answer.selection.trackId,
                clipId: answer.selection.clipId,
                clipIds: answer.selection.clipIds,
            })
    ) {
        throw new Error('Planning interpretation catalogs do not share the actual context binding.');
    }
    if (
        metric !== undefined &&
        (metric.catalogId !== answer.catalogId ||
            metric.revision !== answer.revision ||
            metric.requestDigest !== answer.requestDigest ||
            JSON.stringify(metric.selection) !== JSON.stringify(answer.selection))
    ) {
        throw new Error('Metric interpretation does not share the complete printed context binding.');
    }
}

function createCandidateReferences(
    creative: CreativeInterpretationCatalog,
    answer: AnswerInterpretationCatalog,
    binding: PlanningContextBinding
) {
    const fallback: Array<[string, string, string, string | null, number | null, number | null]> = [];
    const facts = collectCandidateObjectFacts(creative, answer);
    const references = new Map<string, string>();
    function objectReference(id: string): string {
        if (id === 'master') {
            return 'master';
        }
        const prior = references.get(id);
        if (prior !== undefined) {
            return prior;
        }
        const fact = facts.get(id);
        if (fact === undefined) {
            throw new Error('A planning candidate has no captured object facts.');
        }
        const printed = binding.objects.find(
            (entry) =>
                entry.id === id &&
                entry.label === fact.label &&
                entry.kind === fact.kind &&
                entry.parentId === fact.parentId &&
                entry.startBeat === fact.startBeat &&
                entry.endBeat === fact.endBeat
        );
        const reference = printed?.reference ?? `f${String(fallback.length)}`;
        if (printed === undefined) {
            fallback.push([fact.kind, fact.id, fact.label, fact.parentId, fact.startBeat, fact.endBeat]);
        }
        references.set(id, reference);
        return reference;
    }
    return { fallback, facts, objectReference };
}

function createCandidateRows(
    creative: CreativeInterpretationCatalog,
    answer: AnswerInterpretationCatalog,
    binding: PlanningContextBinding,
    facts: Map<string, PlanningContextObject>,
    objectReference: (id: string) => string
) {
    const targets = creative.targets.map((target) => [
        target.provenance,
        target.objectType,
        target.objectIds.map(objectReference),
        target.parentTrackId === null ? null : objectReference(target.parentTrackId),
        target.label,
    ]);
    const constraints = creative.constraints.map((constraint) => {
        if (constraint.kind === 'exclude-dimension') {
            return [constraint.kind, constraint.dimension];
        }
        return [constraint.kind, objectReference(constraint.objectId), constraint.label];
    });
    const scopes = answer.scopes.map((scope) => {
        const row: Array<string | string[]> = [scope.kind, scope.objectIds.map(objectReference)];
        if (
            !scope.objectIds.every(
                (id, index) => scope.labels[index] === (id === 'master' ? 'Master output' : facts.get(id)?.label)
            )
        ) {
            row.push(scope.labels);
        }
        return row;
    });
    const ranges = answer.ranges.map((range) => {
        const printed = binding.sections.find(
            (section) =>
                section.id === range.sectionId &&
                section.label === range.label &&
                section.startBeat === range.startBeat &&
                section.endBeat === range.endBeat
        );
        // Raw internal section identities are withheld by the context producer, including fallback rows.
        return printed?.reference ?? [range.label, range.startBeat, range.endBeat];
    });
    return { targets, constraints, scopes, ranges };
}

function createMetricTables(answer: AnswerInterpretationCatalog, metric?: MetricIntentCatalog) {
    const metricEligibility: number[][] = [];
    const metricRoles = [...new Set(metric?.objectives.flatMap((objective) => objective.roles) ?? [])];
    const metricRoleSets: number[][] = [];
    const metricMetrics: Array<[string, string | null]> = [];
    const metricPolicies: string[] = [];
    type Relation = MetricIntentCatalog['objectives'][number]['goals'][number]['relation'];
    const metricExpectations: Array<[number, string | null, Relation, number | null, number, number | null]> = [];
    const metricObjectives: Array<[string, string | null, string, number, number, number, number[]]> = [];
    function intern<Value>(table: Value[], value: Value): number {
        const key = JSON.stringify(value);
        const prior = table.findIndex((entry) => JSON.stringify(entry) === key);
        if (prior >= 0) {
            return prior;
        }
        table.push(value);
        return table.length - 1;
    }
    function scopeIndices(ids: readonly string[]): number[] {
        return ids.map((id) => {
            const index = answer.scopes.findIndex((scope) => scope.candidateId === id);
            if (index < 0) {
                throw new Error('Metric eligibility names an unpublished shared scope.');
            }
            return index;
        });
    }
    for (const objective of metric?.objectives ?? []) {
        const expectations = objective.goals.map((goal) => {
            let unit: string | null = null;
            if (goal.metricId !== null) {
                unit = OBJECTIVE_METRIC_UNITS[goal.metricId];
            }
            const metricIndex = intern(metricMetrics, [goal.metricName, unit]);
            let policyIndex: number | null = null;
            if (goal.source.kind === 'policy') {
                policyIndex = intern(metricPolicies, goal.source.policyId);
            }
            return intern(metricExpectations, [
                metricIndex,
                goal.band,
                goal.relation,
                goal.targetValue,
                goal.tolerance,
                policyIndex,
            ]);
        });
        const source = objective.goals[0]?.source;
        let identity: string | null = null;
        if (source?.kind === 'recipe') {
            identity = source.recipeId;
        }
        metricObjectives.push([
            source?.kind ?? 'unsupported',
            identity,
            objective.label,
            intern(metricEligibility, scopeIndices(objective.eligibleScopeIds)),
            intern(metricEligibility, scopeIndices(objective.defaultScopeIds)),
            intern(
                metricRoleSets,
                objective.roles.map((role) => metricRoles.indexOf(role))
            ),
            expectations,
        ]);
    }
    return {
        metricObjectives,
        metricEligibility,
        metricRoles,
        metricRoleSets,
        metricMetrics,
        metricExpectations,
        metricPolicies,
    };
}

/** Candidate-contract facts only; source records, paths and media identities never enter this view. */
export function createPlanningCandidateView(
    creative: CreativeInterpretationCatalog,
    answer: AnswerInterpretationCatalog,
    binding: PlanningContextBinding,
    metric?: MetricIntentCatalog
) {
    assertCandidateBinding(creative, answer, binding, metric);
    const { fallback, facts, objectReference } = createCandidateReferences(creative, answer, binding);
    const { targets, constraints, scopes, ranges } = createCandidateRows(
        creative,
        answer,
        binding,
        facts,
        objectReference
    );
    const {
        metricObjectives,
        metricEligibility,
        metricRoles,
        metricRoleSets,
        metricMetrics,
        metricExpectations,
        metricPolicies,
    } = createMetricTables(answer, metric);
    return {
        activeView: creative.selection.activeView,
        unresolved: creative.unresolvedExplicitReferences,
        targets,
        dimensions: creative.dimensions.map((dimension) => dimension.dimension),
        constraints,
        slots: creative.creationSlots.map((slot) => [slot.objectType, slot.parentCandidateId, slot.budget]),
        scopes,
        ranges,
        fallback,
        metricObjectives,
        metricEligibility,
        metricRoles,
        metricRoleSets,
        metricMetrics,
        metricExpectations,
        metricPolicies,
    };
}
