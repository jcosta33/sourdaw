/// <reference lib="webworker" />
import wasmUrl from '@automerge/automerge/automerge.wasm';
import { initializeWasm } from '@automerge/automerge/slim';

import { type ProspectiveMutationWorkerResponse } from '../models/ProspectiveMutationWorkerProtocol';

import { materializeProspectiveMutation } from './prospectiveMutationWorkerRuntime';

self.onmessage = async (event: MessageEvent<unknown>): Promise<void> => {
    // Chromium serializes the origin of a dedicated Worker's creating document as
    // an empty string; other engines report the document origin. A dedicated
    // Worker is unreachable from any other browsing context, so those are the
    // only two shapes a trusted sender can produce.
    if (event.origin !== '' && event.origin !== self.location.origin) {
        return;
    }
    const { data } = event;
    try {
        await initializeWasm(wasmUrl);
        const result = materializeProspectiveMutation(data);
        const response: ProspectiveMutationWorkerResponse = { status: 'complete', ...result };
        self.postMessage(
            response,
            result.changes.map((bytes) => bytes.buffer)
        );
    } catch (error) {
        const response: ProspectiveMutationWorkerResponse = {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
