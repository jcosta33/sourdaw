#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

import parseSpdxExpression from 'spdx-expression-parse';
import { parseDocument } from 'yaml';

import { parseJsonWithUniqueKeys } from './strictJson.ts';

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
    metadataFiles?: LegalFile[];
    serverLockPath?: string;
    graphs?: string[];
};

export type DependencyLicenseProof = {
    source: string;
    revision: string;
    files?: Array<{ archivePath: string; sourcePath: string; sha256: string }>;
    assembled?: {
        metadata: Array<{ sourcePath: string; sha256: string }>;
        licenses: string[];
    };
};

type DependencyLicenseProofManifest = {
    schemaVersion: 3;
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
const SOURCE_FILE_SUFFIX = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|java|js|jsx|m|mm|py|rs|ts|tsx)$/iu;
const COMPLETE_MIT_NOTICE = /copyright[\s\S]+permission is hereby granted[\s\S]+the above copyright notice/iu;
const PROOF_DIRECTORY = 'release/dependency-license-proofs/';
const SPDX_LICENSE_LIST_VERSION = '3.28.0';
const SPDX_LICENSE_TEXTS: Readonly<Record<string, { path: string; sha256: string; source: string }>> = {
    'Apache-2.0': {
        path: 'release/spdx-license-texts/Apache-2.0.txt',
        sha256: '074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff',
        source: 'https://github.com/spdx/license-list-data/blob/v3.28.0/text/Apache-2.0.txt',
    },
    ISC: {
        path: 'release/spdx-license-texts/ISC.txt',
        sha256: 'f2ec607f67bb0dd3053b49835b02110d5cd0f8eb6da3aac4dc0b142a6b299be9',
        source: 'https://github.com/spdx/license-list-data/blob/v3.28.0/text/ISC.txt',
    },
    'LGPL-3.0': {
        path: 'release/spdx-license-texts/LGPL-3.0.txt',
        sha256: '996af0513df21f7496288951c41428a03c174e9e4a9d63665c57d670f845ccb1',
        source: 'https://github.com/spdx/license-list-data/blob/v3.28.0/text/LGPL-3.0-only.txt',
    },
    MIT: {
        path: 'release/spdx-license-texts/MIT.txt',
        sha256: 'b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5',
        source: 'https://github.com/spdx/license-list-data/blob/v3.28.0/text/MIT.txt',
    },
    Unlicense: {
        path: 'release/spdx-license-texts/Unlicense.txt',
        sha256: '0bdebfeda07d45dada625ae1317c6f833186e798b171d0db640bcf32e92a8240',
        source: 'https://github.com/spdx/license-list-data/blob/v3.28.0/text/Unlicense.txt',
    },
};
const LICENSE_SIGNATURES: Readonly<Record<string, readonly RegExp[]>> = {
    '0BSD': [
        /permission\s+to\s+use,\s+copy,\s+modify,\s+and\/or\s+distribute\s+this\s+software\s+for\s+any\s+purpose\s+with\s+or\s+without\s+fee/iu,
        /the software is provided ["'“]as is["'”]/iu,
    ],
    'Apache-2.0': [
        /Apache License\s+Version 2\.0/iu,
        /terms and conditions for use, reproduction, and distribution/iu,
        /grant of copyright license/iu,
    ],
    'BSD-2-Clause': [
        /redistribution and use in source and binary forms/iu,
        /redistributions of source code must retain/iu,
        /redistributions in binary form must reproduce/iu,
        /this software is provided by the copyright holders and contributors\s+["'“]as is["'”]/iu,
    ],
    'BSD-3-Clause': [
        /redistribution and use in source and binary forms/iu,
        /neither the name of [\s\S]{0,100} nor the names? of\s+(?:its|the)\s+contributors/iu,
        /this software is provided by the copyright holders and contributors\s+["'“]as\s+is["'”]/iu,
    ],
    'CDLA-Permissive-2.0': [
        /Community Data License Agreement/iu,
        /Conditions for Sharing Data/iu,
        /No Warranty; Limitation of Liability/iu,
    ],
    ISC: [
        /permission\s+to\s+use,\s+copy,\s+modify,\s+and\/or\s+distribute\s+this\s+software\s+for\s+any\s+purpose\s+with\s+or\s+without\s+fee/iu,
        /the software is provided ["'“]as is["'”]/iu,
        /(?:disclaims\s+all\s+warranties|all\s+implied\s+warranties)[\s\S]*?merchantability/iu,
    ],
    'LGPL-2.1-or-later': [
        /GNU Lesser General Public License/iu,
        /either version 2\.1 of the License, or \(at your option\) any later version/iu,
        /without any warranty/iu,
    ],
    'LGPL-3.0': [/GNU Lesser General Public License/iu, /version 3, 29 June 2007/iu, /GNU General Public License/iu],
    MIT: [
        /permission is hereby granted,\s+free of charge/iu,
        /the above copyright notice and this permission notice[\s\S]{0,100}?shall be\s+included/iu,
        /the software is provided ["'“]as is["'”]/iu,
    ],
    'MIT-0': [
        /MIT No Attribution/iu,
        /permission is hereby granted, free of charge/iu,
        /the software is provided ["'“]as is["'”]/iu,
    ],
    'MPL-2.0': [/Mozilla Public License Version 2\.0/iu, /Source Code Form/iu, /Covered Software/iu],
    'Unicode-3.0': [
        /UNICODE LICENSE V3/iu,
        /COPYRIGHT AND PERMISSION NOTICE/iu,
        /THE DATA FILES AND SOFTWARE ARE PROVIDED ["'“]AS IS["'”]/iu,
    ],
    Unlicense: [
        /This is free and unencumbered software released into the public domain/iu,
        /Anyone is free to copy, modify, publish, use, compile, sell, or\s+distribute this software/iu,
        /THE SOFTWARE IS PROVIDED ["'“]AS\s+IS["'”]/iu,
    ],
    Zlib: [
        /This software is provided ["'“]as-is["'”]/iu,
        /The origin of this software must not be misrepresented/iu,
        /This notice may not be removed or altered from any source distribution/iu,
    ],
};
const EXCEPTION_SIGNATURES: Readonly<Record<string, readonly RegExp[]>> = {
    'LLVM-exception': [
        /LLVM Exceptions? to the Apache 2\.0 License/iu,
        /limitations under the License with the following exceptions/iu,
    ],
};
const BUILD_ONLY_PLATFORM_NPM_PACKAGES = new Set([
    '@rollup/rollup-android-arm-eabi@4.60.1',
    '@rollup/rollup-android-arm64@4.60.1',
    '@rollup/rollup-darwin-arm64@4.60.1',
    '@rollup/rollup-darwin-x64@4.60.1',
    '@rollup/rollup-freebsd-arm64@4.60.1',
    '@rollup/rollup-freebsd-x64@4.60.1',
    '@rollup/rollup-linux-arm-gnueabihf@4.60.1',
    '@rollup/rollup-linux-arm-musleabihf@4.60.1',
    '@rollup/rollup-linux-arm64-gnu@4.60.1',
    '@rollup/rollup-linux-arm64-musl@4.60.1',
    '@rollup/rollup-linux-loong64-gnu@4.60.1',
    '@rollup/rollup-linux-loong64-musl@4.60.1',
    '@rollup/rollup-linux-ppc64-gnu@4.60.1',
    '@rollup/rollup-linux-ppc64-musl@4.60.1',
    '@rollup/rollup-linux-riscv64-gnu@4.60.1',
    '@rollup/rollup-linux-riscv64-musl@4.60.1',
    '@rollup/rollup-linux-s390x-gnu@4.60.1',
    '@rollup/rollup-linux-x64-gnu@4.60.1',
    '@rollup/rollup-linux-x64-musl@4.60.1',
    '@rollup/rollup-openbsd-x64@4.60.1',
    '@rollup/rollup-openharmony-arm64@4.60.1',
    '@rollup/rollup-win32-arm64-msvc@4.60.1',
    '@rollup/rollup-win32-ia32-msvc@4.60.1',
    '@rollup/rollup-win32-x64-gnu@4.60.1',
    '@rollup/rollup-win32-x64-msvc@4.60.1',
    'fsevents@2.3.3',
]);

function sha256(contents: Buffer): string {
    return createHash('sha256').update(contents).digest('hex');
}

function readJsonFile<T>(path: string): T {
    return parseJsonWithUniqueKeys<T>(readFileSync(path, 'utf8'), path);
}

export function readLegalFile(path: string, label: string): LegalFile {
    const bytes = readFileSync(path);
    return readLegalBytes(bytes, label);
}

function readLegalBytes(bytes: Buffer, label: string): LegalFile {
    const contents = bytes.toString('utf8');
    if (!Buffer.from(contents, 'utf8').equals(bytes)) {
        throw new Error(`${label}: legal file is not UTF-8`);
    }
    if (contents.trim().length === 0) {
        throw new Error(`${label}: legal file is empty`);
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
            } else if (entry.isFile() && LEGAL_FILE.test(entry.name) && !SOURCE_FILE_SUFFIX.test(entry.name)) {
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
            metadataFiles: record.metadataFiles?.map(({ label, sha256: digest }) => ({
                label,
                sha256: digest,
            })),
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
    const packageMetadata = readJsonFile<{
        scripts?: { build?: unknown };
    }>(resolve(root, 'package.json'));
    if (!/^\s*- '!node_modules\/\*\*\/\*'$/mu.test(electronBuilder)) {
        throw new Error(`${packageId}: electron packaging no longer excludes node_modules`);
    }
    if (packageMetadata.scripts?.build !== 'vite build') {
        throw new Error(`${packageId}: renderer bundling contract drifted`);
    }
}

export function collectNpmDependencyLicenses(root: string): DependencyLicenseRecord[] {
    const report = parseJsonWithUniqueKeys<Record<string, PnpmLicenseEntry[]>>(
        execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024,
        }),
        'pnpm licenses list --prod --json'
    );
    const records = new Map<string, DependencyLicenseRecord>();
    for (const entries of Object.values(report)) {
        for (const entry of entries) {
            for (const packagePath of entry.paths) {
                const packageJsonPath = resolve(packagePath, 'package.json');
                if (!existsSync(packageJsonPath)) {
                    throw new Error(`${packagePath}: pnpm reported a dependency that is not installed`);
                }
                const packageJson = readJsonFile<{
                    name?: unknown;
                    version?: unknown;
                    license?: unknown;
                    os?: unknown;
                    cpu?: unknown;
                    libc?: unknown;
                }>(packageJsonPath);
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
                    metadataFiles: [readLegalFile(packageJsonPath, 'package.json')],
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
    const lock = readJsonFile<PackageLock>(lockPath);
    const included = new Set<string>();
    const rootDependencies = {
        ...lock.packages['']?.dependencies,
        ...lock.packages['']?.optionalDependencies,
    };
    const queue = Object.keys(rootDependencies).map((name) => `node_modules/${name}`);
    while (queue.length > 0) {
        const path = queue.pop()!;
        if (included.has(path)) {
            continue;
        }
        const metadata = lock.packages[path];
        if (metadata === undefined) {
            throw new Error(`${path}: server production dependency is missing from package-lock.json`);
        }
        if (metadata.dev === true) {
            throw new Error(`${path}: server production dependency is marked dev-only`);
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
                serverLockPath: path,
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
    const metadata = parseJsonWithUniqueKeys<CargoMetadata>(
        execFileSync('cargo', ['metadata', '--locked', '--format-version', '1'], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 100 * 1024 * 1024,
        }),
        'cargo metadata --locked --format-version 1'
    );
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
            metadataFiles: [
                readLegalFile(pkg.manifest_path, basename(pkg.manifest_path)),
                ...(existsSync(resolve(dirname(pkg.manifest_path), 'AUTHORS'))
                    ? [readLegalFile(resolve(dirname(pkg.manifest_path), 'AUTHORS'), 'AUTHORS')]
                    : []),
            ],
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
        const lock = readJsonFile<PackageLock>(resolve(root, 'server/package-lock.json'));
        const lockPath = record.serverLockPath ?? `node_modules/${record.name}`;
        const entry = lock.packages[lockPath];
        if (entry === undefined || typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string') {
            throw new Error(`npm:${record.name}@${record.version}: ${lockPath} identity is incomplete`);
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
    file: { archivePath: string; sourcePath: string; sha256: string }
): LegalFile {
    const proofRootPath = resolve(root, PROOF_DIRECTORY);
    const proofRoot = realpathSync(proofRootPath);
    const candidatePath = resolve(root, file.archivePath);
    const candidateRelative = relative(proofRootPath, candidatePath);
    if (
        candidateRelative === '' ||
        candidateRelative.startsWith(`..${sep}`) ||
        candidateRelative === '..' ||
        isAbsolute(candidateRelative)
    ) {
        throw new Error(`${packageId}: proof path escapes ${PROOF_DIRECTORY}`);
    }
    const realPath = realpathSync(candidatePath);
    const realRelative = relative(proofRoot, realPath);
    if (
        realRelative === '' ||
        realRelative.startsWith(`..${sep}`) ||
        realRelative === '..' ||
        isAbsolute(realRelative)
    ) {
        throw new Error(`${packageId}: proof path escapes ${PROOF_DIRECTORY}`);
    }
    if (!file.archivePath.endsWith('.tgz')) {
        throw new Error(`${packageId}: proof must use a locked package archive`);
    }
    if (
        file.sourcePath.trim().length === 0 ||
        isAbsolute(file.sourcePath) ||
        file.sourcePath.split('/').includes('..')
    ) {
        throw new Error(`${packageId}: proof source path is missing`);
    }
    const archive = readFileSync(realPath);
    const archiveIntegrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
    if (archiveIntegrity !== proof.revision) {
        throw new Error(`${packageId}: proof archive does not match the locked package`);
    }
    const tar = gunzipSync(archive);
    const wanted = `package/${file.sourcePath}`;
    let legal: LegalFile | undefined;
    for (let offset = 0; offset + 512 <= tar.length;) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) {
            break;
        }
        const field = (start: number, end: number): string =>
            header.subarray(start, end).toString('utf8').replace(/\0.*$/u, '').trim();
        const name = field(0, 100);
        const prefix = field(345, 500);
        const archivePath = prefix.length === 0 ? name : `${prefix}/${name}`;
        const size = Number.parseInt(field(124, 136), 8);
        if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) {
            throw new Error(`${packageId}: proof archive is malformed`);
        }
        const contents = tar.subarray(offset + 512, offset + 512 + size);
        if (archivePath === wanted) {
            if (legal !== undefined) {
                throw new Error(`${packageId}: proof archive repeats ${file.sourcePath}`);
            }
            legal = readLegalBytes(contents, `${file.sourcePath} from ${file.archivePath}`);
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (legal === undefined) {
        throw new Error(`${packageId}: proof archive lacks ${file.sourcePath}`);
    }
    if (legal.sha256 !== file.sha256) {
        throw new Error(`${packageId}: dependency proof drifted at ${file.sourcePath}`);
    }
    return { ...legal, label: `${file.sourcePath} from ${proof.source}@${proof.revision}` };
}

type SpdxNode = ReturnType<typeof parseSpdxExpression>;

function normalizeLicenseExpression(expression: string): string {
    return expression.replaceAll(/\s*\/\s*/gu, ' OR ');
}

function matchesSignatures(contents: string, signatures: readonly RegExp[]): boolean {
    const normalized = contents.replaceAll(/^\s*\/\/\s?/gmu, '');
    return signatures.every((signature) => signature.test(normalized));
}

function hasLicenseEvidence(license: string, files: readonly LegalFile[]): boolean {
    const signatures = LICENSE_SIGNATURES[license];
    if (signatures === undefined) {
        throw new Error(`unsupported SPDX evidence signature: ${license}`);
    }
    return files.some(({ contents }) => matchesSignatures(contents, signatures));
}

function hasExceptionEvidence(exception: string, files: readonly LegalFile[]): boolean {
    const signatures = EXCEPTION_SIGNATURES[exception];
    if (signatures === undefined) {
        throw new Error(`unsupported SPDX exception evidence signature: ${exception}`);
    }
    return files.some(({ contents }) => matchesSignatures(contents, signatures));
}

function satisfiesSpdxNode(node: SpdxNode, files: readonly LegalFile[]): boolean {
    if ('license' in node) {
        return (
            hasLicenseEvidence(node.license, files) &&
            (node.exception === undefined || hasExceptionEvidence(node.exception, files))
        );
    }
    if (node.conjunction === 'and') {
        return satisfiesSpdxNode(node.left, files) && satisfiesSpdxNode(node.right, files);
    }
    return satisfiesSpdxNode(node.left, files) || satisfiesSpdxNode(node.right, files);
}

export function assertLicenseExpressionEvidence(
    packageId: string,
    expression: string,
    legalFiles: readonly LegalFile[]
): void {
    let parsed: SpdxNode;
    try {
        parsed = parseSpdxExpression(normalizeLicenseExpression(expression));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${packageId}: invalid SPDX license expression ${expression}: ${message}`);
    }
    if (!satisfiesSpdxNode(parsed, legalFiles)) {
        throw new Error(`${packageId}: evidence does not substantiate declared license ${expression}`);
    }
}

function readCanonicalSpdxText(root: string, license: string): LegalFile {
    const source = SPDX_LICENSE_TEXTS[license];
    if (source === undefined) {
        throw new Error(`assembled proof uses unsupported canonical SPDX license: ${license}`);
    }
    const legal = readLegalFile(resolve(root, source.path), source.path);
    if (legal.sha256 !== source.sha256) {
        throw new Error(`${source.path}: SPDX ${SPDX_LICENSE_LIST_VERSION} text drifted`);
    }
    return { ...legal, label: `${license} canonical text from ${source.source}` };
}

function validateAssembledProof(
    packageId: string,
    proof: DependencyLicenseProof,
    record: DependencyLicenseRecord,
    root: string
): LegalFile[] {
    const assembled = proof.assembled!;
    const expectedMetadata = new Map((record.metadataFiles ?? []).map((file) => [file.label, file] as const));
    if (expectedMetadata.size === 0) {
        throw new Error(`${packageId}: assembled proof has no installed package metadata`);
    }
    if (assembled.metadata.length !== expectedMetadata.size) {
        throw new Error(`${packageId}: assembled proof metadata set is incomplete`);
    }
    const metadataFiles = assembled.metadata.map(({ sourcePath, sha256: expectedSha256 }) => {
        const metadata = expectedMetadata.get(sourcePath);
        if (metadata === undefined || metadata.sha256 !== expectedSha256) {
            throw new Error(`${packageId}: assembled proof metadata drifted at ${sourcePath}`);
        }
        return metadata;
    });
    if (new Set(assembled.metadata.map(({ sourcePath }) => sourcePath)).size !== assembled.metadata.length) {
        throw new Error(`${packageId}: assembled proof repeats package metadata`);
    }
    if (assembled.licenses.length === 0 || new Set(assembled.licenses).size !== assembled.licenses.length) {
        throw new Error(`${packageId}: assembled proof licenses must be unique and non-empty`);
    }
    const canonicalTerms = assembled.licenses.map((license) => readCanonicalSpdxText(root, license));
    assertLicenseExpressionEvidence(packageId, record.license, canonicalTerms);

    const metadataBlocks = metadataFiles.map((file) => {
        const contents = file.contents.endsWith('\n') ? file.contents : `${file.contents}\n`;
        return [
            `===== archive metadata ${file.label} sha256:${file.sha256} =====`,
            contents,
            `===== end archive metadata ${file.label} =====`,
        ].join('\n');
    });
    const licenseBlocks = canonicalTerms.map((file, index) => {
        const license = assembled.licenses[index]!;
        const contents = file.contents.endsWith('\n') ? file.contents : `${file.contents}\n`;
        return [
            `===== canonical SPDX ${license} sha256:${file.sha256} =====`,
            `Source: ${SPDX_LICENSE_TEXTS[license]!.source}`,
            contents,
            `===== end canonical SPDX ${license} =====`,
        ].join('\n');
    });
    const contents = [
        'Sourdaw assembled dependency compliance notice',
        '',
        `Package: ${packageId}`,
        `Locked source: ${proof.source}`,
        `Locked revision: ${proof.revision}`,
        `Declared license: ${record.license}`,
        `Selected SPDX terms: ${assembled.licenses.join(', ')}`,
        '',
        'The locked published archive omits full license terms. This checked-in notice combines its immutable metadata with canonical SPDX License List text. It is assembled evidence, not an upstream file.',
        '',
        ...metadataBlocks,
        ...licenseBlocks,
        '',
    ].join('\n');
    const bytes = Buffer.from(contents, 'utf8');
    return [
        ...record.legalFiles,
        {
            label: `assembled notice from locked archive metadata and SPDX ${SPDX_LICENSE_LIST_VERSION}`,
            sha256: sha256(bytes),
            contents,
        },
    ];
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
    const files = proof.files ?? [];
    if (proof.assembled !== undefined) {
        if (files.length > 0) {
            throw new Error(`${packageId}: proof cannot mix archive files with assembled evidence`);
        }
        return validateAssembledProof(packageId, proof, record, root);
    }
    if (files.length === 0) {
        throw new Error(`${packageId}: proof has no legal evidence`);
    }
    const legalFiles = files.map((file) => assertProofFile(packageId, proof, root, file));
    assertLicenseExpressionEvidence(packageId, record.license, legalFiles);
    return legalFiles;
}

export function readDependencyLicenseProofManifest(root: string): DependencyLicenseProofManifest {
    const manifestPath = resolve(root, DEPENDENCY_LICENSE_PROOFS_PATH);
    return readJsonFile<DependencyLicenseProofManifest>(manifestPath);
}

function applyDependencyLicenseProofs(root: string, records: DependencyLicenseRecord[]): DependencyLicenseRecord[] {
    const manifest = readDependencyLicenseProofManifest(root);
    if (manifest.schemaVersion !== 3 || typeof manifest.packages !== 'object') {
        throw new Error(`${DEPENDENCY_LICENSE_PROOFS_PATH}: unsupported proof manifest`);
    }
    const used = new Set<string>();
    const unresolved: string[] = [];
    const resolved = records.map((record) => {
        const packageId = `${record.ecosystem}:${record.name}@${record.version}`;
        const proof = manifest.packages[packageId];
        if (record.legalFiles.length > 0) {
            try {
                assertLicenseExpressionEvidence(packageId, record.license, record.legalFiles);
                return record;
            } catch (error) {
                if (proof === undefined) {
                    throw error;
                }
            }
        }
        if (proof === undefined) {
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
        previous.serverLockPath ??= record.serverLockPath;
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
                `Evidence labels: ${labels}`,
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
        'Each package keeps its declared license expression and exact archive terms or an explicit assembled notice.',
        `Assembled notices use hash-pinned metadata from the lock-resolved install plus canonical SPDX License List ${SPDX_LICENSE_LIST_VERSION} text; only checked proof archives are byte-authenticated against package integrity.`,
        'Generation fails when complete legal evidence is unavailable.',
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
