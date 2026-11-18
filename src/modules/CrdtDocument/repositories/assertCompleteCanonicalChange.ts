import { decodeChange } from '@automerge/automerge';

/** One complete native change is admitted; a document or appended chunks never enter adoption. */
export function assertCompleteCanonicalChange(bytes: Uint8Array<ArrayBuffer>): void {
    if (
        bytes.length < 10 ||
        bytes[0] !== 0x85 ||
        bytes[1] !== 0x6f ||
        bytes[2] !== 0x4a ||
        bytes[3] !== 0x83 ||
        (bytes[8] !== 1 && bytes[8] !== 2)
    ) {
        throw new Error('Prospective mutation Worker returned an invalid change envelope');
    }
    let length = 0n;
    for (let index = 0; index < 10; index++) {
        const byte = bytes[9 + index];
        if (byte === undefined || (index === 9 && byte > 1)) {
            break;
        }
        length |= BigInt(byte & 0x7f) << BigInt(index * 7);
        if ((byte & 0x80) === 0) {
            if ((index > 0 && byte === 0) || length !== BigInt(bytes.length - 10 - index)) {
                break;
            }
            // Native insertion accepts a corrupt checksum; the public decoder
            // recomputes the change hash, including for compressed changes.
            const checksum = Array.from(bytes.subarray(4, 8), (value) => value.toString(16).padStart(2, '0')).join('');
            let hash: string;
            const started = performance.now();
            try {
                hash = decodeChange(bytes).hash;
            } finally {
                performance.measure('automerge-prospective-vendor-decode-task', {
                    start: started,
                    end: performance.now(),
                });
                performance.clearMeasures('automerge-prospective-vendor-decode-task');
            }
            if (!hash.startsWith(checksum)) {
                throw new Error('Prospective mutation Worker returned an invalid change checksum');
            }
            return;
        }
    }
    throw new Error('Prospective mutation Worker returned an invalid change length');
}
