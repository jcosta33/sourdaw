import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type MeasuredScheduledVibeRunPlan, type VibeRunValueChoiceTier } from '../../models/VibeRunPlan';
import { agentRunLifecycle } from '../agentRunLifecycle';

import { describeVibeRunValueChoiceCalls } from './describeVibeRunValueChoiceCalls';
import { isHostedValueChoiceChain } from './isHostedValueChoiceChain';
import { readVibeRunValueChoiceFit } from './readVibeRunValueChoiceFit';

/**
 * On a hosted chain every batch asks the provider for its recipe values, so the run must afford a
 * request and its one correction for every batch before it is scheduled, and the card says how many
 * calls that is. A local chain asks nothing and counts nothing. The tier it decided is what the run
 * records, so every batch follows what the card disclosed.
 */
export function readVibeRunValueChoiceScheduleFit(
    input: { runId: string; context: ProjectContext },
    plan: MeasuredScheduledVibeRunPlan,
    catalog: ReturnType<typeof getMixRecipeCatalog>
): { status: 'fits'; tier: VibeRunValueChoiceTier; lines: string[] } | { status: 'refused'; reason: string } {
    if (!isHostedValueChoiceChain()) {
        return { status: 'fits', tier: 'local', lines: [] };
    }
    const run = agentRunLifecycle.get(input.runId);
    if (run === null) {
        return { status: 'refused', reason: 'this run no longer exists' };
    }
    const fit = readVibeRunValueChoiceFit({ plan, catalog, context: input.context, budgets: run.budgets });
    if (fit.refusal !== null) {
        return { status: 'refused', reason: fit.refusal };
    }
    return { status: 'fits', tier: 'hosted', lines: [describeVibeRunValueChoiceCalls(fit.calls)] };
}
