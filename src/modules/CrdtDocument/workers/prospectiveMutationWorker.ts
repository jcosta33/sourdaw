/// <reference lib="webworker" />
import { type ProspectiveMutationWorkerResponse } from '../models/ProspectiveMutationWorkerProtocol';

import { materializeProspectiveMutation } from './prospectiveMutationWorkerRuntime';

self.onmessage = ({ data }: MessageEvent<unknown>): void => {
    try {
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
