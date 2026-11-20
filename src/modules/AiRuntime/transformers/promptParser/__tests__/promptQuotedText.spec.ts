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

    it.each([
        ["Make 'em louder than the 'Keys' track", true, "Make 'em louder than the '    ' track"],
        ["Make the drums louder, 'cause the mix is dull", true, "Make the drums louder, 'cause the mix is dull"],
        ["rock 'n' roll the bass", true, "rock ' ' roll the bass"],
        ["'til the chorus, keep the vocal", true, "'til the chorus, keep the vocal"],
        ["make 'em brighter", true, "make 'em brighter"],
        ["Make 'Em louder", true, "Make 'Em louder"],
        ["'Keys'", true, "'    '"],
        ["the 'Lead Vocal' track", true, "the '          ' track"],
        ["the 'emerald' pad", true, "the '       ' pad"],
        ["don't touch the kick's tail on the drums' bus", true, "don't touch the kick's tail on the drums' bus"],
        ["'Keys", false, "'    "],
        ["'Til Dawn'", true, "'        '"],
        ["Make the 'Round Robin' track louder", true, "Make the '           ' track louder"],
        ["Make the 'N' track louder", true, "Make the ' ' track louder"],
        [
            "Add a track called 'Till Dawn and Dusk' and mute the drums",
            true,
            "Add a track called '                  ' and mute the drums",
        ],
        ["Make the 'Round' track louder", true, "Make the '     ' track louder"],
        ["Make the 'Kay' track and the 'Keys' track louder", true, "Make the '   ' track and the '    ' track louder"],
        ["Make 'em louder than 'Keys'", true, "Make 'em louder than '    '"],
        ["Make the 'Till' track louder", true, "Make the '    ' track louder"],
        ['"Til Dawn"', true, '"        "'],
        ['‘Til Dawn’', true, '‘        ’'],
    ])('reads a word-initial elision as part of the word in %s', (value, complete, expected) => {
        expect(scanPromptQuotedText(value)).toEqual({ complete, maskedText: expected });
    });
});
