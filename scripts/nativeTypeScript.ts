import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API, DiagnosticCategory, type Diagnostic } from 'typescript/unstable/sync';

import * as ast from 'typescript/unstable/ast';
import type { SourceFile } from 'typescript/unstable/ast';

export type NativeSource = { path: string; text: string };
export type NativeParse = { source: SourceFile; diagnostics: readonly Diagnostic[] };
export type NativeSourceReader = {
    read: (path: string, text: string) => NativeParse;
    readMany: (sources: readonly NativeSource[]) => ReadonlyMap<string, NativeParse>;
};

/** Owns one native syntax project for the synchronous operation, including every failure path. */
export function withNativeSourceReader<T>(operation: (reader: NativeSourceReader) => T): T {
    const root = process.cwd();
    const config = resolve(root, '.agents-native-source', randomUUID(), 'tsconfig.json');
    const virtual = createVirtualFileSystem({ [config]: '{}' });
    const write = virtual.writeFile;
    const remove = virtual.removeFile;
    if (!write || !remove) {
        throw new Error('Native TypeScript virtual filesystem is not writable');
    }
    const api = new API({ cwd: root, fs: virtual });
    let previousPaths: string[] = [];
    let snapshot: ReturnType<API['updateSnapshot']> | undefined;
    const readMany = (sources: readonly NativeSource[]): ReadonlyMap<string, NativeParse> => {
        const entries = new Map(sources.map((source) => [resolve(root, source.path), source]));
        if (entries.size !== sources.length) {
            throw new Error('Native source batch contains duplicate paths');
        }
        snapshot?.dispose();
        for (const path of previousPaths) {
            remove(path);
        }
        for (const [path, source] of entries) {
            write(path, source.text);
        }
        write(
            config,
            JSON.stringify({
                compilerOptions: {
                    allowJs: true,
                    checkJs: false,
                    jsx: 'preserve',
                    target: 'esnext',
                    module: 'esnext',
                    noCheck: true,
                    noEmit: true,
                    noLib: true,
                    noResolve: true,
                    resolveJsonModule: true,
                    moduleResolution: 'bundler',
                    types: [],
                },
                files: [...entries.keys()],
            })
        );
        const currentPaths = [...entries.keys()];
        snapshot = api.updateSnapshot({
            openProjects: previousPaths.length === 0 ? [config] : undefined,
            fileChanges: {
                changed: [config, ...currentPaths.filter((path) => previousPaths.includes(path))],
                created: currentPaths.filter((path) => !previousPaths.includes(path)),
                deleted: previousPaths.filter((path) => !entries.has(path)),
            },
        });
        previousPaths = currentPaths;
        const project = snapshot.getProject(config);
        if (!project) {
            throw new Error('Native syntax project did not open');
        }
        const errors = [
            ...project.program.getConfigFileParsingDiagnostics(),
            ...project.program.getProgramDiagnostics(),
        ].filter((item) => item.category === DiagnosticCategory.Error);
        if (errors.length > 0) {
            throw new Error(errors.map((item) => item.text).join('\n'));
        }
        const parsed = new Map<string, NativeParse>();
        for (const [path, input] of entries) {
            const source = project.program.getSourceFile(path);
            if (!source || source.text !== input.text) {
                throw new Error(`Native source snapshot did not preserve input: ${path}`);
            }
            parsed.set(input.path, { source, diagnostics: project.program.getSyntacticDiagnostics(path) });
        }
        return parsed;
    };
    try {
        return operation({
            readMany,
            read: (path, text) => {
                const parsed = readMany([{ path, text }]).get(path);
                if (!parsed) {
                    throw new Error(`Native source snapshot omitted ${path}`);
                }
                return parsed;
            },
        });
    } finally {
        try {
            snapshot?.dispose();
        } finally {
            api.close();
        }
    }
}

/** ASTs own their binary buffer and decoder; these values require no live checker or service. */
export function readNativeSources(sources: readonly NativeSource[]): ReadonlyMap<string, NativeParse> {
    return sources.length === 0
        ? new Map<string, NativeParse>()
        : withNativeSourceReader((reader) => reader.readMany(sources));
}

export function readNativeSource(path: string, text: string): NativeParse {
    return withNativeSourceReader((reader) => reader.read(path, text));
}

export function requireNativeSyntax(parsed: NativeParse): SourceFile {
    const errors = parsed.diagnostics.filter((item) => item.category === DiagnosticCategory.Error);
    if (errors.length > 0) {
        throw new Error(`Source does not parse: ${errors.map((item) => item.text).join('\n')}`);
    }
    return parsed.source;
}

/** Resolves project-owned config and optional virtual probe inputs within one genuine native project. */
export function withNativeConfiguredProject<T>(
    configPath: string,
    sources: readonly NativeSource[],
    operation: (project: import('typescript/unstable/sync').Project) => T
): T {
    const rootConfig = resolve(configPath);
    const config = sources.length > 0 ? resolve(rootConfig, '..', `.native-probe-${randomUUID()}.json`) : rootConfig;
    const content = new Map(sources.map((source) => [resolve(source.path), source.text]));
    if (sources.length > 0) {
        content.set(config, JSON.stringify({ extends: rootConfig, files: [...content.keys()], include: [] }));
    }
    const api = new API({
        fs: {
            readFile: (path) => content.get(resolve(path)),
            fileExists: (path) => (content.has(resolve(path)) ? true : undefined),
        },
    });
    let snapshot: ReturnType<API['updateSnapshot']> | undefined;
    try {
        snapshot = api.updateSnapshot({ openProjects: [config] });
        const project = snapshot.getProject(config);
        if (!project) throw new Error(`Native project did not open: ${rootConfig}`);
        const errors = [
            ...project.program.getConfigFileParsingDiagnostics(),
            ...project.program.getProgramDiagnostics(),
        ].filter((item) => item.category === DiagnosticCategory.Error);
        if (errors.length > 0) throw new Error(errors.map((item) => item.text).join('\n'));
        return operation(project);
    } finally {
        try {
            snapshot?.dispose();
        } finally {
            api.close();
        }
    }
}

export function readNativeConfiguration(configPath: string) {
    const api = new API();
    let snapshot: ReturnType<API['updateSnapshot']> | undefined;
    try {
        const path = resolve(configPath);
        const parsed = api.parseConfigFile(path);
        snapshot = api.updateSnapshot({ openProjects: [path] });
        const project = snapshot.getProject(path);
        if (!project) throw new Error(`Native project did not open: ${path}`);
        const errors = [
            ...project.program.getConfigFileParsingDiagnostics(),
            ...project.program.getProgramDiagnostics(),
        ].filter((item) => item.category === DiagnosticCategory.Error);
        if (errors.length > 0) throw new Error(errors.map((item) => item.text).join('\n'));
        return parsed;
    } finally {
        try {
            snapshot?.dispose();
        } finally {
            api.close();
        }
    }
}

/** Removes comment trivia only from gaps outside real native lexical leaves, retaining UTF-16 offsets. */
export function stripNativeComments(source: SourceFile): string {
    const protectedRanges: Array<{ start: number; end: number }> = [];
    const visit = (node: import('typescript/unstable/ast').Node): void => {
        let hasChild = false;
        node.forEachChild((child) => {
            hasChild = true;
            visit(child);
        });
        if (!hasChild && node.kind <= ast.SyntaxKind.LastToken) {
            protectedRanges.push({ start: node.getStart(source), end: node.end });
        }
    };
    visit(source);
    protectedRanges.sort((left, right) => left.start - right.start);
    const comments: Array<{ start: number; end: number }> = [];
    const inspect = (start: number, end: number): void => {
        if (!source.text.slice(start, end).includes('/')) return;
        const scanner = ast.createScanner(false, ast.LanguageVariant.Standard, source.text, start, end - start);
        for (let kind = scanner.scan(); kind !== ast.SyntaxKind.EndOfFile; kind = scanner.scan()) {
            if (kind === ast.SyntaxKind.SingleLineCommentTrivia || kind === ast.SyntaxKind.MultiLineCommentTrivia) {
                comments.push({ start: scanner.getTokenStart(), end: scanner.getTokenEnd() });
            }
        }
    };
    let cursor = 0;
    for (const range of protectedRanges) {
        if (range.start < cursor || range.end < range.start) throw new Error('Native lexical leaf ranges overlap');
        inspect(cursor, range.start);
        cursor = range.end;
    }
    inspect(cursor, source.text.length);
    const pieces: string[] = [];
    cursor = 0;
    for (const comment of comments) {
        pieces.push(source.text.slice(cursor, comment.start));
        pieces.push(source.text.slice(comment.start, comment.end).replace(/[^\r\n]/g, ' '));
        cursor = comment.end;
    }
    pieces.push(source.text.slice(cursor));
    return pieces.join('');
}

/** Scope-local checker for a supplied fixture; no ambient project or filesystem mutation participates. */
export function withNativeCheckedSource<T>(
    path: string,
    text: string,
    operation: (source: SourceFile, checker: import('typescript/unstable/sync').Checker) => T
): T {
    const file = resolve(path);
    const config = resolve(file, '..', `.native-check-${randomUUID()}.json`);
    const files = createVirtualFileSystem({
        [file]: text,
        [config]: JSON.stringify({
            compilerOptions: { noLib: true, noResolve: true, types: [], target: 'esnext' },
            files: [file],
        }),
    });
    const api = new API({ fs: files });
    let snapshot: ReturnType<API['updateSnapshot']> | undefined;
    try {
        snapshot = api.updateSnapshot({ openProjects: [config] });
        const project = snapshot.getProject(config);
        const source = project?.program.getSourceFile(file);
        if (!project || !source || source.text !== text) throw new Error(`Native fixture did not parse: ${path}`);
        requireNativeSyntax({ source, diagnostics: project.program.getSyntacticDiagnostics(file) });
        return operation(source, project.checker);
    } finally {
        try {
            snapshot?.dispose();
        } finally {
            api.close();
        }
    }
}

/** JSONC remains JSON with comment trivia and trailing commas, rather than a JSON5 admission widening. */
export function parseNativeJsonc(path: string, text: string): unknown {
    const source = requireNativeSyntax(readNativeSource(path, text));
    const stripped = stripNativeComments(source);
    const scanner = ast.createScanner(true, ast.LanguageVariant.Standard, stripped);
    const commas: number[] = [];
    let comma: number | undefined;
    for (let kind = scanner.scan(); kind !== ast.SyntaxKind.EndOfFile; kind = scanner.scan()) {
        if (
            comma !== undefined &&
            (kind === ast.SyntaxKind.CloseBraceToken || kind === ast.SyntaxKind.CloseBracketToken)
        )
            commas.push(comma);
        comma = kind === ast.SyntaxKind.CommaToken ? scanner.getTokenStart() : undefined;
    }
    const characters = stripped.split('');
    for (const position of commas) characters[position] = ' ';
    return JSON.parse(characters.join('').replace(/^\uFEFF/, ''));
}
