import { ZipArchiveError } from '#/infra/archive/extractGuardedZip';

import {
    MODEL_STORAGE_REQUEST_TYPE,
    MODEL_STORAGE_RESPONSE_TYPE,
    type ModelStorageWorkerRequest,
    type ModelStorageWorkerResponse,
    type ModelStorageWriteStage,
} from '../models/ModelStorageWorkerProtocol';

type PendingRequest = {
    onProgress?: (stage: ModelStorageWriteStage) => void;
    reject: (reason: unknown) => void;
    resolve: (response: ModelStorageWorkerResponse) => void;
};

type BeginModelWriteInput = {
    family: string;
    modelId: string;
    expectedSizeBytes?: number;
    expectedSha256?: string;
    archive: boolean;
};

type CommitModelWriteInput = {
    writeId: string;
    onProgress?: (stage: ModelStorageWriteStage) => void;
};

type ReadModelInput = {
    family: string;
    modelId: string;
    expectedSizeBytes?: number;
    expectedSha256?: string;
};

export type ModelStoragePort = {
    abortModelWrite: (writeId: string) => Promise<void>;
    beginModelWrite: (input: BeginModelWriteInput) => Promise<string>;
    checkModel: (input: { family: string; modelId: string }) => Promise<boolean>;
    commitModelWrite: (input: CommitModelWriteInput) => Promise<{ storedBytes: number; extractedPath: string | null }>;
    deleteModel: (input: { family: string; modelId: string }) => Promise<void>;
    measureStorage: () => Promise<number>;
    readModel: (input: ReadModelInput) => Promise<MessagePort | null>;
    verifyModel: (input: {
        family: string;
        modelId: string;
        expectedSizeBytes: number;
        expectedSha256: string;
    }) => Promise<boolean>;
    writeModelChunk: (input: { writeId: string; chunk: ArrayBuffer }) => Promise<number>;
};

const pendingRequests = new Map<string, PendingRequest>();
let worker: Worker | null = null;

function deserializeError(response: Extract<ModelStorageWorkerResponse, { type: typeof MODEL_STORAGE_RESPONSE_TYPE.error }>): Error {
    if (response.name === 'ZipArchiveError') {
        return new ZipArchiveError(response.message);
    }
    if (response.name === 'TypeError') {
        return new TypeError(response.message);
    }
    if (response.name !== 'Error' && response.name.endsWith('Error')) {
        return new DOMException(response.message, response.name);
    }
    return new Error(response.message);
}

function rejectAll(reason: Error): void {
    for (const pending of pendingRequests.values()) {
        pending.reject(reason);
    }
    pendingRequests.clear();
}

function resetWorker(reason: Error): void {
    rejectAll(reason);
    worker?.terminate();
    worker = null;
}

function getWorker(): Worker {
    if (worker) {
        return worker;
    }
    const created = new Worker(new URL('../workers/modelStorageWorker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<ModelStorageWorkerResponse>) => {
        const response = event.data;
        const pending = pendingRequests.get(response.requestId);
        if (!pending) {
            return;
        }
        if (response.type === MODEL_STORAGE_RESPONSE_TYPE.writeProgress) {
            pending.onProgress?.(response.stage);
            return;
        }
        pendingRequests.delete(response.requestId);
        if (response.type === MODEL_STORAGE_RESPONSE_TYPE.error) {
            pending.reject(deserializeError(response));
            return;
        }
        pending.resolve(response);
    };
    created.onerror = (event) => resetWorker(new Error(event.message || 'Model storage worker failed'));
    created.onmessageerror = () => resetWorker(new Error('Model storage worker returned an unreadable response'));
    worker = created;
    return created;
}

function sendRequest(
    request: ModelStorageWorkerRequest,
    transfer: Transferable[] = [],
    onProgress?: (stage: ModelStorageWriteStage) => void
): Promise<ModelStorageWorkerResponse> {
    return new Promise((resolve, reject) => {
        pendingRequests.set(request.requestId, { onProgress, reject, resolve });
        try {
            getWorker().postMessage(request, transfer);
        } catch (error) {
            pendingRequests.delete(request.requestId);
            reject(error);
        }
    });
}

export const modelStorageWorkerBridge: ModelStoragePort & { terminate: () => void } = {
    async readModel(input): Promise<MessagePort | null> {
        const channel = new MessageChannel();
        const requestId = crypto.randomUUID();
        const request: ModelStorageWorkerRequest = {
            type: MODEL_STORAGE_REQUEST_TYPE.readModel,
            requestId,
            ...input,
            destinationPort: channel.port1,
        };
        try {
            const response = await sendRequest(request, [channel.port1]);
            if (response.type !== MODEL_STORAGE_RESPONSE_TYPE.readComplete) {
                throw new Error(`Unexpected model storage response: ${response.type}`);
            }
            if (!response.found) {
                channel.port2.close();
                return null;
            }
            return channel.port2;
        } catch (error) {
            channel.port2.close();
            throw error;
        }
    },

    async beginModelWrite(input): Promise<string> {
        const requestId = crypto.randomUUID();
        const writeId = crypto.randomUUID();
        const response = await sendRequest({ type: MODEL_STORAGE_REQUEST_TYPE.beginModelWrite, requestId, writeId, ...input });
        if (response.type !== MODEL_STORAGE_RESPONSE_TYPE.writeBegun) {
            throw new Error(`Unexpected model storage response: ${response.type}`);
        }
        return writeId;
    },

    async writeModelChunk({ writeId, chunk }): Promise<number> {
        const response = await sendRequest(
            { type: MODEL_STORAGE_REQUEST_TYPE.writeModelChunk, requestId: crypto.randomUUID(), writeId, chunk },
            [chunk]
        );
        if (response.type !== MODEL_STORAGE_RESPONSE_TYPE.chunkWritten) {
            throw new Error(`Unexpected model storage response: ${response.type}`);
        }
        return response.bytesWritten;
    },

    async commitModelWrite({ writeId, onProgress }) {
        const response = await sendRequest(
            { type: MODEL_STORAGE_REQUEST_TYPE.commitModelWrite, requestId: crypto.randomUUID(), writeId },
            [],
            onProgress
        );
        if (response.type !== MODEL_STORAGE_RESPONSE_TYPE.writeCommitted) {
            throw new Error(`Unexpected model storage response: ${response.type}`);
        }
        return { storedBytes: response.storedBytes, extractedPath: response.extractedPath };
    },

    async abortModelWrite(writeId): Promise<void> {
        const response = await sendRequest({ type: MODEL_STORAGE_REQUEST_TYPE.abortModelWrite, requestId: crypto.randomUUID(), writeId });
        if (response.type !== MODEL_STORAGE_RESPONSE_TYPE.writeAborted) {
            throw new Error(`Unexpected model storage response: ${response.type}`);
        }
    },

    async deleteModel(input): Promise<void> {
        const response = await sendRequest({ type: MODEL_STORAGE_REQUEST_TYPE.deleteModel, requestId: crypto.randomUUID(), ...input });
        if (response.type !== MODEL_STORAGE_RESPONSE_TYPE.modelDeleted) {
            throw new Error(`Unexpected model storage response: ${response.type}`);
        }
    },

    async checkModel(input): Promise<boolean> {
        const response = await sendRequest({ type: MODEL_STORAGE_REQUEST_TYPE.checkModel, requestId: crypto.randomUUID(), ...input });
        if (response.type !== MODEL_STORAGE_RESPONSE_TYPE.modelChecked) {
            throw new Error(`Unexpected model storage response: ${response.type}`);
        }
        return response.cached;
    },

    async verifyModel(input): Promise<boolean> {
        const response = await sendRequest({ type: MODEL_STORAGE_REQUEST_TYPE.verifyModel, requestId: crypto.randomUUID(), ...input });
        if (response.type !== MODEL_STORAGE_RESPONSE_TYPE.modelVerified) {
            throw new Error(`Unexpected model storage response: ${response.type}`);
        }
        return response.verified;
    },

    async measureStorage(): Promise<number> {
        const response = await sendRequest({ type: MODEL_STORAGE_REQUEST_TYPE.measureStorage, requestId: crypto.randomUUID() });
        if (response.type !== MODEL_STORAGE_RESPONSE_TYPE.storageMeasured) {
            throw new Error(`Unexpected model storage response: ${response.type}`);
        }
        return response.usedBytes;
    },

    terminate(): void {
        resetWorker(new Error('Model storage worker terminated'));
    },
};
