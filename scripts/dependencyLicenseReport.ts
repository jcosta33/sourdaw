#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { parseDocument } from 'yaml';

export const DEPENDENCY_LICENSE_REPORT_PATH = 'public/legal/DEPENDENCY-LICENSES.txt';
export const SERVER_THIRD_PARTY_NOTICES_PATH = 'server/THIRD-PARTY-NOTICES.md';
export const DEPENDENCY_LICENSE_PROOFS_PATH = 'release/dependency-license-proofs.json';

type LegalFile = {
    label: string;
    sha256: string;
    contents: string;
};

export type DependencyLicenseRecord = {
    ecosystem: 'cargo' | 'npm';
    name: string;
    version: string;
    license: string;
    legalFiles: LegalFile[];
    graphs?: string[];
};

export type DependencyLicenseProof = {
    source: string;
    revision: string;
    files: Array<{ path: string; sourcePath: string; sha256: string }>;
};

type DependencyLicenseProofManifest = {
    schemaVersion: 2;
    packages: Record<string, DependencyLicenseProof>;
};

type PackageLock = {
    packages: Record<
        string,
        {
            version?: unknown;
            license?: unknown;
            dev?: boolean;
            dependencies?: Record<string, string>;
            optionalDependencies?: Record<string, string>;
            os?: unknown;
            cpu?: unknown;
            libc?: unknown;
            resolved?: unknown;
            integrity?: unknown;
        }
    >;
};

type PnpmLicenseEntry = {
    paths: string[];
};

type CargoMetadata = {
    packages: Array<{
        id: string;
        name: string;
        version: string;
        license: string | null;
        license_file: string | null;
        manifest_path: string;
    }>;
    resolve: {
        nodes: Array<{
            id: string;
            deps: Array<{
                pkg: string;
                dep_kinds: Array<{ kind: 'build' | 'dev' | null }>;
            }>;
        }>;
    } | null;
    workspace_members: string[];
};

const LEGAL_FILE = /^(?:licen[cs]e|notice|copying|copyright)(?:[._-].*)?$/iu;
const COMPLETE_MIT_NOTICE = /copyright[\s\S]+permission is hereby granted[\s\S]+the above copyright notice/iu;
const PROOF_DIRECTORY = 'release/dependency-license-proofs/';
const BUILD_ONLY_PLATFORM_NPM_PACKAGES = new Set(['@rollup/rollup-darwin-arm64@4.60.1', 'fsevents@2.3.3']);

function sha256(contents: Buffer): string {
    return createHash('sha256').update(contents).digest('hex');
}

function readLegalFile(path: string, label: string): LegalFile {
    const bytes = readFileSync(path);
    const contents = bytes.toString('utf8');
    if (!Buffer.from(contents, 'utf8').equals(bytes)) {
        throw new Error(`${label}: legal file is not UTF-8`);
    }
    return { label, sha256: sha256(bytes), contents };
}

function packageLegalFiles(directory: string, explicitLicenseFile?: string): LegalFile[] {
    const paths: string[] = [];
    const queue = [directory];
    while (queue.length > 0) {
        const current = queue.pop()!;
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = resolve(current, entry.name);
            if (entry.isDirectory()) {
                if (!['.git', 'node_modules', 'target'].includes(entry.name)) {
                    queue.push(path);
                }
            } else if (entry.isFile() && LEGAL_FILE.test(entry.name)) {
                paths.push(path);
            }
        }
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^readme(?:\..*)?$/iu.test(entry.name)) {
            continue;
        }
        const path = resolve(directory, entry.name);
        if (COMPLETE_MIT_NOTICE.test(readFileSync(path, 'utf8'))) {
            paths.push(path);
        }
    }
    if (explicitLicenseFile !== undefined && existsSync(explicitLicenseFile)) {
        paths.push(explicitLicenseFile);
    }
    const uniquePaths = [...new Set(paths)].sort();
    return uniquePaths.map((path) => readLegalFile(path, basename(path)));
}

function licenseExpression(value: unknown, label: string): string {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    throw new Error(`${label}: package has no declared license expression`);
}

function assertEquivalent(left: DependencyLicenseRecord, right: DependencyLicenseRecord): void {
    const comparable = (record: DependencyLicenseRecord): string =>
        JSON.stringify({
            license: record.license,
            legalFiles: record.legalFiles.map(({ label, sha256: digest }) => ({ label, sha256: digest })),
        });
    if (comparable(left) !== comparable(right)) {
        throw new Error(`${left.ecosystem}:${left.name}@${left.version}: peer-context legal metadata differs`);
    }
}

export function isPlatformRestrictedPackage(packageJson: { os?: unknown; cpu?: unknown; libc?: unknown }): boolean {
    return [packageJson.os, packageJson.cpu, packageJson.libc].some(
        (selector) => typeof selector === 'string' || Array.isArray(selector)
    );
}

export function assertPlatformRestrictedNpmPackage(packageId: string): void {
    if (!BUILD_ONLY_PLATFORM_NPM_PACKAGES.has(packageId)) {
        throw new Error(
            `${packageId}: platform-restricted production package has no audited shipped-closure classification`
        );
    }
}

function assertBuildOnlyPlatformNpmPackage(root: string, packageId: string): void {
    assertPlatformRestrictedNpmPackage(packageId);
    const electronBuilder = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8');
    const packageMetadata = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
        scripts?: { build?: unknown };
    };
    if (!/^\s*- '!node_modules\/\*\*\/\*'$/mu.test(electronBuilder)) {
        throw new Error(`${packageId}: electron packaging no longer excludes node_modules`);
    }
    if (packageMetadata.scripts?.build !== 'vite build') {
        throw new Error(`${packageId}: renderer bundling contract drifted`);
    }
}

export function collectNpmDependencyLicenses(root: string): DependencyLicenseRecord[] {
    const report = JSON.parse(
        execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024,
        })
    ) as Record<string, PnpmLicenseEntry[]>;
    const records = new Map<string, DependencyLicenseRecord>();
    for (const entries of Object.values(report)) {
        for (const entry of entries) {
            for (const packagePath of entry.paths) {
                const packageJsonPath = resolve(packagePath, 'package.json');
                if (!existsSync(packageJsonPath)) {
                    throw new Error(`${packagePath}: pnpm reported a dependency that is not installed`);
                }
                const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
                    name?: unknown;
                    version?: unknown;
                    license?: unknown;
                    os?: unknown;
                    cpu?: unknown;
                    libc?: unknown;
                };
                if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
                    throw new TypeError(`${packageJsonPath}: package identity is incomplete`);
                }
                if (isPlatformRestrictedPackage(packageJson)) {
                    assertBuildOnlyPlatformNpmPackage(root, `${packageJson.name}@${packageJson.version}`);
                    continue;
                }
                const record: DependencyLicenseRecord = {
                    ecosystem: 'npm',
                    name: packageJson.name,
                    version: packageJson.version,
                    license: licenseExpression(packageJson.license, packageJsonPath),
                    legalFiles: packageLegalFiles(packagePath),
                    graphs: ['pnpm-lock.yaml'],
                };
                const key = `${record.name}@${record.version}`;
                const previous = records.get(key);
                if (previous === undefined) {
                    records.set(key, record);
                } else {
                    assertEquivalent(previous, record);
                }
            }
        }
    }
    return [...records.values()];
}

export function collectNpmLockDependencyLicenses(root: string): DependencyLicenseRecord[] {
    const lockPath = resolve(root, 'server/package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as PackageLock;
    const included = new Set<string>();
    const queue = Object.keys(lock.packages['']?.dependencies ?? {}).map((name) => `node_modules/${name}`);
    while (queue.length > 0) {
        const path = queue.pop()!;
        if (included.has(path)) {
            continue;
        }
        const metadata = lock.packages[path];
        if (metadata === undefined || metadata.dev === true || isPlatformRestrictedPackage(metadata)) {
            continue;
        }
        included.add(path);
        const dependencies = { ...metadata.dependencies, ...metadata.optionalDependencies };
        for (const name of Object.keys(dependencies)) {
            const nested = `${path}/node_modules/${name}`;
            queue.push(lock.packages[nested] === undefined ? `node_modules/${name}` : nested);
        }
    }
    return [...included].sort().flatMap<DependencyLicenseRecord>((path) => {
        const metadata = lock.packages[path]!;
        if (typeof metadata.version !== 'string') {
            throw new TypeError(`${path}: locked server production dependency has no version`);
        }
        const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
        if (name.length === 0) {
            throw new TypeError(`${path}: locked server production dependency has no package name`);
        }
        if (isPlatformRestrictedPackage(metadata)) {
            throw new Error(`${name}@${metadata.version}: platform-restricted server dependency may ship`);
        }
        return [
            {
                ecosystem: 'npm' as const,
                name,
                version: metadata.version,
                license: licenseExpression(metadata.license, `${lockPath}:${path}`),
                legalFiles: [],
                graphs: ['server/package-lock.json'],
            },
        ];
    });
}

function runtimeCargoPackageIds(metadata: CargoMetadata): Set<string> {
    if (metadata.resolve === null) {
        throw new Error('Cargo metadata omitted the dependency resolve graph');
    }
    const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
    const included = new Set(metadata.workspace_members);
    const queue = [...metadata.workspace_members];
    while (queue.length > 0) {
        const node = nodes.get(queue.pop()!);
        if (node === undefined) {
            continue;
        }
        for (const dependency of node.deps) {
            if (!dependency.dep_kinds.some(({ kind }) => kind === null) || included.has(dependency.pkg)) {
                continue;
            }
            included.add(dependency.pkg);
            queue.push(dependency.pkg);
        }
    }
    return included;
}

export function collectCargoDependencyLicenses(root: string): DependencyLicenseRecord[] {
    const metadata = JSON.parse(
        execFileSync('cargo', ['metadata', '--locked', '--format-version', '1'], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 100 * 1024 * 1024,
        })
    ) as CargoMetadata;
    const workspace = new Set(metadata.workspace_members);
    const runtime = runtimeCargoPackageIds(metadata);
    return metadata.packages
        .filter((pkg) => runtime.has(pkg.id) && !workspace.has(pkg.id))
        .map((pkg) => ({
            ecosystem: 'cargo' as const,
            name: pkg.name,
            version: pkg.version,
            license: licenseExpression(pkg.license, `${pkg.name}@${pkg.version}`),
            legalFiles: packageLegalFiles(
                dirname(pkg.manifest_path),
                pkg.license_file === null ? undefined : pkg.license_file
            ),
            graphs: ['Cargo.lock'],
        }));
}

function cargoChecksum(root: string, name: string, version: string): string | undefined {
    const blocks = readFileSync(resolve(root, 'Cargo.lock'), 'utf8').split('[[package]]');
    for (const block of blocks) {
        if (
            new RegExp(`^name = "${name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}"$`, 'mu').test(block) &&
            new RegExp(`^version = "${version.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}"$`, 'mu').test(block)
        ) {
            return /^checksum = "([0-9a-f]{64})"$/mu.exec(block)?.[1];
        }
    }
    return undefined;
}

function pnpmIntegrity(root: string, name: string, version: string): string | undefined {
    const document = parseDocument(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'));
    if (document.errors.length > 0) {
        throw new Error(`pnpm-lock.yaml: ${document.errors[0]!.message}`);
    }
    const lock = document.toJS() as {
        packages?: Record<string, { resolution?: { integrity?: unknown } }>;
    };
    const key = Object.keys(lock.packages ?? {}).find(
        (candidate) => candidate === `${name}@${version}` || candidate.startsWith(`${name}@${version}(`)
    );
    const integrity = key === undefined ? undefined : lock.packages?.[key]?.resolution?.integrity;
    return typeof integrity === 'string' ? integrity : undefined;
}

function expectedProofIdentity(root: string, record: DependencyLicenseRecord): { source: string; revision: string } {
    if (record.ecosystem === 'cargo') {
        const checksum = cargoChecksum(root, record.name, record.version);
        if (checksum === undefined) {
            throw new Error(`cargo:${record.name}@${record.version}: Cargo.lock checksum is missing`);
        }
        return {
            source: `https://crates.io/api/v1/crates/${record.name}/${record.version}/download`,
            revision: `sha256:${checksum}`,
        };
    }
    if (record.graphs?.includes('server/package-lock.json')) {
        const lock = JSON.parse(readFileSync(resolve(root, 'server/package-lock.json'), 'utf8')) as PackageLock;
        const entry = lock.packages[`node_modules/${record.name}`];
        if (entry === undefined || typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string') {
            throw new Error(`npm:${record.name}@${record.version}: server/package-lock.json identity is incomplete`);
        }
        if (entry.version !== record.version) {
            throw new Error(`npm:${record.name}@${record.version}: server/package-lock.json version drifted`);
        }
        return { source: entry.resolved, revision: entry.integrity };
    }
    const integrity = pnpmIntegrity(root, record.name, record.version);
    if (integrity === undefined) {
        throw new Error(`npm:${record.name}@${record.version}: pnpm-lock.yaml integrity is missing`);
    }
    return { source: `npm:${record.name}@${record.version}`, revision: integrity };
}

function assertProofFile(
    packageId: string,
    proof: DependencyLicenseProof,
    root: string,
    file: { path: string; sourcePath: string; sha256: string }
): LegalFile {
    if (!file.path.startsWith(PROOF_DIRECTORY) || /(?:^|\/)(?:SPDX-|LICENSE$)/u.test(file.path)) {
        throw new Error(`${packageId}: proof must be package-specific checked-in source evidence`);
    }
    if (file.sourcePath.trim().length === 0) {
        throw new Error(`${packageId}: proof source path is missing`);
    }
    const legal = readLegalFile(resolve(root, file.path), file.path);
    if (legal.contents.trim().length === 0 || !/license|copyright|permission/iu.test(legal.contents)) {
        throw new Error(`${packageId}: proof at ${file.path} lacks legal or copyright content`);
    }
    if (legal.sha256 !== file.sha256) {
        throw new Error(`${packageId}: dependency proof drifted at ${file.path}`);
    }
    return { ...legal, label: `${file.sourcePath} from ${proof.source}@${proof.revision}` };
}

export function validateDependencyLicenseProof(
    root: string,
    record: DependencyLicenseRecord,
    proof: DependencyLicenseProof
): LegalFile[] {
    const packageId = `${record.ecosystem}:${record.name}@${record.version}`;
    const expected = expectedProofIdentity(root, record);
    if (proof.source !== expected.source || proof.revision !== expected.revision) {
        throw new Error(`${packageId}: proof source identity does not match the locked package`);
    }
    const legalFiles = proof.files.map((file) => assertProofFile(packageId, proof, root, file));
    const declaredTerms = record.license.split(/\s*(?:OR|AND|\/)\s*/u).map((term) => term.trim());
    const termEvidence = (term: string, contents: string): boolean => {
        if (term === 'Apache-2.0') {
            return /Apache(?: License)?, Version 2\.0|Apache-2\.0/u.test(contents);
        }
        return contents.includes(term);
    };
    if (!declaredTerms.some((term) => legalFiles.some((file) => termEvidence(term, file.contents)))) {
        throw new Error(`${packageId}: proof does not substantiate declared license ${record.license}`);
    }
    return legalFiles;
}

function applyDependencyLicenseProofs(root: string, records: DependencyLicenseRecord[]): DependencyLicenseRecord[] {
    const manifest = JSON.parse(
        readFileSync(resolve(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8')
    ) as DependencyLicenseProofManifest;
    if (manifest.schemaVersion !== 2 || typeof manifest.packages !== 'object') {
        throw new Error(`${DEPENDENCY_LICENSE_PROOFS_PATH}: unsupported proof manifest`);
    }
    const used = new Set<string>();
    const unresolved: string[] = [];
    const resolved = records.map((record) => {
        if (record.legalFiles.length > 0) {
            return record;
        }
        const packageId = `${record.ecosystem}:${record.name}@${record.version}`;
        const proof = manifest.packages[packageId];
        if (proof === undefined || proof.files.length === 0) {
            unresolved.push(packageId);
            return record;
        }
        const legalFiles = validateDependencyLicenseProof(root, record, proof);
        used.add(packageId);
        return { ...record, legalFiles };
    });
    if (unresolved.length > 0) {
        throw new Error(
            unresolved
                .sort()
                .map((packageId) => `${packageId}: exact license and copyright notice could not be proven`)
                .join('\n')
        );
    }
    const stale = Object.keys(manifest.packages).filter((packageId) => !used.has(packageId));
    if (stale.length > 0) {
        throw new Error(`${DEPENDENCY_LICENSE_PROOFS_PATH}: stale package proofs: ${stale.sort().join(', ')}`);
    }
    return resolved;
}

function mergeDependencyLicenseRecords(records: DependencyLicenseRecord[]): DependencyLicenseRecord[] {
    const merged = new Map<string, DependencyLicenseRecord>();
    for (const record of records) {
        const key = `${record.ecosystem}:${record.name}@${record.version}`;
        const previous = merged.get(key);
        if (previous === undefined) {
            merged.set(key, { ...record, graphs: [...new Set(record.graphs ?? [])].sort() });
            continue;
        }
        assertEquivalent(previous, record);
        previous.graphs = [...new Set([...(previous.graphs ?? []), ...(record.graphs ?? [])])].sort();
    }
    return [...merged.values()];
}

function compareRecords(left: DependencyLicenseRecord, right: DependencyLicenseRecord): number {
    const compare = (leftValue: string, rightValue: string): number => {
        if (leftValue === rightValue) {
            return 0;
        }
        return leftValue < rightValue ? -1 : 1;
    };
    return (
        compare(left.ecosystem, right.ecosystem) ||
        compare(left.name, right.name) ||
        compare(left.version, right.version)
    );
}

export function renderDependencyLicenseReport(
    records: DependencyLicenseRecord[],
    graphDigests: Readonly<Record<string, string>> = {}
): string {
    const sorted = [...records].sort(compareRecords);
    const blocks = new Map<string, { contents: string; labels: Set<string>; packages: Set<string> }>();
    const packageLines = sorted.map((record) => {
        const packageId = `${record.ecosystem}:${record.name}@${record.version}`;
        const references = record.legalFiles.map((file) => {
            const existing = blocks.get(file.sha256);
            if (existing !== undefined && existing.contents !== file.contents) {
                throw new Error(`${packageId}: SHA-256 collision in dependency legal files`);
            }
            const block = existing ?? { contents: file.contents, labels: new Set(), packages: new Set() };
            block.labels.add(file.label);
            block.packages.add(packageId);
            blocks.set(file.sha256, block);
            return `sha256:${file.sha256}`;
        });
        if (references.length === 0) {
            throw new Error(`${packageId}: exact license and copyright notice could not be proven`);
        }
        const graphs = [...new Set(record.graphs ?? [])].sort().join(',');
        return `${packageId} | ${record.license} | ${[...new Set(references)].sort().join(',')} | ${graphs}`;
    });
    const npmCount = sorted.filter(({ ecosystem }) => ecosystem === 'npm').length;
    const cargoCount = sorted.length - npmCount;
    const graphLines = Object.entries(graphDigests)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, digest]) => `- ${path} sha256:${digest}`);
    const legalBlocks = [...blocks.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([digest, block]) => {
            const packages = [...block.packages]
                .sort()
                .map((value) => `- ${value}`)
                .join('\n');
            const labels = [...block.labels].sort().join(', ');
            const contents = block.contents.endsWith('\n') ? block.contents : `${block.contents}\n`;
            return [
                `===== sha256:${digest} =====`,
                `Original filenames: ${labels}`,
                'Packages:',
                packages,
                '',
                contents,
                `===== end sha256:${digest} =====`,
            ].join('\n');
        });
    return [
        'Sourdaw third-party dependency licenses',
        '',
        'Generated from pnpm-lock.yaml, server/package-lock.json, and the normal-dependency Cargo.lock graph.',
        'Each package keeps its declared license expression and exact archive or pinned-upstream legal text.',
        'Generation fails when exact legal evidence is unavailable.',
        '',
        'Source graph digests:',
        ...graphLines,
        '',
        `Package inventory: ${String(npmCount)} npm, ${String(cargoCount)} Cargo`,
        '',
        ...packageLines,
        '',
        'Embedded legal files',
        '',
        ...legalBlocks,
        '',
    ].join('\n');
}

export function renderServerThirdPartyNotices(records: DependencyLicenseRecord[]): string {
    const serverRecords = records
        .filter((record) => record.graphs?.includes('server/package-lock.json'))
        .sort(compareRecords);
    if (serverRecords.length === 0) {
        throw new Error('server/package-lock.json: production dependency closure is empty');
    }
    const sections = serverRecords.map((record) => {
        const files = record.legalFiles.map((file) => file.contents.trimEnd()).join('\n\n');
        return `## ${record.name} ${record.version}\n\nDeclared license: ${record.license}\n\n${files}`;
    });
    return ['# Third-Party Notices', '', ...sections, ''].join('\n');
}

export type DependencyLicenseArtifacts = {
    report: string;
    serverNotices: string;
};

export function buildDependencyLicenseArtifacts(root: string): DependencyLicenseArtifacts {
    const records = applyDependencyLicenseProofs(
        root,
        mergeDependencyLicenseRecords([
            ...collectNpmDependencyLicenses(root),
            ...collectNpmLockDependencyLicenses(root),
            ...collectCargoDependencyLicenses(root),
        ])
    );
    return {
        report: renderDependencyLicenseReport(records, {
            'pnpm-lock.yaml': sha256(readFileSync(resolve(root, 'pnpm-lock.yaml'))),
            'server/package-lock.json': sha256(readFileSync(resolve(root, 'server/package-lock.json'))),
            'Cargo.lock': sha256(readFileSync(resolve(root, 'Cargo.lock'))),
        }),
        serverNotices: renderServerThirdPartyNotices(records),
    };
}

export function buildDependencyLicenseReport(root: string): string {
    return buildDependencyLicenseArtifacts(root).report;
}
