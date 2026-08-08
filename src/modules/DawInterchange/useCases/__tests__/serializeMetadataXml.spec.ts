import { describe, expect, it } from 'vitest';

import { serializeMetadataXml } from '../serializeMetadataXml';

describe('serializeMetadataXml', () => {
    it('wraps title, artist, and comment in the MetaData structure', () => {
        const result = serializeMetadataXml({ title: 'Song', artist: 'Artist', comment: 'Notes' });

        expect(result).toContain('<Title>Song</Title>');
        expect(result).toContain('<Artist>Artist</Artist>');
        expect(result).toContain('<Comment>Notes</Comment>');
        expect(result).toContain('<MetaData>');
        expect(result).toContain('</MetaData>');
    });

    it('starts with the XML declaration', () => {
        const result = serializeMetadataXml({ title: '', artist: '', comment: '' });

        expect(result.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    });

    it('escapes ampersands in all fields', () => {
        const result = serializeMetadataXml({ title: 'A & B', artist: 'C & D', comment: 'E & F' });

        expect(result).toContain('<Title>A &amp; B</Title>');
        expect(result).toContain('<Artist>C &amp; D</Artist>');
        expect(result).toContain('<Comment>E &amp; F</Comment>');
        // Raw unescaped ampersand must not appear in the field content.
        expect(result).not.toMatch(/<Title>[^<]*&[^a]/);
    });

    it('escapes angle brackets', () => {
        const result = serializeMetadataXml({ title: '<tag>', artist: 'a>b', comment: 'c<d' });

        expect(result).toContain('<Title>&lt;tag&gt;</Title>');
        expect(result).toContain('<Artist>a&gt;b</Artist>');
        expect(result).toContain('<Comment>c&lt;d</Comment>');
    });

    it('escapes quotes and apostrophes', () => {
        const result = serializeMetadataXml({
            title: 'say "hi"',
            artist: "it's",
            comment: `both 'n "`,
        });

        expect(result).toContain('<Title>say &quot;hi&quot;</Title>');
        expect(result).toContain('<Artist>it&apos;s</Artist>');
        expect(result).toContain('<Comment>both &apos;n &quot;</Comment>');
    });

    it('handles empty strings', () => {
        const result = serializeMetadataXml({ title: '', artist: '', comment: '' });

        expect(result).toContain('<Title></Title>');
        expect(result).toContain('<Artist></Artist>');
        expect(result).toContain('<Comment></Comment>');
    });
});
