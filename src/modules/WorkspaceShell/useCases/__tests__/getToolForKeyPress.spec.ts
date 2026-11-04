import { describe, expect, it } from 'vitest';

import { getToolForKeyPress } from '../getToolForKeyPress';

const plain = { mod: false, alt: false };

describe('getToolForKeyPress', () => {
    it.each([
        ['s', 'select'],
        ['c', 'cut'],
        ['d', 'draw'],
        ['b', 'draw'],
        ['t', 'stretch'],
        ['e', 'marquee'],
        ['1', 'select'],
        ['2', 'cut'],
        ['3', 'draw'],
        ['4', 'automation'],
        ['5', 'stretch'],
    ])('selects the tool for an unmodified %s', (key, tool) => {
        expect(getToolForKeyPress({ key, ...plain })).toBe(tool);
    });

    it.each([
        ['a', 'cycles automation visibility, not a tool'],
        ['6', 'has no tool'],
        ['S', 'is the shifted letter'],
        ['Enter', 'is not a tool key'],
    ])('returns null for %s, which %s', (key) => {
        expect(getToolForKeyPress({ key, ...plain })).toBeNull();
    });

    it.each([
        ['mod', { mod: true, alt: false }],
        ['alt', { mod: false, alt: true }],
    ])('returns null for every tool key pressed with %s', (_name, modifiers) => {
        const toolKeys = ['s', 'c', 'd', 'b', 't', 'e', '1', '2', '3', '4', '5'];

        expect(toolKeys.map((key) => getToolForKeyPress({ key, ...modifiers }))).toStrictEqual(
            toolKeys.map(() => null)
        );
    });
});
