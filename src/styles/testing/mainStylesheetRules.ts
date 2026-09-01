/**
 * Read the rules `main.css` actually ships, for specs that must observe them.
 *
 * Specs run in jsdom, which loads no stylesheet. A class name on a rendered
 * element is inert there, so asserting the class says nothing about whether a
 * rule still styles it — deleting or renaming the rule leaves such an assertion
 * green. Matching the shipped selector against the rendered DOM closes that gap.
 *
 * This is a scanner, not a CSS parser. It reports the rules it is sure of and
 * refuses the rest: a rule counts only when every block enclosing it is an
 * at-rule this file classifies. Anything else throws. That way an unread
 * construct costs a loud failure rather than a selector that looks fine and
 * describes something the browser never applies — which is the whole reason the
 * titlebar specs read the stylesheet instead of trusting a class name.
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
     * The conditional at-rules enclosing this rule, outermost first, and empty
     * when the rule applies wherever its selector matches.
     */
    readonly conditional: readonly string[];
};

/** Members apply exactly where their selectors match; the at-rule orders them. */
const TRANSPARENT_AT_RULES = new Set(['@layer']);

/** Members apply only while a query holds. */
const CONDITIONAL_AT_RULES = new Set(['@media', '@supports', '@container']);

/** Nested blocks are not style rules — a keyframe step is a point in time. */
const OPAQUE_AT_RULES = new Set(['@keyframes']);

type BlockKind = 'style' | 'transparent' | 'conditional' | 'opaque' | 'unread';

function kindOf(prelude: string): BlockKind {
    if (!prelude.startsWith('@')) {
        return 'style';
    }
    const atRule = (/^@[a-z-]+/iu.exec(prelude)?.[0] ?? '').toLowerCase();
    if (TRANSPARENT_AT_RULES.has(atRule)) {
        return 'transparent';
    }
    if (CONDITIONAL_AT_RULES.has(atRule)) {
        return 'conditional';
    }
    if (OPAQUE_AT_RULES.has(atRule)) {
        return 'opaque';
    }
    return 'unread';
}

const IMPORTANT = /\s*!important$/iu;

/**
 * Split a block into declarations. A value may itself contain a colon — a `url()`
 * scheme, say — so only the first one separates a declaration, and text carrying
 * none at all (an at-rule body such as `@apply`) is not a declaration. `!important`
 * changes which rule wins, not what the rule sets, so it is not part of the value.
 */
function declarationsOf(block: string): Declaration[] {
    return block
        .split(';')
        .map((text) => {
            const separator = text.indexOf(':');
            return separator === -1
                ? undefined
                : {
                      property: text.slice(0, separator).trim(),
                      value: text
                          .slice(separator + 1)
                          .trim()
                          .replace(IMPORTANT, ''),
                  };
        })
        .filter((declaration): declaration is Declaration => declaration !== undefined);
}

type OpenBlock = {
    readonly prelude: string;
    readonly kind: BlockKind;
    /** What the enclosing block had collected before this one opened. */
    readonly enclosingText: string;
};

/**
 * The style rules a stylesheet applies, in file order, each with the conditional
 * at-rules it sits under.
 *
 * A rule is reported only when every block above it is an at-rule classified
 * here. A rule nested in another style rule is refused rather than reported
 * without its ancestor, because reading that ancestor back out means resolving
 * `&`, which is a parser's job and not this file's. A rule under an at-rule this
 * file does not classify is refused too: it may apply always, sometimes, or in
 * one frame of a transition, and guessing is what a guard must not do. A
 * classified at-rule whose nested blocks are not rules contributes nothing.
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
            // Kept verbatim, quotes and escapes included: a quoted run is part
            // of the selector or value it sits in — `[role='menu']`, say — and
            // only its braces and comment markers must go uninterpreted.
            let cursor = index + 1;
            while (cursor < css.length && css[cursor] !== character) {
                cursor += css[cursor] === '\\' ? 2 : 1;
            }
            const close = Math.min(cursor + 1, css.length);
            text += css.slice(index, close);
            index = close;
            continue;
        }

        if (character === '{') {
            // A prelude runs from the end of the last declaration, so a block
            // nested under one keeps the enclosing rule's own text intact.
            const boundary = text.lastIndexOf(';');
            const prelude = text.slice(boundary + 1).trim();
            open.push({ prelude, kind: kindOf(prelude), enclosingText: text.slice(0, boundary + 1) });
            text = '';
            index += 1;
            continue;
        }

        if (character === '}') {
            const block = open.pop();
            if (block === undefined) {
                throw new Error('stylesheet closes a block that was never opened');
            }
            if (block.kind === 'style') {
                rules.push(...reportable(block, text, open));
            }
            text = block.enclosingText;
            index += 1;
            continue;
        }

        text += character;
        index += 1;
    }

    if (open.length > 0) {
        throw new Error(`stylesheet ends inside ${String(open.length)} unclosed block(s)`);
    }
    return rules;
}

/** The closed style rule, as one rule or as none — or a refusal to read it. */
function reportable(block: OpenBlock, body: string, enclosing: readonly OpenBlock[]): StylesheetRule[] {
    if (enclosing.some(({ kind }) => kind === 'opaque')) {
        return [];
    }
    const unread = enclosing.find(({ kind }) => kind === 'style' || kind === 'unread');
    if (unread !== undefined) {
        throw new Error(`stylesheet nests ${block.prelude} inside ${unread.prelude}, which this scanner does not read`);
    }
    if (block.prelude === '') {
        throw new Error(`stylesheet rule parsed with no selector: {${body.trim()}}`);
    }
    return [
        {
            selector: block.prelude,
            declarations: declarationsOf(body),
            conditional: enclosing.filter(({ kind }) => kind === 'conditional').map(({ prelude }) => prelude),
        },
    ];
}

/**
 * Every rule `main.css` ships. A stylesheet this size yielding none means the
 * scan lost its place rather than that the file holds none, so it throws.
 */
export function stylesheetRules(): readonly StylesheetRule[] {
    const rules = parseStylesheet(mainStylesheet);
    if (rules.length === 0) {
        throw new Error('main.css parsed to no rules at all');
    }
    return rules;
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
