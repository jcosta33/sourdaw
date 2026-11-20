import { describe, expect, it } from 'vitest';

import { maskQuotedLabels } from '../maskQuotedLabels';

describe('maskQuotedLabels', () => {
    it.each([
        ["Make 'em louder than the 'Keys' track", "Make 'em louder than the '    ' track"],
        ["Make the drums louder, 'cause the mix is dull", "Make the drums louder, 'cause the mix is dull"],
        ["rock 'n' roll the bass", "rock ' ' roll the bass"],
        ["Make the 'Round Robin' track louder", "Make the '           ' track louder"],
        ["Make the 'N' track louder", "Make the ' ' track louder"],
        [
            "Add a track called 'Till Dawn and Dusk' and mute the drums",
            "Add a track called '                  ' and mute the drums",
        ],
        ["Make the 'Round' track louder", "Make the '     ' track louder"],
        ["Make the 'Kay' track and the 'Keys' track louder", "Make the '   ' track and the '    ' track louder"],
        ["Don't make 'em louder than the 'Keys' track", "Don't make 'em louder than the '    ' track"],
        ["Make 'em louder than 'Keys'", "Make 'em louder than '    '"],
        ["'Keys'", "'    '"],
        ["the 'Lead Vocal' track", "the '          ' track"],
        ["don't touch Keys", "don't touch Keys"],
        ['"Keys"', '"    "'],
        ['‘Keys’ and “Lead”', '‘    ’ and “    ”'],
    ])('masks only real quotations in %s', (value, expected) => {
        expect(maskQuotedLabels(value)).toBe(expected);
    });
});
