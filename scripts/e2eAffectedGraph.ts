import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isPlaywrightCollected } from './vitestCollectionPatterns.ts';

const COMPOSITION_SHELLS = new Set([
    'src/app/bootstrap.ts',
    'src/modules/WorkspaceShell/presentations/views/AppShell.tsx',
]);
const SMOKE_SPEC = 'tests/e2e/smoke.spec.ts';

export type SourceNode = {
    source: string;
    dependencies: { resolved: string; module?: string; couldNotResolve?: boolean }[];
};

export type AffectedSelection =
    { kind: 'narrow'; specs: string[]; browserAi: boolean; owners: string[] } | { kind: 'full'; reason: string };

function ownerOf(path: string, knownOwners: ReadonlySet<string>): string | undefined {
    const owner = /^src\/modules\/([^/]+)\//.exec(path)?.[1];
    return owner && knownOwners.has(owner) ? owner : undefined;
}

function isKnownFeatureSource(path: string, knownOwners: ReadonlySet<string>): boolean {
    const owner = ownerOf(path, knownOwners);
    if (!owner) {
        return false;
    }
    return path.startsWith(`src/modules/${owner}/presentations/`);
}

function isValidSpec(path: string): boolean {
    return isPlaywrightCollected(path) && !path.split('/').includes('..') && !path.split('/').includes('node_modules');
}

function isOwnerRegistry(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((owner: unknown) => typeof owner === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(owner)) &&
        new Set(value).size === value.length
    );
}

function readSuiteEntry(
    entry: unknown,
    owners: ReadonlySet<string>,
    inventory: ReadonlySet<string>
): {
    spec: string;
    owners: ReadonlySet<string>;
} {
    if (
        typeof entry !== 'object' ||
        entry === null ||
        !('spec' in entry) ||
        typeof entry.spec !== 'string' ||
        !('owners' in entry) ||
        !Array.isArray(entry.owners) ||
        entry.owners.length === 0 ||
        !entry.owners.every((owner: unknown) => typeof owner === 'string' && owners.has(owner))
    ) {
        throw new Error('Invalid E2E suite ownership entry');
    }
    if (
        !isValidSpec(entry.spec) ||
        entry.spec === SMOKE_SPEC ||
        !inventory.has(entry.spec) ||
        new Set(entry.owners).size !== entry.owners.length
    ) {
        throw new Error(`Invalid E2E suite ownership: ${entry.spec}`);
    }
    return { spec: entry.spec, owners: new Set(entry.owners) };
}

function suiteOwners(
    value: unknown,
    inventory: ReadonlySet<string>
): {
    owners: ReadonlySet<string>;
    suites: Map<string, ReadonlySet<string>>;
} {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('version' in value) ||
        value.version !== 1 ||
        !('owners' in value) ||
        !isOwnerRegistry(value.owners) ||
        !('entries' in value) ||
        !Array.isArray(value.entries)
    ) {
        throw new Error('Invalid E2E suite ownership manifest');
    }
    const owners = new Set<string>(value.owners);
    const entries = new Map<string, ReadonlySet<string>>();
    for (const entry of value.entries as unknown[]) {
        const parsed = readSuiteEntry(entry, owners, inventory);
        if (entries.has(parsed.spec)) {
            throw new Error(`Duplicate E2E suite ownership: ${parsed.spec}`);
        }
        entries.set(parsed.spec, parsed.owners);
    }
    if ([...owners].some((owner) => ![...entries.values()].some((suite) => suite.has(owner)))) {
        throw new Error('E2E owner has no suite');
    }
    return { owners, suites: entries };
}

function isValidDependency(value: unknown): value is SourceNode['dependencies'][number] {
    if (typeof value !== 'object' || value === null || !('resolved' in value)) {
        return false;
    }
    return (
        typeof value.resolved === 'string' &&
        value.resolved.length > 0 &&
        (!('module' in value) || typeof value.module === 'string') &&
        (!('couldNotResolve' in value) || typeof value.couldNotResolve === 'boolean')
    );
}

function reverseGraph(graph: readonly SourceNode[]): {
    modules: ReadonlyMap<string, SourceNode>;
    reverse: ReadonlyMap<string, ReadonlySet<string>>;
} {
    const modules = new Map<string, SourceNode>();
    const reverse = new Map<string, Set<string>>();
    const resolvedSources = new Set<string>();
    for (const module of graph) {
        if (
            !module ||
            typeof module.source !== 'string' ||
            !Array.isArray(module.dependencies) ||
            modules.has(module.source)
        ) {
            throw new Error('malformed dependency graph');
        }
        modules.set(module.source, module);
        for (const dependency of module.dependencies) {
            if (!isValidDependency(dependency)) {
                throw new Error('malformed dependency graph');
            }
            if (dependency.couldNotResolve && /^(?:\.|#\/)/.test(dependency.module ?? '')) {
                throw new Error('unresolved local import');
            }
            if (dependency.resolved.startsWith('src/')) {
                resolvedSources.add(dependency.resolved);
                const importers = reverse.get(dependency.resolved) ?? new Set<string>();
                importers.add(module.source);
                reverse.set(dependency.resolved, importers);
            }
        }
    }
    if ([...resolvedSources].some((source) => !modules.has(source))) {
        throw new Error('dependency graph has missing source nodes');
    }
    return { modules, reverse };
}

function affectedOwners(
    changedSources: readonly string[],
    knownOwners: ReadonlySet<string>,
    modules: ReadonlyMap<string, SourceNode>,
    reverse: ReadonlyMap<string, ReadonlySet<string>>,
    hasOpaqueDependency: (source: string) => boolean
): ReadonlySet<string> {
    const owners = new Set<string>();
    const visited = new Set<string>();
    const pending = [...changedSources];
    while (pending.length > 0) {
        const path = pending.pop()!;
        if (visited.has(path)) {
            continue;
        }
        visited.add(path);
        if (!modules.has(path)) {
            throw new Error(`source absent from dependency graph: ${path}`);
        }
        if (COMPOSITION_SHELLS.has(path)) {
            continue;
        }
        const owner = ownerOf(path, knownOwners);
        if (!owner || !isKnownFeatureSource(path, knownOwners)) {
            throw new Error(`shared or uncurated consumer: ${path}`);
        }
        if (hasOpaqueDependency(path)) {
            throw new Error(`opaque runtime dependency: ${path}`);
        }
        owners.add(owner);
        for (const consumer of reverse.get(path) ?? []) {
            pending.push(consumer);
        }
    }
    return owners;
}

/** Unknown inputs always widen: a file edge alone cannot prove event or runtime coupling. */
export function selectAffectedE2e(
    changedSources: readonly string[],
    availableSpecs: readonly string[],
    manifest: unknown,
    graph: readonly SourceNode[],
    hasOpaqueDependency: (source: string) => boolean = () => false
): AffectedSelection {
    try {
        const inventory = new Set(availableSpecs);
        if (
            inventory.size !== availableSpecs.length ||
            !inventory.has(SMOKE_SPEC) ||
            [...inventory].some((path) => !isValidSpec(path))
        ) {
            return { kind: 'full', reason: 'invalid E2E inventory' };
        }
        const { owners: knownOwners, suites: ownedSuites } = suiteOwners(manifest, inventory);
        if (changedSources.length === 0 || changedSources.some((path) => !isKnownFeatureSource(path, knownOwners))) {
            return { kind: 'full', reason: 'unknown or shared changed source' };
        }
        const { modules, reverse } = reverseGraph(graph);
        const owners = affectedOwners(changedSources, knownOwners, modules, reverse, hasOpaqueDependency);
        const specs = Array.from(inventory)
            .filter(
                (spec) =>
                    spec !== SMOKE_SPEC &&
                    (!ownedSuites.has(spec) || [...ownedSuites.get(spec)!].some((owner) => owners.has(owner)))
            )
            .sort();
        return {
            kind: 'narrow',
            specs,
            browserAi: specs.some((spec) => spec.startsWith('tests/e2e/browserAi')),
            owners: [...owners].sort(),
        };
    } catch (error) {
        return { kind: 'full', reason: error instanceof Error ? error.message : 'affected E2E selection failed' };
    }
}

export async function loadAffectedE2e(
    root: string,
    changedSources: readonly string[],
    availableSpecs: readonly string[]
): Promise<AffectedSelection> {
    try {
        const manifest: unknown = JSON.parse(readFileSync(resolve(root, 'scripts/e2eSuiteOwners.json'), 'utf8'));
        const { cruise } = await import('dependency-cruiser');
        const ts = await import('typescript');
        const result = await cruise(['src'], {
            baseDir: root,
            outputType: 'json',
            doNotFollow: { path: 'node_modules' },
            exclude: { path: '(?:^|/)__tests__/|\\.(spec|test)\\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$' },
            tsConfig: { fileName: resolve(root, 'tsconfig.json') },
            tsPreCompilationDeps: 'specify',
        });
        if (result.exitCode !== 0 || typeof result.output !== 'string') {
            return { kind: 'full', reason: 'dependency graph did not complete' };
        }
        const parsed: unknown = JSON.parse(result.output);
        if (typeof parsed !== 'object' || parsed === null || !('modules' in parsed) || !Array.isArray(parsed.modules)) {
            return { kind: 'full', reason: 'malformed dependency graph' };
        }
        const opaque = (path: string): boolean => {
            const source = ts.createSourceFile(
                path,
                readFileSync(resolve(root, path), 'utf8'),
                ts.ScriptTarget.Latest,
                true
            );
            let found = false;
            const visit = (node: import('typescript').Node): void => {
                if (
                    ts.isCallExpression(node) &&
                    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
                    (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0]))
                ) {
                    found = true;
                }
                if (ts.isCallExpression(node) && node.expression.getText(source) === 'import.meta.glob') {
                    found = true;
                }
                if (ts.isNewExpression(node) && node.expression.getText(source) === 'Worker') {
                    found = true;
                }
                if (!found) {
                    ts.forEachChild(node, visit);
                }
            };
            visit(source);
            return found;
        };
        const modules = parsed.modules as SourceNode[];
        const potentialConsumers = modules.filter((module) =>
            /^src\/(?:app\/|modules\/[^/]+\/presentations\/)/.test(module.source)
        );
        if (potentialConsumers.some((module) => opaque(module.source))) {
            return { kind: 'full', reason: 'opaque presentation or composition import' };
        }
        return selectAffectedE2e(changedSources, availableSpecs, manifest, modules, opaque);
    } catch (error) {
        return { kind: 'full', reason: error instanceof Error ? error.message : 'dependency graph failed' };
    }
}
