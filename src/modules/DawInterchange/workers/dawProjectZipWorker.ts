/// <reference lib="webworker" />

import { runDawProjectZipWorkerRequest } from './runDawProjectZipWorkerRequest';

import type { DawProjectZipWorkerRequest, DawProjectZipWorkerResponse } from '../models/DawProjectZipWorkerProtocol';

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
