import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Derives, from the source tree, every module through which a hosted request body is built or leaves.
 *
 * Rule: a transport is any non-test source file under `src/` that defines or imports
 * `runProviderGatewayRequest` (read from the import or destructure, under any local name, never from
 * call text) or calls `fetch(` against a runtime's hosted `base_url`. Import specifiers are read in
 * single quotes, double quotes and no-substitution template literals, static and dynamic. A module is reached when it imports a value
 * (never a type) that resolves, through `#/` aliases and barrel re-exports, to the defining file of
 * a reached module, to a fixpoint. Presentation and composition-root modules are reached but
 * terminal: they put no request body of their own on the wire, so following their importers would
 * only list the application's entry points.
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const TERMINAL_TIER = /(?:^|\/)(?:presentations|app)\//u;
const GATEWAY_FUNCTION = 'runProviderGatewayRequest';
const GATEWAY_DEFINITION = /^[ \t]*export\s+(?:async\s+)?function\s+runProviderGatewayRequest\b/mu;
const BASE_URL_FETCH = /\bfetch\(`\$\{runtime\.base_url\}/u;
/** A static import at the start of a statement; the specifier is in single quotes, double quotes or backticks. */
const STATIC_IMPORT = /^[ \t]*import(?![\w$])\s*(type\s+)?([^'"`;]*?)\s*from\s*(['"`])([^'"`$\n]+)\3/gmu;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"`])([^'"`$\n]+)\1\s*\)/gu;
const DESTRUCTURED_DYNAMIC_IMPORT = /\{([^}]*)\}\s*=\s*await\s+import\s*\(/gu;
const EXPORT_NAMED_FROM = /export\s*(type\s*)?\{([^}]*)\}\s*from\s*(['"`])([^'"`$\n]+)\3/gu;
const EXPORT_STAR_FROM = /export\s*\*\s*from\s*(['"`])([^'"`$\n]+)\1/gu;

export type HostedBodyCensus = {
    /** Every reached module, relative to `src/`. */
    modules: readonly string[];
    /** The reached modules that are transports. */
    transports: readonly string[];
    /** Whether `from` imports `to` directly or through other reached modules. */
    reaches: (from: string, to: string) => boolean;
};

function listSourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : listSourceFiles(path);
        }
        const isSource = /\.tsx?$/u.test(entry.name) && !/\.(?:spec|test|d)\.tsx?$/u.test(entry.name);
        return isSource ? [path] : [];
    });
}

function isBarrel(file: string): boolean {
    return /\/index\.tsx?$/u.test(file);
}

function splitSpecifierList(list: string): { name: string; local: string; typeOnly: boolean }[] {
    const parts = list.split(',');
    const trimmed = parts.map((part) => part.trim());
    const nonEmpty = trimmed.filter((part) => part !== '');
    return nonEmpty.map((part) => {
        const typeOnly = /^type\s/u.test(part);
        const pieces = part.replace(/^type\s+/u, '').split(/\s+as\s+/u);
        const [name = '', local = name] = pieces.map((piece) => piece.trim());
        return { name, local, typeOnly };
    });
}

/** Reads `src/`, or the given sources, keyed by path relative to `src/`, in place of it. */
function importsGatewayFunction(text: string): boolean {
    for (const match of text.matchAll(STATIC_IMPORT)) {
        const named = /\{([^}]*)\}/u.exec(match[2] ?? '');
        const importsValue = match[1] === undefined && named !== null;
        if (
            importsValue &&
            splitSpecifierList(named[1] ?? '').some((entry) => entry.name === GATEWAY_FUNCTION && !entry.typeOnly)
        ) {
            return true;
        }
    }
    for (const match of text.matchAll(DESTRUCTURED_DYNAMIC_IMPORT)) {
        const bound = (match[1] ?? '').split(',').map((part) => part.split(':')[0]?.trim());
        if (bound.includes(GATEWAY_FUNCTION)) {
            return true;
        }
    }
    return false;
}

function isTransportSource(text: string): boolean {
    return GATEWAY_DEFINITION.test(text) || importsGatewayFunction(text) || BASE_URL_FETCH.test(text);
}

/** The given sources, keyed by path relative to `src/`, or else every source file read from `src/`. */
function readSources(inMemorySources: Readonly<Record<string, string>> | undefined): Map<string, string> {
    if (inMemorySources !== undefined) {
        return new Map(Object.entries(inMemorySources).map(([file, text]) => [join(SRC_ROOT, file), text]));
    }
    return new Map(listSourceFiles(SRC_ROOT).map((file) => [file, readFileSync(file, 'utf8')]));
}

export function discoverHostedBodyCensus(inMemorySources?: Readonly<Record<string, string>>): HostedBodyCensus {
    const sources = readSources(inMemorySources);
    const files = Array.from(sources.keys());

    function resolveSpecifier(from: string, specifier: string): string | null {
        let base: string;
        if (specifier.startsWith('.')) {
            base = resolve(dirname(from), specifier);
        } else if (specifier.startsWith('#/')) {
            base = join(SRC_ROOT, specifier.slice(2));
        } else {
            return null;
        }
        const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
        return candidates.find((candidate) => sources.has(candidate)) ?? null;
    }

    // Export name -> defining file, following `export { x } from` and `export * from` through barrels.
    const exportCache = new Map<string, Map<string, string>>();
    function readExports(file: string, visiting: ReadonlySet<string> = new Set()): Map<string, string> {
        const cached = exportCache.get(file);
        if (cached !== undefined) {
            return cached;
        }
        const exported = new Map<string, string>();
        if (visiting.has(file)) {
            return exported;
        }
        const nextVisiting = new Set(visiting).add(file);
        const text = sources.get(file) ?? '';
        for (const match of text.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class|enum)\s+([\w$]+)/gu)) {
            exported.set(match[1] ?? '', file);
        }
        for (const match of text.matchAll(EXPORT_NAMED_FROM)) {
            const target = resolveSpecifier(file, match[4] ?? '');
            if (target === null || match[1] !== undefined) {
                continue;
            }
            const targetExports = readExports(target, nextVisiting);
            for (const { name, local, typeOnly } of splitSpecifierList(match[2] ?? '')) {
                const definedIn = targetExports.get(name);
                if (!typeOnly && definedIn !== undefined) {
                    exported.set(local, definedIn);
                }
            }
        }
        for (const match of text.matchAll(EXPORT_STAR_FROM)) {
            const target = resolveSpecifier(file, match[2] ?? '');
            if (target !== null) {
                for (const [name, definedIn] of readExports(target, nextVisiting)) {
                    exported.set(name, definedIn);
                }
            }
        }
        if (visiting.size === 0) {
            exportCache.set(file, exported);
        }
        return exported;
    }

    // The defining files whose values a module imports; a type-only import is erased and reaches nothing.
    function readValueUses(file: string): Set<string> {
        const used = new Set<string>();
        const text = sources.get(file) ?? '';
        for (const match of text.matchAll(STATIC_IMPORT)) {
            const target = resolveSpecifier(file, match[4] ?? '');
            if (match[1] !== undefined || target === null) {
                continue;
            }
            const clause = match[2] ?? '';
            const targetExports = readExports(target);
            const named = /\{([^}]*)\}/u.exec(clause);
            for (const { name, typeOnly } of named === null ? [] : splitSpecifierList(named[1] ?? '')) {
                const definedIn = targetExports.get(name);
                if (typeOnly) {
                    continue;
                }
                if (definedIn !== undefined) {
                    used.add(definedIn);
                } else if (!isBarrel(target)) {
                    used.add(target);
                }
            }
            if (/\*\s+as\s/u.test(clause) || /^[A-Za-z_$]/u.test(clause.trim())) {
                used.add(target);
                for (const definedIn of targetExports.values()) {
                    used.add(definedIn);
                }
            }
        }
        for (const match of text.matchAll(DYNAMIC_IMPORT)) {
            const target = resolveSpecifier(file, match[2] ?? '');
            if (target !== null) {
                used.add(target);
                for (const definedIn of readExports(target).values()) {
                    used.add(definedIn);
                }
            }
        }
        used.delete(file);
        return used;
    }

    const uses = new Map(files.map((file) => [file, readValueUses(file)]));
    const transports = files.filter((file) => isTransportSource(sources.get(file) ?? ''));
    const reached = new Set(transports);
    for (let grew = true; grew;) {
        grew = false;
        for (const file of files) {
            if (reached.has(file) || isBarrel(file)) {
                continue;
            }
            const fileUses = uses.get(file);
            const importsPropagating = Array.from(fileUses ?? []).some(
                (used) => reached.has(used) && !TERMINAL_TIER.test(relative(SRC_ROOT, used))
            );
            if (importsPropagating) {
                reached.add(file);
                grew = true;
            }
        }
    }

    const toRelative = (file: string) => relative(SRC_ROOT, file);
    return {
        modules: Array.from(reached, toRelative).sort(),
        transports: transports.map(toRelative).sort(),
        reaches: (from, to) => {
            const target = join(SRC_ROOT, to);
            const seen = new Set<string>();
            const stack = [join(SRC_ROOT, from)];
            while (stack.length > 0) {
                const current = stack.pop() ?? '';
                if (seen.has(current)) {
                    continue;
                }
                seen.add(current);
                for (const used of uses.get(current) ?? []) {
                    if (used === target) {
                        return true;
                    }
                    if (reached.has(used)) {
                        stack.push(used);
                    }
                }
            }
            return false;
        },
    };
}
