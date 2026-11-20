import { describe, expect, it } from 'vitest';

import { maskQuotedLabels } from '../maskQuotedLabels';

describe('maskQuotedLabels', () => {
    it.each([
        ["Make 'em louder than the 'Keys' track", "Make 'em louder than the '    ' track"],
        ["Make the drums louder, 'cause the mix is dull", "Make the drums louder, 'cause the mix is dull"],
        ["'Keys'", "'    '"],
        ["the 'Lead Vocal' track", "the '          ' track"],
        ["don't touch Keys", "don't touch Keys"],
        ['"Keys"', '"    "'],
        ['‘Keys’ and “Lead”', '‘    ’ and “    ”'],
    ])('masks only real quotations in %s', (value, expected) => {
        expect(maskQuotedLabels(value)).toBe(expected);
    });
});
