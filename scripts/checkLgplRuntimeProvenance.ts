#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { parsePnpmLock } from './pnpmLock.ts';
import {
    FAUST_SOURCE_ARCHIVE,
    FAUST_SOURCE_SHA256,
    validateFaustCorrespondingSource,
} from './faustCorrespondingSource.ts';

type Source = {
    id: string;
    repository: string;
    revision: string;
    version?: string;
    relationship:
        'npm-gitHead' | 'embedded-version-match' | 'embedded-library-match' | 'reconstructed-corresponding-source';
    archiveSha256?: string;
    upstreamRevisionAvailable?: false;
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
            archive?: string;
            archiveSha256?: string;
            upstreamRevisionAvailable?: false;
        }
    >;
    integration?: Component['integration'];
};

export type LgplRuntimeContract = Readonly<Record<string, RequiredComponent>>;

const REQUIRED_COMPONENTS: LgplRuntimeContract = {
    faustwasm: {
        package: '@grame/faustwasm',
        version: '0.20.2',
        specifier: '0.20.2',
        integrity: 'sha512-Xtr5w73+3SVfXDA7HMATxQJy5wjfDRH10b6nHv1iximJQz4vnOh9D1f5z+l2kFKmuo5ZzkIOx9y5WI2/vtEI7w==',
        repository: 'https://github.com/grame-cncm/faustwasm',
        revision: '4403c779a3e92af4e4f44b5abda98b3ac5fa57d9',
        distribution: 'copied-byte-for-byte',
        packageLicense: 'LGPL-2.1',
        license: 'LGPL-2.1-or-later',
        licenseFiles: {
            'public/legal/faustwasm-COPYING.txt':
                'sha256:5af8efd745a8c91bf99443662e85708866807dc2e01b08045f338d63e2839916',
        },
        packageFiles: {
            'COPYING.txt': 'sha256:5af8efd745a8c91bf99443662e85708866807dc2e01b08045f338d63e2839916',
            'libfaust-wasm/libfaust-wasm.data':
                'sha256:7f338f4d5006608241c875c38363348d42f9aeed5cbfa5cbb63828e5d4f912ed',
            'libfaust-wasm/libfaust-wasm.js': 'sha256:82b9fe95a126afab27ccd8bdc0ac9f6c7191db569fef3d1b59cb873508797acc',
            'libfaust-wasm/libfaust-wasm.wasm':
                'sha256:b047d7c2dd1e77392ee352a95db9df4bd81458c5ca58ccc67631476fe4b59573',
            'dist/esm/index.js': 'sha256:aab25a0e405586b6ce614788f2edc473d7241d523f2a61fbf020ada14655ff1a',
            'dist/esm/index.js.map': 'sha256:89378855b7ec759a894a947844618f530670f60b451f1337b559f04f68986bd4',
        },
        shippedFiles: {
            'public/faust/libfaust-wasm.data': 'libfaust-wasm/libfaust-wasm.data',
            'public/faust/libfaust-wasm.js': 'libfaust-wasm/libfaust-wasm.js',
            'public/faust/libfaust-wasm.wasm': 'libfaust-wasm/libfaust-wasm.wasm',
        },
        sources: {
            faustwasm: {
                repository: 'https://github.com/grame-cncm/faustwasm',
                revision: '4403c779a3e92af4e4f44b5abda98b3ac5fa57d9',
                relationship: 'reconstructed-corresponding-source',
                archive: 'public/legal/faustwasm-0.20.2-corresponding-source.tar.gz',
                archiveSha256: '7a6f0939e8905e40b7733f8e17cf5c806f3c89fb6c5291985dcc6deb883b3682',
                upstreamRevisionAvailable: false,
            },
            'faust-core': {
                repository: 'https://github.com/grame-cncm/faust',
                revision: '21884a6d63713ff99dca2fef95c33aecaedfe643',
                version: '2.90.19',
                relationship: 'embedded-version-match',
            },
            'faust-libraries': {
                repository: 'https://github.com/grame-cncm/faustlibraries',
                revision: '42fab480c778df7bad5c6b620ca4fd005b2bfe9b',
                relationship: 'embedded-library-match',
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

const REQUIRED_RELINKING: Readonly<Record<string, { heading: string; markers: readonly string[] }>> = {
    faustwasm: {
        heading: 'FaustWasm',
        markers: ['SOURCES.json', 'public/faust/', 'pnpm build', 'pnpm desktop:build'],
    },
    lamejs: {
        heading: 'lamejs',
        markers: ['SOURCES.json', '@breezystack/lamejs', 'pnpm build', 'pnpm desktop:build'],
    },
};

const REQUIRED_RELINKING_PREAMBLE = [
    'exact Sourdaw source archive',
    'permit modification and relinking',
    'Do not distribute a binary without the matching archive.',
] as const;

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

function lockHasExactResolution(lock: string, component: Component): boolean {
    try {
        const parsed = parsePnpmLock(lock).application;
        const dependency = parsed.importers?.['.']?.dependencies?.[component.package];
        const resolution = parsed.packages?.[`${component.package}@${component.version}`]?.resolution;
        return (
            dependency?.specifier === component.specifier &&
            dependency.version === component.version &&
            resolution?.integrity === component.integrity
        );
    } catch {
        return false;
    }
}

function hasRuntimeImport(path: string, specifier: string): boolean {
    const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    return source.statements.some((statement) => {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== specifier
        ) {
            return false;
        }
        const clause = statement.importClause;
        if (clause === undefined) {
            return true;
        }
        if (clause.isTypeOnly) {
            return false;
        }
        if (clause.name !== undefined || clause.namedBindings === undefined) {
            return true;
        }
        return (
            ts.isNamespaceImport(clause.namedBindings) || clause.namedBindings.elements.some((item) => !item.isTypeOnly)
        );
    });
}

function markdownSection(markdown: string, heading: string): string | undefined {
    const marker = `## ${heading}`;
    const start = markdown.indexOf(marker);
    if (start === -1) {
        return undefined;
    }
    const next = markdown.indexOf('\n## ', start + marker.length);
    return markdown.slice(start, next === -1 ? undefined : next);
}

export function validateLgplRuntimeProvenance(
    root: string,
    requiredComponents: LgplRuntimeContract = REQUIRED_COMPONENTS
): string[] {
    const manifest = readJson<Provenance>(resolve(root, 'public/legal/SOURCES.json'));
    const projectPackage = readJson<{ dependencies?: Record<string, string> }>(resolve(root, 'package.json'));
    const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
    const notices = readFileSync(resolve(root, 'public/legal/THIRD-PARTY-NOTICES.md'), 'utf8');
    const relinking = readFileSync(resolve(root, 'public/legal/RELINKING.md'), 'utf8');
    const directions = [notices, relinking].join('\n');
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
        const relinkingContract = REQUIRED_RELINKING[component.id];
        const relinkingSection =
            relinkingContract === undefined ? undefined : markdownSection(relinking, relinkingContract.heading);
        if (
            relinkingContract === undefined ||
            relinkingSection === undefined ||
            relinkingContract.markers.some((marker) => !relinkingSection.includes(marker))
        ) {
            errors.push(`${component.id}: relinking directions drifted`);
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
                source.archive !== (contract.archive ?? `${contract.repository}/archive/${contract.revision}.tar.gz`) ||
                source.archiveSha256 !== contract.archiveSha256 ||
                source.upstreamRevisionAvailable !== contract.upstreamRevisionAvailable
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
        const installedPackage = readJson<{ name?: string; version?: string; license?: string }>(installedPackagePath);
        if (installedPackage.name !== component.package) {
            errors.push(`${component.id}: installed package identity drifted`);
        }
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
            const reconstructed = source.relationship === 'reconstructed-corresponding-source';
            if (reconstructed) {
                if (
                    source.archive !== FAUST_SOURCE_ARCHIVE ||
                    source.archiveSha256 !== FAUST_SOURCE_SHA256 ||
                    source.upstreamRevisionAvailable !== false
                ) {
                    errors.push(`${component.id}: corresponding source identity drifted`);
                }
                errors.push(...validateFaustCorrespondingSource(root));
            }
            if (
                !/^[0-9a-f]{40}$/.test(source.revision) ||
                (!reconstructed && !source.archive.includes(source.revision))
            ) {
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
            if (!hasRuntimeImport(resolve(root, component.integration.file), component.integration.import)) {
                errors.push(`${component.id}: integration import drifted`);
            }
        }
    }

    const normalizedRelinking = relinking.replaceAll(/\s+/g, ' ');
    if (REQUIRED_RELINKING_PREAMBLE.some((marker) => !normalizedRelinking.includes(marker))) {
        errors.push('matching application-source directions drifted');
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
        const npmSource = component.sources.find(
            (source) =>
                source.relationship === 'npm-gitHead' || source.relationship === 'reconstructed-corresponding-source'
        );
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
            if (source.relationship === 'reconstructed-corresponding-source') {
                errors.push(...validateFaustCorrespondingSource(root));
                continue;
            }
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
