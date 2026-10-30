import { type ExportByteWriter } from '../../models/ExportAudioSource';
import {
    OGG_CODEC_MAX_BYTES,
    type OggCodecWorkerCommand,
    type OggCodecWorkerRequest,
    type OggCodecWorkerResponse,
} from '../../models/OggCodecWorkerProtocol';

let nextSession = 0;

type Pending = {
    id: number;
    sequence: number;
    writing: boolean;
    resolve: () => void;
    reject: (error: unknown) => void;
};

/** One request and one awaited sink write; each file owns and terminates its Worker. */
export async function createOggCodecWorker(input: {
    codec: 'ogg' | 'opus';
    sampleRate: number;
    channels: 1 | 2;
    writer: ExportByteWriter;
    signal?: AbortSignal;
}) {
    if (input.signal?.aborted) {
        throw new Error('Export cancelled');
    }
    input.writer.checkCancelled?.();
    const worker = new Worker(new URL('../../workers/oggCodecWorker.ts', import.meta.url), { type: 'module' });
    const session = ++nextSession;
    let nextId = 0;
    let pending: Pending | undefined;
    let closed = false;

    const close = (error: unknown = new Error('Codec Worker closed')) => {
        if (closed) {
            return;
        }
        closed = true;
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        input.signal?.removeEventListener('abort', onAbort);
        worker.terminate();
        const active = pending;
        pending = undefined;
        active?.reject(error);
    };
    const onAbort = () => close(new Error('Export cancelled'));
    const onError = (event: ErrorEvent) => close(new Error(event.message || 'Codec Worker failed'));
    const onMessageError = () => close(new Error('Codec Worker message could not be decoded'));
    const receive = async (message: OggCodecWorkerResponse) => {
        const active = pending;
        if (closed || message.session !== session || !active || message.id !== active.id) {
            return;
        }
        if (message.kind === 'error') {
            close(new Error(message.message));
            return;
        }
        if (message.kind === 'done') {
            if (active.writing) {
                throw new Error('Codec completed before its output drained');
            }
            pending = undefined;
            active.resolve();
            return;
        }
        if (
            active.writing ||
            message.sequence !== active.sequence ||
            !(message.bytes instanceof Uint8Array) ||
            message.bytes.length === 0 ||
            message.bytes.length > OGG_CODEC_MAX_BYTES
        ) {
            throw new Error('Invalid or concurrent codec output');
        }
        active.writing = true;
        input.writer.checkCancelled?.();
        await input.writer.write(message.bytes);
        if (closed || pending !== active) {
            return;
        }
        input.writer.checkCancelled?.();
        active.writing = false;
        active.sequence += 1;
        worker.postMessage({
            session,
            id: active.id,
            kind: 'ack',
            sequence: message.sequence,
        } satisfies OggCodecWorkerRequest);
    };
    const onMessage = (event: MessageEvent<OggCodecWorkerResponse>) => {
        void receive(event.data).catch(close);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    input.signal?.addEventListener('abort', onAbort, { once: true });

    const request = (message: OggCodecWorkerCommand, transfers: Transferable[] = []) => {
        if (closed) {
            return Promise.reject(new Error('Codec Worker closed'));
        }
        if (pending) {
            return Promise.reject(new Error('Concurrent codec request'));
        }
        return new Promise<void>((resolve, reject) => {
            const id = ++nextId;
            pending = { id, sequence: 0, writing: false, resolve, reject };
            try {
                worker.postMessage({ ...message, session, id }, transfers);
            } catch (error) {
                close(error);
            }
        });
    };
    try {
        await request({ kind: 'init', codec: input.codec, sampleRate: input.sampleRate, channels: input.channels });
    } catch (error) {
        close(error);
        throw error;
    }
    return {
        encode: (channels: readonly Float32Array[]) => {
            const owned = channels.map((channel) => new Float32Array(channel));
            return request(
                { kind: 'encode', channels: owned },
                owned.map((channel) => channel.buffer)
            );
        },
        flush: () => request({ kind: 'flush' }),
        close,
    };
}
