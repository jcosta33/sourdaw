import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
});
