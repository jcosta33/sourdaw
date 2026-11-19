import { createHash } from 'node:crypto';

import { change, clone, decodeChange, encodeChange, from, getChanges } from '@automerge/automerge';
import { describe, expect, it, vi } from 'vitest';

import { assertExactNativeChangeEncoding, encodeExactNativeChange } from '../encodeExactNativeChange';

describe('exact native change encoding', () => {
    it('preserves a negative IEEE-754 zero and checksums the repaired bytes', () => {
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
        const input = { ...header, ops: [{ ...operation, value: -0 }] };
        const { bytes, hash } = encodeExactNativeChange(input, { encodeChange, decodeChange });
        const decoded = decodeChange(bytes);
        expect(decoded.ops[0]?.value).toBe(-0);
        const checksum = createHash('sha256').update(bytes.subarray(8)).digest();
        expect([...bytes.subarray(4, 8)]).toEqual([...checksum.subarray(0, 4)]);
        expect(hash).toBe(checksum.toString('hex'));
        const { hash: _repairedHash, ...canonical } = decoded;
        const codec = { encodeChange: vi.fn(encodeChange), decodeChange: vi.fn(decodeChange) };
        expect(assertExactNativeChangeEncoding(canonical, bytes, codec)).toBe('exact-float-repair');
        expect(codec.encodeChange).toHaveBeenCalledOnce();
        expect(codec.decodeChange).toHaveBeenCalledTimes(2);
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
