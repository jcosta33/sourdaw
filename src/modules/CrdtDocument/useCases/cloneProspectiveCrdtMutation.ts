import { automergeRepository } from '../repositories/automergeRepository';

import { type MutateCrdtDocInput } from './mutateCrdtDoc';

/** Build an unpublished same-actor clone for an explicitly prepared storage write. */
export function cloneProspectiveCrdtMutation<DocShape = Record<string, unknown>>(
    input: Omit<MutateCrdtDocInput<DocShape>, 'prospectiveValidation'>
) {
    return automergeRepository.cloneProspectiveMutation<DocShape>(
        input.id,
        input.changeFn,
        input.message,
        input.snapshotTransaction,
        input.localSlots,
        input.canonicalMutation
    );
}
