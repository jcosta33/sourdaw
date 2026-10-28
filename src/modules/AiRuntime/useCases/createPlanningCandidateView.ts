import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';
import { type CreativeInterpretationCatalog } from '../models/CreativeInterpretation';
import { type PlanningContextBinding, type PlanningContextObject } from '../models/PlanningContextBinding';

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

/** Candidate-contract facts only; source records, paths and media identities never enter this view. */
export function createPlanningCandidateView(
    creative: CreativeInterpretationCatalog,
    answer: AnswerInterpretationCatalog,
    binding: PlanningContextBinding,
    metric?: MetricIntentCatalog
) {
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
        metricObjectives:
            metric?.objectives.map((objective) => [
                objective.id,
                objective.label,
                objective.eligibleScopeIds,
                objective.goals.map((goal) => [
                    goal.metricId,
                    goal.band,
                    goal.relation,
                    goal.targetValue,
                    goal.tolerance,
                    goal.source,
                ]),
            ]) ?? [],
    };
}
