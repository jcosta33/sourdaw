import { vi } from 'vitest';

import { type OggCodecWorkerRequest, type OggCodecWorkerResponse } from '../../../models/OggCodecWorkerProtocol';
import { installOggCodecWorker } from '../../../workers/oggCodecWorker';

/** Real codec/runtime and transferable ownership; only the Worker transport is in process. */
export class OggCodecTestWorker extends EventTarget {
    static instances: OggCodecTestWorker[] = [];
    requests: OggCodecWorkerRequest[] = [];
    terminations = 0;
    scope: Parameters<typeof installOggCodecWorker>[0];
    constructor() {
        super();
        OggCodecTestWorker.instances.push(this);
        this.scope = {
            onmessage: null,
            postMessage: (message, transfer) => {
                const copy = structuredClone(message, { transfer });
                // Node's clone belongs to its VM realm. A real Worker deserializes into
                // the receiver's realm; recreate that receiver view for jsdom callers.
                if (copy.kind === 'chunk') {
                    copy.bytes = new Uint8Array(copy.bytes);
                }
                queueMicrotask(() => {
                    if (!this.terminations) {
                        this.dispatchEvent(new MessageEvent('message', { data: copy }));
                    }
                });
            },
        };
        installOggCodecWorker(this.scope);
    }
    postMessage(message: OggCodecWorkerRequest, transfer: Transferable[] = []) {
        const copy = structuredClone(message, { transfer });
        if (copy.kind === 'encode') {
            copy.channels = copy.channels.map((channel) => new Float32Array(channel));
        }
        this.requests.push(copy);
        queueMicrotask(() => {
            if (!this.terminations) {
                this.scope.onmessage?.(new MessageEvent('message', { data: copy }));
            }
        });
    }
    terminate() {
        this.terminations += 1;
    }
    emit(message: OggCodecWorkerResponse) {
        this.dispatchEvent(new MessageEvent('message', { data: message }));
    }
}

export function useRealOggWorkerTransport() {
    OggCodecTestWorker.instances = [];
    vi.stubGlobal('Worker', OggCodecTestWorker);
}

export function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

export function toneSource(rate = 48000, channels: 1 | 2 = 2, length = rate + 137) {
    const pcm = Array.from({ length: channels }, (_, channel) =>
        Float32Array.from(
            { length },
            (_, frame) => 0.2 * Math.sin((2 * Math.PI * (channel ? 733 : 431) * frame) / rate + channel * 0.37)
        )
    );
    return {
        length,
        sampleRate: rate,
        numberOfChannels: channels,
        samplePeak: 0.2,
        getChannelData: (channel: number) => pcm[channel]!,
        pcm,
    };
}

export function joinBytes(chunks: readonly Uint8Array[]) {
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}

export function oggPages(bytes: Uint8Array) {
    const pages: { flags: number; granule: bigint; body: Uint8Array }[] = [];
    let offset = 0;
    while (offset < bytes.length) {
        if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== 'OggS') {
            throw new Error('Invalid Ogg page');
        }
        const segments = bytes[offset + 26]!;
        const bodyLength = bytes.subarray(offset + 27, offset + 27 + segments).reduce((sum, n) => sum + n, 0);
        const bodyStart = offset + 27 + segments;
        pages.push({
            flags: bytes[offset + 5]!,
            granule: new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset).getBigUint64(6, true),
            body: bytes.slice(bodyStart, bodyStart + bodyLength),
        });
        offset = bodyStart + bodyLength;
    }
    if (offset !== bytes.length) {
        throw new Error('Truncated Ogg page');
    }
    return pages;
}
