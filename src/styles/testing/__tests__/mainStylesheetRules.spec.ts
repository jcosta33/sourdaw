import { describe, it, expect } from 'vitest';

import { parseStylesheet, selectorDeclaring, selectorDeclaringIn, stylesheetRules } from '../mainStylesheetRules';

const DRAG_RULE = '.desktop-titlebar-region { app-region: drag; }';

describe('mainStylesheetRules', () => {
    it('ships warm scrollbar highlights in the renderer stylesheet', () => {
        const declarationsFor = (selector: string) =>
            stylesheetRules()
                .filter((rule) => rule.selector === selector)
                .flatMap((rule) => rule.declarations);

        expect(declarationsFor('*')).toContainEqual({
            property: 'scrollbar-color',
            value: 'rgba(255, 249, 242, 0.12) transparent',
        });
        expect(declarationsFor('::-webkit-scrollbar-thumb')).toContainEqual({
            property: 'background',
            value: 'rgba(255, 249, 242, 0.12)',
        });
        expect(declarationsFor('::-webkit-scrollbar-thumb:hover')).toContainEqual({
            property: 'background',
            value: 'rgba(255, 249, 242, 0.25)',
        });
    });

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

    it('refuses a nested rule rather than reporting it without its ancestor', () => {
        // Reported bare, `:is(button)` answers `closest` for any button on the
        // page — the assertion it feeds means "inside the titlebar row".
        const nested = '.desktop-titlebar-region { :is(button) { app-region: no-drag; } }';

        expect(() => parseStylesheet(nested)).toThrow('which this scanner does not read');
    });

    it('refuses a rule under an at-rule it cannot classify', () => {
        // `@scope` narrows where the rule applies and `@starting-style` narrows
        // when. Reading either as unconditional is the failure this guards.
        expect(() => parseStylesheet(`@scope (.titlebar) { ${DRAG_RULE} }`)).toThrow(
            'which this scanner does not read'
        );
        expect(() => parseStylesheet(`@starting-style { ${DRAG_RULE} }`)).toThrow('which this scanner does not read');
    });

    it('reads an animation step as a moment rather than as a rule', () => {
        const animated = parseStylesheet(
            `@keyframes slide { from { margin-left: env(titlebar-area-x, 0px); } 50% { margin-left: 0; } } ${DRAG_RULE}`
        );

        // A step is neither a selector nor a second declaration of the property.
        expect(animated.map((rule) => rule.selector)).toEqual(['.desktop-titlebar-region']);
    });

    it('reads a value the same whether or not it claims importance', () => {
        const important = parseStylesheet('.desktop-titlebar-region { app-region: drag !important; }');

        // `!important` decides which rule wins, not what the rule sets.
        expect(selectorDeclaringIn(important, 'app-region', 'drag')).toBe('.desktop-titlebar-region');
    });

    it('reads past an escaped quote instead of running off the end of the file', () => {
        const escaped = `.quoted::before { content: "\\""; } ${DRAG_RULE}`;

        // An unterminated string swallows every rule after it, and a scan that
        // ends mid-block must say so rather than return what it managed to read.
        expect(parseStylesheet(escaped).map((rule) => rule.selector)).toEqual([
            '.quoted::before',
            '.desktop-titlebar-region',
        ]);
        expect(() => parseStylesheet('.desktop-titlebar-region { app-region: drag;')).toThrow('unclosed block');
    });
});
