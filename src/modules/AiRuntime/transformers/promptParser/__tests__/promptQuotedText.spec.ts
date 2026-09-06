import { describe, expect, it } from 'vitest';

import { maskQuotedTextContents, scanPromptQuotedText } from '../promptQuotedText';

describe('prompt quoted text', () => {
    it.each([
        ['"Selected Clip"', '"             "'],
        ['“Selected Clip”', '“             ”'],
        ["'Drummer's Selected Clip'", "'                       '"],
        ['‘Drummer’s Selected Clip’', '‘                       ’'],
    ])('masks the complete quoted contents of %s', (value, expected) => {
        const result = scanPromptQuotedText(value);

        expect(result).toEqual({ complete: true, maskedText: expected });
        expect(result.maskedText.length).toBe(value.length);
        expect(result.maskedText).not.toContain('Selected Clip');
    });

    it('keeps an unquoted apostrophe as ordinary name content', () => {
        expect(maskQuotedTextContents("rename Drummer's Cut")).toBe("rename Drummer's Cut");
    });

    it('preserves UTF-16 offsets while masking astral quoted content', () => {
        const value = 'rename “🎸 Selected Clip” to Intro';
        const result = scanPromptQuotedText(value);

        expect(result.complete).toBe(true);
        expect(result.maskedText.length).toBe(value.length);
        expect(result.maskedText.indexOf(' to Intro')).toBe(value.indexOf(' to Intro'));
    });

    it('reports an incomplete quoted span while keeping its contents masked', () => {
        const result = scanPromptQuotedText('leave ‘Drummer’s Selected Clip unchanged');

        expect(result.complete).toBe(false);
        expect(result.maskedText).toHaveLength('leave ‘Drummer’s Selected Clip unchanged'.length);
        expect(result.maskedText).toMatch(/^leave ‘ +$/u);
    });
});
