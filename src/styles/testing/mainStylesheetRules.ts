/**
 * Read the rules `main.css` actually ships, for specs that must observe them.
 *
 * Specs run in jsdom, which loads no stylesheet. A class name on a rendered
 * element is inert there, so asserting the class says nothing about whether a
 * rule still styles it — deleting or renaming the rule leaves such an assertion
 * green. Matching the shipped selector against the rendered DOM closes that gap.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read from disk rather than imported: the test runner stubs stylesheet
// imports to an empty string, `?raw` included.
const mainStylesheet = readFileSync(resolve(process.cwd(), 'src/styles/main.css'), 'utf8');

/** One rule: the selector list before its block, and the block's own text. */
const RULE = /([^{}/*]+)\{([^{}]*)\}/gu;

type Declaration = {
    readonly property: string;
    readonly value: string;
};

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

/**
 * The selector list of the one rule in `main.css` setting a property to a value,
 * ready to pass to `matches` or `closest`.
 *
 * The property and the value are matched as parsed declarations rather than as
 * text, so `app-region` never answers for `-webkit-app-region`. Both an absent
 * rule and a second matching one throw: a caller asserting against "the rule
 * that opts elements out of the drag region" gets that rule or an error, never
 * an unrelated selector that happens to sit earlier in the file.
 */
export function selectorDeclaring(property: string, value: string): string {
    const selectors = [...mainStylesheet.matchAll(RULE)]
        .filter(([, , block]) =>
            declarationsOf(block ?? '').some(
                (declaration) => declaration.property === property && declaration.value === value
            )
        )
        .map(([, selector]) => (selector ?? '').trim());

    const [only] = selectors;
    if (only === undefined) {
        throw new Error(`main.css carries no rule declaring ${property}: ${value}`);
    }
    if (selectors.length > 1) {
        throw new Error(
            `main.css declares ${property}: ${value} on ${String(selectors.length)} rules: ${selectors.join(' / ')}`
        );
    }
    return only;
}
