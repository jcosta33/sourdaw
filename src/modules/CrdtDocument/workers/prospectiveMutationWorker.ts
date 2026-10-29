/// <reference lib="webworker" />
import { type ProspectiveMutationWorkerResponse } from '../models/ProspectiveMutationWorkerProtocol';

import { materializeProspectiveMutation } from './prospectiveMutationWorkerRuntime';

self.onmessage = ({ data }: MessageEvent<unknown>): void => {
    try {
        const bytes = materializeProspectiveMutation(data);
        const response: ProspectiveMutationWorkerResponse = { status: 'complete', bytes };
        self.postMessage(response, [bytes.buffer]);
    } catch (error) {
        const response: ProspectiveMutationWorkerResponse = {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
