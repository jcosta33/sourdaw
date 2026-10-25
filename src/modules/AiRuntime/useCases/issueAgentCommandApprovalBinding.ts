import { issueCommandApprovalBinding } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
} from '#/modules/CrdtDocument/useCases';

import { type compileAgentRiskApproval } from './compileAgentRiskApproval';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type CommandApprovalInput = Parameters<typeof issueCommandApprovalBinding>[0];

type ApprovalBindingRejection = {
    reason: string;
    stale: boolean;
};

export function issueAgentCommandApprovalBinding(input: {
    approval: ReturnType<typeof compileAgentRiskApproval>;
    commandBatch: Pick<CommandApprovalInput, 'authority' | 'serialized'>;
    onRejection?: (rejection: ApprovalBindingRejection) => void;
}) {
    return issueCommandApprovalBinding({
        authority: input.commandBatch.authority,
        serialized: input.commandBatch.serialized,
        validate: () => {
            // Confirmation preflight already accepts an unchanged project when a
            // no-op store flush moved only the mutation epoch. Use the same proof
            // at the final binding; the batch's own source revision stays exact.
            let currentRevision = input.approval.sourceRevision;
            if (!projectRevisionMatchesLiveIgnoringCommandCheckpoint(input.approval.sourceRevision)) {
                currentRevision = captureProjectRevision();
            }
            const validation = validateAgentRiskApproval({
                approval: input.approval,
                commandBatch: input.commandBatch,
                currentRevision,
            });
            if (validation.status === 'invalid' && input.onRejection) {
                input.onRejection({ reason: validation.reason, stale: validation.stale });
            }
            return validation;
        },
    });
}
