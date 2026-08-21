#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDocument } from 'yaml';

import { ELECTRON_RUNTIME_CONTRACT, type ElectronRuntimeContract } from './electronRuntimeContract.ts';
import { afterExtract } from './flipElectronFuses.ts';

type ElectronManifest = ElectronRuntimeContract;

function sha256(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson<Value>(path: string): Value {
    return JSON.parse(readFileSync(path, 'utf8')) as Value;
}

function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function lockHasExactElectron(lock: string, contract: ElectronRuntimeContract): boolean {
    const document = parseDocument(lock, { uniqueKeys: true });
    if (document.errors.length > 0) {
        return false;
    }
    const parsed = document.toJS() as {
        importers?: Record<string, { devDependencies?: Record<string, { specifier?: string; version?: string }> }>;
        packages?: Record<string, { resolution?: { integrity?: string } }>;
    };
    const dependency = parsed.importers?.['.']?.devDependencies?.electron;
    const resolution = parsed.packages?.[`electron@${contract.version}`]?.resolution;
    return (
        dependency?.specifier === contract.specifier &&
        dependency.version === contract.version &&
        resolution?.integrity === contract.integrity
    );
}

function hasMarkers(value: string, markers: readonly string[]): boolean {
    return markers.every((marker) => value.includes(marker));
}

export function electronReleaseInventoryContract(contract: ElectronRuntimeContract = ELECTRON_RUNTIME_CONTRACT) {
    return {
        sources: [
            contract.repository,
            contract.chromium.repository,
            contract.node.repository,
            contract.ffmpeg.repository,
            'package.json',
            'public/legal/ELECTRON-SOURCES.json',
        ],
        revisions: [
            `electron ${contract.version} ${contract.revision}`,
            `Chromium ${contract.chromium.version} ${contract.chromium.revision}`,
            `Node ${contract.node.version} ${contract.node.revision}`,
            `FFmpeg ${contract.ffmpeg.revision}`,
            'pnpm-lock.yaml',
        ],
        digests: [
            `npm-integrity:${contract.integrity}`,
            `sha256:${contract.licenseSha256}`,
            'public/legal/ELECTRON-SOURCES.json',
            'pending:OS-12-final-desktop-package',
        ],
        licenses: [
            'MIT:Electron',
            'LGPL-2.1-or-later:Electron-FFmpeg',
            'bundled-notices:electron-LICENSES.chromium.html',
        ],
    } as const;
}

function readBuilderConfig(value: string): { afterExtract?: unknown; afterPack?: unknown } | undefined {
    const document = parseDocument(value, { uniqueKeys: true });
    if (document.errors.length > 0) {
        return undefined;
    }
    return document.toJS() as { afterExtract?: unknown; afterPack?: unknown };
}

export function validateElectronRuntimeProvenance(
    root: string,
    contract: ElectronRuntimeContract = ELECTRON_RUNTIME_CONTRACT
): string[] {
    const errors: string[] = [];
    const manifest = readJson<ElectronManifest>(resolve(root, 'public/legal/ELECTRON-SOURCES.json'));
    const projectPackage = readJson<{ devDependencies?: Record<string, string> }>(resolve(root, 'package.json'));
    const electronPackage = readJson<{ version?: string; license?: string }>(
        resolve(root, 'node_modules/electron/package.json')
    );
    const checksums = readJson<Record<string, string>>(resolve(root, 'node_modules/electron/checksums.json'));
    const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
    const notices = readFileSync(resolve(root, 'public/legal/THIRD-PARTY-NOTICES.md'), 'utf8');
    const relinking = readFileSync(resolve(root, 'public/legal/RELINKING.md'), 'utf8');
    const builderConfig = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8');

    if (!sameValue(manifest, contract)) {
        errors.push('Electron source manifest drifted');
    }
    if (projectPackage.devDependencies?.electron !== contract.specifier) {
        errors.push('Electron dependency specifier drifted');
    }
    if (!lockHasExactElectron(lock, contract)) {
        errors.push('Electron lock resolution drifted');
    }
    if (electronPackage.version !== contract.version || electronPackage.license !== contract.license) {
        errors.push('installed Electron identity drifted');
    }

    const packageLicense = resolve(root, 'node_modules/electron/LICENSE');
    if (!existsSync(packageLicense) || sha256(packageLicense) !== contract.licenseSha256) {
        errors.push('Electron package license drifted');
    }
    for (const target of contract.targets) {
        if (checksums[target.archive] !== target.sha256) {
            errors.push(`${target.archive}: Electron release checksum drifted`);
        }
    }

    const noticeMarkers = [
        contract.version,
        contract.license,
        contract.revision,
        contract.chromium.version,
        contract.chromium.revision,
        contract.node.version,
        contract.node.revision,
        contract.ffmpeg.revision,
        contract.ffmpeg.license,
        'electron-LICENSE.txt',
        'electron-LICENSES.chromium.html',
        'ELECTRON-SOURCES.json',
    ];
    if (!hasMarkers(notices, noticeMarkers)) {
        errors.push('Electron user notices drifted');
    }
    if (
        !hasMarkers(relinking, [
            contract.ffmpeg.revision,
            'libffmpeg.dylib',
            'libffmpeg.so',
            'ffmpeg.dll',
            'Desktop releases must also include',
            'required to rebuild the shipped Electron FFmpeg library',
        ])
    ) {
        errors.push('Electron FFmpeg relinking directions drifted');
    }
    const parsedBuilderConfig = readBuilderConfig(builderConfig);
    if (parsedBuilderConfig?.afterExtract !== './scripts/flipElectronFuses.ts') {
        errors.push('Electron legal-file packaging hook drifted');
    }
    if (parsedBuilderConfig?.afterPack !== './scripts/flipElectronFuses.ts') {
        errors.push('Electron final-package verification hook drifted');
    }
    if (typeof afterExtract !== 'function') {
        errors.push('Electron legal-file staging export drifted');
    }

    return errors;
}

export async function validateElectronSourcesOnline(
    root: string,
    contract: ElectronRuntimeContract = ELECTRON_RUNTIME_CONTRACT,
    fetcher: typeof fetch = fetch
): Promise<string[]> {
    const errors = validateElectronRuntimeProvenance(root, contract);
    try {
        const response = await fetcher(`https://registry.npmjs.org/electron/${contract.version}`);
        const metadata = (await response.json()) as { dist?: { integrity?: string } };
        if (!response.ok || metadata.dist?.integrity !== contract.integrity) {
            errors.push('Electron npm integrity drifted');
        }
    } catch (error) {
        errors.push(`Electron npm metadata unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        const response = await fetcher(
            `https://github.com/electron/electron/releases/download/v${contract.version}/SHASUMS256.txt`
        );
        const shasums = await response.text();
        if (
            !response.ok ||
            contract.targets.some((target) => !shasums.includes(`${target.sha256} *${target.archive}`))
        ) {
            errors.push('Electron release checksums drifted');
        }
    } catch (error) {
        errors.push(
            `Electron release checksums unavailable: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    try {
        const response = await fetcher(`https://raw.githubusercontent.com/electron/electron/${contract.revision}/DEPS`);
        const deps = await response.text();
        if (!response.ok || !hasMarkers(deps, [contract.chromium.version, contract.node.version])) {
            errors.push('Electron bundled runtime versions drifted');
        }
    } catch (error) {
        errors.push(`Electron DEPS unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const githubTagCommit = async (repository: string, tag: string): Promise<string> => {
        const ref = await fetcher(`https://api.github.com/repos/${repository}/git/ref/tags/${tag}`);
        const refBody = (await ref.json()) as { object?: { sha?: string; type?: string; url?: string } };
        if (!ref.ok || refBody.object?.sha === undefined) {
            throw new Error(`tag unavailable: ${repository}@${tag}`);
        }
        if (refBody.object.type !== 'tag') {
            return refBody.object.sha;
        }
        if (refBody.object.url === undefined) {
            throw new Error(`tag object unavailable: ${repository}@${tag}`);
        }
        const tagObject = await fetcher(refBody.object.url);
        const tagBody = (await tagObject.json()) as { object?: { sha?: string } };
        if (!tagObject.ok || tagBody.object?.sha === undefined) {
            throw new Error(`tag target unavailable: ${repository}@${tag}`);
        }
        return tagBody.object.sha;
    };

    try {
        const [electronRevision, nodeRevision] = await Promise.all([
            githubTagCommit('electron/electron', `v${contract.version}`),
            githubTagCommit('nodejs/node', contract.node.version),
        ]);
        if (electronRevision !== contract.revision) {
            errors.push('Electron source revision drifted');
        }
        if (nodeRevision !== contract.node.revision) {
            errors.push('Node source revision drifted');
        }
    } catch (error) {
        errors.push(`GitHub source tags unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        const response = await fetcher(
            `https://chromium.googlesource.com/chromium/src/+/refs/tags/${contract.chromium.version}?format=JSON`
        );
        const body = (await response.text()).replace(/^\)\]\}'\n/u, '');
        const tag = JSON.parse(body) as { commit?: string };
        if (!response.ok || tag.commit !== contract.chromium.revision) {
            errors.push('Chromium source revision drifted');
        }
    } catch (error) {
        errors.push(`Chromium source tag unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        const depsResponse = await fetcher(
            `https://chromium.googlesource.com/chromium/src/+/${contract.chromium.revision}/DEPS?format=TEXT`
        );
        const deps = Buffer.from(await depsResponse.text(), 'base64').toString('utf8');
        if (!depsResponse.ok || !deps.includes(`'ffmpeg_revision': '${contract.ffmpeg.revision}'`)) {
            errors.push('Chromium FFmpeg revision drifted');
        }
        const sourceResponse = await fetcher(
            `https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/${contract.ffmpeg.revision}?format=JSON`
        );
        const sourceBody = (await sourceResponse.text()).replace(/^\)\]\}'\n/u, '');
        const source = JSON.parse(sourceBody) as { commit?: string };
        if (!sourceResponse.ok || source.commit !== contract.ffmpeg.revision) {
            errors.push('FFmpeg source revision drifted');
        }
    } catch (error) {
        errors.push(`FFmpeg source evidence unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    return errors;
}

export function checkElectronRuntimeProvenance(root: string): void {
    const errors = validateElectronRuntimeProvenance(root);
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    process.stdout.write('Electron runtime provenance valid\n');
}

async function checkElectronSourcesOnline(root: string): Promise<void> {
    const errors = await validateElectronSourcesOnline(root);
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    process.stdout.write('Electron source and release identities valid\n');
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    if (process.argv.includes('--online')) {
        await checkElectronSourcesOnline(root);
    } else {
        checkElectronRuntimeProvenance(root);
    }
}
