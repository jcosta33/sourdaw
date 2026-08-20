#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Source = {
    id: string;
    repository: string;
    revision: string;
    version?: string;
    relationship: 'npm-gitHead' | 'embedded-version-match';
    archive: string;
};

type Component = {
    id: string;
    package: string;
    version: string;
    specifier: string;
    integrity: string;
    repository: string;
    revision: string;
    modifications: 'none';
    distribution: 'copied-byte-for-byte' | 'vite-bundle';
    packageLicense: string;
    license: string;
    licenseFiles: Record<string, string>;
    packageFiles: Record<string, string>;
    shippedFiles: Record<string, string>;
    sources: Source[];
    integration?: { file: string; import: string };
};

type Provenance = {
    schemaVersion: number;
    components: Component[];
};

type RequiredComponent = {
    package: string;
    version: string;
    specifier: string;
    integrity: string;
    repository: string;
    revision: string;
    distribution: Component['distribution'];
    packageLicense: string;
    license: string;
    licenseFiles: Record<string, string>;
    packageFiles: Record<string, string>;
    shippedFiles: Record<string, string>;
    sources: Record<
        string,
        {
            repository: string;
            revision: string;
            version?: string;
            relationship: Source['relationship'];
        }
    >;
    integration?: Component['integration'];
};

export type LgplRuntimeContract = Readonly<Record<string, RequiredComponent>>;

const REQUIRED_COMPONENTS: LgplRuntimeContract = {
    faustwasm: {
        package: '@grame/faustwasm',
        version: '0.16.7',
        specifier: '0.16.7',
        integrity: 'sha512-hLMCFuZFBvDOOAftFJKJEbc+p0GcXQLlswSgK6zOoMhrOV5zZdp39Qz4VSmdDQjTeiRNboNSvsy1FgB4nuJQRw==',
        repository: 'https://github.com/grame-cncm/faustwasm',
        revision: 'a1ae243d885d6494409a2a4a227cbdd2a6833edf',
        distribution: 'copied-byte-for-byte',
        packageLicense: 'LGPL-3.0',
        license: 'LGPL-2.1-or-later',
        licenseFiles: {
            'public/legal/faustwasm-COPYING.txt':
                'sha256:587bc956e3703e11aa8f4350193d6f5e37b497d84a552abdbe348b48e542d5a1',
        },
        packageFiles: {
            'COPYING.txt': 'sha256:c747ba23f84a8b47ebc6007bf536215b3ceeab6bfa2f803cab422a512e3f1ed3',
            'libfaust-wasm/libfaust-wasm.data':
                'sha256:1a5acda82475a3196eb09444fc6cc42951ae3b8c062828fc4b6f0155a6f23f3f',
            'libfaust-wasm/libfaust-wasm.js': 'sha256:3e582a8a47128ae1eb594c7e39c9a706844304d2377f11439cf3a9f8a8be2622',
            'libfaust-wasm/libfaust-wasm.wasm':
                'sha256:c84e10786d9090eb5a70cab806f66b1cf82009d5c0836c473d3cb76fae7e76db',
        },
        shippedFiles: {
            'public/faust/libfaust-wasm.data': 'libfaust-wasm/libfaust-wasm.data',
            'public/faust/libfaust-wasm.js': 'libfaust-wasm/libfaust-wasm.js',
            'public/faust/libfaust-wasm.wasm': 'libfaust-wasm/libfaust-wasm.wasm',
        },
        sources: {
            faustwasm: {
                repository: 'https://github.com/grame-cncm/faustwasm',
                revision: 'a1ae243d885d6494409a2a4a227cbdd2a6833edf',
                relationship: 'npm-gitHead',
            },
            'faust-core': {
                repository: 'https://github.com/grame-cncm/faust',
                revision: '011423ab76674cd96009385af15cadcd281a3259',
                version: '2.86.2',
                relationship: 'embedded-version-match',
            },
        },
    },
    lamejs: {
        package: '@breezystack/lamejs',
        version: '1.2.7',
        specifier: '1.2.7',
        integrity: 'sha512-6wc7ck65ctA75Hq7FYHTtTvGnYs6msgdxiSUICQ+A01nVOWg6rqouZB8IdyteRlfpYYiFovkf67dIeOgWIUzTA==',
        repository: 'https://github.com/gideonstele/lamejs',
        revision: '1fb0ef5fa177413107e2e107d054a9b994e3f79c',
        distribution: 'vite-bundle',
        packageLicense: 'LGPL-3.0',
        license: 'LGPL-3.0-only',
        licenseFiles: {
            'public/legal/LGPL-3.0-and-GPL-3.0.txt':
                'sha256:5eecce16e59e24ddd9d3712012517a033f2cd0459ace22b43d5659d4624abff0',
            'public/legal/lamejs-NOTICE.txt': 'sha256:b89d10b0c083613ad440e2357ef7b2cddb22e79495237d533efde4cfa3cee5fc',
        },
        packageFiles: {
            LICENSE: 'sha256:cd144ca132e3842b01f5ed2d6f3a32141e24a1cc15e115aa5f19a2294ce0a379',
            'dist/lamejs.js': 'sha256:1c5f944911ccf2f6e29ab36c2e568363210ab16f50c0d76077060f40ecf91d28',
        },
        shippedFiles: {},
        sources: {
            lamejs: {
                repository: 'https://github.com/gideonstele/lamejs',
                revision: '1fb0ef5fa177413107e2e107d054a9b994e3f79c',
                relationship: 'npm-gitHead',
            },
        },
        integration: {
            file: 'src/modules/AudioRendering/repositories/audioEncoders/mp3Encoder.ts',
            import: '@breezystack/lamejs',
        },
    },
};

function sha256(path: string): string {
    return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function readJson<Value>(path: string): Value {
    return JSON.parse(readFileSync(path, 'utf8')) as Value;
}

function checkHash(root: string, path: string, expected: string, errors: string[]): void {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) {
        errors.push(`${path}: missing`);
    } else if (sha256(absolute) !== expected) {
        errors.push(`${path}: digest drifted`);
    }
}

function sameRecord(actual: Record<string, string>, expected: Record<string, string>): boolean {
    return JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort());
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function lockHasExactResolution(lock: string, component: Component): boolean {
    const packageName = escapeRegExp(component.package);
    const version = escapeRegExp(component.version);
    const specifier = escapeRegExp(component.specifier);
    const integrity = escapeRegExp(component.integrity);
    const importer = new RegExp(
        `^      '${packageName}':\\n        specifier: ${specifier}\\n        version: ${version}$`,
        'mu'
    );
    const resolution = new RegExp(
        `^  '${packageName}@${version}':\\n    resolution: \\{integrity: ${integrity}\\}$`,
        'mu'
    );
    return importer.test(lock) && resolution.test(lock);
}

export function validateLgplRuntimeProvenance(
    root: string,
    requiredComponents: LgplRuntimeContract = REQUIRED_COMPONENTS
): string[] {
    const manifest = readJson<Provenance>(resolve(root, 'public/legal/SOURCES.json'));
    const projectPackage = readJson<{ dependencies?: Record<string, string> }>(resolve(root, 'package.json'));
    const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
    const directions = [
        readFileSync(resolve(root, 'public/legal/THIRD-PARTY-NOTICES.md'), 'utf8'),
        readFileSync(resolve(root, 'public/legal/RELINKING.md'), 'utf8'),
    ].join('\n');
    const errors: string[] = [];

    if (manifest.schemaVersion !== 1) {
        errors.push('schemaVersion must be 1');
    }
    if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
        return [...errors, 'components must be non-empty'];
    }

    const ids = manifest.components.map((component) => component.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify(Object.keys(requiredComponents).sort())) {
        errors.push('component set drifted');
    }

    for (const component of manifest.components) {
        const required = requiredComponents[component.id];
        if (required === undefined) {
            continue;
        }
        if (
            component.package !== required.package ||
            component.version !== required.version ||
            component.specifier !== required.specifier ||
            component.integrity !== required.integrity ||
            component.repository !== required.repository ||
            component.revision !== required.revision ||
            component.packageLicense !== required.packageLicense ||
            component.license !== required.license ||
            component.modifications !== 'none' ||
            component.distribution !== required.distribution
        ) {
            errors.push(`${component.id}: identity or license contract drifted`);
        }
        if (!sameRecord(component.licenseFiles, required.licenseFiles)) {
            errors.push(`${component.id}: required license evidence drifted`);
        }
        if (!sameRecord(component.packageFiles, required.packageFiles)) {
            errors.push(`${component.id}: required package evidence drifted`);
        }
        if (!sameRecord(component.shippedFiles, required.shippedFiles)) {
            errors.push(`${component.id}: shipped file mapping drifted`);
        }
        const sourceIds = component.sources.map((source) => source.id);
        if (new Set(sourceIds).size !== sourceIds.length) {
            errors.push(`${component.id}: source IDs must be unique`);
        }
        const sources = Object.fromEntries(component.sources.map((source) => [source.id, source]));
        if (JSON.stringify(Object.keys(sources).sort()) !== JSON.stringify(Object.keys(required.sources).sort())) {
            errors.push(`${component.id}: source set drifted`);
        }
        for (const [id, contract] of Object.entries(required.sources)) {
            const source = sources[id];
            if (
                source?.repository !== contract.repository ||
                source.revision !== contract.revision ||
                source.version !== contract.version ||
                source.relationship !== contract.relationship ||
                source.archive !== `${contract.repository}/archive/${contract.revision}.tar.gz`
            ) {
                errors.push(`${component.id}: ${id} source identity drifted`);
            }
        }
        if (JSON.stringify(component.integration) !== JSON.stringify(required.integration)) {
            errors.push(`${component.id}: integration contract drifted`);
        }
        if (projectPackage.dependencies?.[component.package] !== component.specifier) {
            errors.push(`${component.id}: dependency specifier drifted`);
        }
        if (!lockHasExactResolution(lock, component)) {
            errors.push(`${component.id}: lock resolution drifted`);
        }

        const packageRoot = resolve(root, 'node_modules', component.package);
        const installedPackagePath = resolve(packageRoot, 'package.json');
        if (!existsSync(installedPackagePath)) {
            errors.push(`${component.id}: package is not installed`);
            continue;
        }
        const installedPackage = readJson<{ version?: string; license?: string }>(installedPackagePath);
        if (installedPackage.version !== component.version) {
            errors.push(`${component.id}: installed version drifted`);
        }
        if (installedPackage.license !== component.packageLicense) {
            errors.push(`${component.id}: package license metadata drifted`);
        }

        for (const [path, expected] of Object.entries(component.packageFiles)) {
            checkHash(packageRoot, path, expected, errors);
        }
        for (const [path, expected] of Object.entries(component.licenseFiles)) {
            checkHash(root, path, expected, errors);
        }
        for (const [shippedPath, packagePath] of Object.entries(component.shippedFiles)) {
            const shipped = resolve(root, shippedPath);
            const installed = resolve(packageRoot, packagePath);
            if (!existsSync(shipped) || !existsSync(installed)) {
                errors.push(`${component.id}: shipped package pair is missing: ${shippedPath}`);
            } else if (!readFileSync(shipped).equals(readFileSync(installed))) {
                errors.push(`${component.id}: shipped file differs from package: ${shippedPath}`);
            }
        }

        if (
            !component.sources.some(
                (source) => source.repository === component.repository && source.revision === component.revision
            )
        ) {
            errors.push(`${component.id}: package source revision is missing`);
        }
        for (const source of component.sources) {
            if (!/^[0-9a-f]{40}$/.test(source.revision) || !source.archive.includes(source.revision)) {
                errors.push(`${component.id}: source is not pinned to its revision`);
            }
            if (!directions.includes(source.archive)) {
                errors.push(`${component.id}: source directions omit ${source.revision}`);
            }
        }
        if (!directions.includes(component.version) || !directions.includes(component.license)) {
            errors.push(`${component.id}: user directions omit version or license`);
        }

        if (component.integration !== undefined) {
            const integration = readFileSync(resolve(root, component.integration.file), 'utf8');
            if (!integration.includes(component.integration.import)) {
                errors.push(`${component.id}: integration import drifted`);
            }
        }
    }

    const faust = manifest.components.find((component) => component.id === 'faustwasm');
    const compiler = faust?.sources.find((source) => source.id === 'faust-core');
    const compilerBinary = Object.keys(faust?.shippedFiles ?? {}).find((path) => path.endsWith('.wasm'));
    if (compiler?.version === undefined) {
        errors.push('faustwasm: compiler source version is missing');
    } else if (compilerBinary === undefined) {
        errors.push('faustwasm: compiler binary is missing');
    } else if (!readFileSync(resolve(root, compilerBinary)).includes(Buffer.from(compiler.version))) {
        errors.push('faustwasm: embedded compiler version drifted');
    }

    const desktopConfig = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8');
    if (!/from: public\/legal\s+to: legal/u.test(desktopConfig)) {
        errors.push('desktop package omits the legal directory');
    }
    const statusBar = readFileSync(
        resolve(root, 'src/modules/WorkspaceShell/presentations/views/StatusBar.tsx'),
        'utf8'
    );
    if (!statusBar.includes("window.open('/legal/THIRD-PARTY-NOTICES.md', '_blank')")) {
        errors.push('application omits the legal notice entry point');
    }

    return errors;
}

export async function validateLgplSourceAvailability(root: string): Promise<string[]> {
    const manifest = readJson<Provenance>(resolve(root, 'public/legal/SOURCES.json'));
    const errors: string[] = [];
    for (const component of manifest.components) {
        const npmSource = component.sources.find((source) => source.relationship === 'npm-gitHead');
        try {
            const packageName = component.package.replace('/', '%2F');
            const response = await fetch(`https://registry.npmjs.org/${packageName}/${component.version}`);
            if (!response.ok) {
                errors.push(`${component.id}: npm metadata unavailable (${String(response.status)})`);
            } else {
                const metadata = (await response.json()) as { gitHead?: string; dist?: { integrity?: string } };
                if (metadata.gitHead !== npmSource?.revision || metadata.dist?.integrity !== component.integrity) {
                    errors.push(`${component.id}: npm source or package integrity drifted`);
                }
            }
        } catch (error) {
            errors.push(
                `${component.id}: npm metadata unavailable (${error instanceof Error ? error.message : String(error)})`
            );
        }

        for (const source of component.sources) {
            try {
                const response = await fetch(source.archive, { method: 'HEAD', redirect: 'follow' });
                if (!response.ok) {
                    errors.push(`${component.id}: source archive unavailable: ${source.id}`);
                }
            } catch (error) {
                errors.push(
                    `${component.id}: source archive unavailable: ${source.id} (${error instanceof Error ? error.message : String(error)})`
                );
            }
        }
    }
    return errors;
}

export function checkLgplRuntimeProvenance(root: string): void {
    const errors = validateLgplRuntimeProvenance(root);
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    process.stdout.write('LGPL runtime provenance valid\n');
}

async function checkLgplSourcesOnline(root: string): Promise<void> {
    checkLgplRuntimeProvenance(root);
    const errors = await validateLgplSourceAvailability(root);
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    process.stdout.write('LGPL source routes available\n');
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    if (process.argv.includes('--online')) {
        await checkLgplSourcesOnline(root);
    } else {
        checkLgplRuntimeProvenance(root);
    }
}
