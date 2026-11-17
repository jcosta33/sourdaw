import { createHash } from 'node:crypto';

import { change, clone, decodeChange, encodeChange, from, getChanges } from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { encodeExactNativeChange } from '../encodeExactNativeChange';

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
    });
});
