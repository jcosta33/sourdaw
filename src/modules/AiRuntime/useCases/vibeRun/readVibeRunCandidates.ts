import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { ANALYSIS_MEASURE_MAX_TARGETS } from '../../models/AnalysisMeasureLimits';
import { type ProjectContext, type ProjectContextProductionBrief } from '../../models/ProjectContext';
import { planWholeProjectVibeRun } from '../planWholeProjectVibeRun';
import { type readBriefMixIntent } from '../readBriefMixIntent';

import { withBriefTrackRoles } from './withBriefTrackRoles';

type VibeRunCandidateInput = {
    context: ProjectContext;
    brief: ProjectContextProductionBrief;
    descriptors: NonNullable<ReturnType<typeof readBriefMixIntent>>['requestedDescriptors'];
};

/** The batches the authored recipes would plan for these characters, before anything is measured. */
export function readVibeRunCandidates(
    input: VibeRunCandidateInput,
    catalog: ReturnType<typeof getMixRecipeCatalog>,
    protectedTargetIds: readonly string[]
) {
    const tracks = withBriefTrackRoles(input.context.tracks, input.brief);
    const plannerInput = {
        context: { tracks, sections: input.context.sections, productionBrief: input.brief },
        descriptors: input.descriptors,
        recipes: catalog.recipes.filter((recipe) => recipe.origin === undefined),
        maxTargetsPerBatch: ANALYSIS_MEASURE_MAX_TARGETS,
        protectedTargetIds,
    };
    return { tracks, plannerInput, plan: planWholeProjectVibeRun({ ...plannerInput, measurements: [] }) };
}
