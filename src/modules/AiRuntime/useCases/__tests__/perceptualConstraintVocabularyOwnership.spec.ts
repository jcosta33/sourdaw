import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    type Expression,
    type Node,
    createSourceFile,
    forEachChild,
    isCallExpression,
    isIdentifier,
    isNewExpression,
    isNoSubstitutionTemplateLiteral,
    isPropertyAccessExpression,
    isStringLiteral,
    isTaggedTemplateExpression,
    isTemplateExpression,
    isVariableDeclaration,
    ScriptKind,
    ScriptTarget,
} from 'typescript';
import { describe, expect, it } from 'vitest';

/** The files that own the constraint readers' vocabulary: every word a reader matches is listed in one of them. */
const VOCABULARY_OWNERS = new Set(['constraintClauseWords.ts', 'constraintDirections.ts', 'words.ts']);
const FOLDER = resolve(fileURLToPath(import.meta.url), '../../perceptualConstraints');

/** Every `String.raw` template, regex literal, and literal first argument of `new RegExp(…)`: the pattern sources. */
const PATTERN_SOURCE =
    /String\.raw`(?<raw>(?:\\.|[^`\\])*)`|new RegExp\(\s*(?:'(?<single>(?:\\.|[^'\\])*)'|"(?<double>(?:\\.|[^"\\])*)"|`(?<template>(?:\\.|[^`\\])*)`)|(?<=[(,=]\s*)\/(?<literal>(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+)\/[dgimsuvy]*/gu;
/**
 * What a pattern source spells without naming a word: an interpolation, an escape with its braced
 * argument ("\b", "\s", "\p{L}"), and a group or backreference name ("(?<object>", "\k<object>").
 */
const NOT_A_WORD = /\$\{[^}]*\}|\\[pPuk]\{[^}]*\}|\\k<[^>]*>|\\./gu;
const GROUP_NAME = /\(\?<(?![=!])[^>]*>/gu;
const SPELLED_WORD = /\p{L}{2,}/gu;

function patternSources(source: string): string[] {
    return Array.from(source.matchAll(PATTERN_SOURCE), (match) => {
        const { raw, single, double, template, literal } = match.groups ?? {};
        return raw ?? single ?? double ?? template ?? literal ?? '';
    });
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
 * `new RegExp(…)`, and every interpolation of a `String.raw` template.
 */
function patternInputs(node: Node): Expression[] {
    const inputs: Expression[] = [];
    if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === 'words') {
        inputs.push(...node.arguments);
    }
    if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'RegExp') {
        inputs.push(...(node.arguments ?? []).slice(0, 1));
    }
    if (isTaggedTemplateExpression(node) && isStringRaw(node.tag) && isTemplateExpression(node.template)) {
        inputs.push(...node.template.templateSpans.map((span) => span.expression));
    }
    forEachChild(node, (child) => {
        inputs.push(...patternInputs(child));
    });
    return inputs;
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
    const file = createSourceFile('reader.ts', source, ScriptTarget.Latest, true, ScriptKind.TS);
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
    if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'RegExp') {
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
    ])('finds a string reaching a pattern: %s', (_name, source, expected) => {
        expect(reachedStrings(source)).toEqual(expected);
    });
});
