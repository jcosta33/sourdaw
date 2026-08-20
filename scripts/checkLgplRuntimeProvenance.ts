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
    packageLicense: string;
    license: string;
    licenseFiles: string[];
    packageFiles: string[];
    shippedFiles: Record<string, string>;
    sources: Record<string, { repository: string; relationship: Source['relationship'] }>;
    integration?: Component['integration'];
};

const REQUIRED_COMPONENTS: Record<string, RequiredComponent> = {
    faustwasm: {
        package: '@grame/faustwasm',
        packageLicense: 'LGPL-3.0',
        license: 'LGPL-2.1-or-later',
        licenseFiles: ['public/legal/faustwasm-COPYING.txt'],
        packageFiles: [
            'COPYING.txt',
            'libfaust-wasm/libfaust-wasm.data',
            'libfaust-wasm/libfaust-wasm.js',
            'libfaust-wasm/libfaust-wasm.wasm',
        ],
        shippedFiles: {
            'public/faust/libfaust-wasm.data': 'libfaust-wasm/libfaust-wasm.data',
            'public/faust/libfaust-wasm.js': 'libfaust-wasm/libfaust-wasm.js',
            'public/faust/libfaust-wasm.wasm': 'libfaust-wasm/libfaust-wasm.wasm',
        },
        sources: {
            faustwasm: {
                repository: 'https://github.com/grame-cncm/faustwasm',
                relationship: 'npm-gitHead',
            },
            'faust-core': {
                repository: 'https://github.com/grame-cncm/faust',
                relationship: 'embedded-version-match',
            },
        },
    },
    lamejs: {
        package: '@breezystack/lamejs',
        packageLicense: 'LGPL-3.0',
        license: 'LGPL-3.0-only',
        licenseFiles: ['public/legal/LGPL-3.0-and-GPL-3.0.txt', 'public/legal/lamejs-NOTICE.txt'],
        packageFiles: ['LICENSE', 'dist/lamejs.js'],
        shippedFiles: {},
        sources: {
            lamejs: {
                repository: 'https://github.com/gideonstele/lamejs',
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

function sameKeys(actual: Record<string, string>, expected: string[]): boolean {
    return JSON.stringify(Object.keys(actual).sort()) === JSON.stringify([...expected].sort());
}

export function validateLgplRuntimeProvenance(root: string): string[] {
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
    if (JSON.stringify(ids) !== JSON.stringify(Object.keys(REQUIRED_COMPONENTS).sort())) {
        errors.push('component set drifted');
    }

    for (const component of manifest.components) {
        const required = REQUIRED_COMPONENTS[component.id];
        if (required === undefined) {
            continue;
        }
        if (
            component.package !== required.package ||
            component.packageLicense !== required.packageLicense ||
            component.license !== required.license ||
            component.modifications !== 'none'
        ) {
            errors.push(`${component.id}: identity or license contract drifted`);
        }
        if (!sameKeys(component.licenseFiles, required.licenseFiles)) {
            errors.push(`${component.id}: required license files drifted`);
        }
        if (!sameKeys(component.packageFiles, required.packageFiles)) {
            errors.push(`${component.id}: required package files drifted`);
        }
        if (!sameRecord(component.shippedFiles, required.shippedFiles)) {
            errors.push(`${component.id}: shipped file mapping drifted`);
        }
        const sources = Object.fromEntries(component.sources.map((source) => [source.id, source]));
        if (JSON.stringify(Object.keys(sources).sort()) !== JSON.stringify(Object.keys(required.sources).sort())) {
            errors.push(`${component.id}: source set drifted`);
        }
        for (const [id, contract] of Object.entries(required.sources)) {
            const source = sources[id];
            if (source?.repository !== contract.repository || source.relationship !== contract.relationship) {
                errors.push(`${component.id}: ${id} source identity drifted`);
            }
        }
        if (JSON.stringify(component.integration) !== JSON.stringify(required.integration)) {
            errors.push(`${component.id}: integration contract drifted`);
        }
        if (projectPackage.dependencies?.[component.package] !== component.specifier) {
            errors.push(`${component.id}: dependency specifier drifted`);
        }
        if (!lock.includes(`${component.package}@${component.version}`) || !lock.includes(component.integrity)) {
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
    const compiler = faust?.sources.find((source) => source.version !== undefined);
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
