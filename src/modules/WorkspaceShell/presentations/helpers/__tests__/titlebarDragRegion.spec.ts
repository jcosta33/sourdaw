import { describe, it, expect } from 'vitest';

import { selectorDeclaring } from '#/styles/testing/mainStylesheetRules';

import { TITLEBAR_NO_DRAG_SELECTOR } from '../titlebarDragRegion';

/**
 * Two selectors differing only in how the formatter wrapped them are the same
 * selector. Whitespace inside a list collapses; the descendant space between
 * compounds is meaning, so it survives.
 */
const canonical = (selector: string): string =>
    selector
        .replaceAll(/\s+/gu, ' ')
        .replaceAll(/\(\s/gu, '(')
        .replaceAll(/\s\)/gu, ')')
        .replaceAll(/\s*,\s*/gu, ', ')
        .trim();

describe('titlebar drag region', () => {
    it('opts the same elements out of the drag region as the shipped stylesheet', () => {
        // The stylesheet and the double-click guard both decide what the row
        // hands its clicks back to. `main.css` cannot import the constant, so
        // this is what stops the two copies drifting apart.
        expect(canonical(selectorDeclaring('app-region', 'no-drag'))).toBe(canonical(TITLEBAR_NO_DRAG_SELECTOR));
    });
});
