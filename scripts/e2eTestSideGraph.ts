import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { posix, relative, resolve } from 'node:path';

import * as ts from 'typescript/unstable/ast';

import { readNativeSources, requireNativeSyntax } from './nativeTypeScript.ts';

import { cruiseFileGraph } from './e2eFileGraph.ts';
import { testSideModuleKind, type TestSideRoute } from './e2eTestSideRoute.ts';
import { isPlaywrightCollected } from './vitestCollectionPatterns.ts';

import type { SourceNode } from './e2eAffectedGraph.ts';

const TEST_SIDE_SCRIPT = /\.(?:ts|tsx|js|mjs)$/;
const TEST_ROOT = 'tests';
// Root configs that load test files: Playwright imports helpers and names its global setup by path,
// and Vite serves test entries by URL.
const ROOT_CONFIG = /^(?:playwright|vite)[\w.-]*\.config\.[cm]?[jt]s$/;
// Product code is cruised too, so a product import of a test-side file is visible. Vitest specs are
// left out: a fixture only they import becomes a root that no browser loads.
const VITEST_SPEC_UNDER_SRC = '^src/.*\\.(?:test|spec)\\.[cm]?[jt]sx?$';
const UNRESOLVED_LOCAL = /^(?:\.|#\/|\/?src\/|\/?tests\/)/;

/** A text that names files by path rather than by import: a non-script file, or one string literal. */
export type PathReference = { file: string; text: string };

export type TestSideGraph =
    { kind: 'graph'; graph: SourceNode[]; references: PathReference[] } | { kind: 'full'; reason: string };

function importersByModule(graph: readonly SourceNode[]): ReadonlyMap<string, ReadonlySet<string>> {
    const importers = new Map<string, Set<string>>();
    for (const module of graph) {
        if (!module || typeof module.source !== 'string' || !Array.isArray(module.dependencies)) {
            throw new Error('malformed test-side dependency graph');
        }
        // The cruiser repeats a leaf for an unresolved package once per distinct importer.
        if (importers.has(module.source) && module.dependencies.length > 0) {
            throw new Error('malformed test-side dependency graph');
        }
        importers.set(module.source, importers.get(module.source) ?? new Set());
    }
    for (const module of graph) {
        for (const dependency of module.dependencies) {
            if (dependency.couldNotResolve && UNRESOLVED_LOCAL.test(dependency.module ?? '')) {
                throw new Error(`unresolved test-side import in ${module.source}`);
            }
            importers.get(dependency.resolved)?.add(module.source);
        }
    }
    return importers;
}

function referencedBy(path: string, references: readonly PathReference[]): string | undefined {
    const name = posix.basename(path);
    const stem = path.replace(TEST_SIDE_SCRIPT, '');
    return references.find(({ text }) => text.includes(name) || text.includes(stem))?.file;
}

function isProductSource(path: string): boolean {
    return path.startsWith('src/') && !path.split('/').includes('__tests__');
}

type Reach = { kind: 'specs'; specs: string[] } | { kind: 'full'; reason: string } | { kind: 'product' };

/** Every browser spec reverse-transitively importing `path`, unless something other than a spec loads it. */
function reachOf(
    path: string,
    importers: ReadonlyMap<string, ReadonlySet<string>>,
    available: ReadonlySet<string>
): Reach {
    const specs = new Set<string>();
    const visited = new Set<string>();
    const pending = [path];
    while (pending.length > 0) {
        const module = pending.pop()!;
        if (visited.has(module)) {
            continue;
        }
        visited.add(module);
        const consumers = importers.get(module) ?? new Set<string>();
        if (isProductSource(module)) {
            return { kind: 'product' };
        }
        if (isPlaywrightCollected(module)) {
            if (!available.has(module)) {
                return { kind: 'full', reason: `reaching spec is not collected: ${module}` };
            }
            specs.add(module);
        } else if (consumers.size === 0 && testSideModuleKind(module) !== 'src') {
            // A root other than a spec or a Vitest-only src fixture: a config, setup, or unloaded file.
            const reason = module === path ? 'imported by no browser spec' : `loaded outside browser specs: ${module}`;
            return { kind: 'full', reason };
        }
        pending.push(...consumers);
    }
    return { kind: 'specs', specs: [...specs].sort() };
}

function routeOf(
    path: string,
    graph: Extract<TestSideGraph, { kind: 'graph' }>,
    importers: ReadonlyMap<string, ReadonlySet<string>>,
    available: ReadonlySet<string>
): TestSideRoute | undefined {
    if (!importers.has(path)) {
        return { path, kind: 'full', reason: 'absent from the test-side dependency graph' };
    }
    const reach = reachOf(path, importers, available);
    if (reach.kind === 'product') {
        return undefined;
    }
    const reference = referencedBy(path, graph.references);
    if (reference !== undefined) {
        return { path, kind: 'full', reason: `loaded by path from ${reference}` };
    }
    if (reach.kind === 'full') {
        return { path, ...reach };
    }
    if (reach.specs.length === 0 && testSideModuleKind(path) === 'e2e') {
        return { path, kind: 'full', reason: 'imported by no browser spec' };
    }
    return { path, ...reach };
}

/**
 * Route each changed test-side module to exactly the browser specs that statically import it, the
 * related-test semantics of Playwright `--only-changed` and Jest `findRelatedTests`. Anything the
 * import graph cannot prove widens: a path reference, a non-spec root, an uncollected spec, a failed
 * graph. A src fixture that no browser spec reaches is unit-only, because the graph also shows no
 * product code imports it. Paths that are not test-side modules, and test-side files product code
 * imports, are absent from the result and keep their route.
 */
export function selectTestSideSpecs(
    changed: readonly string[],
    availableSpecs: readonly string[],
    graph: TestSideGraph
): TestSideRoute[] {
    const candidates = changed.filter((path) => testSideModuleKind(path) !== undefined);
    if (graph.kind === 'full') {
        return candidates.map((path) => ({ path, kind: 'full', reason: graph.reason }));
    }
    let importers: ReadonlyMap<string, ReadonlySet<string>>;
    try {
        importers = importersByModule(graph.graph);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'test-side dependency graph failed';
        return candidates.map((path) => ({ path, kind: 'full', reason }));
    }
    const available = new Set(availableSpecs);
    const routes: TestSideRoute[] = [];
    for (const path of candidates) {
        const route = routeOf(path, graph, importers, available);
        if (route !== undefined) {
            routes.push(route);
        }
    }
    return routes;
}

function literalTexts(parsed: ts.SourceFile): string[] {
    const texts: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            return;
        }
        if (ts.isStringLiteralLikeNode(node) || ts.isTemplateLiteralToken(node)) {
            texts.push(node.text);
        }
        node.forEachChild(visit);
    };
    visit(parsed);
    return texts;
}

function pathReferences(root: string, files: readonly string[]): PathReference[] {
    const references: PathReference[] = [];
    const contents = files.map((file) => ({ path: file, text: readFileSync(resolve(root, file), 'utf8') }));
    const parsed = readNativeSources(contents.filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file.path)));
    for (const { path: file, text: source } of contents) {
        if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) {
            references.push({ file, text: source });
            continue;
        }
        const input = parsed.get(file);
        if (!input) {
            throw new Error(`Native source snapshot omitted ${file}`);
        }
        for (const text of literalTexts(requireNativeSyntax(input))) {
            references.push({ file, text });
        }
    }
    return references;
}

function testFiles(root: string): string[] {
    return readdirSync(resolve(root, TEST_ROOT), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).split('\\').join('/'));
}

/**
 * The import graph of the product and test trees and the root Playwright configs, without Vitest
 * specs, plus the path references that load files without an import.
 */
export async function loadTestSideGraph(root: string): Promise<TestSideGraph> {
    try {
        if (!existsSync(resolve(root, TEST_ROOT))) {
            return { kind: 'full', reason: 'test tree is missing' };
        }
        const configs = readdirSync(root).filter((name) => ROOT_CONFIG.test(name));
        const playwrightConfigs = configs.filter((name) => name.startsWith('playwright'));
        const cruised = await cruiseFileGraph(root, {
            roots: [...['src', TEST_ROOT].filter((tree) => existsSync(resolve(root, tree))), ...playwrightConfigs],
            exclude: VITEST_SPEC_UNDER_SRC,
            doNotFollow: 'node_modules',
        });
        if (cruised.kind === 'full') {
            return cruised;
        }
        const files = testFiles(root).filter((file) => !file.split('/').includes('node_modules'));
        return { kind: 'graph', graph: cruised.modules, references: pathReferences(root, [...files, ...configs]) };
    } catch (error) {
        return { kind: 'full', reason: error instanceof Error ? error.message : 'test-side dependency graph failed' };
    }
}
