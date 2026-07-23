import { describe, it, expect } from 'vitest';

import { parseMetadataXml } from '../parseMetadataXml';

describe('parseMetadataXml', () => {
    it('extracts Title, Artist, and Comment from valid XML', () => {
        const xml = '<Project><Title>My Song</Title><Artist>Jane</Artist><Comment>Mix v2</Comment></Project>';
        const meta = parseMetadataXml(xml);
        expect(meta.title).toBe('My Song');
        expect(meta.artist).toBe('Jane');
        expect(meta.comment).toBe('Mix v2');
    });

    it('returns empty strings for missing fields', () => {
        const xml = '<Project><Title>Only Title</Title></Project>';
        const meta = parseMetadataXml(xml);
        expect(meta.title).toBe('Only Title');
        expect(meta.artist).toBe('');
        expect(meta.comment).toBe('');
    });

    it('returns empty defaults for an empty root element', () => {
        const meta = parseMetadataXml('<Project />');
        expect(meta).toEqual({ title: '', artist: '', comment: '' });
    });

    it('returns empty defaults for invalid XML', () => {
        const meta = parseMetadataXml('<<<not xml>>>');
        expect(meta).toEqual({ title: '', artist: '', comment: '' });
    });

    it('trims whitespace from extracted text', () => {
        const xml = '<Project><Title>  Spaced  </Title></Project>';
        expect(parseMetadataXml(xml).title).toBe('Spaced');
    });

    it('handles fields with empty text content', () => {
        const xml = '<Project><Title></Title><Artist></Artist></Project>';
        const meta = parseMetadataXml(xml);
        expect(meta.title).toBe('');
        expect(meta.artist).toBe('');
    });
});
