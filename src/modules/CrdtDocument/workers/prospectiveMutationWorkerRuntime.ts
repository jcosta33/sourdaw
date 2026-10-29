import { change, free, getChanges, getHeads, load, type Doc } from '@automerge/automerge';

import { applyCanonicalStorageSlotMutation } from '#/infra/store/storage/applyCanonicalStorageSlotMutation';

import {
    parseProspectiveMutationWorkerRequest,
    type ProspectiveMutationWorkerResult,
} from '../models/ProspectiveMutationWorkerProtocol';

export function materializeProspectiveMutation(request: unknown): ProspectiveMutationWorkerResult {
    const input = parseProspectiveMutationWorkerRequest(request);
    let document: Doc<Record<string, unknown>> | undefined;
    try {
        document = load(input.seed, { actor: input.actor });
        const heads = getHeads(document);
        if (heads.length !== input.heads.length || heads.some((head) => !input.heads.includes(head))) {
            throw new Error('Prospective mutation seed heads changed');
        }
        const options =
            input.time === undefined
                ? { message: input.message || undefined }
                : { message: input.message || undefined, time: input.time };
        const seed = document;
        document = change(document, options, (draft) => applyCanonicalStorageSlotMutation(draft, input.mutation));
        return {
            changes: getChanges(seed, document).map((bytes) => Uint8Array.from(bytes)),
            heads: getHeads(document),
        };
    } finally {
        if (document) {
            free(document);
        }
    }
}
