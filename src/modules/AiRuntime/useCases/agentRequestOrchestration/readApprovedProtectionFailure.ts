import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';

import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { proposalProtection } from '../agentReference/proposalProtection';
import { getProjectContext } from '../getProjectContext';

/** Captured identities and facets remain authoritative when live dependencies change a batch's effects. */
export function readApprovedProtectionFailure(confirmation: PendingAppActionConfirmation): string | null {
    const approved = confirmation.approvalSnapshot;
    const facts = approved.protectionFacts;
    if (facts === undefined || (facts.protectedUnchanged.length === 0 && facts.protectedControls.length === 0)) {
        return null;
    }
    if (agentProjectRepairStateStore.value) {
        return 'The project needs repair before its captured request protections can be checked.';
    }
    const changed = proposalProtection.findChange(approved.actions, facts, getProjectContext());
    return changed === null
        ? null
        : `The approved proposal changes "${changed.name}", which its captured request leaves unchanged.`;
}
