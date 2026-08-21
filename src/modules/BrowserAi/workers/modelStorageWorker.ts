/// <reference lib="webworker" />

import { type ModelStorageWorkerRequest } from '../models/ModelStorageWorkerProtocol';

import { createModelStorageRequestHandler } from './modelStorageWorkerRuntime';

const handleRequest = createModelStorageRequestHandler({
    getRoot: () => navigator.storage.getDirectory(),
    postResponse: (response) => self.postMessage(response),
});

self.onmessage = (event: MessageEvent<ModelStorageWorkerRequest>) => {
    void handleRequest(event.data);
};
