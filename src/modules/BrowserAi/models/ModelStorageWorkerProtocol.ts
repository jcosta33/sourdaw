/**
 * Renderer ↔ model-storage-worker contract. ArrayBuffer chunks and MessagePorts
 * are transfer-list payloads; bulk model bytes are never encoded as JSON arrays.
 */
export type ModelStorageWriteStage = 'verifying' | 'extracting' | 'storing';

export type ModelStorageWorkerRequest =
    | {
          type: 'read-model';
          requestId: string;
          family: string;
          modelId: string;
          expectedSizeBytes?: number;
          expectedSha256?: string;
          destinationPort: MessagePort;
      }
    | {
          type: 'begin-model-write';
          requestId: string;
          writeId: string;
          family: string;
          modelId: string;
          expectedSizeBytes?: number;
          expectedSha256?: string;
          archive: boolean;
      }
    | { type: 'write-model-chunk'; requestId: string; writeId: string; chunk: ArrayBuffer }
    | { type: 'commit-model-write'; requestId: string; writeId: string }
    | { type: 'abort-model-write'; requestId: string; writeId: string }
    | { type: 'delete-model'; requestId: string; family: string; modelId: string }
    | { type: 'check-model'; requestId: string; family: string; modelId: string }
    | {
          type: 'verify-model';
          requestId: string;
          family: string;
          modelId: string;
          expectedSizeBytes: number;
          expectedSha256: string;
      }
    | { type: 'measure-storage'; requestId: string };

export type ModelStorageWorkerResponse =
    | { type: 'read-complete'; requestId: string; found: boolean }
    | { type: 'write-begun'; requestId: string }
    | { type: 'chunk-written'; requestId: string; bytesWritten: number }
    | { type: 'write-progress'; requestId: string; stage: ModelStorageWriteStage }
    | {
          type: 'write-committed';
          requestId: string;
          storedBytes: number;
          extractedPath: string | null;
      }
    | { type: 'write-aborted'; requestId: string }
    | { type: 'model-deleted'; requestId: string }
    | { type: 'model-checked'; requestId: string; cached: boolean }
    | { type: 'model-verified'; requestId: string; verified: boolean }
    | { type: 'storage-measured'; requestId: string; usedBytes: number }
    | { type: 'error'; requestId: string; name: string; message: string };

export type ModelStorageTransferMessage =
    { type: 'model-data'; modelData: ArrayBuffer } | { type: 'model-error'; name: string; message: string };
