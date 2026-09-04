#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkProjectLicense } from './checkProjectLicense.ts';
import {
    checkReleaseInventory,
    fileSha256,
    pathAddressedSha256,
    projectLicenseDistributionReleaseInventoryContract,
    REQUIRED_SNAPSHOT_PATHS,
    SNAPSHOT_DIGEST_SURFACES,
    type ReleaseInventory,
} from './checkReleaseInventory.ts';
import {
    assertLicenseExpressionEvidence,
    cargoRegistryArchiveSource,
    collectCargoDependencyLicensesFromInstalledMetadata,
    collectNpmDependencyLicenses,
    collectNpmLockDependencyLicenses,
    DEPENDENCY_LICENSE_PROOFS_PATH,
    DEPENDENCY_LICENSE_REPORT_PATH,
    expectedProofIdentities,
    mergeDependencyLicenseRecords,
    readDependencyLicenseProofSourceManifest,
    readLegalFile,
    selectCanonicalSpdxLicenses,
    SERVER_THIRD_PARTY_NOTICES_PATH,
    type DependencyLicenseProof,
    type DependencyLicenseProofSourceManifest,
    type DependencyLicenseRecord,
} from './dependencyLicenseReport.ts';
import { writeDependencyLicenseArtifacts } from './generateDependencyLicenseReport.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';

export const RELEASE_INVENTORY_PATH = 'release/open-source-inventory.json';

/**
 * Every other digest class pins a release surface this command has no evidence about, so restamping
 * one would bless a change nobody decided to make.
 */
export const UNRESTAMPED_DIGEST_CLASSES =
    'not restamped: Grand Boule tracked-set, WASM, DDSP, Electron, Levain, trademark, and owner-asset digests — drift there is a release-surface change rather than dependency-bump drift, and it needs a person.';

const PROJECT_LICENSE_SURFACE_ID = 'project-license-distribution';
const REQUIRED_SNAPSHOT_PATH_SET = new Set<string>(REQUIRED_SNAPSHOT_PATHS);
const DEPENDENCY_LICENSE_ARTIFACT_PATHS = [
    DEPENDENCY_LICENSE_PROOFS_PATH,
    DEPENDENCY_LICENSE_REPORT_PATH,
    SERVER_THIRD_PARTY_NOTICES_PATH,
] as const;
const RESTAMPED_DIGEST_PATHS = new Set<string>([
    ...DEPENDENCY_LICENSE_ARTIFACT_PATHS,
    ...Object.keys(SNAPSHOT_DIGEST_SURFACES),
]);

export type InstalledDependencies = {
    records: DependencyLicenseRecord[];
    cargoSourceDirectories: Readonly<Record<string, string>>;
};

export type RestampOptions = {
    resolveInstalled?: (root: string) => InstalledDependencies;
    writeArtifacts?: (root: string) => void;
    verify?: (root: string) => string[];
    cargoHome?: string;
};

export type RestampResult = {
    ok: boolean;
    output: string;
};

type ProofAttempt = { proof: DependencyLicenseProof } | { refusal: string };

type AssembledEvidence = { assembled: NonNullable<DependencyLicenseProof['assembled']> } | { refusal: string };

type ProofReconciliation = {
    packages: Record<string, DependencyLicenseProof>;
    changes: string[];
    refusals: string[];
};

function sha256(contents: Buffer): string {
    return createHash('sha256').update(contents).digest('hex');
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function packageId(record: Pick<DependencyLicenseRecord, 'ecosystem' | 'name' | 'version'>): string {
    return `${record.ecosystem}:${record.name}@${record.version}`;
}

/** `cargo:serde@1.0.0` -> `cargo:serde`, so a bumped package is recognized across its versions. */
function qualifiedName(id: string): string {
    const separator = id.lastIndexOf('@');
    return separator <= 0 ? id : id.slice(0, separator);
}

function hasSatisfyingEvidence(record: DependencyLicenseRecord): boolean {
    if (record.legalFiles.length === 0) {
        return false;
    }
    try {
        assertLicenseExpressionEvidence(packageId(record), record.license, record.legalFiles);
        return true;
    } catch {
        return false;
    }
}

export function resolveInstalledDependencies(root: string): InstalledDependencies {
    const cargo = collectCargoDependencyLicensesFromInstalledMetadata(root);
    return {
        records: mergeDependencyLicenseRecords([
            ...collectNpmDependencyLicenses(root),
            ...collectNpmLockDependencyLicenses(root),
            ...cargo.records,
        ]),
        cargoSourceDirectories: Object.fromEntries(
            cargo.metadata.packages.map((pkg) => [
                packageId({ ecosystem: 'cargo', name: pkg.name, version: pkg.version }),
                dirname(pkg.manifest_path),
            ])
        ),
    };
}

function crateArchivePath(cargoHome: string, record: DependencyLicenseRecord): string | undefined {
    const cacheRoot = join(cargoHome, 'registry', 'cache');
    if (!existsSync(cacheRoot)) {
        return undefined;
    }
    for (const registry of readdirSync(cacheRoot)) {
        const candidate = join(cacheRoot, registry, `${record.name}-${record.version}.crate`);
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function assembledEvidence(record: DependencyLicenseRecord, sourceDirectory: string | undefined): AssembledEvidence {
    const id = packageId(record);
    const metadataFiles = record.metadataFiles ?? [];
    if (metadataFiles.length === 0) {
        return { refusal: `${id}: the installed package carries no metadata to pin; re-pin this proof by hand` };
    }
    const metadata: Array<{ sourcePath: string; sha256: string }> = [];
    for (const file of metadataFiles) {
        if (sourceDirectory === undefined) {
            metadata.push({ sourcePath: file.label, sha256: file.sha256 });
            continue;
        }
        const path = join(sourceDirectory, file.label);
        if (!existsSync(path)) {
            return { refusal: `${id}: ${file.label} is absent from ${sourceDirectory}; run "cargo fetch" and rerun` };
        }
        metadata.push({ sourcePath: file.label, sha256: readLegalFile(path, file.label).sha256 });
    }
    try {
        return { assembled: { metadata, licenses: selectCanonicalSpdxLicenses(record.license) } };
    } catch (error) {
        return { refusal: `${id}: ${errorMessage(error)}; re-pin this proof by hand` };
    }
}

function cargoAssembledProof(
    record: DependencyLicenseRecord,
    sourceDirectory: string | undefined,
    cargoHome: string
): ProofAttempt {
    const id = packageId(record);
    if (sourceDirectory === undefined || !existsSync(sourceDirectory)) {
        return { refusal: `${id}: the registry source directory is absent; run "cargo fetch" and rerun` };
    }
    const archive = crateArchivePath(cargoHome, record);
    if (archive === undefined) {
        return {
            refusal: `${id}: ${record.name}-${record.version}.crate is absent from ${join(cargoHome, 'registry', 'cache')}; run "cargo fetch" and rerun`,
        };
    }
    const evidence = assembledEvidence(record, sourceDirectory);
    if ('refusal' in evidence) {
        return evidence;
    }
    return {
        proof: {
            source: cargoRegistryArchiveSource(record),
            revision: `sha256:${sha256(readFileSync(archive))}`,
            ...evidence,
        },
    };
}

function npmAssembledProof(root: string, record: DependencyLicenseRecord): ProofAttempt {
    const id = packageId(record);
    const evidence = assembledEvidence(record, undefined);
    if ('refusal' in evidence) {
        return evidence;
    }
    try {
        const identity = expectedProofIdentities(root, record)[0];
        if (identity === undefined) {
            return { refusal: `${id}: the lockfiles carry no archive identity; re-pin this proof by hand` };
        }
        return { proof: { source: identity.source, revision: identity.revision, ...evidence } };
    } catch (error) {
        return { refusal: `${id}: ${errorMessage(error)}; re-pin this proof by hand` };
    }
}

function assembledProof(
    root: string,
    record: DependencyLicenseRecord,
    sourceDirectory: string | undefined,
    cargoHome: string
): ProofAttempt {
    return record.ecosystem === 'cargo'
        ? cargoAssembledProof(record, sourceDirectory, cargoHome)
        : npmAssembledProof(root, record);
}

function archiveProofRefusal(
    id: string,
    proof: DependencyLicenseProof,
    successors: readonly DependencyLicenseRecord[]
): string {
    const archives = (proof.files ?? []).map((file) => file.archivePath).join(', ');
    return `${id}: an archive proof cannot be carried to ${successors.map(packageId).join(', ')}; fetch the replacement for ${archives} and re-pin it by hand`;
}

/**
 * Retires every proof whose exact version the install no longer resolves, and pins one for every
 * resolved package whose own legal files leave its declared license unsubstantiated.
 */
export function reconcileDependencyLicenseProofs(
    root: string,
    installed: InstalledDependencies,
    proofs: Readonly<Record<string, DependencyLicenseProof>>,
    cargoHome: string
): ProofReconciliation {
    const resolvedIds = new Set(installed.records.map(packageId));
    const unproven = installed.records.filter(
        (record) => proofs[packageId(record)] === undefined && !hasSatisfyingEvidence(record)
    );
    const entries: Array<[string, DependencyLicenseProof]> = [];
    const changes: string[] = [];
    const refusals: string[] = [];
    const carried = new Set<string>();

    for (const [id, proof] of Object.entries(proofs)) {
        if (resolvedIds.has(id)) {
            entries.push([id, proof]);
            continue;
        }
        const successors = unproven.filter((record) => qualifiedName(packageId(record)) === qualifiedName(id));
        if (successors.length === 0) {
            changes.push(`dropped ${id}`);
            continue;
        }
        if (proof.assembled === undefined) {
            refusals.push(archiveProofRefusal(id, proof, successors));
            continue;
        }
        for (const successor of successors) {
            const successorId = packageId(successor);
            const attempt = assembledProof(root, successor, installed.cargoSourceDirectories[successorId], cargoHome);
            if ('refusal' in attempt) {
                refusals.push(attempt.refusal);
                continue;
            }
            entries.push([successorId, attempt.proof]);
            carried.add(successorId);
            changes.push(`carried ${id} forward to ${successorId}`);
        }
    }

    for (const record of unproven) {
        const id = packageId(record);
        if (carried.has(id) || record.ecosystem !== 'cargo') {
            continue;
        }
        const attempt = cargoAssembledProof(record, installed.cargoSourceDirectories[id], cargoHome);
        if ('refusal' in attempt) {
            refusals.push(attempt.refusal);
            continue;
        }
        entries.push([id, attempt.proof]);
        changes.push(`added ${id}`);
    }

    return { packages: Object.fromEntries(entries), changes, refusals };
}

function readArtifactContents(root: string): Map<string, string> {
    const contents = new Map<string, string>();
    for (const path of DEPENDENCY_LICENSE_ARTIFACT_PATHS) {
        const absolute = resolve(root, path);
        if (existsSync(absolute)) {
            contents.set(path, readFileSync(absolute, 'utf8'));
        }
    }
    return contents;
}

function changedArtifacts(root: string, recorded: ReadonlyMap<string, string>): string[] {
    return [...readArtifactContents(root)]
        .filter(([path, contents]) => recorded.get(path) !== contents)
        .map(([path]) => path);
}

function restoreArtifacts(root: string, recorded: ReadonlyMap<string, string>): void {
    for (const path of changedArtifacts(root, recorded)) {
        const contents = recorded.get(path);
        if (contents !== undefined) {
            writeFileSync(resolve(root, path), contents, 'utf8');
        }
    }
}

function writeProofManifest(
    root: string,
    manifest: DependencyLicenseProofSourceManifest,
    packages: Record<string, DependencyLicenseProof>,
    recorded: ReadonlyMap<string, string>
): void {
    const contents = `${JSON.stringify({ ...manifest, packages }, null, 4)}\n`;
    if (contents === recorded.get(DEPENDENCY_LICENSE_PROOFS_PATH)) {
        return;
    }
    writeFileSync(resolve(root, DEPENDENCY_LICENSE_PROOFS_PATH), contents, 'utf8');
}

function currentDigest(root: string, path: string): string | undefined {
    const absolute = resolve(root, path);
    return existsSync(absolute) ? fileSha256(absolute) : undefined;
}

function restampRequiredSnapshots(root: string, inventory: ReleaseInventory): void {
    for (const entry of inventory.snapshots) {
        if (!REQUIRED_SNAPSHOT_PATH_SET.has(entry.path)) {
            continue;
        }
        const digest = currentDigest(root, entry.path);
        if (digest !== undefined) {
            entry.sha256 = digest;
        }
    }
}

/** The surface digest a lock snapshot binds carries no path, so the recorded snapshot identifies it. */
function restampLockBoundSurfaceDigests(
    root: string,
    inventory: ReleaseInventory,
    recordedSnapshots: ReadonlyMap<string, string>
): void {
    for (const [path, surfaceIds] of Object.entries(SNAPSHOT_DIGEST_SURFACES)) {
        const recorded = recordedSnapshots.get(path);
        const digest = currentDigest(root, path);
        if (recorded === undefined || digest === undefined || recorded === digest) {
            continue;
        }
        for (const surface of inventory.surfaces.filter(({ id }) => surfaceIds.includes(id))) {
            surface.digests = surface.digests.map((value) =>
                value === `sha256:${recorded}` ? `sha256:${digest}` : value
            );
        }
    }
}

function restampPathAddressedDigests(root: string, inventory: ReleaseInventory): void {
    for (const surface of inventory.surfaces) {
        surface.digests = surface.digests.map((value) => {
            const addressed = pathAddressedSha256(value);
            if (addressed === undefined || !RESTAMPED_DIGEST_PATHS.has(addressed.path)) {
                return value;
            }
            const digest = currentDigest(root, addressed.path);
            return digest === undefined ? value : `sha256:${digest}:${addressed.path}`;
        });
    }
}

function restampProjectLicenseSurface(root: string, inventory: ReleaseInventory): void {
    const surface = inventory.surfaces.find(({ id }) => id === PROJECT_LICENSE_SURFACE_ID);
    if (surface === undefined) {
        return;
    }
    const contract = projectLicenseDistributionReleaseInventoryContract(root);
    surface.kind = contract.kind;
    surface.paths = contract.paths;
    surface.sources = contract.sources;
    surface.revisions = contract.revisions;
    surface.digests = contract.digests;
    surface.licenses = contract.licenses;
}

export function restampReleaseInventory(root: string): string[] {
    const path = resolve(root, RELEASE_INVENTORY_PATH);
    const recorded = readFileSync(path, 'utf8');
    const inventory = parseJsonWithUniqueKeys<ReleaseInventory>(recorded, path);
    const recordedSnapshots = new Map(inventory.snapshots.map((entry) => [entry.path, entry.sha256] as const));
    restampRequiredSnapshots(root, inventory);
    restampLockBoundSurfaceDigests(root, inventory, recordedSnapshots);
    restampPathAddressedDigests(root, inventory);
    restampProjectLicenseSurface(root, inventory);
    const restamped = `${JSON.stringify(inventory, null, 4)}\n`;
    if (restamped === recorded) {
        return [];
    }
    writeFileSync(path, restamped, 'utf8');
    return [RELEASE_INVENTORY_PATH];
}

function failureMessages(check: () => void): string[] {
    try {
        check();
        return [];
    } catch (error) {
        return [errorMessage(error)];
    }
}

function verifyRestampedTree(root: string): string[] {
    return [
        ...failureMessages(() => {
            checkProjectLicense(root);
        }),
        ...failureMessages(() => {
            checkReleaseInventory(root);
        }),
    ];
}

function refused(errors: readonly string[]): RestampResult {
    return { ok: false, output: `${UNRESTAMPED_DIGEST_CLASSES}\n${errors.join('\n')}\n` };
}

export function restampDependencyBump(root: string, options: RestampOptions = {}): RestampResult {
    const cargoHome = options.cargoHome ?? process.env.CARGO_HOME ?? join(homedir(), '.cargo');
    const installed = (options.resolveInstalled ?? resolveInstalledDependencies)(root);
    const manifest = readDependencyLicenseProofSourceManifest(root);
    const reconciliation = reconcileDependencyLicenseProofs(root, installed, manifest.packages, cargoHome);
    if (reconciliation.refusals.length > 0) {
        return refused(reconciliation.refusals);
    }
    const recorded = readArtifactContents(root);
    writeProofManifest(root, manifest, reconciliation.packages, recorded);
    try {
        (options.writeArtifacts ?? writeDependencyLicenseArtifacts)(root);
    } catch (error) {
        restoreArtifacts(root, recorded);
        return refused([errorMessage(error)]);
    }
    const rewritten = [
        ...changedArtifacts(root, recorded),
        ...restampReleaseInventory(root),
        ...reconciliation.changes,
    ];
    const errors = (options.verify ?? verifyRestampedTree)(root);
    if (errors.length > 0) {
        return refused(errors);
    }
    return { ok: true, output: `restamped: ${rewritten.length === 0 ? 'nothing to rewrite' : rewritten.join(', ')}\n` };
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    const result = restampDependencyBump(resolve(fileURLToPath(new URL('..', import.meta.url))));
    process.stdout.write(result.output);
    if (!result.ok) {
        process.exitCode = 1;
    }
}
