/**
 * Schema, parser, validator, and path digests of the agent-campaign evidence manifest. Kept free of
 * any dependency beyond node builtins: the gate runner imports it under Node type stripping, and
 * `scripts/__tests__/agentCampaignHarness.spec.ts` imports it as a plain script test. Nothing under
 * `src/` may import this module; `src/app/__tests__/agentCampaignBaseline.spec.ts` parses the
 * committed manifest itself with a local minimal type instead. Contract:
 * docs/architecture/agent-release-gates.md.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export type EvidenceDigestedPath = { path: string; digest: string };

export type EvidenceFixture = { path: string; digest: string | null; status?: 'absent' };

export type EvidenceSuiteKind = 'unit' | 'unit+rust' | 'rust+unit' | 'manual';

export type EvidenceSuite = {
    id: string;
    task: string;
    kind: EvidenceSuiteKind;
    command: string;
    fixtures: readonly EvidenceFixture[];
};

export type EvidenceTask = { id: string; gates: readonly string[] };

export type EvidenceCollision = { path: string; suites: readonly string[] };

export type EvidenceManifest = {
    schemaVersion: number;
    campaign: string;
    thresholds: EvidenceDigestedPath;
    capabilityInventory: { source: string; digest: string };
    census: { digest: string };
    environment: readonly string[];
    tasks: readonly EvidenceTask[];
    suites: readonly EvidenceSuite[];
    collisions: readonly EvidenceCollision[];
};

export type EvidenceOutcome = 'passed' | 'failed' | 'blocked';

export type EvidenceRecord = {
    schemaVersion: number;
    suite: string;
    task: string;
    command: string;
    integratedCommit: string;
    capabilityInventoryDigest: string;
    fixtures: readonly EvidenceFixture[];
    environment: readonly EvidenceDigestedPath[];
    startedAt: string;
    durationMs: number;
    exitCode: number;
    outcome: EvidenceOutcome;
};

export const EVIDENCE_SCHEMA_VERSION = 1;
export const EVIDENCE_CAMPAIGN = 'sourdaw-agent-production-system';
export const EVIDENCE_MANIFEST_PATH = 'evidence/agent-campaign/manifest.json';
export const EVIDENCE_RECORDS_DIRECTORY = 'evidence/agent-campaign/records';
export const EVIDENCE_THRESHOLDS_PATH = 'docs/architecture/agent-release-gates.md';
export const EVIDENCE_CAPABILITY_INVENTORY_SOURCE = 'src/app/getAgentProtocolManifest.ts';

/**
 * Resolution inputs a gate run observes. The manifest carries their paths only: their bytes move
 * with ordinary dependency work, and what a run resolved against belongs to that run's record.
 */
export const EVIDENCE_ENVIRONMENT_PATHS = [
    'package.json',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'tsconfig.json',
    'vite.config.ts',
] as const;

const SUITE_KINDS: readonly EvidenceSuiteKind[] = ['unit', 'unit+rust', 'rust+unit', 'manual'];
const OUTCOMES: readonly EvidenceOutcome[] = ['passed', 'failed', 'blocked'];
const SHA256_HEX = /^[0-9a-f]{64}$/u;

function hashFile(absolute: string): string {
    return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

function collectFiles(absolute: string): readonly string[] {
    const files: string[] = [];
    const visit = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const child = resolve(current, entry.name);
            if (entry.isDirectory()) {
                visit(child);
                continue;
            }
            if (entry.isFile()) {
                files.push(child);
            }
        }
    };
    visit(absolute);
    return files.sort();
}

/** Relative path and bytes of every file in sorted order, so one tree always digests the same. */
function hashDirectory(absolute: string): string {
    const hash = createHash('sha256');
    for (const file of collectFiles(absolute)) {
        hash.update(relative(absolute, file).replaceAll('\\', '/'));
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
    }
    return hash.digest('hex');
}

/** Digest of a file's bytes or of a whole tree; null when the path does not exist. */
export function computeFixtureDigest(root: string, path: string): string | null {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) {
        return null;
    }
    if (statSync(absolute).isDirectory()) {
        return hashDirectory(absolute);
    }
    return hashFile(absolute);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${label}: expected an object`);
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new TypeError(`${label}: expected a string`);
    }
    return value;
}

function asNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${label}: expected a number`);
    }
    return value;
}

function asArray(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`${label}: expected an array`);
    }
    return value;
}

function parseDigestedPath(value: unknown, label: string): EvidenceDigestedPath {
    const entry = asRecord(value, label);
    return { path: asString(entry.path, `${label}.path`), digest: asString(entry.digest, `${label}.digest`) };
}

function parseFixture(value: unknown, label: string): EvidenceFixture {
    const entry = asRecord(value, label);
    const path = asString(entry.path, `${label}.path`);
    if (entry.digest === null) {
        if (entry.status !== 'absent') {
            throw new Error(`${label}: ${path} carries no digest and is not marked absent`);
        }
        return { path, digest: null, status: 'absent' };
    }
    if (entry.status !== undefined) {
        throw new Error(`${label}: ${path} carries both a digest and a status`);
    }
    return { path, digest: asString(entry.digest, `${label}.digest`) };
}

function parseSuiteKind(value: unknown, label: string): EvidenceSuiteKind {
    const kind = SUITE_KINDS.find((candidate) => candidate === value);
    if (kind === undefined) {
        throw new Error(`${label}: unknown suite kind ${JSON.stringify(value)}`);
    }
    return kind;
}

function parseOutcome(value: unknown, label: string): EvidenceOutcome {
    const outcome = OUTCOMES.find((candidate) => candidate === value);
    if (outcome === undefined) {
        throw new Error(`${label}: unknown outcome ${JSON.stringify(value)}`);
    }
    return outcome;
}

function parseSuite(value: unknown, label: string): EvidenceSuite {
    const entry = asRecord(value, label);
    return {
        id: asString(entry.id, `${label}.id`),
        task: asString(entry.task, `${label}.task`),
        kind: parseSuiteKind(entry.kind, `${label}.kind`),
        command: asString(entry.command, `${label}.command`),
        fixtures: asArray(entry.fixtures, `${label}.fixtures`).map((fixture, index) =>
            parseFixture(fixture, `${label}.fixtures[${index}]`)
        ),
    };
}

function parseTask(value: unknown, label: string): EvidenceTask {
    const entry = asRecord(value, label);
    return {
        id: asString(entry.id, `${label}.id`),
        gates: asArray(entry.gates, `${label}.gates`).map((gate, index) => asString(gate, `${label}.gates[${index}]`)),
    };
}

function parseCollision(value: unknown, label: string): EvidenceCollision {
    const entry = asRecord(value, label);
    return {
        path: asString(entry.path, `${label}.path`),
        suites: asArray(entry.suites, `${label}.suites`).map((suite, index) =>
            asString(suite, `${label}.suites[${index}]`)
        ),
    };
}

export function parseEvidenceManifest(text: string): EvidenceManifest {
    const root = asRecord(JSON.parse(text), EVIDENCE_MANIFEST_PATH);
    const capability = asRecord(root.capabilityInventory, 'capabilityInventory');
    const census = asRecord(root.census, 'census');
    return {
        schemaVersion: asNumber(root.schemaVersion, 'schemaVersion'),
        campaign: asString(root.campaign, 'campaign'),
        thresholds: parseDigestedPath(root.thresholds, 'thresholds'),
        capabilityInventory: {
            source: asString(capability.source, 'capabilityInventory.source'),
            digest: asString(capability.digest, 'capabilityInventory.digest'),
        },
        census: { digest: asString(census.digest, 'census.digest') },
        environment: asArray(root.environment, 'environment').map((entry, index) =>
            asString(entry, `environment[${index}]`)
        ),
        tasks: asArray(root.tasks, 'tasks').map((task, index) => parseTask(task, `tasks[${index}]`)),
        suites: asArray(root.suites, 'suites').map((suite, index) => parseSuite(suite, `suites[${index}]`)),
        collisions: asArray(root.collisions, 'collisions').map((collision, index) =>
            parseCollision(collision, `collisions[${index}]`)
        ),
    };
}

export function parseEvidenceRecord(text: string, label: string): EvidenceRecord {
    const entry = asRecord(JSON.parse(text), label);
    return {
        schemaVersion: asNumber(entry.schemaVersion, `${label}.schemaVersion`),
        suite: asString(entry.suite, `${label}.suite`),
        task: asString(entry.task, `${label}.task`),
        command: asString(entry.command, `${label}.command`),
        integratedCommit: asString(entry.integratedCommit, `${label}.integratedCommit`),
        capabilityInventoryDigest: asString(entry.capabilityInventoryDigest, `${label}.capabilityInventoryDigest`),
        fixtures: asArray(entry.fixtures, `${label}.fixtures`).map((fixture, index) =>
            parseFixture(fixture, `${label}.fixtures[${index}]`)
        ),
        environment: asArray(entry.environment, `${label}.environment`).map((item, index) =>
            parseDigestedPath(item, `${label}.environment[${index}]`)
        ),
        startedAt: asString(entry.startedAt, `${label}.startedAt`),
        durationMs: asNumber(entry.durationMs, `${label}.durationMs`),
        exitCode: asNumber(entry.exitCode, `${label}.exitCode`),
        outcome: parseOutcome(entry.outcome, `${label}.outcome`),
    };
}

function sortCollisions(collisions: readonly EvidenceCollision[]): readonly EvidenceCollision[] {
    return collisions
        .map(({ path, suites }) => ({ path, suites: [...suites].sort() }))
        .sort((left, right) => (left.path < right.path ? -1 : 1));
}

/** Append to the list a key holds, creating that list on its first use. */
function appendTo(index: Map<string, string[]>, key: string, value: string): void {
    const existing = index.get(key);
    if (existing === undefined) {
        index.set(key, [value]);
        return;
    }
    existing.push(value);
}

/** Fixture paths more than one suite reads: those suites cannot record independent evidence. */
export function sharedFixturePaths(suites: readonly EvidenceSuite[]): readonly EvidenceCollision[] {
    const readers = new Map<string, string[]>();
    for (const suite of suites) {
        for (const fixture of suite.fixtures) {
            appendTo(readers, fixture.path, suite.id);
        }
    }
    const entries = [...readers.entries()];
    const shared = entries.filter(([, ids]) => ids.length > 1);
    return sortCollisions(shared.map(([path, ids]) => ({ path, suites: ids })));
}

function validateSchema(manifest: EvidenceManifest): readonly string[] {
    const problems: string[] = [];
    if (manifest.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
        problems.push(`schemaVersion ${manifest.schemaVersion} is not ${EVIDENCE_SCHEMA_VERSION}`);
    }
    if (manifest.campaign.length === 0) {
        problems.push('campaign is empty');
    }
    const digests = [
        ['thresholds.digest', manifest.thresholds.digest],
        ['capabilityInventory.digest', manifest.capabilityInventory.digest],
        ['census.digest', manifest.census.digest],
    ] as const;
    for (const [label, digest] of digests) {
        if (!SHA256_HEX.test(digest)) {
            problems.push(`${label} is not a sha-256 digest`);
        }
    }
    return problems;
}

function validateSuiteIdentity(manifest: EvidenceManifest): readonly string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const suite of manifest.suites) {
        if (seen.has(suite.id)) {
            problems.push(`suite ${suite.id} is declared more than once`);
        }
        seen.add(suite.id);
        if (suite.command.length === 0) {
            problems.push(`suite ${suite.id} carries no command`);
        }
    }
    return problems;
}

function validateTaskOwnership(manifest: EvidenceManifest): readonly string[] {
    const problems: string[] = [];
    const declared = new Set(manifest.suites.map((suite) => suite.id));
    const owners = new Map<string, string[]>();
    for (const task of manifest.tasks) {
        for (const gate of task.gates) {
            if (!declared.has(gate)) {
                problems.push(`task ${task.id} gate ${gate} names no suite`);
            }
            appendTo(owners, gate, task.id);
        }
    }
    for (const suite of manifest.suites) {
        const owning = owners.get(suite.id) ?? [];
        if (owning.length !== 1) {
            problems.push(`suite ${suite.id} belongs to ${owning.length} tasks, not one`);
            continue;
        }
        if (owning[0] !== suite.task) {
            problems.push(`suite ${suite.id} records task ${suite.task} but ${owning[0]} owns it`);
        }
    }
    return problems;
}

function validateDigestedPaths(manifest: EvidenceManifest): readonly string[] {
    const problems: string[] = [];
    if (manifest.environment.some((path) => path.length === 0)) {
        problems.push('environment carries an entry without a path');
    }
    for (const suite of manifest.suites) {
        for (const fixture of suite.fixtures) {
            if (fixture.path.length === 0) {
                problems.push(`suite ${suite.id} carries a fixture without a path`);
            }
            if (fixture.digest !== null && !SHA256_HEX.test(fixture.digest)) {
                problems.push(`suite ${suite.id} fixture ${fixture.path} is not a sha-256 digest`);
            }
        }
    }
    return problems;
}

function validateCollisions(manifest: EvidenceManifest): readonly string[] {
    const expected = JSON.stringify(sharedFixturePaths(manifest.suites));
    const recorded = JSON.stringify(sortCollisions(manifest.collisions));
    if (expected === recorded) {
        return [];
    }
    return ['collisions do not match the fixture paths the suites share'];
}

export function validateEvidenceManifest(manifest: EvidenceManifest): readonly string[] {
    return [
        ...validateSchema(manifest),
        ...validateSuiteIdentity(manifest),
        ...validateTaskOwnership(manifest),
        ...validateDigestedPaths(manifest),
        ...validateCollisions(manifest),
    ];
}
