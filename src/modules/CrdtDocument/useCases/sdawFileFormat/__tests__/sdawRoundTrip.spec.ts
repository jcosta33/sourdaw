import { describe, it, expect } from 'vitest';

import { decodeSdawFile } from '../decodeSdawFile';
import { encodeSdawFile } from '../encodeSdawFile';
import { SDAW_MAGIC, FORMAT_VERSION } from '../helpers';

import type { DocumentBundle } from '../../../models/CrdtDocumentTypes';

describe('SDAW file format encode/decode', () => {
    it('SDAW_MAGIC is 4 bytes', () => {
        expect(SDAW_MAGIC).toHaveLength(4);
        expect(new TextDecoder().decode(new Uint8Array(SDAW_MAGIC))).toBe('SDAW');
    });

    it('FORMAT_VERSION is positive', () => {
        expect(FORMAT_VERSION).toBeGreaterThan(0);
    });

    it('encode produces non-empty Uint8Array', () => {
        const bundle = new Map() as DocumentBundle;
        const encoded = encodeSdawFile(bundle);
        expect(encoded.length).toBeGreaterThanOrEqual(8);
    });

    it('encoded file starts with SDAW magic', () => {
        const bundle = new Map() as DocumentBundle;
        const encoded = encodeSdawFile(bundle);
        for (let i = 0; i < 4; i++) {
            expect(encoded[i]).toBe(SDAW_MAGIC[i]);
        }
    });

    it('round-trip empty bundle', () => {
        const bundle = new Map() as DocumentBundle;
        const encoded = encodeSdawFile(bundle);
        const decoded = decodeSdawFile(encoded);
        expect(decoded.size).toBe(0);
    });

    it('round-trip single document', () => {
        const bundle = new Map([['test-doc', new Uint8Array([1, 2, 3, 4, 5])]]) as DocumentBundle;
        const encoded = encodeSdawFile(bundle);
        const decoded = decodeSdawFile(encoded);
        expect(decoded.size).toBe(1);
        expect(decoded.get('test-doc')).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });

    it('round-trip multiple documents', () => {
        const bundle = new Map([
            ['doc-a', new Uint8Array([10, 20])],
            ['doc-b', new Uint8Array([30, 40, 50])],
        ]) as DocumentBundle;
        const encoded = encodeSdawFile(bundle);
        const decoded = decodeSdawFile(encoded);
        expect(decoded.size).toBe(2);
        expect(decoded.get('doc-a')).toEqual(new Uint8Array([10, 20]));
        expect(decoded.get('doc-b')).toEqual(new Uint8Array([30, 40, 50]));
    });

    it('round-trip preserves large binary data', () => {
        const large = new Uint8Array(10000);
        for (let i = 0; i < large.length; i++) {
            large[i] = i % 256;
        }
        const bundle = new Map([['large', large]]) as DocumentBundle;
        const encoded = encodeSdawFile(bundle);
        const decoded = decodeSdawFile(encoded);
        expect(decoded.get('large')?.length).toBe(10000);
    });

    it('round-trip preserves unicode docId', () => {
        const bundle = new Map([['doc-音楽-🎵', new Uint8Array([1])]]) as DocumentBundle;
        const encoded = encodeSdawFile(bundle);
        const decoded = decodeSdawFile(encoded);
        expect(decoded.get('doc-音楽-🎵')).toEqual(new Uint8Array([1]));
    });

    it('decode throws on too-short input', () => {
        expect(() => decodeSdawFile(new Uint8Array(4))).toThrow();
    });

    it('decode throws on wrong magic', () => {
        const bad = new Uint8Array([0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0]);
        expect(() => decodeSdawFile(bad)).toThrow();
    });
});
