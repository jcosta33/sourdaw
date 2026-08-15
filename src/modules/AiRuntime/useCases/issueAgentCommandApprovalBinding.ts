import { issueCommandApprovalBinding } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type compileAgentRiskApproval } from './compileAgentRiskApproval';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type CommandApprovalInput = Parameters<typeof issueCommandApprovalBinding>[0];

export function issueAgentCommandApprovalBinding(input: {
    approval: ReturnType<typeof compileAgentRiskApproval>;
    commandBatch: Pick<CommandApprovalInput, 'authority' | 'serialized'>;
}) {
    return issueCommandApprovalBinding({
        authority: input.commandBatch.authority,
        serialized: input.commandBatch.serialized,
        validate: () =>
            validateAgentRiskApproval({
                approval: input.approval,
                commandBatch: input.commandBatch,
                currentRevision: captureProjectRevision(),
            }),
    });
}
