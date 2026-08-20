#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Source = {
    repository: string;
    revision: string;
    version?: string;
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

    const ids = manifest.components.map((component) => component.id);
    if (new Set(ids).size !== ids.length) {
        errors.push('component IDs must be unique');
    }

    for (const component of manifest.components) {
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

    return errors;
}

export function checkLgplRuntimeProvenance(root: string): void {
    const errors = validateLgplRuntimeProvenance(root);
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    process.stdout.write('LGPL runtime provenance valid\n');
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    checkLgplRuntimeProvenance(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
}
