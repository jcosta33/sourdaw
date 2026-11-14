import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { parseAllDocuments } from 'yaml';

type YamlParser = { parseAllDocuments: typeof parseAllDocuments };
function isYamlParser(value: unknown): value is YamlParser {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'parseAllDocuments') === 'function';
}
/** Control-only imports need no install; generation resolves yaml only from its already admitted package root. */
function yamlParser(packageRoot?: string): YamlParser {
    const requirePackage = createRequire(
        packageRoot === undefined ? import.meta.url : resolve(packageRoot, 'package.json')
    );
    const parser: unknown = requirePackage('yaml');
    if (!isYamlParser(parser)) {
        throw new Error('pnpm-lock.yaml: yaml parser exports are unavailable');
    }
    return parser;
}

type Mapping = Record<string, unknown>;
type Dependency = { specifier?: string; version?: string };
export type PnpmLockPackages = Record<string, { resolution?: { integrity?: string } }>;
type Importer = Mapping & {
    dependencies?: Record<string, Dependency>;
    devDependencies?: Record<string, Dependency>;
    optionalDependencies?: Record<string, Dependency>;
};
type LockDocument = Mapping & { importers?: Record<string, Importer>; packages: PnpmLockPackages };
export type PnpmLock = { application: LockDocument; packages: PnpmLockPackages };

function isMapping(value: unknown): value is Mapping {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapping(value: unknown, label: string): Mapping {
    if (!isMapping(value)) {
        throw new Error(`pnpm-lock.yaml: ${label} must be a mapping`);
    }
    return value;
}

function dependencies(value: unknown, label: string): Record<string, Dependency> {
    return Object.fromEntries(
        Object.entries(mapping(value, label)).map(([name, value]) => {
            const dependency = mapping(value, `${label}.${name}`);
            const { specifier, version } = dependency;
            if (
                (specifier !== undefined && typeof specifier !== 'string') ||
                (version !== undefined && typeof version !== 'string')
            ) {
                throw new Error(`pnpm-lock.yaml: ${label}.${name} must declare string versions`);
            }
            return [name, { ...dependency, specifier, version }];
        })
    );
}

function importers(value: unknown): Record<string, Importer> | undefined {
    if (value === undefined) {
        return undefined;
    }
    return Object.fromEntries(
        Object.entries(mapping(value, 'importers')).map(([name, value]) => {
            const importer: Importer = Object.fromEntries(Object.entries(mapping(value, `importers.${name}`)));
            for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
                if (importer[field] !== undefined) {
                    importer[field] = dependencies(importer[field], `importers.${name}.${field}`);
                }
            }
            for (const field of ['configDependencies', 'packageManagerDependencies']) {
                if (importer[field] !== undefined) {
                    dependencies(importer[field], `importers.${name}.${field}`);
                }
            }
            return [name, importer];
        })
    );
}

function packages(value: unknown): PnpmLockPackages {
    return Object.fromEntries(
        Object.entries(mapping(value, 'packages')).map(([name, value]): [string, PnpmLockPackages[string]] => {
            const entry = mapping(value, `packages.${name}`);
            if (entry.resolution === undefined) {
                return [name, { ...entry, resolution: undefined }];
            }
            const resolution = mapping(entry.resolution, `packages.${name}.resolution`);
            const { integrity } = resolution;
            if (integrity !== undefined && typeof integrity !== 'string') {
                throw new Error(`pnpm-lock.yaml: packages.${name}.resolution.integrity must be a string`);
            }
            return [name, { ...entry, resolution: { ...resolution, integrity } }];
        })
    );
}

function isTooling(document: LockDocument): boolean {
    const rows = Object.values(document.importers ?? {});
    const toolingFields = ['configDependencies', 'packageManagerDependencies'];
    if (!rows.some((row) => toolingFields.some((field) => Object.hasOwn(row, field)))) {
        return false;
    }
    if (
        rows.some((row) => Object.keys(row).some((field) => !toolingFields.includes(field))) ||
        Object.keys(document).some(
            (field) => !['lockfileVersion', 'importers', 'packages', 'snapshots'].includes(field)
        )
    ) {
        throw new Error('pnpm-lock.yaml: package-manager document mixes application fields');
    }
    return true;
}

/** Keep importer authority separate while binding proof identities across both current lock documents. */
export function parsePnpmLock(source: string, packageRoot?: string): PnpmLock {
    const documents = yamlParser(packageRoot).parseAllDocuments(source, { uniqueKeys: true });
    if (documents.length === 0 || documents.length > 2) {
        throw new Error('pnpm-lock.yaml: expected one application document and at most one package-manager document');
    }
    let application: LockDocument | undefined;
    let tooling: LockDocument | undefined;
    const combined = new Map<string, PnpmLockPackages[string]>();
    const identities = new Map<string, string | undefined>();
    for (const document of documents) {
        const issue = document.errors[0] ?? document.warnings[0];
        if (issue !== undefined) {
            throw new Error(`pnpm-lock.yaml: ${issue.message}`);
        }
        const data = mapping(document.toJS({ maxAliasCount: 100 }), 'document');
        const parsed: LockDocument = {
            ...data,
            importers: importers(data.importers),
            packages: packages(data.packages),
        };
        if (isTooling(parsed)) {
            if (tooling !== undefined) {
                throw new Error('pnpm-lock.yaml: duplicate package-manager document');
            }
            tooling = parsed;
        } else {
            if (application !== undefined) {
                throw new Error('pnpm-lock.yaml: duplicate application document');
            }
            application = parsed;
        }
        for (const [name, entry] of Object.entries(parsed.packages)) {
            // Peer qualifiers change a snapshot, never the registry archive identity.
            const identity = name.split('(')[0]!;
            const integrity = entry.resolution?.integrity;
            if (identities.has(identity) && identities.get(identity) !== integrity) {
                throw new Error(`pnpm-lock.yaml: conflicting package integrity for ${identity}`);
            }
            identities.set(identity, integrity);
            combined.set(name, entry);
        }
    }
    if (application === undefined) {
        throw new Error('pnpm-lock.yaml: application document is missing');
    }
    return { application, packages: Object.fromEntries(combined) };
}
