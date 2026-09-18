/**
 * Renderer ↔ model-storage-worker contract. ArrayBuffer chunks and MessagePorts
 * are transfer-list payloads; bulk model bytes are never encoded as JSON arrays.
 *
 * The discriminants are owned by the frozen value tables below so both realms
 * spell them from one source: the bridge authors request types, the runtime
 * answers with response types, and the inference workers receive the transfer
 * messages. A drifted spelling on either side of the postMessage boundary is a
 * message the other side ignores, so no site re-hardcodes these literals.
 */
export const MODEL_STORAGE_REQUEST_TYPE = {
    readModel: 'read-model',
    beginModelWrite: 'begin-model-write',
    writeModelChunk: 'write-model-chunk',
    commitModelWrite: 'commit-model-write',
    abortModelWrite: 'abort-model-write',
    deleteModel: 'delete-model',
    checkModel: 'check-model',
    verifyModel: 'verify-model',
    measureStorage: 'measure-storage',
} as const;

export const MODEL_STORAGE_RESPONSE_TYPE = {
    readComplete: 'read-complete',
    writeBegun: 'write-begun',
    chunkWritten: 'chunk-written',
    writeProgress: 'write-progress',
    writeCommitted: 'write-committed',
    writeAborted: 'write-aborted',
    modelDeleted: 'model-deleted',
    modelChecked: 'model-checked',
    modelVerified: 'model-verified',
    storageMeasured: 'storage-measured',
    error: 'error',
} as const;

export const MODEL_STORAGE_TRANSFER_TYPE = {
    modelData: 'model-data',
    modelError: 'model-error',
} as const;

export type ModelStorageWriteStage = 'verifying' | 'extracting' | 'storing';

export type ModelStorageWorkerRequest =
    | {
          type: typeof MODEL_STORAGE_REQUEST_TYPE.readModel;
          requestId: string;
          family: string;
          modelId: string;
          expectedSizeBytes?: number;
          expectedSha256?: string;
          destinationPort: MessagePort;
      }
    | {
          type: typeof MODEL_STORAGE_REQUEST_TYPE.beginModelWrite;
          requestId: string;
          writeId: string;
          family: string;
          modelId: string;
          expectedSizeBytes?: number;
          expectedSha256?: string;
          archive: boolean;
      }
    | {
          type: typeof MODEL_STORAGE_REQUEST_TYPE.writeModelChunk;
          requestId: string;
          writeId: string;
          chunk: ArrayBuffer;
      }
    | { type: typeof MODEL_STORAGE_REQUEST_TYPE.commitModelWrite; requestId: string; writeId: string }
    | { type: typeof MODEL_STORAGE_REQUEST_TYPE.abortModelWrite; requestId: string; writeId: string }
    | { type: typeof MODEL_STORAGE_REQUEST_TYPE.deleteModel; requestId: string; family: string; modelId: string }
    | { type: typeof MODEL_STORAGE_REQUEST_TYPE.checkModel; requestId: string; family: string; modelId: string }
    | {
          type: typeof MODEL_STORAGE_REQUEST_TYPE.verifyModel;
          requestId: string;
          family: string;
          modelId: string;
          expectedSizeBytes: number;
          expectedSha256: string;
      }
    | { type: typeof MODEL_STORAGE_REQUEST_TYPE.measureStorage; requestId: string };

export type ModelStorageWorkerResponse =
    | { type: typeof MODEL_STORAGE_RESPONSE_TYPE.readComplete; requestId: string; found: boolean }
    | { type: typeof MODEL_STORAGE_RESPONSE_TYPE.writeBegun; requestId: string }
    | { type: typeof MODEL_STORAGE_RESPONSE_TYPE.chunkWritten; requestId: string; bytesWritten: number }
    | {
          type: typeof MODEL_STORAGE_RESPONSE_TYPE.writeProgress;
          requestId: string;
          stage: ModelStorageWriteStage;
      }
    | {
          type: typeof MODEL_STORAGE_RESPONSE_TYPE.writeCommitted;
          requestId: string;
          storedBytes: number;
          extractedPath: string | null;
      }
    | { type: typeof MODEL_STORAGE_RESPONSE_TYPE.writeAborted; requestId: string }
    | { type: typeof MODEL_STORAGE_RESPONSE_TYPE.modelDeleted; requestId: string }
    | { type: typeof MODEL_STORAGE_RESPONSE_TYPE.modelChecked; requestId: string; cached: boolean }
    | { type: typeof MODEL_STORAGE_RESPONSE_TYPE.modelVerified; requestId: string; verified: boolean }
    | { type: typeof MODEL_STORAGE_RESPONSE_TYPE.storageMeasured; requestId: string; usedBytes: number }
    | { type: typeof MODEL_STORAGE_RESPONSE_TYPE.error; requestId: string; name: string; message: string };

export type ModelStorageTransferMessage =
    | { type: typeof MODEL_STORAGE_TRANSFER_TYPE.modelData; modelData: ArrayBuffer }
    | { type: typeof MODEL_STORAGE_TRANSFER_TYPE.modelError; name: string; message: string };
