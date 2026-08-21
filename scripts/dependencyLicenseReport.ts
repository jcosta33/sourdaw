#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export const DEPENDENCY_LICENSE_REPORT_PATH = 'public/legal/DEPENDENCY-LICENSES.txt';

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
    const paths = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && LEGAL_FILE.test(entry.name))
        .map((entry) => resolve(directory, entry.name));
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
    return Array.isArray(packageJson.os) || Array.isArray(packageJson.cpu) || Array.isArray(packageJson.libc);
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
                    continue;
                }
                const record: DependencyLicenseRecord = {
                    ecosystem: 'npm',
                    name: packageJson.name,
                    version: packageJson.version,
                    license: licenseExpression(packageJson.license, packageJsonPath),
                    legalFiles: packageLegalFiles(packagePath),
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
        }));
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

export function renderDependencyLicenseReport(records: DependencyLicenseRecord[]): string {
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
        const legal = references.length === 0 ? 'metadata-only' : [...new Set(references)].sort().join(',');
        return `${packageId} | ${record.license} | ${legal}`;
    });
    const npmCount = sorted.filter(({ ecosystem }) => ecosystem === 'npm').length;
    const cargoCount = sorted.length - npmCount;
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
        'Generated from the platform-neutral installed production pnpm graph and the normal-dependency Cargo graph.',
        'Each package keeps its own declared license expression and every root legal file shipped in its package archive.',
        '`metadata-only` means that exact archive declared a license but shipped no root license or notice file;',
        'this report does not synthesize or reattribute third-party terms.',
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

export function buildDependencyLicenseReport(root: string): string {
    return renderDependencyLicenseReport([
        ...collectNpmDependencyLicenses(root),
        ...collectCargoDependencyLicenses(root),
    ]);
}
