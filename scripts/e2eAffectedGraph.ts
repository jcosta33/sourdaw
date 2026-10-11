import { lstatSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

import ts from 'typescript';

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
            if (dependency.couldNotResolve && /^(?:\.|#\/|\/?src\/)/.test(dependency.module ?? '')) {
                throw new Error('unresolved local import');
            }
            if (/^(?:src|public)\//.test(dependency.resolved)) {
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

function publicAssetFromInitializer(initializer: ts.Expression | undefined, source: ts.SourceFile): string | undefined {
    if (!initializer || !ts.isPropertyAccessExpression(initializer) || initializer.name.text !== 'href') {
        return undefined;
    }
    const url = initializer.expression;
    if (!ts.isNewExpression(url) || !ts.isIdentifier(url.expression) || url.expression.text !== 'URL') {
        return undefined;
    }
    const [asset, base] = url.arguments ?? [];
    if (
        url.arguments?.length !== 2 ||
        !asset ||
        !ts.isStringLiteralLike(asset) ||
        !base ||
        !isGlobalLocationHref(base) ||
        !usesPlatformBindings(source, ['URL', 'globalThis'])
    ) {
        return undefined;
    }
    const name = asset.text;
    if (
        !/^[A-Za-z0-9][A-Za-z0-9_./-]*\.(?:[cm]?js)$/.test(name) ||
        name.split('/').some((part) => part === '' || part === '.' || part === '..')
    ) {
        return undefined;
    }
    return `public/${name}`;
}

function isGlobalLocationHref(base: ts.Expression): boolean {
    return (
        ts.isPropertyAccessExpression(base) &&
        base.name.text === 'href' &&
        ts.isPropertyAccessExpression(base.expression) &&
        base.expression.name.text === 'location' &&
        ts.isIdentifier(base.expression.expression) &&
        base.expression.expression.text === 'globalThis'
    );
}

function usesPlatformBindings(source: ts.SourceFile, names: readonly string[]): boolean {
    let unproven = false;
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && names.includes(node.text)) {
            const parent = node.parent;
            const constructor = ts.isNewExpression(parent) && parent.expression === node;
            const type = ts.isTypeReferenceNode(parent) && parent.typeName === node;
            const location =
                node.text === 'globalThis' &&
                ts.isPropertyAccessExpression(parent) &&
                parent.expression === node &&
                parent.name.text === 'location';
            if (!constructor && !type && !location) {
                unproven = true;
            }
        }
        if (!unproven) {
            ts.forEachChild(node, visit);
        }
    };
    visit(source);
    return !unproven;
}

function sameBlockConstUrl(importCall: ts.CallExpression, source: ts.SourceFile): string | undefined {
    const argument = importCall.arguments[0];
    if (importCall.arguments.length !== 1 || !argument || !ts.isIdentifier(argument)) {
        return undefined;
    }
    let enclosing: ts.Node | undefined = importCall.parent;
    while (enclosing && !ts.isReturnStatement(enclosing)) {
        if (ts.isBlock(enclosing) || ts.isFunctionLike(enclosing)) {
            return undefined;
        }
        enclosing = enclosing.parent;
    }
    if (!enclosing || !ts.isReturnStatement(enclosing) || !ts.isBlock(enclosing.parent)) {
        return undefined;
    }
    for (const statement of enclosing.parent.statements) {
        if (statement.pos >= enclosing.pos || !ts.isVariableStatement(statement)) {
            continue;
        }
        if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
            continue;
        }
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== argument.text) {
                continue;
            }
            return publicAssetFromInitializer(declaration.initializer, source);
        }
    }
    return undefined;
}

function staticWorkerTarget(worker: ts.NewExpression, source: ts.SourceFile, sourcePath: string): string | undefined {
    const url = worker.arguments?.[0];
    if (!url || !ts.isNewExpression(url) || !ts.isIdentifier(url.expression) || url.expression.text !== 'URL') {
        return undefined;
    }
    const [target, base] = url.arguments ?? [];
    if (
        url.arguments?.length !== 2 ||
        !target ||
        !ts.isStringLiteralLike(target) ||
        !base ||
        base.getText(source) !== 'import.meta.url' ||
        !usesPlatformBindings(source, ['URL', 'Worker'])
    ) {
        return undefined;
    }
    const literal = target.text;
    if (
        !/^(?:\.\/|\.\.\/)/.test(literal) ||
        !/^[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?)$/.test(literal) ||
        literal.includes('//')
    ) {
        return undefined;
    }
    const resolved = posix.normalize(posix.join(posix.dirname(sourcePath), literal));
    return resolved.startsWith('src/') ? resolved : undefined;
}

function isQualifiedPlatformWorker(expression: ts.Expression): boolean {
    if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'Worker') {
        return (
            ts.isIdentifier(expression.expression) &&
            ['globalThis', 'self', 'window'].includes(expression.expression.text)
        );
    }
    return (
        ts.isElementAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        ['globalThis', 'self', 'window'].includes(expression.expression.text) &&
        ts.isStringLiteralLike(expression.argumentExpression) &&
        expression.argumentExpression.text === 'Worker'
    );
}

/** Complete syntax-visible runtime edges before trusting reverse reachability. */
export function completeRuntimeGraph(
    root: string,
    graph: readonly SourceNode[]
): { graph: SourceNode[]; opaqueSources: ReadonlySet<string> } {
    const { modules } = reverseGraph(graph);
    const extra = new Map<string, Set<string>>();
    const publicAssets = new Set<string>();
    const opaqueSources = new Set<string>();
    const addEdge = (source: string, target: string): void => {
        const dependencies = extra.get(source) ?? new Set<string>();
        dependencies.add(target);
        extra.set(source, dependencies);
    };
    for (const path of modules.keys()) {
        if (!/^(?:src|public)\//.test(path) || !/\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/.test(path)) {
            continue;
        }
        const source = ts.createSourceFile(
            path,
            readFileSync(resolve(root, path), 'utf8'),
            ts.ScriptTarget.Latest,
            true
        );
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                const argument = node.arguments[0];
                if (node.arguments.length !== 1 || !argument) {
                    opaqueSources.add(path);
                } else if (!ts.isStringLiteralLike(argument)) {
                    const asset = sameBlockConstUrl(node, source);
                    if (!asset || !modules.has(asset) || !lstatSync(resolve(root, asset)).isFile()) {
                        opaqueSources.add(path);
                    } else {
                        publicAssets.add(asset);
                        addEdge(path, asset);
                    }
                }
            }
            if (ts.isCallExpression(node) && node.expression.getText(source) === 'import.meta.glob') {
                opaqueSources.add(path);
            }
            if (ts.isNewExpression(node)) {
                const directWorker = ts.isIdentifier(node.expression) && node.expression.text === 'Worker';
                if (directWorker || isQualifiedPlatformWorker(node.expression)) {
                    const target = directWorker ? staticWorkerTarget(node, source, path) : undefined;
                    if (!target || !modules.has(target)) {
                        opaqueSources.add(path);
                    } else {
                        addEdge(path, target);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    const pending = [...publicAssets];
    const checked = new Set<string>();
    while (pending.length > 0) {
        const asset = pending.pop()!;
        if (checked.has(asset)) {
            continue;
        }
        checked.add(asset);
        for (const dependency of modules.get(asset)?.dependencies ?? []) {
            if (dependency.resolved.startsWith('src/')) {
                throw new Error(`public runtime asset imports product source: ${asset}`);
            }
            if (dependency.resolved.startsWith('public/')) {
                pending.push(dependency.resolved);
            }
        }
    }
    return {
        graph: graph.map((module) => {
            const dependencies = [...module.dependencies];
            for (const target of extra.get(module.source) ?? []) {
                dependencies.push({ resolved: target });
            }
            return { ...module, dependencies };
        }),
        opaqueSources,
    };
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
        for (const source of modules.keys()) {
            if (hasOpaqueDependency(source)) {
                throw new Error(`opaque runtime dependency: ${source}`);
            }
        }
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
        const result = await cruise(['src', 'public'], {
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
        const completed = completeRuntimeGraph(root, parsed.modules as SourceNode[]);
        return selectAffectedE2e(changedSources, availableSpecs, manifest, completed.graph, (path) =>
            completed.opaqueSources.has(path)
        );
    } catch (error) {
        return { kind: 'full', reason: error instanceof Error ? error.message : 'dependency graph failed' };
    }
}
