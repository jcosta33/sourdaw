/**
 * The closure a gate run's evidence depends on: every tracked file its specs and scripts reach
 * through resolved static imports (type-only edges included), every tracked file in the
 * path-dependency crates its `cargo test -p` commands compile, and the named fixtures and declared
 * path reads beside them. The committed manifest never carries it — nearly every product edit moves
 * it — so a record stores what its run observed and `--release` recomputes it against the live tree.
 * Derivation is offline and fails closed. Contract: docs/architecture/agent-release-gates.md.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { cruiseFileGraph } from '../e2eFileGraph.ts';

import { EVIDENCE_SCRIPT_RUNTIME_FILES, EVIDENCE_SUITE_CLOSURE_READS } from './evidenceGateContract.ts';

import type { EvidenceClosure, EvidenceRecord, EvidenceSuite } from './evidenceManifest.ts';

/** What one suite's closure starts from. */
export type ClosureSeed = {
    /** Code files whose import closure the evidence depends on. */
    codeRoots: readonly string[];
    /** Packages a `cargo test -p` command compiles and tests. */
    crates: readonly string[];
    /** Files or trees the evidence reads by path; a tree stands for its tracked files. */
    reads: readonly string[];
};

type CargoDependencyKind = 'normal' | 'dev' | 'build';

type CargoDependency = { name: string; path: string | undefined; kind: CargoDependencyKind };

type CargoPackage = {
    name: string;
    directory: string;
    dependencies: readonly CargoDependency[];
    targets: readonly { kinds: readonly string[]; source: string }[];
};

/** One resolved module of the import graph; `coreModule` marks a Node builtin. */
export type ClosureGraphNode = {
    source: string;
    dependencies: readonly { resolved: string; module?: string; couldNotResolve?: boolean; coreModule?: boolean }[];
};

export type ClosureInputs = {
    graph: ReadonlyMap<string, ClosureGraphNode>;
    cargo: readonly CargoPackage[];
    tracked: readonly string[];
    root: string;
};

/** The process boundaries closure loading crosses, so a spec can stand in for `cargo`. */
export type ClosureIo = { cargoMetadata: (root: string) => string };

export const DEFAULT_CLOSURE_IO: ClosureIo = {
    cargoMetadata: (root) =>
        execFileSync('cargo', ['metadata', '--offline', '--format-version', '1', '--no-deps'], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        }),
};

const CODE_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/u;

export function isCodeFile(path: string): boolean {
    return CODE_FILE.test(path);
}

function field(value: unknown, key: string): unknown {
    if (typeof value !== 'object' || value === null || !(key in value)) {
        return undefined;
    }
    return Reflect.get(value, key);
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new TypeError(`cargo metadata: ${label} is not a string`);
    }
    return value;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`cargo metadata: ${label} is not an array`);
    }
    return value;
}

function parseDependencyKind(value: unknown, label: string): CargoDependencyKind {
    if (value === null) {
        return 'normal';
    }
    if (value === 'dev' || value === 'build') {
        return value;
    }
    throw new Error(`cargo metadata: ${label} has unknown kind ${JSON.stringify(value)}`);
}

function repositoryPath(root: string, absolute: string): string {
    return relative(root, absolute).replaceAll('\\', '/');
}

function parseCargoPackage(root: string, value: unknown, label: string): CargoPackage {
    const name = requireString(field(value, 'name'), `${label}.name`);
    const manifest = requireString(field(value, 'manifest_path'), `${label}.manifest_path`);
    return {
        name,
        directory: repositoryPath(root, resolve(manifest, '..')),
        dependencies: requireArray(field(value, 'dependencies'), `${name}.dependencies`).map((dependency, index) => {
            const path = field(dependency, 'path');
            return {
                name: requireString(field(dependency, 'name'), `${name}.dependencies[${index}].name`),
                path: path === undefined ? undefined : repositoryPath(root, requireString(path, `${name} path`)),
                kind: parseDependencyKind(field(dependency, 'kind'), `${name}.dependencies[${index}]`),
            };
        }),
        targets: requireArray(field(value, 'targets'), `${name}.targets`).map((target, index) => ({
            kinds: requireArray(field(target, 'kind'), `${name}.targets[${index}].kind`).map((kind) =>
                requireString(kind, `${name}.targets[${index}].kind`)
            ),
            source: repositoryPath(root, requireString(field(target, 'src_path'), `${name}.targets[${index}]`)),
        })),
    };
}

/** The workspace packages of `cargo metadata --no-deps` output, with repository-relative paths. */
export function parseCargoMetadata(root: string, text: string): readonly CargoPackage[] {
    const packages = requireArray(field(JSON.parse(text), 'packages'), 'packages');
    return packages.map((entry, index) => parseCargoPackage(root, entry, `packages[${index}]`));
}

/** Paths a compiled package contributes: its manifest, its `src` tree, and its build script. */
function packagePaths(cargoPackage: CargoPackage, tested: boolean): readonly string[] {
    const paths = [`${cargoPackage.directory}/Cargo.toml`, `${cargoPackage.directory}/src`];
    for (const target of cargoPackage.targets) {
        if (target.kinds.includes('custom-build')) {
            paths.push(target.source);
        }
        if (tested && target.kinds.includes('test') && !target.source.startsWith(`${cargoPackage.directory}/src/`)) {
            paths.push(`${cargoPackage.directory}/tests`);
        }
    }
    return paths;
}

/** Workspace files every `cargo test` resolves its profiles, toolchain, and build flags from. */
const CARGO_WORKSPACE_FILES: readonly string[] = ['Cargo.toml', 'rust-toolchain.toml', '.cargo/config.toml'];

/**
 * The path-dependency closure of one tested package. Its own dev-dependencies compile under
 * `cargo test`; a dependency's dev-dependencies never do.
 */
function cargoClosurePaths(packages: readonly CargoPackage[], crate: string): readonly string[] {
    const tested = packages.find((entry) => entry.name === crate);
    if (tested === undefined) {
        throw new Error(`cargo metadata names no workspace package ${crate}`);
    }
    const byDirectory = new Map(packages.map((entry) => [entry.directory, entry]));
    const seen = new Set<string>();
    const paths: string[] = [...CARGO_WORKSPACE_FILES];
    const queue: CargoPackage[] = [tested];
    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
        if (seen.has(current.directory)) {
            continue;
        }
        seen.add(current.directory);
        const isTested = current === tested;
        paths.push(...packagePaths(current, isTested));
        for (const dependency of current.dependencies) {
            if (dependency.path === undefined || (dependency.kind === 'dev' && !isTested)) {
                continue;
            }
            const target = byDirectory.get(dependency.path);
            if (target === undefined) {
                throw new Error(
                    `${current.name}: path dependency ${dependency.name} at ${dependency.path} is not a workspace package in cargo metadata`
                );
            }
            queue.push(target);
        }
    }
    return paths;
}

/** Every tracked file one static-import walk from `roots` reaches; an unresolved import refuses. */
function importClosurePaths(inputs: ClosureInputs, roots: readonly string[]): readonly string[] {
    const tracked = new Set(inputs.tracked);
    const seen = new Set<string>();
    const queue = [...roots];
    for (let current = queue.pop(); current !== undefined; current = queue.pop()) {
        if (seen.has(current)) {
            continue;
        }
        if (!tracked.has(current)) {
            throw new Error(`${current}: reached by an evidence import closure but not a tracked file`);
        }
        seen.add(current);
        const node = inputs.graph.get(current);
        if (node === undefined) {
            throw new Error(`${current}: missing from the resolved import graph`);
        }
        for (const dependency of node.dependencies) {
            const specifier = dependency.module ?? dependency.resolved;
            if (dependency.couldNotResolve === true && !isInstalledPackage(inputs.root, current, specifier)) {
                throw new Error(`${current}: cannot resolve import ${specifier}`);
            }
            if (
                dependency.couldNotResolve === true ||
                dependency.coreModule === true ||
                dependency.resolved.split('/').includes('node_modules')
            ) {
                continue;
            }
            queue.push(dependency.resolved);
        }
    }
    return [...seen];
}

/**
 * Whether a bare specifier the resolver gave up on names a package installed where Node would look
 * for it. The resolver misses packages that publish only conditional `exports`; those are
 * dependencies, pinned by the lockfile, not repository files. A relative or `#` alias specifier never
 * qualifies, so an unresolvable repository import still refuses.
 */
function isInstalledPackage(root: string, importer: string, specifier: string): boolean {
    if (/^[.#/]/u.test(specifier)) {
        return false;
    }
    const segments = specifier.split('/');
    const name = segments.slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
    for (let directory = resolve(root, importer, '..'); ; directory = resolve(directory, '..')) {
        if (existsSync(resolve(directory, 'node_modules', name, 'package.json'))) {
            return true;
        }
        if (directory === resolve(root) || directory === resolve(directory, '..')) {
            return false;
        }
    }
}

/** A file stands for itself; a tree for every tracked file beneath it. Neither may be empty. */
function expandTracked(tracked: readonly string[], path: string): readonly string[] {
    const prefix = `${path.replace(/\/$/u, '')}/`;
    const files = tracked.filter((file) => file === path || file.startsWith(prefix));
    if (files.length === 0) {
        throw new Error(`${path}: an evidence closure path that names no tracked file`);
    }
    return files;
}

/** The sorted, tracked file paths of one suite's closure. */
export function closurePaths(seed: ClosureSeed, inputs: ClosureInputs): readonly string[] {
    const trees = [...seed.reads, ...seed.crates.flatMap((crate) => cargoClosurePaths(inputs.cargo, crate))];
    const files = new Set([
        ...importClosurePaths(inputs, seed.codeRoots),
        ...trees.flatMap((path) => expandTracked(inputs.tracked, path)),
    ]);
    return [...files].sort();
}

function sha256(bytes: Buffer | string): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Each closure file's digest, and one digest over the sorted list. */
export function digestClosure(root: string, paths: readonly string[]): EvidenceClosure {
    const files = paths
        .filter((path) => existsSync(resolve(root, path)))
        .map((path) => ({ path, digest: sha256(readFileSync(resolve(root, path))) }));
    const listing = files.map(({ path, digest }) => `${path}\0${digest}\0`).join('');
    return { digest: sha256(listing), files };
}

/** Each file whose bytes, or whose membership, differ between a recorded and a live closure. */
export function closureDrift(recorded: EvidenceClosure, live: EvidenceClosure): readonly string[] {
    const before = new Map(recorded.files.map(({ path, digest }) => [path, digest]));
    const after = new Map(live.files.map(({ path, digest }) => [path, digest]));
    const drifted = new Set<string>();
    for (const [path, digest] of after) {
        if (before.get(path) !== digest) {
            drifted.add(path);
        }
    }
    for (const path of before.keys()) {
        if (!after.has(path)) {
            drifted.add(path);
        }
    }
    if (drifted.size === 0 && recorded.digest !== live.digest) {
        return ['<closure digest disagrees with its own file list>'];
    }
    return [...drifted].sort();
}

function trackedFiles(root: string): readonly string[] {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\0')
        .filter((path) => path.length > 0);
}

/** The import graph, workspace metadata, and tracked file list the given seeds need. */
export async function loadClosureInputs(
    root: string,
    seeds: readonly ClosureSeed[],
    io: ClosureIo = DEFAULT_CLOSURE_IO
): Promise<ClosureInputs> {
    const codeRoots = [...new Set(seeds.flatMap((seed) => seed.codeRoots))].sort();
    const needsCargo = seeds.some((seed) => seed.crates.length > 0);
    let graph: ClosureInputs['graph'] = new Map();
    if (codeRoots.length > 0) {
        const cruised = await cruiseFileGraph(root, { roots: codeRoots, exclude: '^$', doNotFollow: 'node_modules' });
        if (cruised.kind === 'full') {
            throw new Error(`evidence import closure cannot be derived: ${cruised.reason}`);
        }
        graph = new Map(cruised.modules.map((node) => [node.source, node]));
    }
    return {
        graph,
        cargo: needsCargo ? parseCargoMetadata(root, io.cargoMetadata(root)) : [],
        tracked: trackedFiles(root),
        root,
    };
}

/** The packages a command tests with `cargo test -p`. */
export function testedCrates(command: string): readonly string[] {
    const tokens = command.split(/\s+/u).filter((token) => token.length > 0);
    const crates: string[] = [];
    for (const [index, token] of tokens.entries()) {
        const crate = tokens[index + 1];
        if (token === '-p' && tokens[index - 2] === 'cargo' && tokens[index - 1] === 'test' && crate !== undefined) {
            crates.push(crate);
        }
    }
    return crates;
}

/** The package scripts a command invokes with `pnpm <script>`. */
function invokedScripts(command: string): readonly string[] {
    const tokens = command.split(/\s+/u).filter((token) => token.length > 0);
    return tokens.flatMap((token, index) => {
        const script = tokens[index + 1];
        return token === 'pnpm' && script !== undefined ? [script] : [];
    });
}

function packageScript(root: string, script: string): string {
    const body = field(field(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')), 'scripts'), script);
    if (typeof body !== 'string') {
        throw new TypeError(`package.json declares no script ${script}`);
    }
    return body;
}

const VITE_CONFIG = 'vite.config.ts';

/**
 * Every setup file `vite.config.ts` can hand Vitest, read from its source text as the harness specs
 * read it: the `setupFiles` expression is a conditional, so the union of its branches is pinned.
 */
function vitestSetupFiles(root: string): readonly string[] {
    const source = readFileSync(resolve(root, VITE_CONFIG), 'utf8');
    const expression = /\bsetupFiles:(?<body>[^;]*?\]),\n/u.exec(source)?.groups?.body;
    const files = Array.from(
        (expression ?? '').matchAll(/'\.\/(?<path>[^']+)'/gu),
        (match) => match.groups?.path ?? ''
    );
    if (files.length === 0 || files.includes('')) {
        throw new Error(`${VITE_CONFIG}: no Vitest setupFiles could be read`);
    }
    return files;
}

/**
 * Files a package script runs under: the repository files its `package.json` command names, the
 * files the contract declares its runner loads, and the Vitest setup files when it runs Vitest.
 */
function scriptRuntimeFiles(root: string, script: string): readonly string[] {
    const named = packageScript(root, script)
        .split(/\s+/u)
        .filter((token) => /^[\w.-]+\/[\w./-]+\.\w+$/u.test(token));
    const missing = named.find((path) => !existsSync(resolve(root, path)));
    if (missing !== undefined) {
        throw new Error(`package.json script ${script} runs ${missing}, which is not in the tree`);
    }
    const declared = EVIDENCE_SCRIPT_RUNTIME_FILES[script] ?? [];
    const setup = declared.includes(VITE_CONFIG) ? vitestSetupFiles(root) : [];
    return [...named, ...declared, ...setup];
}

/**
 * Where a suite's closure starts: its named code fixtures and the files its package scripts run
 * under as import roots, the crates its command tests, and its other named fixtures plus the path
 * reads the contract declares for it.
 */
export function suiteClosureSeed(root: string, suite: EvidenceSuite): ClosureSeed {
    const runtime = invokedScripts(suite.command).flatMap((script) => scriptRuntimeFiles(root, script));
    const declaredReads = EVIDENCE_SUITE_CLOSURE_READS[suite.id] ?? [];
    const starts = [...suite.fixtures.map(({ path }) => path), ...runtime];
    return {
        codeRoots: starts.filter(isCodeFile),
        crates: testedCrates(suite.command),
        reads: [...starts.filter((path) => !isCodeFile(path)), ...declaredReads],
    };
}

/** Each given suite's closure as the live tree carries it, from one import graph and one metadata read. */
export async function readLiveClosures(
    root: string,
    suites: readonly EvidenceSuite[],
    io: ClosureIo = DEFAULT_CLOSURE_IO
): Promise<ReadonlyMap<string, EvidenceClosure>> {
    if (suites.length === 0) {
        return new Map();
    }
    const seeds = suites.map((suite) => ({ id: suite.id, seed: suiteClosureSeed(root, suite) }));
    const inputs = await loadClosureInputs(
        root,
        seeds.map(({ seed }) => seed),
        io
    );
    return new Map(seeds.map(({ id, seed }) => [id, digestClosure(root, closurePaths(seed, inputs))]));
}

/** One blocker per closure file that moved since the run, or one for a closure never recorded or derived. */
export function closureBlockers(
    suite: EvidenceSuite,
    record: EvidenceRecord,
    live: EvidenceClosure | undefined
): readonly string[] {
    if (record.closure === null) {
        return [`${suite.id}: record carries no closure`];
    }
    if (live === undefined) {
        return [`${suite.id}: no live closure was derived for the record`];
    }
    return closureDrift(record.closure, live).map((path) => `${suite.id}: closure file drifted: ${path}`);
}

/** The closure boundaries plus the suite command itself, so a spec can stand in for both. */
export type GateRunIo = ClosureIo & {
    runCommand: (root: string, suite: EvidenceSuite) => { exitCode: number; durationMs: number };
};

export type StableClosureRun =
    | { kind: 'ran'; closure: EvidenceClosure; exitCode: number; durationMs: number }
    | { kind: 'drifted'; problems: readonly string[] };

async function liveClosureOf(root: string, suite: EvidenceSuite, io: ClosureIo): Promise<EvidenceClosure> {
    const closure = (await readLiveClosures(root, [suite], io)).get(suite.id);
    if (closure === undefined) {
        throw new Error(`${suite.id}: no closure was derived`);
    }
    return closure;
}

/**
 * Runs a suite between two closure derivations: the first refuses the run when the closure cannot
 * be derived, and the second refuses a run whose subject moved under it, which must leave no record
 * claiming either tree.
 */
export async function runAgainstStableClosure(
    root: string,
    suite: EvidenceSuite,
    io: GateRunIo
): Promise<StableClosureRun> {
    const closure = await liveClosureOf(root, suite, io);
    const run = io.runCommand(root, suite);
    const drift = closureDrift(closure, await liveClosureOf(root, suite, io));
    if (drift.length > 0) {
        return {
            kind: 'drifted',
            problems: drift.map((path) => `${suite.id}: closure file drifted during the run: ${path}`),
        };
    }
    return { kind: 'ran', closure, ...run };
}
