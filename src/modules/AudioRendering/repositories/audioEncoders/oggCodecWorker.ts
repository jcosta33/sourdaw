/// <reference lib="webworker" />
import {
    OGG_CODEC_BLOCK_FRAMES,
    OGG_CODEC_MAX_BYTES,
    type OggCodecWorkerRequest,
    type OggCodecWorkerResponse,
} from '../../models/OggCodecWorkerProtocol';
import opus from './vendor/opus/opus-encode.js';
import ogg from './vendor/vorbis/ogg-encode.js';

type Encoder = { encode: (channels: Float32Array[]) => Uint8Array; flush: () => Uint8Array; free: () => void };

/** The codec retains its frame state; acknowledgement gates every emitted output slice. */
export function installOggCodecWorker(scope: {
    postMessage: (message: OggCodecWorkerResponse, transfers: Transferable[]) => void;
    onmessage: ((event: MessageEvent<OggCodecWorkerRequest>) => void) | null;
}) {
    let session: number | undefined;
    let channels: number | undefined;
    let encoder: Encoder | undefined;
    let busy = false;
    let terminal = false;
    let acknowledgement: { id: number; sequence: number; resolve: () => void } | undefined;
    const release = () => {
        const owned = encoder;
        encoder = undefined;
        owned?.free();
    };
    const execute = async (message: OggCodecWorkerRequest) => {
        if (message.kind === 'ack') {
            if (
                message.session === session &&
                acknowledgement?.id === message.id &&
                acknowledgement.sequence === message.sequence
            ) {
                const ack = acknowledgement;
                acknowledgement = undefined;
                ack.resolve();
            }
            return;
        }
        if (terminal || (session !== undefined && message.session !== session)) {
            return;
        }
        if (busy) {
            throw new Error('Concurrent codec Worker input');
        }
        busy = true;
        session = message.session;
        try {
            let bytes: Uint8Array | undefined;
            if (message.kind === 'init') {
                if (encoder || (message.channels !== 1 && message.channels !== 2)) {
                    throw new Error('Invalid codec initialization');
                }
                channels = message.channels;
                if (message.codec === 'opus') {
                    if (message.sampleRate !== 48000) {
                        throw new Error('Opus requires prepared 48 kHz PCM');
                    }
                    encoder = await opus({
                        sampleRate: 48000,
                        channels,
                        bitrate: 128,
                        application: 'audio',
                        complexity: 10,
                    });
                } else {
                    if (![44100, 48000, 88200, 96000].includes(message.sampleRate)) {
                        throw new Error('Unsupported Vorbis sample rate');
                    }
                    encoder = await ogg({ sampleRate: message.sampleRate, channels, quality: 4 });
                }
            } else {
                if (!encoder) {
                    throw new Error('Codec is not initialized');
                }
                if (message.kind === 'encode') {
                    const length = message.channels[0]?.length ?? 0;
                    if (
                        message.channels.length !== channels ||
                        length < 1 ||
                        length > OGG_CODEC_BLOCK_FRAMES ||
                        message.channels.some(
                            (channel) => !(channel instanceof Float32Array) || channel.length !== length
                        )
                    ) {
                        throw new Error('Invalid bounded codec PCM block');
                    }
                    bytes = encoder.encode(message.channels);
                } else {
                    bytes = encoder.flush();
                }
            }
            if (bytes) {
                let sequence = 0;
                for (let offset = 0; offset < bytes.length; offset += OGG_CODEC_MAX_BYTES) {
                    const owned = new Uint8Array(bytes.subarray(offset, offset + OGG_CODEC_MAX_BYTES));
                    const ack = new Promise<void>((resolve) => {
                        acknowledgement = { id: message.id, sequence, resolve };
                    });
                    scope.postMessage({ kind: 'chunk', session, id: message.id, sequence, bytes: owned }, [
                        owned.buffer,
                    ]);
                    await ack;
                    sequence += 1;
                }
            }
            if (message.kind === 'flush') {
                release();
                terminal = true;
            }
            scope.postMessage({ kind: 'done', session, id: message.id }, []);
        } finally {
            busy = false;
        }
    };
    scope.onmessage = (event) => {
        void execute(event.data).catch((error: unknown) => {
            if (terminal) {
                return;
            }
            terminal = true;
            let message = error instanceof Error ? error.message : 'Codec encoding failed';
            try {
                release();
            } catch (cleanupError) {
                message += `; codec cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
            }
            scope.postMessage({ kind: 'error', session: event.data.session, id: event.data.id, message }, []);
        });
    };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
    installOggCodecWorker(globalThis);
}
