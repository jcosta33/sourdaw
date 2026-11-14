// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as ast from 'typescript/unstable/ast';
import { describe, expect, it } from 'vitest';

import {
    readNativeSources,
    requireNativeSyntax,
    withNativeSourceReader,
    readNativeConfiguration,
    withNativeCheckedSource,
    parseNativeJsonc,
    stripNativeComments,
    type NativeSourceReader,
} from '../nativeTypeScript';

it('parses a real multi-file native batch and keeps detached AST text, parents and UTF-16 ranges', () => {
    const first = 'const label = "😀";\nexport const read = () => label;\n';
    const second = 'export const Panel = () => <section data-id="actual">text</section>;\n';
    const parsed = readNativeSources([
        { path: 'native-owner-first.ts', text: first },
        { path: 'native-owner-second.tsx', text: second },
    ]);
    const one = parsed.get('native-owner-first.ts');
    const two = parsed.get('native-owner-second.tsx');
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    if (!one || !two) throw new Error('native batch omitted source');
    const source = requireNativeSyntax(one);
    expect(source.text).toBe(first);
    const statement = source.statements[1];
    expect(statement?.getText(source)).toBe('export const read = () => label;');
    expect(statement?.parent).toBe(source);
    expect(source.getLineAndCharacterOfPosition(statement?.getStart(source) ?? -1)).toEqual({ line: 1, character: 0 });
    const tags: string[] = [];
    const visit = (node: ast.Node): void => {
        if (ast.isJsxOpeningElement(node)) tags.push(node.tagName.getText());
        node.forEachChild(visit);
    };
    visit(requireNativeSyntax(two));
    expect(tags).toEqual(['section']);
});

it('replaces same-path input in a later snapshot without changing an earlier detached AST', () => {
    withNativeSourceReader((reader) => {
        const first = requireNativeSyntax(reader.read('native-revision.ts', 'export const version = 1;'));
        const second = requireNativeSyntax(reader.read('native-revision.ts', 'export const version = 2;'));
        expect(first.statements[0]?.getText()).toBe('export const version = 1;');
        expect(second.statements[0]?.getText()).toBe('export const version = 2;');
    });
});

it('tracks created and deleted batch paths across real native snapshot replacements', () => {
    withNativeSourceReader((reader) => {
        const first = reader.readMany([{ path: 'native-created.ts', text: 'export const first = 1;' }]);
        const replacement = reader.readMany([
            { path: 'native-other.tsx', text: 'export const Panel = () => <div />;' },
        ]);
        expect([...replacement.keys()]).toEqual(['native-other.tsx']);
        const restored = reader.readMany([{ path: 'native-created.ts', text: 'export const first = 3;' }]);
        const previous = first.get('native-created.ts');
        const current = restored.get('native-created.ts');
        if (!previous || !current) throw new Error('Native snapshot omitted the recreated path');
        expect(requireNativeSyntax(previous).text).toBe('export const first = 1;');
        expect(requireNativeSyntax(current).text).toBe('export const first = 3;');
    });
});

it('refuses actual malformed native input instead of manufacturing an empty tree', () => {
    withNativeSourceReader((reader) => {
        const broken = reader.read('native-broken.ts', 'export const value = (');
        expect(() => requireNativeSyntax(broken)).toThrow('Source does not parse:');
        expect(requireNativeSyntax(reader.read('native-broken.ts', 'export const value = 3;')).statements).toHaveLength(
            1
        );
    });
});

describe('native service cleanup', () => {
    it.each([false, true])('closes the actual native channel after an operation (failure=%s)', (failure) => {
        const captured: NativeSourceReader[] = [];
        const operation = (): void => {
            withNativeSourceReader((reader) => {
                captured.push(reader);
                reader.read('native-scope.ts', 'export const value = 1;');
                if (failure) throw new Error('expected operation failure');
            });
        };
        if (failure) expect(operation).toThrow('expected operation failure');
        else expect(operation).not.toThrow();
        const reader = captured[0];
        if (!reader) throw new Error('native reader was not captured');
        expect(() => reader.read('native-scope.ts', 'export const value = 2;')).toThrow('SyncRpcChannel is closed');
    });

    it.each([false, true])('retires the actual checked-source checker after its scope (failure=%s)', (failure) => {
        const captured: Array<{ source: ast.SourceFile; checker: import('typescript/unstable/sync').Checker }> = [];
        const operation = (): void =>
            withNativeCheckedSource('native-check-lifetime.ts', 'export const value = 1;', (source, checker) => {
                captured.push({ source, checker });
                expect(checker.getTypeAtLocation(source.statements[0]!)).toBeDefined();
                if (failure) throw new Error('expected checker failure');
            });
        if (failure) expect(operation).toThrow('expected checker failure');
        else expect(operation).not.toThrow();
        const value = captured[0];
        if (!value) throw new Error('Native checker was not observed');
        expect(() => value.checker.getTypeAtLocation(value.source.statements[0]!)).toThrow(/closed|disposed/);
    });

    it('allows a Node process to exit after an operation fails with a live snapshot', () => {
        const helper = pathToFileURL(join(import.meta.dirname, '../nativeTypeScript.ts')).href;
        const result = spawnSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `
import { withNativeSourceReader } from ${JSON.stringify(helper)};
try {
    withNativeSourceReader((reader) => {
        reader.read('native-cleanup.ts', 'export const value = 1;');
        throw new Error('expected operation failure');
    });
    throw new Error('failure was swallowed');
} catch (error) {
    if (!(error instanceof Error) || error.message !== 'expected operation failure') throw error;
}
console.log('closed');
`,
            ],
            { encoding: 'utf8', timeout: 15_000 }
        );
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout.trim()).toBe('closed');
    }, 20_000);
});

it('observes actual native pathsBasePath provenance for own and inherited paths declarations', () => {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-config-origin-'));
    try {
        mkdirSync(join(root, 'config'));
        writeFileSync(join(root, 'input.ts'), 'export const input = true;');
        writeFileSync(
            join(root, 'tsconfig.json'),
            JSON.stringify({ compilerOptions: { paths: { '#/*': ['./src/*'] } }, files: ['input.ts'] })
        );
        expect(readNativeConfiguration(join(root, 'tsconfig.json')).options).toHaveProperty('pathsBasePath', root);
        writeFileSync(
            join(root, 'config/base.json'),
            JSON.stringify({ compilerOptions: { paths: { '#/*': ['./src/*'] } } })
        );
        writeFileSync(
            join(root, 'tsconfig.json'),
            JSON.stringify({ extends: './config/base.json', files: ['input.ts'] })
        );
        expect(readNativeConfiguration(join(root, 'tsconfig.json')).options).toHaveProperty(
            'pathsBasePath',
            join(root, 'config')
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

it('parses real JSONC without admitting JSON5-only keys, quotes or undefined values', () => {
    expect(parseNativeJsonc('native-config.json', '{ /* comment */ "rules": ["first",], }')).toEqual({
        rules: ['first'],
    });
    for (const text of ["{ 'key': 1 }", '{ key: 1 }', '{"key": undefined}']) {
        expect(() => parseNativeJsonc('native-invalid.json', text)).toThrow();
    }
});

it('strips real comments while preserving JSX text, regex and template lexical leaves and all offsets', () => {
    const text =
        'const regex = /\\/\\/literal/; const raw = `literal // text`; /* strip me */\nexport const Panel = () => <span>literal // text</span>; // strip too\n';
    const parsed = readNativeSources([{ path: 'native-comments.tsx', text }]).get('native-comments.tsx');
    if (!parsed) throw new Error('native comments fixture was omitted');
    const stripped = stripNativeComments(requireNativeSyntax(parsed));
    expect(stripped.length).toBe(text.length);
    expect(stripped).toContain('`literal // text`');
    expect(stripped).toContain('<span>literal // text</span>');
    expect(stripped).not.toContain('strip me');
    expect(stripped).not.toContain('strip too');
    expect(stripped.indexOf('export')).toBe(text.indexOf('export'));
});
