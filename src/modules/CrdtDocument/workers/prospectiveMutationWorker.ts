/// <reference lib="webworker" />
import wasmUrl from '@automerge/automerge/automerge.wasm';
import { initializeWasm } from '@automerge/automerge/slim';

import { type ProspectiveMutationWorkerResponse } from '../models/ProspectiveMutationWorkerProtocol';

import { materializeProspectiveMutation } from './prospectiveMutationWorkerRuntime';

self.onmessage = async ({ data }: MessageEvent<unknown>): Promise<void> => {
    try {
        await initializeWasm(wasmUrl);
        const result = materializeProspectiveMutation(data);
        const response: ProspectiveMutationWorkerResponse = { status: 'complete', ...result };
        self.postMessage(response, [result.bytes.buffer]);
    } catch (error) {
        const response: ProspectiveMutationWorkerResponse = {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
