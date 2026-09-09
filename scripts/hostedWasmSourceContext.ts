import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { wasmArtifacts, type WasmPackageSpec } from './wasm-artifacts.ts';

type SourceToolkit = Pick<
    typeof wasmArtifacts,
    | 'repoRoot'
    | 'manifestPath'
    | 'packages'
    | 'readManifest'
    | 'hashCrateClosure'
    | 'rustToolchainChannel'
    | 'wasmBindgenLockVersion'
> & { pinnedToolchain: { wasmPack: string } };

type Capture = (command: string, args: string[]) => string;

export type HostedWasmSourceContext = { root: string; toolkit: SourceToolkit };

function captureAt(root: string): Capture {
    return (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trimEnd();
}

function changedWorktreePaths(capture: Capture): string[] {
    return [
        capture('git', ['diff', '--name-only', '-z', 'HEAD']),
        capture('git', ['ls-files', '--others', '--exclude-standard', '-z']),
    ].flatMap((output) => output.split('\0').filter(Boolean));
}

function assertHead(capture: Capture, expected: string): void {
    if (capture('git', ['rev-parse', 'HEAD']) !== expected) {
        throw new Error('Checkout does not match the requested source head');
    }
}

function canonicalGitRoot(path: string, label: string): { root: string; capture: Capture } {
    const root = realpathSync(resolve(path));
    const capture = captureAt(root);
    if (realpathSync(capture('git', ['rev-parse', '--show-toplevel'])) !== root) {
        throw new Error(`${label} checkout root is not a Git top-level`);
    }
    return { root, capture };
}

function sameDescriptor(left: WasmPackageSpec, right: WasmPackageSpec): boolean {
    return (
        left.id === right.id &&
        left.crateDir === right.crateDir &&
        left.buildScript === right.buildScript &&
        left.artifacts.length === right.artifacts.length &&
        left.artifacts.every((path, index) => path === right.artifacts[index])
    );
}

function validateSourceContext(root: string, toolkit: SourceToolkit): HostedWasmSourceContext {
    const canonicalRoot = realpathSync(resolve(root));
    if (
        realpathSync(toolkit.repoRoot) !== canonicalRoot ||
        realpathSync(toolkit.manifestPath) !== join(canonicalRoot, 'public/wasm/manifest.json')
    ) {
        throw new Error('Source WASM toolkit is bound to a different root');
    }
    if (
        !Array.isArray(toolkit.packages) ||
        toolkit.packages.length !== wasmArtifacts.packages.length ||
        !wasmArtifacts.packages.every((control) => {
            const source = toolkit.packages.find((candidate) => candidate.id === control.id);
            return source !== undefined && sameDescriptor(control, source);
        })
    ) {
        throw new Error('Source WASM toolkit package registry is incompatible with control policy');
    }
    return { root: canonicalRoot, toolkit };
}

export async function loadHostedWasmSourceContext(sourceRoot: string): Promise<HostedWasmSourceContext> {
    const root = realpathSync(resolve(sourceRoot));
    const toolkitPath = join(root, 'scripts', 'wasm-artifacts.ts');
    if (!existsSync(toolkitPath)) {
        throw new Error('Source checkout is missing scripts/wasm-artifacts.ts');
    }
    const loaded: unknown = await import(pathToFileURL(toolkitPath).href);
    if (typeof loaded !== 'object' || loaded === null || !Reflect.has(loaded, 'wasmArtifacts')) {
        throw new Error('Source WASM toolkit has no wasmArtifacts export');
    }
    const toolkit = Reflect.get(loaded, 'wasmArtifacts') as SourceToolkit;
    if (
        typeof toolkit !== 'object' ||
        toolkit === null ||
        typeof toolkit.readManifest !== 'function' ||
        typeof toolkit.hashCrateClosure !== 'function' ||
        typeof toolkit.rustToolchainChannel !== 'function' ||
        typeof toolkit.wasmBindgenLockVersion !== 'function' ||
        typeof toolkit.repoRoot !== 'string' ||
        typeof toolkit.manifestPath !== 'string' ||
        typeof toolkit.pinnedToolchain !== 'object' ||
        toolkit.pinnedToolchain === null ||
        typeof toolkit.pinnedToolchain.wasmPack !== 'string'
    ) {
        throw new Error('Source WASM toolkit exports are incomplete');
    }
    return validateSourceContext(root, toolkit);
}

/** Admit a return source as a Git root without loading any source-side code. */
export function admitHostedWasmReturnRoot(sourceRoot: string): string {
    if (!isAbsolute(sourceRoot)) {
        throw new Error('Hosted WASM source root must be absolute');
    }
    return canonicalGitRoot(sourceRoot, 'Artifact return source').root;
}

export function admitHostedWasmCheckouts(input: {
    controlRoot: string;
    sourceRoot: string;
    workflowSha: string;
    sourceSha: string;
}): { controlRoot: string; sourceRoot: string } {
    if (!isAbsolute(input.sourceRoot)) {
        throw new Error('Hosted WASM source root must be absolute');
    }
    const control = canonicalGitRoot(input.controlRoot, 'Workflow control');
    const source = canonicalGitRoot(input.sourceRoot, 'Source');
    const relation = relative(control.root, source.root);
    const reverseRelation = relative(source.root, control.root);
    if (
        control.root === source.root ||
        dirname(control.root) !== dirname(source.root) ||
        (!relation.startsWith('../') && relation !== '') ||
        (!reverseRelation.startsWith('../') && reverseRelation !== '')
    ) {
        throw new Error('Hosted WASM control and source checkouts must be distinct siblings');
    }
    assertHead(control.capture, input.workflowSha);
    if (changedWorktreePaths(control.capture).length > 0) {
        throw new Error('Hosted build requires a clean workflow control checkout');
    }
    assertHead(source.capture, input.sourceSha);
    if (changedWorktreePaths(source.capture).length > 0) {
        throw new Error('Hosted build requires a clean source checkout');
    }
    return { controlRoot: control.root, sourceRoot: source.root };
}
