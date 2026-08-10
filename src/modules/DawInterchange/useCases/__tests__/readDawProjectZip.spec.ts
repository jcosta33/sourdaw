import { zipSync } from 'fflate';
import { describe, it, expect } from 'vitest';

import { readDawProjectZip } from '../readDawProjectZip';

/**
 * Specs for readDawProjectZip. Zero existing spec coverage.
 * Uses fflate's zipSync to create real zip archives for testing.
 */

function makeZip(entries: Record<string, Uint8Array>): ArrayBuffer {
    return zipSync(entries).buffer;
}

function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

describe('readDawProjectZip — project.xml extraction', () => {
    it('extracts project.xml content', () => {
        const zip = makeZip({ 'project.xml': utf8('<Project/>') });
        const result = readDawProjectZip(zip);
        expect(result.projectXml).toBe('<Project/>');
    });

    it('matches project.xml case-insensitively (Project.xml)', () => {
        const zip = makeZip({ 'Project.xml': utf8('<Project/>') });
        const result = readDawProjectZip(zip);
        expect(result.projectXml).toBe('<Project/>');
    });

    it('matches project.xml with a leading slash (/project.xml)', () => {
        const zip = makeZip({ '/project.xml': utf8('<Project/>') });
        const result = readDawProjectZip(zip);
        expect(result.projectXml).toBe('<Project/>');
    });
});

describe('readDawProjectZip — missing project.xml', () => {
    it('throws with available entry list when project.xml is missing', () => {
        const zip = makeZip({ 'readme.txt': utf8('hello') });
        expect(() => readDawProjectZip(zip)).toThrow(/missing project\.xml/);
        expect(() => readDawProjectZip(zip)).toThrow(/readme\.txt/);
    });

    it('throws with <empty> when the archive has no entries', () => {
        const zip = makeZip({});
        expect(() => readDawProjectZip(zip)).toThrow(/<empty>/);
    });
});

describe('readDawProjectZip — metadata.xml', () => {
    it('extracts metadata.xml when present', () => {
        const zip = makeZip({
            'project.xml': utf8('<Project/>'),
            'metadata.xml': utf8('<Metadata/>'),
        });
        const result = readDawProjectZip(zip);
        expect(result.metadataXml).toBe('<Metadata/>');
    });

    it('falls back to Metadata.xml (capitalized)', () => {
        const zip = makeZip({
            'project.xml': utf8('<Project/>'),
            'Metadata.xml': utf8('<Meta/>'),
        });
        const result = readDawProjectZip(zip);
        expect(result.metadataXml).toBe('<Meta/>');
    });

    it('returns null when no metadata.xml is present', () => {
        const zip = makeZip({ 'project.xml': utf8('<Project/>') });
        const result = readDawProjectZip(zip);
        expect(result.metadataXml).toBeNull();
    });
});

describe('readDawProjectZip — audio assets', () => {
    it('extracts audio/ prefixed files', () => {
        const audioData = utf8('RIFF....');
        const zip = makeZip({
            'project.xml': utf8('<Project/>'),
            'audio/kick.wav': audioData,
        });
        const result = readDawProjectZip(zip);
        expect(result.audioAssets.has('audio/kick.wav')).toBe(true);
        const extracted = result.audioAssets.get('audio/kick.wav')!;
        expect(extracted.length).toBe(audioData.length);
        expect(Array.from(extracted)).toEqual(Array.from(audioData));
    });

    it('skips non-audio/ entries', () => {
        const zip = makeZip({
            'project.xml': utf8('<Project/>'),
            'readme.txt': utf8('hello'),
            'audio/snare.wav': utf8('RIFF....'),
        });
        const result = readDawProjectZip(zip);
        expect(result.audioAssets.size).toBe(1);
        expect(result.audioAssets.has('readme.txt')).toBe(false);
    });

    it('extracts multiple audio assets', () => {
        const zip = makeZip({
            'project.xml': utf8('<Project/>'),
            'audio/kick.wav': utf8('kick'),
            'audio/snare.wav': utf8('snare'),
            'audio/hat.wav': utf8('hat'),
        });
        const result = readDawProjectZip(zip);
        expect(result.audioAssets.size).toBe(3);
    });
});

describe('readDawProjectZip — UTF-8 BOM stripping', () => {
    it('strips a UTF-8 BOM prefix from project.xml', () => {
        const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
        const content = utf8('<Project/>');
        const withBom = new Uint8Array(bom.length + content.length);
        withBom.set(bom);
        withBom.set(content, bom.length);
        const zip = makeZip({ 'project.xml': withBom });
        const result = readDawProjectZip(zip);
        // BOM stripped — content starts with '<'.
        expect(result.projectXml).toBe('<Project/>');
        expect(result.projectXml.charCodeAt(0)).toBe(0x3c); // '<'
    });
});
