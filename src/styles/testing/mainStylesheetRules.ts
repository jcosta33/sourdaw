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

/** One rule: the selector list before its block, and the declarations inside. */
const RULE = /([^{}/*]+)\{([^{}]*)\}/gu;

/**
 * The selector list `main.css` attaches one declaration to, ready to pass to
 * `matches` or `closest`. Throws when no rule carries the declaration, so a
 * deleted or renamed rule fails its caller instead of quietly matching nothing.
 */
export function selectorDeclaring(declaration: string): string {
    for (const [, selector, declarations] of mainStylesheet.matchAll(RULE)) {
        if (selector !== undefined && declarations?.includes(declaration) === true) {
            return selector.trim();
        }
    }
    throw new Error(`main.css carries no rule declaring ${declaration}`);
}
