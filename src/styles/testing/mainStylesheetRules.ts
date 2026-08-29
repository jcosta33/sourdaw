/**
 * Read the rules `main.css` actually ships, for specs that must observe them.
 *
 * Specs run in jsdom, which loads no stylesheet. A class name on a rendered
 * element is inert there, so asserting the class says nothing about whether a
 * rule still styles it — deleting or renaming the rule leaves such an assertion
 * green. Matching the shipped selector against the rendered DOM closes that gap.
 *
 * Reading a rule's text is not enough on its own: a rule inside a query that
 * never holds is text that never applies, which is the exact shape of the defect
 * the titlebar specs exist to catch. So the stylesheet is scanned rather than
 * pattern-matched, and every rule carries the conditions it was found under.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read from disk rather than imported: the test runner stubs stylesheet
// imports to an empty string, `?raw` included.
const mainStylesheet = readFileSync(resolve(process.cwd(), 'src/styles/main.css'), 'utf8');

type Declaration = {
    readonly property: string;
    readonly value: string;
};

export type StylesheetRule = {
    readonly selector: string;
    readonly declarations: readonly Declaration[];
    /**
     * The conditional group at-rules enclosing this rule, outermost first, and
     * empty when the rule applies wherever its selector matches.
     */
    readonly conditional: readonly string[];
};

/**
 * At-rules whose body applies only while a query holds. `@layer` is absent on
 * purpose: it orders the cascade, it does not decide whether a rule applies.
 */
const CONDITIONAL_GROUP_AT_RULES = new Set(['@media', '@supports', '@container', '@document']);

const isConditionalGroup = (prelude: string): boolean =>
    CONDITIONAL_GROUP_AT_RULES.has((/^@[a-z-]+/iu.exec(prelude)?.[0] ?? '').toLowerCase());

/**
 * Split a block into declarations. A value may itself contain a colon — a `url()`
 * scheme, say — so only the first one separates a declaration, and text carrying
 * none at all (an at-rule body such as `@apply`) is not a declaration.
 */
function declarationsOf(block: string): Declaration[] {
    return block
        .split(';')
        .map((text) => {
            const separator = text.indexOf(':');
            return separator === -1
                ? undefined
                : { property: text.slice(0, separator).trim(), value: text.slice(separator + 1).trim() };
        })
        .filter((declaration): declaration is Declaration => declaration !== undefined);
}

type OpenBlock = {
    readonly prelude: string;
    /** What the enclosing block had collected before this one opened. */
    readonly enclosingText: string;
};

/**
 * Every style rule in a stylesheet, in file order, each with the conditional
 * group at-rules it sits under.
 *
 * Nesting is tracked rather than skipped: a rule inside `@media`, `@supports` or
 * `@container` is reported with that query, not as a top-level rule. An at-rule
 * is a context, never a rule of its own, so `@layer` and `@utility` contribute
 * their members and nothing else. A style rule that comes out with no selector
 * means the scan lost it, and throws here rather than at a caller passing `''`
 * to `matches` or `closest`.
 */
export function parseStylesheet(css: string): readonly StylesheetRule[] {
    const rules: StylesheetRule[] = [];
    const open: OpenBlock[] = [];
    let text = '';
    let index = 0;

    while (index < css.length) {
        const character = css[index] ?? '';

        if (css.startsWith('/*', index)) {
            const end = css.indexOf('*/', index + 2);
            index = end === -1 ? css.length : end + 2;
            continue;
        }

        if (character === '"' || character === "'") {
            // Kept verbatim, quotes included: a quoted run is part of the
            // selector or the value it sits in — `[role='menu']`, say — and only
            // its braces and comment markers must go uninterpreted.
            const end = css.indexOf(character, index + 1);
            const close = end === -1 ? css.length : end + 1;
            text += css.slice(index, close);
            index = close;
            continue;
        }

        if (character === '{') {
            // A prelude runs from the end of the last declaration, so a block
            // nested under one keeps the enclosing rule's own text intact.
            const boundary = text.lastIndexOf(';');
            open.push({ prelude: text.slice(boundary + 1).trim(), enclosingText: text.slice(0, boundary + 1) });
            text = '';
            index += 1;
            continue;
        }

        if (character === '}') {
            const block = open.pop();
            if (block === undefined) {
                throw new Error('stylesheet closes a block that was never opened');
            }
            if (!block.prelude.startsWith('@')) {
                if (block.prelude === '') {
                    throw new Error(`stylesheet rule parsed with no selector: {${text.trim()}}`);
                }
                rules.push({
                    selector: block.prelude,
                    declarations: declarationsOf(text),
                    conditional: open.map(({ prelude }) => prelude).filter(isConditionalGroup),
                });
            }
            text = block.enclosingText;
            index += 1;
            continue;
        }

        text += character;
        index += 1;
    }

    return rules;
}

/** Every rule `main.css` ships, as `parseStylesheet` reads them. */
export function stylesheetRules(): readonly StylesheetRule[] {
    return parseStylesheet(mainStylesheet);
}

/**
 * The selector list of the one rule setting a property to a value, ready to pass
 * to `matches` or `closest`.
 *
 * The property and the value are matched as parsed declarations rather than as
 * text, so `app-region` never answers for `-webkit-app-region`. An absent rule,
 * a second matching one, and a rule gated behind a query all throw: a caller
 * asserting against "the rule that opts elements out of the drag region" gets a
 * rule that applies, or an error. It never gets an unrelated selector that
 * happens to sit earlier in the file, a selector string the DOM will reject, or
 * a rule whose text is in the stylesheet but whose effect is not on the page.
 */
export function selectorDeclaringIn(rules: readonly StylesheetRule[], property: string, value: string): string {
    const matches = rules.filter((rule) =>
        rule.declarations.some((declaration) => declaration.property === property && declaration.value === value)
    );

    const gated = matches.filter((rule) => rule.conditional.length > 0);
    if (gated.length > 0) {
        const conditions = gated.map((rule) => rule.conditional.join(' > ')).join(', ');
        throw new Error(
            `stylesheet declares ${property}: ${value} inside ${conditions}, so the rule applies only sometimes`
        );
    }

    const [only] = matches;
    if (only === undefined) {
        throw new Error(`stylesheet carries no rule declaring ${property}: ${value}`);
    }
    if (matches.length > 1) {
        const selectors = matches.map((rule) => rule.selector).join(' / ');
        throw new Error(`stylesheet declares ${property}: ${value} on ${String(matches.length)} rules: ${selectors}`);
    }
    return only.selector;
}

/** {@link selectorDeclaringIn}, over the rules `main.css` ships. */
export function selectorDeclaring(property: string, value: string): string {
    return selectorDeclaringIn(stylesheetRules(), property, value);
}
