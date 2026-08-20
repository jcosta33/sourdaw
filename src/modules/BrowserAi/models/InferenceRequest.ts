/**
 * Typed message protocol for main thread ↔ inference worker communication.
 *
 * Follows the spec requirement §1 — both ONNX and TF.js workers use the
 * same protocol so the session manager can route by model type.
 */

export type TensorData = {
    data: Float32Array | BigInt64Array | Int32Array | Uint8Array;
    dims: number[];
    type: 'float32' | 'int64' | 'int32' | 'bool';
};

export type SessionOptions = {
    executionProviders?: Array<'webgpu' | 'wasm'>;
    /** Memory budget hint in bytes for this session */
    memoryBudgetBytes?: number;
};

export type OnnxExecutionProvider = NonNullable<SessionOptions['executionProviders']>[number];
export type DdspStoredArtifact = {
    modelId: string;
    path: 'model.json' | 'group1-shard1of1.bin' | 'settings.json';
    sizeBytes: number;
    sha256: string;
    /** Already-verified artifact stream from the model-storage worker. */
    modelDataPort: MessagePort;
};

// Main thread → Worker
export type WorkerRequest =
    | {
          type: 'create-session';
          /** UUID used to correlate with the session-created response */
          requestId: string;
          modelId: string;
          modelData: ArrayBuffer;
          options: SessionOptions;
      }
    | {
          type: 'create-session-from-model-port';
          /** UUID used to correlate with the session-created response */
          requestId: string;
          modelId: string;
          modelDataPort: MessagePort;
          options: SessionOptions;
      }
    | {
          type: 'run-inference';
          modelId: string;
          feeds: Record<string, TensorData>;
          requestId: string;
      }
    | {
          type: 'release-session';
          modelId: string;
      }
    | {
          type: 'get-status';
          /** UUID used to correlate with the status response (live session-cache query) */
          requestId: string;
      }
    | {
          /** Load a TF.js GraphModel from verified OPFS artifacts. */
          type: 'create-session-from-model-storage';
          /** UUID used to correlate with the session-created response */
          requestId: string;
          modelId: string;
          artifacts: DdspStoredArtifact[];
      }
    | {
          type: 'run-ddsp-inference';
          requestId: string;
          modelId: string;
          pitchHz: Float32Array;
          loudnessDb: Float32Array;
          /** Frame rate expected by this model (typically 250 Hz) */
          frameRate: number;
      }
    | {
          type: 'run-kokoro-tts';
          requestId: string;
          /**
           * Pre-tokenized phoneme IDs with pad tokens (0) at both ends.
           * Shape: int64[1, seq_len] — built by textToKokoroInputIds() on the main thread.
           */
          inputIds: BigInt64Array;
          /**
           * Voice style embedding slice [256 float32 values].
           * Selected from the voice .bin file at index = tokenCount (pre-padding length).
           */
          style: Float32Array;
          speed: number;
      }
    | {
          type: 'run-diffsinger-phrase';
          requestId: string;
          voicebankId: string;
          tokenIds: number[];
          wordDiv: number[];
          wordDur: number[];
          noteMidi: Float32Array;
          noteDur: BigInt64Array;
          durationFrames: number;
          /** Speaker embedding weights for blending (256 float32 values per speaker) */
          speakerEmbed?: Float32Array;
          /** Diffusion steps (3=Low, 5=Standard, 10=High, 20=Maximum) */
          steps: number;
          /** Shallow diffusion depth from dsconfig (typically 0.6) */
          depth: number;
      };

// Worker → Main thread
export type WorkerResponse =
    | {
          type: 'session-created';
          requestId: string;
          modelId: string;
          executionProviders?: OnnxExecutionProvider[];
      }
    | {
          type: 'inference-result';
          requestId: string;
          outputs: Record<string, TensorData>;
      }
    | {
          type: 'ddsp-result';
          requestId: string;
          /** PCM audio at model native sample rate */
          audio: Float32Array;
          nativeSampleRate: number;
      }
    | {
          type: 'tts-result';
          requestId: string;
          /** PCM audio at 24 kHz (Kokoro native) */
          audio: Float32Array;
          samplingRate: number;
      }
    | {
          type: 'diffsinger-result';
          requestId: string;
          /** PCM audio at 44100 Hz */
          audio: Float32Array;
      }
    | {
          type: 'inference-progress';
          requestId: string;
          stage: string;
          progress: number;
      }
    | { type: 'error'; requestId: string; error: string }
    | {
          type: 'status';
          /** Echoes the get-status requestId so the bridge can correlate the live query */
          requestId: string;
          loadedModels: string[];
          memoryUsageBytes: number;
      };
