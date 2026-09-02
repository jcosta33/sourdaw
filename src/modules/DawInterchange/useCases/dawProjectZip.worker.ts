/// <reference lib="webworker" />

import {
    type DawProjectZipWorkerRequest,
    type DawProjectZipWorkerResponse,
    runDawProjectZipWorkerRequest,
} from './runDawProjectZipWorkerRequest';

self.onmessage = (event: MessageEvent<DawProjectZipWorkerRequest>) => {
    try {
        const entries = runDawProjectZipWorkerRequest(event.data);
        const transferBuffers = Object.values(entries).map((data) => data.buffer);
        const response: DawProjectZipWorkerResponse = {
            type: 'success',
            entries: Object.fromEntries(Object.entries(entries).map(([path, data]) => [path, data.buffer])),
        };
        self.postMessage(response, { transfer: transferBuffers });
    } catch (error) {
        const response: DawProjectZipWorkerResponse = {
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
