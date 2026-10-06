import { compareAgentScopeMeasurements } from './compareAgentScopeMeasurements';

type ReferenceComparisonInput = {
    /** One project target's measurements. */
    readonly project: Parameters<typeof compareAgentScopeMeasurements>[0]['baseline'];
    /** The user's reference measurements. */
    readonly reference: Parameters<typeof compareAgentScopeMeasurements>[0]['preview'];
};

/**
 * Per-metric deltas between a reference and one project target, `reference − project`: a positive
 * loudness delta says the reference is louder than the project. The project is the baseline, so the
 * figure reads as how far the project would have to move to reach the reference, and the law each
 * metric goes through is the one a proposal preview uses.
 */
export function compareAgentReferenceToProject({
    project,
    reference,
}: ReferenceComparisonInput): ReturnType<typeof compareAgentScopeMeasurements> {
    return compareAgentScopeMeasurements({ baseline: project, preview: reference });
}
