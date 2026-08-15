import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';

export const commandApprovalBrand = Symbol('commandApprovalBinding');

export type CommandApprovalValidationResult = { status: 'valid' } | { status: 'invalid'; reason: string };

export type CommandApprovalBinding = Readonly<{
    kind: 'command-approval-binding';
    [commandApprovalBrand]: true;
}>;

export type CommandApprovalState = {
    consumed: boolean;
    identity: string;
    validate: () => CommandApprovalValidationResult;
};

export const approvalStates = new WeakMap<CommandApprovalBinding, CommandApprovalState>();

function normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalizeJson);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .toSorted(([left], [right]) => {
                if (left < right) {
                    return -1;
                }
                if (left > right) {
                    return 1;
                }
                return 0;
            })
            .map(([key, nested]) => [key, normalizeJson(nested)])
    );
}

export function getCommandApprovalIdentity(input: { authority: CommandBatchAuthority; serialized: string }): string {
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return JSON.stringify(normalizeJson({ authority: input.authority, envelope: parsed.envelope }));
}
