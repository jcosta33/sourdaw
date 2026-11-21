import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    type Expression,
    type NewExpression,
    type Node,
    createSourceFile,
    forEachChild,
    isArrayLiteralExpression,
    isCallExpression,
    isIdentifier,
    isNewExpression,
    isNoSubstitutionTemplateLiteral,
    isPropertyAccessExpression,
    isRegularExpressionLiteral,
    isStringLiteral,
    isTaggedTemplateExpression,
    isTemplateExpression,
    isVariableDeclaration,
    type SourceFile,
    ScriptKind,
    ScriptTarget,
} from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The files that own the constraint readers' vocabulary. Every word a reader file spells where it builds
 * a pattern is held to be in one of them: the text of a `String.raw` template, a regex literal and the
 * literal first argument of `new RegExp(…)`, and every string literal reaching `words(…)`, `new RegExp(…)`,
 * a `String.raw` interpolation, or a list built in place and compared by `.includes(…)` or `.has(…)`
 * (`['louder'].includes(word)`, `new Set(['louder']).has(word)`). A named set or list compared by
 * `.includes`, `.has` or `===` is not read: nothing in its text tells a word list from a set of type tags
 * ('audio', 'tracks'), so such a list stays a reviewer's to place in its owner.
 */
const VOCABULARY_OWNERS = new Set(['constraintClauseWords.ts', 'constraintDirections.ts', 'words.ts']);
const FOLDER = resolve(fileURLToPath(import.meta.url), '../../perceptualConstraints');
/** The membership tests a list built in place is compared by. */
const MEMBERSHIP_TESTS = new Set(['includes', 'has']);

/**
 * What a pattern source spells without naming a word: an interpolation, an escape with its braced
 * argument ("\b", "\s", "\p{L}"), and a group or backreference name ("(?<object>", "\k<object>").
 */
const NOT_A_WORD = /\$\{[^}]*\}|\\[pPuk]\{[^}]*\}|\\k<[^>]*>|\\./gu;
const GROUP_NAME = /\(\?<(?![=!])[^>]*>/gu;
const SPELLED_WORD = /\p{L}{2,}/gu;

function parse(source: string): SourceFile {
    return createSourceFile('reader.ts', source, ScriptTarget.Latest, true, ScriptKind.TS);
}

/** A literal's text as written, between its delimiters, so an escape reads as the pattern reads it. */
function writtenText(node: Node): string {
    return node.getText().slice(1, -1);
}

/** Whether the node is `new RegExp(…)`. */
function isNewRegExp(node: Node): node is NewExpression {
    return isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'RegExp';
}

/** The source a node spells as a pattern: a raw template, a regex literal or a `RegExp`'s literal source. */
function patternSource(node: Node): string | undefined {
    if (isTaggedTemplateExpression(node) && isStringRaw(node.tag)) {
        return writtenText(node.template);
    }
    if (isRegularExpressionLiteral(node)) {
        return node.text.slice(1, node.text.lastIndexOf('/'));
    }
    const [first] = isNewRegExp(node) ? (node.arguments ?? []) : [];
    const isLiteral =
        first !== undefined &&
        (isStringLiteral(first) || isNoSubstitutionTemplateLiteral(first) || isTemplateExpression(first));
    return isLiteral ? writtenText(first) : undefined;
}

/** Every pattern source a file spells, wherever it stands. */
function patternSources(source: string): string[] {
    const sources: string[] = [];
    const pending: Node[] = [parse(source)];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        const pattern = patternSource(node);
        if (pattern !== undefined) {
            sources.push(pattern);
        }
        forEachChild(node, (child) => {
            pending.push(child);
        });
    }
    return sources;
}

function spelledWords(pattern: string): string[] {
    const bare = pattern.replaceAll(NOT_A_WORD, ' ').replaceAll(GROUP_NAME, ' ');
    return Array.from(bare.matchAll(SPELLED_WORD), (match) => match[0]);
}

/** Whether the node is `String.raw`, the tag every raw pattern source is written with. */
function isStringRaw(node: Node): boolean {
    return (
        isPropertyAccessExpression(node) &&
        isIdentifier(node.expression) &&
        node.expression.text === 'String' &&
        node.name.text === 'raw'
    );
}

/**
 * The expressions a file builds a pattern from: every argument of `words(…)`, the first argument of
 * `new RegExp(…)`, every interpolation of a `String.raw` template, and a list built in place that a
 * membership test compares against.
 */
function patternInputs(node: Node): Expression[] {
    const inputs: Expression[] = [];
    if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === 'words') {
        inputs.push(...node.arguments);
    }
    if (isNewRegExp(node)) {
        inputs.push(...(node.arguments ?? []).slice(0, 1));
    }
    const listed = builtInPlaceList(node);
    if (listed !== undefined) {
        inputs.push(listed);
    }
    if (isTaggedTemplateExpression(node) && isStringRaw(node.tag) && isTemplateExpression(node.template)) {
        inputs.push(...node.template.templateSpans.map((span) => span.expression));
    }
    forEachChild(node, (child) => {
        inputs.push(...patternInputs(child));
    });
    return inputs;
}

/** The receiver of `.includes(…)` or `.has(…)` when it is a list or set built in place. */
function builtInPlaceList(node: Node): Expression | undefined {
    if (!isCallExpression(node) || !isPropertyAccessExpression(node.expression)) {
        return undefined;
    }
    if (!MEMBERSHIP_TESTS.has(node.expression.name.text)) {
        return undefined;
    }
    const receiver = node.expression.expression;
    const isSetInPlace =
        isNewExpression(receiver) && isIdentifier(receiver.expression) && receiver.expression.text === 'Set';
    return isArrayLiteralExpression(receiver) || isSetInPlace ? receiver : undefined;
}

/** Every variable the file declares by name, with the expressions it is initialized from. */
function declarations(node: Node, found = new Map<string, Expression[]>()): Map<string, Expression[]> {
    if (isVariableDeclaration(node) && isIdentifier(node.name) && node.initializer !== undefined) {
        const earlier = found.get(node.name.text) ?? [];
        found.set(node.name.text, [...earlier, node.initializer]);
    }
    forEachChild(node, (child) => {
        declarations(child, found);
    });
    return found;
}

/**
 * The text of every string literal a pattern input reaches, directly or through the variables it reads,
 * however many hops away. A `String.raw` template's own text and a `RegExp`'s flags are left out: the
 * pattern-source scan reads the one, and the other spells no word.
 */
function reachedStrings(source: string): string[] {
    const file = parse(source);
    const declared = declarations(file);
    const visited = new Set<string>();
    const strings: string[] = [];
    const pending: Node[] = patternInputs(file);
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
            strings.push(node.text);
        } else if (isIdentifier(node)) {
            pending.push(...readVariable(node.text, declared, visited));
        } else {
            pending.push(...patternChildren(node));
        }
    }
    return strings.toReversed();
}

/** A variable's initializers the first time the scan reads it, and nothing after, so a cycle ends. */
function readVariable(name: string, declared: Map<string, Expression[]>, visited: Set<string>): Expression[] {
    if (visited.has(name)) {
        return [];
    }
    visited.add(name);
    return declared.get(name) ?? [];
}

/** The children a pattern input is read through: a raw template's interpolations and a `RegExp`'s source alone. */
function patternChildren(node: Node): Node[] {
    if (isTaggedTemplateExpression(node) && isStringRaw(node.tag)) {
        return isTemplateExpression(node.template) ? node.template.templateSpans.map((span) => span.expression) : [];
    }
    if (isNewRegExp(node)) {
        return (node.arguments ?? []).slice(0, 1);
    }
    const children: Node[] = [];
    forEachChild(node, (child) => {
        children.push(child);
    });
    return children;
}

function readerFiles(): string[] {
    return readdirSync(FOLDER).filter((file) => file.endsWith('.ts') && !VOCABULARY_OWNERS.has(file));
}

describe('perceptual constraint vocabulary ownership', () => {
    it('spells no word in a non-owner pattern source: every word is read through its owner', () => {
        const spelled = readerFiles().flatMap((file) => {
            const source = readFileSync(resolve(FOLDER, file), 'utf8');
            return patternSources(source).flatMap((pattern) =>
                spelledWords(pattern).map((word) => `${file}: “${word}” in ${pattern}`)
            );
        });

        expect(spelled).toEqual([]);
    });

    it('builds no pattern from a string a non-owner file spells: every word is read through its owner', () => {
        const spelled = readerFiles().flatMap((file) =>
            reachedStrings(readFileSync(resolve(FOLDER, file), 'utf8')).flatMap((text) =>
                Array.from(text.matchAll(SPELLED_WORD), (word) => `${file}: “${word[0]}” in '${text}'`)
            )
        );

        expect(spelled).toEqual([]);
    });

    it('reads the reader files and their pattern sources, so an empty result is not a blind scan', () => {
        const sources = readerFiles().flatMap((file) => patternSources(readFileSync(resolve(FOLDER, file), 'utf8')));

        expect(readerFiles()).toEqual(
            expect.arrayContaining(['compilePerceptualConstraints.ts', 'readHoldClauses.ts'])
        );
        expect(sources.length).toBeGreaterThan(30);
    });

    it.each([
        ['a spelled word in a raw source', 'const A = String.raw`${B}\\s+than\\b`;', ['than']],
        ['a spelled word in a RegExp string', "const A = new RegExp('at\\\\s+', 'u');", ['at']],
        ['a spelled word in a regex literal', 'const A = x.replace(/\\bon\\b/u, "");', ['on']],
        ['only regex constructs and names', 'const A = String.raw`(?<object>${B})\\p{L}+\\b\\s*(?=${C})`;', []],
        ['a one-letter literal', 'const A = x.replace(/s$/u, "");', []],
        ['a regex literal a function returns', 'function a(s: string) {\n    return /louder/u.test(s);\n}', ['louder']],
        ['a regex literal a condition tests', 'const A = /than/u.test(s) ? 1 : 2;', ['than']],
        ['a regex literal in a list', 'const A = [/wider/u];', ['wider']],
    ])('finds %s', (_name, source, expected) => {
        expect(patternSources(source).flatMap(spelledWords)).toEqual(expected);
    });

    it.each([
        ['a word list built in place', "const A = words(['louder']);", ['louder']],
        ['a word constant a list reads', "const X = 'than';\nconst A = words([X]);", ['than']],
        [
            'a word reaching the builder through an object',
            "const T = 'dynamic';\nconst entries = [{ term: T }];\nconst A = words(entries.map((entry) => entry.term));",
            ['dynamic'],
        ],
        ['a word constant a raw source interpolates', "const X = 'at';\nconst A = String.raw`${X}\\s+`;", ['at']],
        ['a word constant a RegExp reads', "const X = 'on';\nconst A = new RegExp(X, 'iu');", ['on']],
        [
            'an imported word and the flags',
            "import { X } from './owner';\nconst A = new RegExp(words([X]), 'dgiu');",
            [],
        ],
        ['a word no pattern reads', "const reason = 'No measurement holds.';\nconst A = words([B]);", []],
        ['a word list compared in place', "const A = ['louder'].includes(word);", ['louder']],
        ['a word set compared in place', "const A = new Set(['wider']).has(word);", ['wider']],
        ['a word constant a list in place reads', "const X = 'than';\nconst A = [X].includes(word);", ['than']],
    ])('finds a string reaching a pattern: %s', (_name, source, expected) => {
        expect(reachedStrings(source)).toEqual(expected);
    });
});
