import { type AgentRun } from '../../models/AgentRun';
import { type BriefReading } from '../../models/BriefReading';
import { type ProjectContext, type ProjectContextProductionBrief } from '../../models/ProjectContext';
import { type readBriefMixIntent } from '../readBriefMixIntent';

import { prepareVibeRunSchedule } from './prepareVibeRunSchedule';

/**
 * Why the live project no longer plans the reading as it was offered, or `null` when preparing it
 * again, before anything is measured, yields exactly the retained plan.
 */
export function readRetainedPlanDigestDrift(input: {
    reading: BriefReading;
    run: AgentRun;
    prompt: string;
    context: ProjectContext;
    brief: ProjectContextProductionBrief;
    mixIntent: NonNullable<ReturnType<typeof readBriefMixIntent>>;
}): string | null {
    const prepared = prepareVibeRunSchedule({
        prompt: input.prompt,
        context: input.context,
        brief: input.brief,
        mixIntent: input.mixIntent,
        runId: input.run.runId,
        priorReceipts: input.run.plan?.applicationToolReceipts ?? [],
    });
    if (prepared.status === 'none') {
        return 'The project no longer plans this reading as offered: no authored recipe plans it on the project now.';
    }
    if (prepared.status === 'unscheduled') {
        return `The project no longer plans this reading as offered: ${prepared.lines.join(' ')}`;
    }
    if (prepared.planDigest !== input.reading.plan.planDigest) {
        return 'The project no longer plans this reading as offered, so the reading no longer applies.';
    }
    return null;
}
