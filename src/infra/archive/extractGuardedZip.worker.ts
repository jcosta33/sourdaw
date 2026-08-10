/// <reference lib="webworker" />

import {
    type GuardedZipWorkerRequest,
    type GuardedZipWorkerResponse,
    runGuardedZipWorkerRequest,
} from './runGuardedZipWorkerRequest';

self.onmessage = (event: MessageEvent<GuardedZipWorkerRequest>) => {
    try {
        const result = runGuardedZipWorkerRequest(event.data);
        const data = result.data.buffer;
        const response: GuardedZipWorkerResponse = { type: 'success', path: result.path, data };
        self.postMessage(response, { transfer: [data] });
    } catch (error) {
        const response: GuardedZipWorkerResponse = {
            type: 'error',
            code: 'invalid-archive',
            message: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
