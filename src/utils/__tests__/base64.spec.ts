import { describe, it, expect } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../base64';

describe('base64', () => {
    it('should round-trip arbitrary bytes', () => {
        const original = new Uint8Array([0, 127, 255, 10, 32]);
        const encoded = bytesToBase64(original);
        const decoded = base64ToBytes(encoded);
        expect(decoded).toEqual(original);
    });
});
