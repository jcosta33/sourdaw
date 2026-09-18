#!/usr/bin/env node

/**
 * Agent-campaign evidence gate runner. It validates the evidence manifest against the live tree,
 * runs one requirement's verify command and records what that run observed, or decides whether the
 * recorded runs still describe the current head. Contract and thresholds:
 * docs/architecture/agent-release-gates.md.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { format, resolveConfig } from 'prettier';

import { EVIDENCE_SUITE_COMMANDS, EVIDENCE_SUITE_DATA, EVIDENCE_TASK_GROUPINGS } from './evidenceGateContract.ts';
import {
    EVIDENCE_CAMPAIGN,
    EVIDENCE_CAPABILITY_INVENTORY_SOURCE,
    EVIDENCE_ENVIRONMENT_PATHS,
    EVIDENCE_MANIFEST_PATH,
    EVIDENCE_RECORDS_DIRECTORY,
    EVIDENCE_SCHEMA_VERSION,
    EVIDENCE_THRESHOLDS_PATH,
    computeFixtureDigest,
    parseEvidenceManifest,
    parseEvidenceRecord,
    sharedFixturePaths,
    validateEvidenceManifest,
    type EvidenceDigestedPath,
    type EvidenceFixture,
    type EvidenceManifest,
    type EvidenceOutcome,
    type EvidenceRecord,
    type EvidenceSuite,
    type EvidenceSuiteKind,
} from './evidenceManifest.ts';

export {
    EVIDENCE_MANIFEST_PATH,
    EVIDENCE_RECORDS_DIRECTORY,
    EVIDENCE_SCHEMA_VERSION,
    computeFixtureDigest,
    parseEvidenceManifest,
    parseEvidenceRecord,
    validateEvidenceManifest,
};

export type { EvidenceDigestedPath, EvidenceFixture, EvidenceManifest, EvidenceRecord, EvidenceSuite };

/**
 * The two manifest digests that are values of the running application rather than of any file. The
 * `#/` module alias resolves under the test runner, not under plain Node, so the generator takes
 * them as input instead of evaluating them.
 */
export type AppDerivedDigests = { capabilityInventory: string; census: string };

const FIXTURE_PREFIXES = ['src/', 'scripts/', 'tests/', 'evidence/'] as const;

/**
 * Gates already running in this process tree. A verify command may invoke this runner on the very
 * gate that runs it, which would not terminate without the guard.
 */
const ACTIVE_GATES_ENV = 'SOURDAW_EVIDENCE_ACTIVE_GATES';

const BLOCKED_EXIT_CODE = 2;

/**
 * Paths a verify command reads: the repository-relative file arguments it names, and the source tree
 * of every crate it tests. The manifest's own path is excluded — it cannot carry its own digest.
 */
function commandFixturePaths(command: string): readonly string[] {
    const tokens = command.split(/\s+/u).filter((token) => token.length > 0);
    const paths: string[] = [];
    for (const [index, token] of tokens.entries()) {
        if (FIXTURE_PREFIXES.some((prefix) => token.startsWith(prefix)) && token !== EVIDENCE_MANIFEST_PATH) {
            paths.push(token);
        }
        const crate = tokens[index + 1];
        if (token === '-p' && tokens[index - 2] === 'cargo' && tokens[index - 1] === 'test' && crate !== undefined) {
            paths.push(`crates/${crate}/src`);
        }
    }
    return [...new Set(paths)].sort();
}

/**
 * A suite's fixtures: the paths its command's own text names, plus the data files
 * `EVIDENCE_SUITE_DATA` declares for it — files a command loads at runtime rather than names on its
 * own command line, so `commandFixturePaths` can never discover them by parsing tokens.
 */
function suiteFixturePaths(id: string, command: string): readonly string[] {
    const dataFixtures = EVIDENCE_SUITE_DATA[id] ?? [];
    return [...new Set([...commandFixturePaths(command), ...dataFixtures])].sort();
}

/**
 * Every suite's command must equal the frozen contract's verbatim text. `evidenceManifest.ts` stays
 * free of any dependency beyond node builtins (the app's baseline spec type-checks it too), so this
 * check lives here rather than in `validateEvidenceManifest`: it is the one caller that already
 * imports both the parsed manifest and `EVIDENCE_SUITE_COMMANDS`.
 */
function validateSuiteCommands(manifest: EvidenceManifest): readonly string[] {
    const problems: string[] = [];
    for (const suite of manifest.suites) {
        const contractCommand = EVIDENCE_SUITE_COMMANDS[suite.id];
        if (contractCommand === undefined) {
            problems.push(`${suite.id}: the frozen contract names no command for this suite`);
            continue;
        }
        if (suite.command !== contractCommand) {
            problems.push(`${suite.id}: manifest command does not match the frozen contract command`);
        }
    }
    return problems;
}

function suiteKindOf(command: string): EvidenceSuiteKind {
    const rust = command.indexOf('cargo test');
    if (rust < 0) {
        return 'unit';
    }
    const unit = command.indexOf('pnpm test:run');
    if (unit < 0 || rust < unit) {
        return 'rust+unit';
    }
    return 'unit+rust';
}

function buildFixture(root: string, path: string): EvidenceFixture {
    const digest = computeFixtureDigest(root, path);
    if (digest === null) {
        return { path, digest: null, status: 'absent' };
    }
    return { path, digest };
}

function buildSuites(root: string): readonly EvidenceSuite[] {
    const owner = new Map<string, string>();
    for (const task of EVIDENCE_TASK_GROUPINGS) {
        for (const gate of task.gates) {
            owner.set(gate, task.id);
        }
    }
    return Object.entries(EVIDENCE_SUITE_COMMANDS)
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([id, command]) => {
            const task = owner.get(id);
            if (task === undefined) {
                throw new Error(`${id}: no task owns this requirement`);
            }
            return {
                id,
                task,
                kind: suiteKindOf(command),
                command,
                fixtures: suiteFixturePaths(id, command).map((path) => buildFixture(root, path)),
            };
        });
}

function requireDigest(root: string, path: string): string {
    const digest = computeFixtureDigest(root, path);
    if (digest === null) {
        throw new Error(`${path}: the evidence manifest requires this path, which is missing from ${root}`);
    }
    return digest;
}

function carriedAppDigests(root: string): AppDerivedDigests {
    const absolute = resolve(root, EVIDENCE_MANIFEST_PATH);
    if (!existsSync(absolute)) {
        throw new Error(
            `${EVIDENCE_MANIFEST_PATH}: the capability inventory and census digests are evaluated by the application, ` +
                'so a first write must supply them with --capability-digest and --census-digest'
        );
    }
    const manifest = parseEvidenceManifest(readFileSync(absolute, 'utf8'));
    return { capabilityInventory: manifest.capabilityInventory.digest, census: manifest.census.digest };
}

export function buildEvidenceManifest(root: string, appDigests?: AppDerivedDigests): EvidenceManifest {
    const suites = buildSuites(root);
    const derived = appDigests ?? carriedAppDigests(root);
    return {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        campaign: EVIDENCE_CAMPAIGN,
        thresholds: { path: EVIDENCE_THRESHOLDS_PATH, digest: requireDigest(root, EVIDENCE_THRESHOLDS_PATH) },
        capabilityInventory: {
            source: EVIDENCE_CAPABILITY_INVENTORY_SOURCE,
            digest: derived.capabilityInventory,
        },
        census: { digest: derived.census },
        environment: [...EVIDENCE_ENVIRONMENT_PATHS],
        tasks: EVIDENCE_TASK_GROUPINGS.map(({ id, gates }) => ({ id, gates: [...gates] })),
        suites,
        collisions: sharedFixturePaths(suites),
    };
}

/**
 * What the manifest itself pins: the thresholds document and the suite fixtures. Environment digests
 * belong to a gate record, so a dependency bump never makes the manifest stale.
 */
function recordedDigestedPaths(manifest: EvidenceManifest): readonly EvidenceFixture[] {
    return [manifest.thresholds, ...manifest.suites.flatMap((suite) => suite.fixtures)];
}

/** The digest each environment input carries in the live tree, for one run's record. */
export function readEnvironmentDigests(root: string, manifest: EvidenceManifest): readonly EvidenceDigestedPath[] {
    return manifest.environment.map((path) => ({ path, digest: requireDigest(root, path) }));
}

export function readLiveDigests(root: string, manifest: EvidenceManifest): ReadonlyMap<string, string | null> {
    const live = new Map<string, string | null>();
    for (const { path } of recordedDigestedPaths(manifest)) {
        if (!live.has(path)) {
            live.set(path, computeFixtureDigest(root, path));
        }
    }
    return live;
}

export function compareDigests(
    manifest: EvidenceManifest,
    live: ReadonlyMap<string, string | null>
): readonly string[] {
    const stale = new Set<string>();
    for (const { path, digest } of recordedDigestedPaths(manifest)) {
        if ((live.get(path) ?? null) !== digest) {
            stale.add(path);
        }
    }
    return [...stale].sort();
}

export function selectGate(manifest: EvidenceManifest, taskId: string, gateId: string): EvidenceSuite {
    const task = manifest.tasks.find(({ id }) => id === taskId);
    if (task === undefined) {
        throw new Error(`${taskId}: the evidence manifest declares no such task`);
    }
    if (!task.gates.includes(gateId)) {
        throw new Error(`${gateId}: not a gate of ${taskId}`);
    }
    const suite = manifest.suites.find(({ id }) => id === gateId);
    if (suite === undefined) {
        throw new Error(`${gateId}: no suite declares this gate`);
    }
    return suite;
}

/**
 * Paths whose recorded digest no longer describes what the release answers to: the suite fixtures
 * the manifest pins, and the environment inputs as the live tree carries them now.
 */
function driftedRecordPaths(
    suite: EvidenceSuite,
    record: EvidenceRecord,
    environment: readonly EvidenceDigestedPath[]
): readonly string[] {
    const observed = new Map<string, string | null>();
    for (const entry of [...record.environment, ...record.fixtures]) {
        observed.set(entry.path, entry.digest);
    }
    const drifted: string[] = [];
    for (const entry of [...environment, ...suite.fixtures]) {
        if (!observed.has(entry.path) || observed.get(entry.path) !== entry.digest) {
            drifted.push(entry.path);
        }
    }
    return drifted;
}

function releaseBlockers(
    manifest: EvidenceManifest,
    suite: EvidenceSuite,
    record: EvidenceRecord,
    release: ReleaseState
): readonly string[] {
    const { head } = release;
    const blockers: string[] = [];
    if (record.integratedCommit !== head) {
        blockers.push(`${suite.id}: record integrates ${record.integratedCommit}, not the current head ${head}`);
    }
    if (record.capabilityInventoryDigest !== manifest.capabilityInventory.digest) {
        blockers.push(`${suite.id}: record capability inventory digest drifted`);
    }
    for (const path of driftedRecordPaths(suite, record, release.environment)) {
        blockers.push(`${suite.id}: record digest drifted for ${path}`);
    }
    if (record.outcome !== 'passed') {
        blockers.push(`${suite.id}: record outcome is ${record.outcome}, not passed`);
    }
    return blockers;
}

/** The head a release answers to, and the environment digests the live tree carries for it. */
export type ReleaseState = { head: string; environment: readonly EvidenceDigestedPath[] };

export function evaluateRelease(
    manifest: EvidenceManifest,
    records: readonly EvidenceRecord[],
    release: ReleaseState
): { blockers: readonly string[] } {
    const bySuite = new Map(records.map((record) => [record.suite, record]));
    const blockers: string[] = [];
    for (const suite of manifest.suites) {
        const record = bySuite.get(suite.id);
        if (record === undefined) {
            blockers.push(`${suite.id}: no record at ${EVIDENCE_RECORDS_DIRECTORY}/${suite.id}.json`);
            continue;
        }
        blockers.push(...releaseBlockers(manifest, suite, record, release));
    }
    return { blockers };
}

/**
 * The AC-056 source-examples corpus, read beside the manifest when present. The path is fixed here
 * rather than derived from `EVIDENCE_SUITE_COMMANDS`: the corpus is data the release evaluation
 * reads, not a fixture a suite command names.
 */
export const SOURCE_EXAMPLES_CORPUS_PATH = 'evidence/agent-campaign/corpora/source-examples.json';

const SOURCE_EXAMPLE_DISPOSITIONS = ['recovered', 'deferred', 'unrecovered'] as const;

type SourceExampleDisposition = (typeof SOURCE_EXAMPLE_DISPOSITIONS)[number];

type SourceExample = { id: string; disposition: SourceExampleDisposition };

function asSourceExamplesRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${label}: expected an object`);
    }
    return value as Record<string, unknown>;
}

function parseSourceExample(value: unknown, label: string): SourceExample {
    const entry = asSourceExamplesRecord(value, label);
    if (typeof entry.id !== 'string') {
        throw new TypeError(`${label}.id: expected a string`);
    }
    const disposition = SOURCE_EXAMPLE_DISPOSITIONS.find((candidate) => candidate === entry.disposition);
    if (disposition === undefined) {
        throw new Error(`${label}.disposition: unknown disposition ${JSON.stringify(entry.disposition)}`);
    }
    return { id: entry.id, disposition };
}

/** Parses the corpus with the same strict, throw-on-shape-mismatch style as `evidenceManifest.ts`. */
function parseSourceExamplesCorpus(text: string): readonly SourceExample[] {
    const root = asSourceExamplesRecord(JSON.parse(text), SOURCE_EXAMPLES_CORPUS_PATH);
    if (!Array.isArray(root.examples)) {
        throw new TypeError(`${SOURCE_EXAMPLES_CORPUS_PATH}.examples: expected an array`);
    }
    return root.examples.map((example, index) =>
        parseSourceExample(example, `${SOURCE_EXAMPLES_CORPUS_PATH}.examples[${index}]`)
    );
}

/**
 * One release blocker per source example the AC-056 corpus still records as unrecovered, plus a
 * standalone blocker when the corpus itself is missing: a release cannot claim AC-056 complete
 * while an example carries no recoverable definition or the corpus that would say so is absent.
 */
export function sourceExampleReleaseBlockers(root: string): readonly string[] {
    const absolute = resolve(root, SOURCE_EXAMPLES_CORPUS_PATH);
    if (!existsSync(absolute)) {
        return ['source examples corpus missing'];
    }
    return parseSourceExamplesCorpus(readFileSync(absolute, 'utf8'))
        .filter((example) => example.disposition === 'unrecovered')
        .map((example) => `source-example ${example.id}: unrecovered`);
}

function readRecords(root: string, manifest: EvidenceManifest): readonly EvidenceRecord[] {
    const records: EvidenceRecord[] = [];
    for (const suite of manifest.suites) {
        const path = `${EVIDENCE_RECORDS_DIRECTORY}/${suite.id}.json`;
        const absolute = resolve(root, path);
        if (existsSync(absolute)) {
            records.push(parseEvidenceRecord(readFileSync(absolute, 'utf8'), path));
        }
    }
    return records;
}

function writeRecord(root: string, record: EvidenceRecord): void {
    const absolute = resolve(root, EVIDENCE_RECORDS_DIRECTORY, `${record.suite}.json`);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(record, null, 4)}\n`);
}

/** Written through the repository formatter, so the committed manifest is the formatter's own form. */
async function writeManifestFile(absolute: string, manifest: EvidenceManifest): Promise<void> {
    const options = await resolveConfig(absolute);
    const formatted = await format(`${JSON.stringify(manifest, null, 4)}\n`, { ...options, filepath: absolute });
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, formatted);
}

/**
 * The manifest's own location fixes the repository root, so every mode resolves fixtures, records,
 * and the head commit against the tree the manifest describes rather than against the caller's cwd.
 */
function repositoryRootFor(manifestPath: string): string {
    const root = resolve(manifestPath, '../../..');
    if (resolve(root, EVIDENCE_MANIFEST_PATH) !== manifestPath) {
        throw new Error(`${manifestPath}: the manifest must live at ${EVIDENCE_MANIFEST_PATH} within its repository`);
    }
    return root;
}

function headCommit(root: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function activeGates(): readonly string[] {
    return (process.env[ACTIVE_GATES_ENV] ?? '').split(':').filter((id) => id.length > 0);
}

function liveProblems(root: string, manifest: EvidenceManifest): readonly string[] {
    return compareDigests(manifest, readLiveDigests(root, manifest)).map(
        (path) => `${path}: recorded digest differs from the live tree`
    );
}

function report(problems: readonly string[]): number {
    for (const problem of problems) {
        console.error(problem);
    }
    if (problems.length === 0) {
        return 0;
    }
    return 1;
}

function gateScope(manifest: EvidenceManifest, suite: EvidenceSuite): EvidenceManifest {
    return { ...manifest, suites: [suite], collisions: [] };
}

function blockedFixtures(root: string, suite: EvidenceSuite): readonly string[] {
    return suite.fixtures
        .filter((fixture) => computeFixtureDigest(root, fixture.path) === null)
        .map(({ path }) => path);
}

function newRecord(
    manifest: EvidenceManifest,
    suite: EvidenceSuite,
    observed: ReleaseState,
    run: { startedAt: string; durationMs: number; exitCode: number; outcome: EvidenceOutcome }
): EvidenceRecord {
    return {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        suite: suite.id,
        task: suite.task,
        command: suite.command,
        integratedCommit: observed.head,
        capabilityInventoryDigest: manifest.capabilityInventory.digest,
        fixtures: suite.fixtures,
        environment: observed.environment,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        exitCode: run.exitCode,
        outcome: run.outcome,
    };
}

function runSuiteCommand(root: string, suite: EvidenceSuite): { exitCode: number; durationMs: number } {
    const contractCommand = EVIDENCE_SUITE_COMMANDS[suite.id];
    if (suite.command !== contractCommand) {
        throw new Error(`${suite.id}: refusing to run a command that does not match the frozen contract`);
    }
    const started = Date.now();
    const result = spawnSync(suite.command, {
        cwd: root,
        shell: true,
        stdio: 'inherit',
        env: { ...process.env, [ACTIVE_GATES_ENV]: [...activeGates(), suite.id].join(':') },
    });
    if (result.error !== undefined) {
        throw new Error(`${suite.id}: ${suite.command} could not start`, { cause: result.error });
    }
    return { exitCode: result.status ?? 1, durationMs: Date.now() - started };
}

function runBlockedGate(
    root: string,
    manifest: EvidenceManifest,
    suite: EvidenceSuite,
    blocked: readonly string[]
): number {
    for (const path of blocked) {
        console.error(`${suite.id}: fixture ${path} does not exist`);
    }
    const run = { startedAt: new Date().toISOString(), durationMs: 0, exitCode: 0, outcome: 'blocked' } as const;
    const observed = { head: headCommit(root), environment: readEnvironmentDigests(root, manifest) };
    writeRecord(root, newRecord(manifest, suite, observed, run));
    return BLOCKED_EXIT_CODE;
}

function runGate(root: string, manifest: EvidenceManifest, taskId: string, gateId: string): number {
    const suite = selectGate(manifest, taskId, gateId);
    if (suite.kind === 'manual') {
        throw new Error(`${suite.id}: a manual suite carries no runnable command`);
    }
    if (activeGates().includes(suite.id)) {
        console.error(`${suite.id}: already running in this process tree; validated without running it again`);
        return report(liveProblems(root, gateScope(manifest, suite)));
    }
    const blocked = blockedFixtures(root, suite);
    if (blocked.length > 0) {
        return runBlockedGate(root, manifest, suite, blocked);
    }
    const stale = liveProblems(root, gateScope(manifest, suite));
    if (stale.length > 0) {
        return report(stale);
    }
    const observed = { head: headCommit(root), environment: readEnvironmentDigests(root, manifest) };
    const startedAt = new Date().toISOString();
    const run = runSuiteCommand(root, suite);
    const outcome: EvidenceOutcome = run.exitCode === 0 ? 'passed' : 'failed';
    writeRecord(root, newRecord(manifest, suite, observed, { startedAt, ...run, outcome }));
    return run.exitCode;
}

function runRelease(root: string, manifest: EvidenceManifest): number {
    const release = { head: headCommit(root), environment: readEnvironmentDigests(root, manifest) };
    const { blockers } = evaluateRelease(manifest, readRecords(root, manifest), release);
    return report([...blockers, ...sourceExampleReleaseBlockers(root)]);
}

type EvidenceGateOptions = {
    manifest: string;
    task: string | undefined;
    gate: string | undefined;
    release: boolean;
    write: boolean;
    appDigests: AppDerivedDigests | undefined;
};

function parseAppDigests(capability: string | undefined, census: string | undefined): AppDerivedDigests | undefined {
    if (capability === undefined && census === undefined) {
        return undefined;
    }
    if (capability === undefined || census === undefined) {
        throw new Error('--capability-digest and --census-digest are given together');
    }
    return { capabilityInventory: capability, census };
}

function parseOptions(argv: readonly string[]): EvidenceGateOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            manifest: { type: 'string' },
            task: { type: 'string' },
            gate: { type: 'string' },
            release: { type: 'boolean' },
            write: { type: 'boolean' },
            'capability-digest': { type: 'string' },
            'census-digest': { type: 'string' },
        },
        allowPositionals: false,
    });
    if (values.manifest === undefined) {
        throw new Error('--manifest <path> is required');
    }
    if (values.release === true && (values.task !== undefined || values.gate !== undefined)) {
        throw new Error('--release never runs a gate: drop --task and --gate');
    }
    if ((values.task === undefined) !== (values.gate === undefined)) {
        throw new Error('--task and --gate are given together');
    }
    return {
        manifest: values.manifest,
        task: values.task,
        gate: values.gate,
        release: values.release === true,
        write: values.write === true,
        appDigests: parseAppDigests(values['capability-digest'], values['census-digest']),
    };
}

export async function main(argv: readonly string[]): Promise<number> {
    const options = parseOptions(argv);
    const manifestPath = resolve(process.cwd(), options.manifest);
    const root = repositoryRootFor(manifestPath);
    if (options.write) {
        await writeManifestFile(manifestPath, buildEvidenceManifest(root, options.appDigests));
        return 0;
    }
    const manifest = parseEvidenceManifest(readFileSync(manifestPath, 'utf8'));
    const structural = [...validateEvidenceManifest(manifest), ...validateSuiteCommands(manifest)];
    if (structural.length > 0) {
        return report(structural);
    }
    if (options.task !== undefined && options.gate !== undefined) {
        return runGate(root, manifest, options.task, options.gate);
    }
    const problems = liveProblems(root, manifest);
    if (problems.length > 0) {
        return report(problems);
    }
    if (options.release) {
        return runRelease(root, manifest);
    }
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        process.exit(await main(process.argv.slice(2)));
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
