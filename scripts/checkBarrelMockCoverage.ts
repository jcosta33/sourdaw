#!/usr/bin/env node
/**
 * `pnpm check:barrel-mocks` — proves that no spec mocks a contract barrel while
 * omitting an export that spec's own module graph imports from it.
 *
 * Why this exists. A `vi.mock` of a contract barrel whose factory lists every
 * export by hand — no `...(await importOriginal())` — resolves any export added
 * to that barrel *later* to `undefined`. When the consumer renders it, every test
 * in the mocking spec file throws. #1392 is the worked example: `MissingMediaPanel`
 * was added to `Project/presentations/views` and mounted in `TransportBar`, and the
 * red landed in `TransportBar.spec.tsx` — a WorkspaceShell failure for a diff that
 * only touched Project. Focused specs on the changed files stay green, so nothing
 * short of the full suite catches it, and the full suite is exactly what an author
 * mid-change does not run.
 *
 * What it checks. For every `vi.mock('<contract barrel>', factory)` whose factory
 * does not spread `importOriginal`, the mocked keys must cover every name the
 * spec's transitive module graph imports from that barrel. Modules the spec also
 * mocks are not traversed — their real imports never happen. A spread factory is
 * additive by construction and is not checked.
 *
 * This is the static twin of what vitest raises at runtime ("No X export is defined
 * on the ... mock"), moved to the moment the export is added rather than the moment
 * some unrelated spec renders it, and it names both sides: the barrel that grew and
 * the spec that did not follow.
 *
 * How it can fail (ADR 0015).
 *
 *  1. **Mutation.** Delete any key from an exhaustive barrel-mock factory whose
 *     name the consumer imports — e.g. `MissingMediaPanel` in
 *     `WorkspaceShell/presentations/views/__tests__/TransportBar.spec.tsx` — and
 *     this reports it. Equivalently: add an export to a barrel, use it in a
 *     consumer, and every exhaustive mock of that barrel in that consumer's specs
 *     is reported.
 *  2. **Population from a registry, not a list.** The population is every `vi.mock`
 *     call parsed out of every spec under `src/`, and the required names come from
 *     the real import statements. Neither side is hand-maintained here, so a spec
 *     added tomorrow is covered without editing this file.
 *  3. **Planted broken fixtures.** `scripts/__tests__/checkBarrelMockCoverage.spec.ts`
 *     runs the analyzer against in-memory graphs that are deliberately wrong, so the
 *     "no violations" verdict is never reached by an extraction that has gone blind.
 *
 * Exit code 0 = every exhaustive contract-barrel mock covers what its graph uses,
 * 1 = at least one does not (with a per-violation report).
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repoRoot, 'src');

/**
 * The four contract-folder barrels (ADR 0006). A module's public surface is only
 * ever one of these, so this list is the population definition, not a sample.
 * `Common/` and `Supporting/` are the namespaced module groups.
 */
const allBarrelKinds = ['useCases', 'stores', 'events', 'presentations/views'] as const;

/**
 * What the gate fails on. `presentations/views` is the render-crash class: an
 * omitted view resolves to `undefined` and React throws for *every* test in the
 * mocking file, which is how a Project-only diff reds WorkspaceShell (#1392).
 * That class is at zero and this keeps it there.
 *
 * The other three degrade to `undefined is not a function` at call time, and they
 * are not at zero — `--all` reports 148 of them today. They are real latent debt
 * with the same root cause, but converting them is a separate, much larger change
 * than the one this gate shipped with, and a 148-row baseline that says nothing but
 * "pre-existing" is not an exemption table. `--all` keeps the number measurable so
 * the follow-up starts from a count rather than a guess.
 */
const gatedBarrelKinds: ReadonlyArray<(typeof allBarrelKinds)[number]> = ['presentations/views'];

function buildBarrelPattern(kinds: ReadonlyArray<string>): RegExp {
    const kindAlternation = kinds.map((kind) => kind.replace('/', '\\/')).join('|');
    return new RegExp(
        `^#\\/modules\\/[A-Za-z0-9]+(?:\\/(?:Common|Supporting)\\/[A-Za-z0-9]+)?\\/(?:${kindAlternation})$`
    );
}

const moduleExtensions = ['.ts', '.tsx', '.js', '.jsx'] as const;

/**
 * Exemptions. Each row must carry the spec, the barrel, and the reason the mock is
 * deliberately narrower than the graph. Empty is the correct state; a row here is
 * debt with a name on it, not a silenced check.
 */
const exemptions: ReadonlyArray<{ spec: string; barrel: string; reason: string }> = [];

export type MockedBarrel = {
    /** Module specifier passed to `vi.mock`. */
    specifier: string;
    /** 1-based line of the `vi.mock` call, for the report. */
    line: number;
    /** Top-level keys of the object literal the factory returns. */
    keys: string[];
    /** True when the factory spreads `importOriginal` — additive, so not checked. */
    spreadsOriginal: boolean;
};

export type FileFacts = {
    /** Resolved-path → names imported from it (`*` means a namespace import). */
    imports: Map<string, Set<string>>;
    /** `vi.mock` calls found in this file (empty for non-spec modules). */
    mocks: MockedBarrel[];
};

export type Violation = {
    spec: string;
    line: number;
    barrel: string;
    missing: string[];
    /** The module in the graph whose import would resolve to `undefined`. */
    usedBy: string;
};

/**
 * Reads and parses one file into the facts the analysis needs. Injected so the
 * spec can plant in-memory graphs, including broken ones.
 */
export type ReadFacts = (absolutePath: string) => FileFacts | null;

function parseObjectKeys(factory: ts.Node): string[] {
    let keys: string[] | null = null;
    const findObjectLiteral = (node: ts.Node): void => {
        if (keys !== null) {
            return;
        }
        if (ts.isObjectLiteralExpression(node)) {
            keys = node.properties
                .map((property) => {
                    if (!property.name) {
                        return null;
                    }
                    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
                        return property.name.text;
                    }
                    return null;
                })
                .filter((name): name is string => name !== null);
            return;
        }
        node.forEachChild(findObjectLiteral);
    };
    findObjectLiteral(factory);
    return keys ?? [];
}

function collectThenCallbackProperties(call: ts.CallExpression, names: Set<string>): void {
    // `import('…').then((m) => ({ default: m.Foo }))` — the lazy-panel shape. The
    // dynamic import is still subject to the mock, so `m.Foo` is a required name.
    const parent = call.parent;
    if (!parent || !ts.isPropertyAccessExpression(parent) || parent.name.text !== 'then') {
        return;
    }
    const thenCall = parent.parent;
    if (!thenCall || !ts.isCallExpression(thenCall)) {
        return;
    }
    const callback = thenCall.arguments[0];
    if (!callback) {
        return;
    }
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
        return;
    }
    const parameter = callback.parameters[0];
    if (!parameter || !ts.isIdentifier(parameter.name)) {
        return;
    }
    const parameterName = parameter.name.text;
    const walk = (node: ts.Node): void => {
        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === parameterName
        ) {
            names.add(node.name.text);
        }
        node.forEachChild(walk);
    };
    walk(callback.body);
}

/** Parses one source file. Exported so the analyzer and its spec share the parser. */
export function readFileFacts(absolutePath: string, contents: string): FileFacts {
    const sourceFile = ts.createSourceFile(absolutePath, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports = new Map<string, Set<string>>();
    const mocks: MockedBarrel[] = [];

    const addImport = (specifier: string, names: Iterable<string>): void => {
        const existing = imports.get(specifier);
        if (existing) {
            for (const name of names) {
                existing.add(name);
            }
            return;
        }
        imports.set(specifier, new Set(names));
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause;
            if (clause && !clause.isTypeOnly) {
                const names: string[] = [];
                if (clause.name) {
                    names.push('default');
                }
                if (clause.namedBindings) {
                    if (ts.isNamespaceImport(clause.namedBindings)) {
                        names.push('*');
                    } else {
                        for (const element of clause.namedBindings.elements) {
                            if (!element.isTypeOnly) {
                                names.push((element.propertyName ?? element.name).text);
                            }
                        }
                    }
                }
                addImport(node.moduleSpecifier.text, names);
            } else if (!clause) {
                addImport(node.moduleSpecifier.text, []);
            }
        }

        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            if (!node.isTypeOnly) {
                if (node.exportClause && ts.isNamedExports(node.exportClause)) {
                    const names = node.exportClause.elements
                        .filter((element) => !element.isTypeOnly)
                        .map((element) => (element.propertyName ?? element.name).text);
                    addImport(node.moduleSpecifier.text, names);
                } else {
                    addImport(node.moduleSpecifier.text, ['*']);
                }
            }
        }

        if (ts.isCallExpression(node)) {
            const firstArgument = node.arguments[0];
            const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            if (isDynamicImport && firstArgument && ts.isStringLiteralLike(firstArgument)) {
                const names = new Set<string>();
                collectThenCallbackProperties(node, names);
                addImport(firstArgument.text, names);
            }

            const factory = node.arguments[1];
            if (
                firstArgument &&
                factory &&
                ts.isStringLiteralLike(firstArgument) &&
                ts.isPropertyAccessExpression(node.expression) &&
                ts.isIdentifier(node.expression.expression) &&
                node.expression.expression.text === 'vi' &&
                node.expression.name.text === 'mock'
            ) {
                const factoryText = factory.getText(sourceFile);
                mocks.push({
                    specifier: firstArgument.text,
                    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                    keys: parseObjectKeys(factory),
                    spreadsOriginal: factoryText.includes('importOriginal'),
                });
            }
        }

        node.forEachChild(visit);
    };

    visit(sourceFile);
    return { imports, mocks };
}

/**
 * Resolves a module specifier the way `vite.config.ts` does: `#/…` is `src/…`,
 * relative paths are relative to the importer, everything else is a package and
 * is not part of the graph.
 */
export function resolveSpecifier(
    specifier: string,
    importerDirectory: string,
    fileExists: (path: string) => boolean
): string | null {
    let base: string;
    if (specifier.startsWith('#/')) {
        base = join(sourceRoot, specifier.slice(2));
    } else if (specifier.startsWith('.')) {
        base = resolve(importerDirectory, specifier);
    } else {
        return null;
    }

    if (fileExists(base)) {
        return base;
    }
    for (const extension of moduleExtensions) {
        if (fileExists(base + extension)) {
            return base + extension;
        }
    }
    for (const extension of moduleExtensions) {
        const indexPath = join(base, `index${extension}`);
        if (fileExists(indexPath)) {
            return indexPath;
        }
    }
    return null;
}

export type AnalyzeInput = {
    specPaths: string[];
    readFacts: ReadFacts;
    fileExists: (path: string) => boolean;
    /** Barrel kinds to check. Defaults to the gated set. */
    barrelKinds?: ReadonlyArray<string>;
};

/**
 * Walks each spec's module graph and reports every exhaustive contract-barrel mock
 * that omits a name the graph imports from that barrel.
 */
export function analyzeSpecs({ specPaths, readFacts, fileExists, barrelKinds }: AnalyzeInput): Violation[] {
    const contractBarrelPattern = buildBarrelPattern(barrelKinds ?? gatedBarrelKinds);
    const violations: Violation[] = [];

    for (const specPath of specPaths) {
        const specFacts = readFacts(specPath);
        if (!specFacts || specFacts.mocks.length === 0) {
            continue;
        }

        const specDirectory = dirname(specPath);
        const mockedPaths = new Set<string>();
        const barrelsUnderTest = new Map<string, MockedBarrel>();

        for (const mock of specFacts.mocks) {
            const resolved = resolveSpecifier(mock.specifier, specDirectory, fileExists);
            if (resolved) {
                mockedPaths.add(resolved);
            }
            if (mock.spreadsOriginal || !contractBarrelPattern.test(mock.specifier)) {
                continue;
            }
            if (!resolved) {
                continue;
            }
            const exempt = exemptions.some(
                (row) => relative(repoRoot, specPath).split(sep).join('/') === row.spec && row.barrel === mock.specifier
            );
            if (!exempt) {
                barrelsUnderTest.set(resolved, mock);
            }
        }

        if (barrelsUnderTest.size === 0) {
            continue;
        }

        // The mock replaces the module for the whole graph, so every module the
        // spec can reach counts — except the ones the spec also mocks, whose real
        // imports never run.
        const visited = new Set<string>([specPath]);
        const queue: string[] = [specPath];

        while (queue.length > 0) {
            const current = queue.pop();
            if (current === undefined) {
                break;
            }
            const facts = readFacts(current);
            if (!facts) {
                continue;
            }
            for (const [specifier, names] of facts.imports) {
                const resolved = resolveSpecifier(specifier, dirname(current), fileExists);
                if (!resolved) {
                    continue;
                }

                const mock = barrelsUnderTest.get(resolved);
                if (mock) {
                    const missing = [...names].filter((name) => name !== '*' && !mock.keys.includes(name));
                    if (names.has('*')) {
                        missing.push('* (namespace import)');
                    }
                    if (missing.length > 0) {
                        violations.push({
                            spec: specPath,
                            line: mock.line,
                            barrel: mock.specifier,
                            missing: [...new Set(missing)].sort(),
                            usedBy: current,
                        });
                    }
                }

                if (mockedPaths.has(resolved) || visited.has(resolved)) {
                    continue;
                }
                visited.add(resolved);
                queue.push(resolved);
            }
        }
    }

    return violations;
}

const specFilePattern = /\.spec\.tsx?$/;
const skippedDirectories = new Set(['node_modules', 'dist', 'coverage', 'target']);

function walkForSpecs(directory: string, found: string[]): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (skippedDirectories.has(entry.name)) {
                continue;
            }
            walkForSpecs(join(directory, entry.name), found);
            continue;
        }
        if (entry.isFile() && specFilePattern.test(entry.name)) {
            found.push(join(directory, entry.name));
        }
    }
    found.sort();
}

/** Scans the real tree. Exported so the guard's spec runs the same scan the CLI does. */
export function scanRepository(barrelKinds?: ReadonlyArray<string>): {
    specCount: number;
    violations: Violation[];
} {
    const specPaths: string[] = [];
    walkForSpecs(sourceRoot, specPaths);

    const factsCache = new Map<string, FileFacts | null>();
    const existsCache = new Map<string, boolean>();

    const fileExists = (path: string): boolean => {
        const cached = existsCache.get(path);
        if (cached !== undefined) {
            return cached;
        }
        let result = false;
        if (existsSync(path)) {
            result = statSync(path).isFile();
        }
        existsCache.set(path, result);
        return result;
    };

    const readFacts: ReadFacts = (absolutePath) => {
        const cached = factsCache.get(absolutePath);
        if (cached !== undefined) {
            return cached;
        }
        let facts: FileFacts | null;
        try {
            facts = readFileFacts(absolutePath, readFileSync(absolutePath, 'utf8'));
        } catch {
            facts = null;
        }
        factsCache.set(absolutePath, facts);
        return facts;
    };

    return {
        specCount: specPaths.length,
        violations: analyzeSpecs({ specPaths, readFacts, fileExists, barrelKinds }),
    };
}

/** Human-readable report for one violation; shared by the CLI and the guard spec. */
export function formatViolation(violation: Violation): string {
    const spec = relative(repoRoot, violation.spec).split(sep).join('/');
    const usedBy = relative(repoRoot, violation.usedBy).split(sep).join('/');
    return [
        `  ✗ ${spec}:${violation.line}`,
        `    mocks ${violation.barrel} without spreading importOriginal,`,
        `    and omits ${violation.missing.join(', ')} — imported by ${usedBy}.`,
        '    Spread the barrel first: vi.mock(spec, async (importOriginal) => ({',
        "        ...(await importOriginal<typeof import('…')>()), …overrides }))",
    ].join('\n');
}

function main(): number {
    const scanAll = process.argv.includes('--all');
    const kinds = scanAll ? allBarrelKinds : gatedBarrelKinds;
    const { specCount, violations } = scanRepository(kinds);

    if (violations.length > 0) {
        console.error(`\nbarrel mock coverage (${kinds.join(', ')}): ${String(violations.length)} violation(s)\n`);
        console.error(violations.map(formatViolation).join('\n\n'));
        console.error('');
        return 1;
    }

    console.log(`barrel mock coverage: OK — ${String(specCount)} spec files scanned for ${kinds.join(', ')} barrels`);
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
