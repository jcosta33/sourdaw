import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { runGuardedZipWorkerRequest } from '../runGuardedZipWorkerRequest';

function corruptFirstPayload(archive: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    const result = archive.slice();
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    const nameBytes = view.getUint16(26, true);
    const extraBytes = view.getUint16(28, true);
    const payloadOffset = 30 + nameBytes + extraBytes;
    result[payloadOffset] = (result[payloadOffset] ?? 0) ^ 0xff;
    return result;
}

describe('runGuardedZipWorkerRequest', () => {
    it('extracts the only matching entry through the guarded archive path', () => {
        const expected = new Uint8Array([1, 2, 3, 4]);
        const archive = zipSync({ 'model/weights.onnx': expected, 'model/license.txt': new Uint8Array([9]) });

        const result = runGuardedZipWorkerRequest({ bytes: archive.buffer, suffix: '.onnx' });

        expect(result.path).toBe('model/weights.onnx');
        expect(result.data).toEqual(expected);
    });

    it('rejects archives without a matching entry', () => {
        const archive = zipSync({ 'model/readme.txt': new Uint8Array([1]) });

        expect(() => runGuardedZipWorkerRequest({ bytes: archive.buffer, suffix: '.onnx' })).toThrow(
            'Archive contains no .onnx entry'
        );
    });

    it('rejects ambiguous matching entries before selecting payload data', () => {
        const archive = corruptFirstPayload(
            zipSync({
                'model/first.onnx': new Uint8Array([1]),
                'model/second.onnx': new Uint8Array([2]),
            })
        );

        expect(() => runGuardedZipWorkerRequest({ bytes: archive.buffer, suffix: '.onnx' })).toThrow(
            'Archive contains multiple .onnx entries'
        );
    });

    it('inherits the shared extractor path-safety checks', () => {
        const archive = zipSync({ '../weights.onnx': new Uint8Array([1]) });

        expect(() => runGuardedZipWorkerRequest({ bytes: archive.buffer, suffix: '.onnx' })).toThrow(
            'Unsafe archive path'
        );
    });
});
