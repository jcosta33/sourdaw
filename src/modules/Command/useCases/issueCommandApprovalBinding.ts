import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import {
    approvalStates,
    commandApprovalBrand,
    type CommandApprovalBinding,
    type CommandApprovalValidationResult,
    getCommandApprovalIdentity,
} from './commandApprovalBinding';

export function issueCommandApprovalBinding(input: {
    authority: CommandBatchAuthority;
    serialized: string;
    validate: () => CommandApprovalValidationResult;
}): CommandApprovalBinding {
    const binding = Object.freeze({
        kind: 'command-approval-binding' as const,
        [commandApprovalBrand]: true as const,
    });
    approvalStates.set(binding, {
        consumed: false,
        identity: getCommandApprovalIdentity(input),
        validate: input.validate,
    });
    return binding;
}
