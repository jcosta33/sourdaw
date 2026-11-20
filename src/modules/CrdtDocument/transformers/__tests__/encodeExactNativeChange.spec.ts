import { createHash } from 'node:crypto';

import { change, clone, decodeChange, encodeChange, from, getChanges } from '@automerge/automerge';
import { describe, expect, it, vi } from 'vitest';

import { assertExactNativeChangeEncoding, encodeExactNativeChange } from '../encodeExactNativeChange';

function negativeZeroChange() {
    const actor = 'aaaaaaaaaaaaaaaa';
    const source = from({ value: 1 }, { actor });
    const updated = change(clone(source, { actor }), { time: -7 }, (draft) => {
        draft.value = 0.5;
    });
    const original = getChanges(source, updated)[0];
    if (!original) {
        throw new Error('Expected one native change');
    }
    const { hash: _hash, ops, ...header } = decodeChange(original);
    const operation = ops[0];
    if (operation?.datatype !== 'float64') {
        throw new Error('Expected one native float operation');
    }
    return { ...header, ops: [{ ...operation, value: -0 }] };
}

describe('exact native change encoding', () => {
    it('preserves a negative IEEE-754 zero and checksums the repaired bytes', () => {
        const input = negativeZeroChange();
        const workerCodec = { encodeChange, decodeChange: vi.fn(decodeChange) };
        const { bytes, hash } = encodeExactNativeChange(input, workerCodec);
        const decoded = decodeChange(bytes);
        expect(decoded.ops[0]?.value).toBe(-0);
        const checksum = createHash('sha256').update(bytes.subarray(8)).digest();
        expect([...bytes.subarray(4, 8)]).toEqual([...checksum.subarray(0, 4)]);
        expect(hash).toBe(checksum.toString('hex'));
        expect(workerCodec.decodeChange).toHaveBeenCalledTimes(2);
        expect(workerCodec.decodeChange).toHaveNthReturnedWith(1, decodeChange(encodeChange(input)));
        expect(workerCodec.decodeChange).toHaveNthReturnedWith(2, decoded);
        const { hash: _repairedHash, ...canonical } = decoded;
        const codec = { encodeChange: vi.fn(encodeChange), decodeChange: vi.fn(decodeChange) };
        expect(assertExactNativeChangeEncoding(canonical, bytes, codec)).toBe('exact-float-repair');
        expect(codec.encodeChange).toHaveBeenCalledOnce();
        expect(codec.decodeChange).toHaveBeenCalledOnce();
    });

    it('rejects a Worker encoding when its repaired output still decodes to the wrong float', () => {
        const workerDecode = vi
            .fn(decodeChange)
            .mockImplementationOnce(decodeChange)
            .mockImplementationOnce((bytes) => {
                const decoded = decodeChange(bytes);
                const [operation, ...remainingOps] = decoded.ops;
                if (operation?.datatype !== 'float64' || !Object.is(operation.value, -0)) {
                    throw new Error('Expected the Worker to decode the repaired float');
                }
                return { ...decoded, ops: [{ ...operation, value: 0 }, ...remainingOps] };
            });
        expect(() =>
            encodeExactNativeChange(negativeZeroChange(), { encodeChange, decodeChange: workerDecode })
        ).toThrow('Native change did not preserve exact floats');
        expect(workerDecode).toHaveBeenCalledTimes(2);
    });

    it('rejects different bytes even after restoring the exact float', () => {
        const { bytes } = encodeExactNativeChange(negativeZeroChange(), { encodeChange, decodeChange });
        const { hash: _hash, ...canonical } = decodeChange(bytes);
        const codec = {
            encodeChange: (input: Parameters<typeof encodeChange>[0]) =>
                encodeChange({ ...input, time: input.time + 1 }),
            decodeChange: vi.fn(decodeChange),
        };
        expect(() => assertExactNativeChangeEncoding(canonical, bytes, codec)).toThrow(
            'Native sequence contains unsupported opaque metadata'
        );
        expect(codec.decodeChange).toHaveBeenCalledOnce();
        const repairedBytes = codec.decodeChange.mock.calls[0]?.[0];
        if (!repairedBytes) {
            throw new Error('Expected the bytes passed through float repair');
        }
        const repaired = decodeChange(repairedBytes);
        expect(repaired.ops[0]?.value).toBe(-0);
        expect(repaired.time).toBe(canonical.time + 1);
    });

    it('proves identical canonical bytes with one encode and no redundant decode', () => {
        const source = from({ value: 1 }, { actor: 'aaaaaaaaaaaaaaaa' });
        const updated = change(clone(source), (draft) => {
            draft.value = 2;
        });
        const bytes = getChanges(source, updated)[0];
        if (!bytes) {
            throw new Error('Expected one native change');
        }
        const { hash: _hash, ...canonical } = decodeChange(bytes);
        const codec = { encodeChange: vi.fn(encodeChange), decodeChange: vi.fn(decodeChange) };
        expect(assertExactNativeChangeEncoding(canonical, Uint8Array.from(bytes), codec)).toBe('byte-equal');
        expect(codec.encodeChange).toHaveBeenCalledOnce();
        expect(codec.decodeChange).not.toHaveBeenCalled();
    });
});
