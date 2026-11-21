import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { describeRePreviewedBriefReadings } from '../vibeRun/describeRePreviewedBriefReadings';

/**
 * The brief lines a whole re-preview stores and shows: none for a subset, the readings listing without
 * a choice when the card offered readings (the re-preview keeps none), and otherwise the stored lines.
 */
export function readRePreviewedPlannedLines(
    confirmation: PendingAppActionConfirmation,
    selectsSubset: boolean
): string[] | undefined {
    if (selectsSubset) {
        return undefined;
    }
    const { briefReadings, plannedRunLines } = confirmation.approvalSnapshot;
    return briefReadings === undefined ? plannedRunLines : describeRePreviewedBriefReadings(briefReadings.readings);
}
