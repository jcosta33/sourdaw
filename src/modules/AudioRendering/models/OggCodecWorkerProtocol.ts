export const OGG_CODEC_MAX_BYTES = 1024 * 1024;
export const OGG_CODEC_BLOCK_FRAMES = 4096;

type RequestIdentity = { session: number; id: number };

export type OggCodecWorkerCommand =
    | { kind: 'init'; codec: 'ogg' | 'opus'; sampleRate: number; channels: 1 | 2 }
    | { kind: 'encode'; channels: Float32Array[] }
    | { kind: 'flush' }
    | { kind: 'ack'; sequence: number };

export type OggCodecWorkerRequest = RequestIdentity & OggCodecWorkerCommand;

export type OggCodecWorkerResponse = RequestIdentity &
    ({ kind: 'chunk'; sequence: number; bytes: Uint8Array } | { kind: 'done' } | { kind: 'error'; message: string });
