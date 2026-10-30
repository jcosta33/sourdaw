import { change, free, getHeads, getMissingDeps, load, save, type Doc } from '@automerge/automerge/slim';

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
        let options: { message: string | undefined; time?: number };
        if (input.time === undefined) {
            options = { message: input.message || undefined };
        } else {
            options = { message: input.message || undefined, time: input.time };
        }
        document = change(document, options, (draft) => applyCanonicalStorageSlotMutation(draft, input.mutation));
        if (getMissingDeps(document, []).length > 0) {
            throw new Error('Prospective mutation candidate has missing dependencies');
        }
        return {
            bytes: Uint8Array.from(save(document)),
            heads: getHeads(document),
        };
    } finally {
        if (document) {
            free(document);
        }
    }
}
