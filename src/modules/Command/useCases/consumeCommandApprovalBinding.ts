import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import {
    approvalStates,
    type CommandApprovalBinding,
    type CommandApprovalValidationResult,
    getCommandApprovalIdentity,
} from './commandApprovalBinding';

export function consumeCommandApprovalBinding(input: {
    approvalBinding: CommandApprovalBinding;
    authority: CommandBatchAuthority;
    serialized: string;
}): CommandApprovalValidationResult {
    const state = approvalStates.get(input.approvalBinding);
    if (!state) {
        return { status: 'invalid', reason: 'Command approval binding is not owned by Command' };
    }
    if (state.consumed) {
        return { status: 'invalid', reason: 'Command approval binding was already consumed' };
    }
    let identity: string;
    try {
        identity = getCommandApprovalIdentity(input);
    } catch (error) {
        return { status: 'invalid', reason: error instanceof Error ? error.message : String(error) };
    }
    if (identity !== state.identity) {
        return { status: 'invalid', reason: 'Command approval binding does not match the exact command batch' };
    }
    state.consumed = true;
    let validation: CommandApprovalValidationResult;
    try {
        validation = state.validate();
    } catch (error) {
        state.consumed = false;
        return {
            status: 'invalid',
            reason: `Command approval revalidation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    if (validation.status === 'invalid') {
        state.consumed = false;
        return validation;
    }
    return { status: 'valid' };
}
