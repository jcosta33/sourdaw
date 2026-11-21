import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext, type ProjectContextProductionBrief } from '../../models/ProjectContext';
import { type ScheduledVibeRunBatch, type VibeRunVerificationRange } from '../../models/VibeRunPlan';
import { readExplicitProtections } from '../agentReference/readExplicitProtections';
import { planMetricMeasurementRequests } from '../planMetricMeasurementRequests';
import { readArrangementRange } from '../readArrangementRange';
import { type readBriefMixIntent } from '../readBriefMixIntent';

import { readVibeRunCandidates } from './readVibeRunCandidates';
import { readVibeRunInitialGoals } from './readVibeRunInitialGoals';
import { readVibeRunWholeFit } from './readVibeRunWholeFit';
import { toScheduledVibeRunBatch } from './toScheduledVibeRunBatch';
import { withBriefRoleContext } from './withBriefRoleContext';

type Catalog = ReturnType<typeof getMixRecipeCatalog>;

/** What the pre-measurement stage reads: the request, the project, the brief and the run it spends from. */
export type PrepareVibeRunInput = {
    prompt: string;
    context: ProjectContext;
    brief: ProjectContextProductionBrief;
    mixIntent: NonNullable<ReturnType<typeof readBriefMixIntent>>;
    runId: string;
    priorReceipts: readonly ApplicationToolReceipt[];
};

/** The preparation stage's input: the caller's request with the constraint reading it was bound to. */
export type PrepareVibeRunStageInput = PrepareVibeRunInput & { reading: PerceptualConstraintReading };

export type PreparedVibeRunSchedule =
    | { status: 'none' }
    | { status: 'unscheduled'; lines: string[] }
    | {
          status: 'prepared';
          catalog: Catalog;
          candidate: ReturnType<typeof readVibeRunCandidates>;
          ranges: readonly VibeRunVerificationRange[];
          arrangementRange: VibeRunVerificationRange;
          batches: readonly ScheduledVibeRunBatch[];
          reading: PerceptualConstraintReading;
          initialRequests: ReturnType<typeof planMetricMeasurementRequests>;
          /** The identity of what would be scheduled, judged before anything is measured. */
          planDigest: string;
      };

function validSections(context: ProjectContext): boolean {
    const sections = context.sections ?? [];
    return (
        new Set(sections.map((section) => section.id)).size === sections.length &&
        sections.every(
            (section) =>
                Number.isFinite(section.startBeat) &&
                Number.isFinite(section.endBeat) &&
                section.startBeat >= 0 &&
                section.endBeat > section.startBeat
        )
    );
}

/**
 * Everything a vibe run decides before it measures anything: the authored recipes' batches for the
 * characters, the goals their initial figures read, and whether the whole run fits. It is pure CPU,
 * reserves no budget and writes nothing, so a reading can be prepared and prepared again.
 */
export function prepareVibeRunSchedule(input: PrepareVibeRunStageInput): PreparedVibeRunSchedule {
    const catalog = getMixRecipeCatalog();
    if (input.mixIntent.requestedDescriptors.length === 0) {
        return { status: 'none' };
    }
    if (!validSections(input.context)) {
        return {
            status: 'unscheduled',
            lines: [
                'No batches were scheduled after the brief: the section map has invalid bounds or duplicate identities.',
            ],
        };
    }
    // The protection reads the roles the run plans by, so a family it keeps holds every track the brief places in it.
    const protections = readExplicitProtections(input.prompt, withBriefRoleContext(input.context, input.brief));
    if (protections.unresolved.length > 0) {
        return {
            status: 'unscheduled',
            lines: [
                `No batches were scheduled after the brief: unresolved original-request protection: ${protections.unresolved.join(', ')}.`,
            ],
        };
    }
    const candidate = readVibeRunCandidates(
        { context: input.context, brief: input.brief, descriptors: input.mixIntent.requestedDescriptors },
        catalog,
        protections.protectedTrackIds
    );
    if (candidate.plan.batches.length === 0) {
        return { status: 'none' };
    }
    const arrangementRange = readArrangementRange(input.context);
    if (arrangementRange === null) {
        return {
            status: 'unscheduled',
            lines: ['No batches were scheduled after the brief: the arrangement holds no audio to measure.'],
        };
    }
    const ranges = [
        arrangementRange,
        ...(candidate.plan.batches[0]?.objective.sections ?? []).map((section) => ({
            startBeat: section.startBeat,
            endBeat: section.endBeat,
            sectionId: section.id,
        })),
    ];
    const batches = candidate.plan.batches.map((batch) => ({
        ...toScheduledVibeRunBatch(batch),
        verificationRanges: ranges,
    }));
    const initial = readVibeRunInitialGoals(batches, catalog, arrangementRange);
    if (initial.status === 'refused') {
        return { status: 'unscheduled', lines: [`No batches were scheduled after the brief: ${initial.reason}.`] };
    }
    const initialReads = initial.goals.flatMap((goal) => {
        if (goal.metricId === null || goal.range === null) {
            return [];
        }
        return [{ prefix: 'initial', range: goal.range, metricId: goal.metricId, targetIds: goal.targetIds }];
    });
    const initialRequests = planMetricMeasurementRequests({ context: input.context, reads: initialReads });
    const refusals = readVibeRunWholeFit(input, batches, input.reading, initialReads);
    if (refusals.length > 0) {
        return { status: 'unscheduled', lines: [`No batches were scheduled after the brief: ${refusals.join('; ')}.`] };
    }
    return {
        status: 'prepared',
        catalog,
        candidate,
        ranges,
        arrangementRange,
        batches,
        reading: input.reading,
        initialRequests,
        planDigest: digest({ catalogVersion: catalog.version, batches }),
    };
}
