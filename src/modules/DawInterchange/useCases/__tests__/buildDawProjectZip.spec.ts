import { describe, expect, it } from 'vitest';

import { buildDawProjectZip } from '../buildDawProjectZip';

describe('buildDawProjectZip', () => {
    it('produces a non-empty Uint8Array (valid zip output)', () => {
        const result = buildDawProjectZip({
            projectXml: '<project/>',
            metadataXml: '<metadata/>',
            audioFiles: new Map(),
        });

        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBeGreaterThan(0);
        // PK header = 0x50 0x4B (zip magic bytes).
        expect(result[0]).toBe(0x50);
        expect(result[1]).toBe(0x4b);
    });

    it('includes both project.xml and metadata.xml in the archive', () => {
        const result = buildDawProjectZip({
            projectXml: '<project id="test"/>',
            metadataXml: '<metadata title="Song"/>',
            audioFiles: new Map(),
        });

        // The raw XML strings should appear somewhere in the uncompressed zip
        // (level 0 = store mode, no compression — content is verbatim).
        const asText = new TextDecoder().decode(result);
        expect(asText).toContain('<project id="test"/>');
        expect(asText).toContain('<metadata title="Song"/>');
    });

    it('includes audio files from the map with their path keys', () => {
        const audioData = new TextEncoder().encode('RIFF\x00\x00\x00\x00WAVE');
        const result = buildDawProjectZip({
            projectXml: '<project/>',
            metadataXml: '<metadata/>',
            audioFiles: new Map([['audio/track1.wav', audioData]]),
        });

        const asText = new TextDecoder().decode(result);
        // The file path is stored in the zip entry header.
        expect(asText).toContain('audio/track1.wav');
    });

    it('produces identical output for identical input (deterministic)', () => {
        const input = {
            projectXml: '<project/>',
            metadataXml: '<metadata/>',
            audioFiles: new Map([['a.wav', new Uint8Array([1, 2, 3])]]),
        };

        const first = buildDawProjectZip(input);
        const second = buildDawProjectZip(input);

        expect(Array.from(first)).toEqual(Array.from(second));
    });

    it('produces different output when content differs', () => {
        const resultA = buildDawProjectZip({
            projectXml: '<project version="1"/>',
            metadataXml: '<metadata/>',
            audioFiles: new Map(),
        });
        const resultB = buildDawProjectZip({
            projectXml: '<project version="2"/>',
            metadataXml: '<metadata/>',
            audioFiles: new Map(),
        });

        expect(Array.from(resultA)).not.toEqual(Array.from(resultB));
    });

    it('handles an empty audio files map', () => {
        const result = buildDawProjectZip({
            projectXml: '<project/>',
            metadataXml: '<metadata/>',
            audioFiles: new Map(),
        });

        // Still a valid zip with just the two XML files.
        expect(result.length).toBeGreaterThan(0);
        expect(result[0]).toBe(0x50);
    });

    it('handles multiple audio files', () => {
        const result = buildDawProjectZip({
            projectXml: '<project/>',
            metadataXml: '<metadata/>',
            audioFiles: new Map([
                ['audio/kick.wav', new Uint8Array([1])],
                ['audio/snare.wav', new Uint8Array([2])],
                ['audio/hat.wav', new Uint8Array([3])],
            ]),
        });

        const asText = new TextDecoder().decode(result);
        expect(asText).toContain('audio/kick.wav');
        expect(asText).toContain('audio/snare.wav');
        expect(asText).toContain('audio/hat.wav');
    });
});
