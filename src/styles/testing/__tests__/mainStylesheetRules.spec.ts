import { describe, it, expect } from 'vitest';

import { parseStylesheet, selectorDeclaring, selectorDeclaringIn, stylesheetRules } from '../mainStylesheetRules';

const DRAG_RULE = '.desktop-titlebar-region { app-region: drag; }';

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

    it('records the query a rule sits behind rather than reading it as top level', () => {
        const gated = parseStylesheet(`@media (display-mode: window-controls-overlay) { ${DRAG_RULE} }`);
        const ungated = parseStylesheet(DRAG_RULE);

        // Both stylesheets carry the same rule text. Only one of them applies.
        expect(gated.map((rule) => rule.selector)).toEqual(ungated.map((rule) => rule.selector));
        expect(gated[0]?.conditional).toEqual(['@media (display-mode: window-controls-overlay)']);
        expect(ungated[0]?.conditional).toEqual([]);
    });

    it('refuses a rule that only applies while a query holds', () => {
        const gated = parseStylesheet(`@supports (app-region: drag) { ${DRAG_RULE} }`);

        expect(() => selectorDeclaringIn(gated, 'app-region', 'drag')).toThrow('applies only sometimes');
        expect(selectorDeclaringIn(parseStylesheet(DRAG_RULE), 'app-region', 'drag')).toBe('.desktop-titlebar-region');
    });

    it('treats a cascade layer as context rather than as a condition', () => {
        // `@layer` orders the cascade; its rules apply. Refusing them would put
        // every base-layer rule out of reach for no reason.
        const layered = parseStylesheet(`@layer base { ${DRAG_RULE} }`);

        expect(layered[0]?.conditional).toEqual([]);
        expect(selectorDeclaringIn(layered, 'app-region', 'drag')).toBe('.desktop-titlebar-region');
    });

    it('reports an at-rule body as its member rules and never as a rule itself', () => {
        const utility = parseStylesheet('@utility daw-seam { background: red; }');

        expect(utility).toEqual([]);
    });
});
