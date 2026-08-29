import { describe, it, expect } from 'vitest';

import { selectorDeclaring, stylesheetRules } from '../mainStylesheetRules';

describe('mainStylesheetRules', () => {
    it('reads the universal selector as itself rather than losing it', () => {
        // `main.css` resets every element twice over — the base layer and the
        // Firefox scrollbar rule. A parser that treats `*` as punctuation drops
        // both selectors and hands back a rule nothing can be matched against.
        expect(stylesheetRules().map((rule) => rule.selector)).toContain('*');
    });

    it('resolves a declaration on a universal rule to a selector the DOM accepts', () => {
        const selector = selectorDeclaring('scrollbar-width', 'thin');

        expect(selector).toBe('*');
        // The empty string a lost selector would produce is not a valid
        // selector, and every caller here spends its answer on the DOM.
        expect(document.body.matches(selector)).toBe(true);
    });

    it('refuses a property its own vendor-prefixed spelling carries', () => {
        expect(() => selectorDeclaring('-region', 'drag')).toThrow('carries no rule declaring');
    });
});
