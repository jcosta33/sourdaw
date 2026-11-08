import { digest } from '#/utils/canonicalDigest';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ScheduledVibeRunPlan } from '../../models/VibeRunPlan';
import { readArrangementRange } from '../readArrangementRange';

/** Historical evidence is checked against its frozen tables, separately from each fresh approval revision. */
export function readVibeRunPlanLinkage(input: {
    plan: ScheduledVibeRunPlan;
    context: ProjectContext;
    projectId: string;
}): string | null {
    const { plan, context } = input;
    if (plan.schemaVersion === 1) {
        return 'legacy plan is unmeasured; request a new measured run';
    }
    const sections = (context.sections ?? [])
        .filter((section) => section.endBeat > section.startBeat)
        .toSorted(
            (left, right) =>
                left.startBeat - right.startBeat || left.endBeat - right.endBeat || left.id.localeCompare(right.id)
        )
        .map(({ id, startBeat, endBeat }) => ({ id, startBeat, endBeat }));
    const arrangement = readArrangementRange(context);
    if (
        plan.initial.projectId !== input.projectId ||
        digest(plan.initial.sections) !== digest(sections) ||
        digest(plan.initial.arrangementRange) !== digest(arrangement)
    ) {
        return 'project identity, section map or arrangement range changed since initial measurement';
    }
    if (
        context.productionBrief?.id !== plan.initial.briefId ||
        digest(context.productionBrief) !== plan.initial.briefDigest
    ) {
        return 'production brief content changed since initial measurement';
    }
    for (const role of plan.initial.roles) {
        const live = context.tracks.find((track) => track.id === role.targetId)?.canonicalRole;
        if (
            live?.role !== role.canonicalRole.role ||
            live.source !== role.canonicalRole.source ||
            live.evidence !== role.canonicalRole.evidence
        ) {
            return `target ${role.targetId} changed role since initial measurement`;
        }
    }
    return null;
}
