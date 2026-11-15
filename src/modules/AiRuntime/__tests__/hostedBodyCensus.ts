import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Derives, from the source tree, every module through which a hosted request body is built or leaves.
 *
 * Rule: a transport is any non-test source file under `src/` that calls `runProviderGatewayRequest(`
 * or `fetch(` against a runtime's hosted `base_url`. A module is reached when it imports a value
 * (never a type) that resolves, through `#/` aliases and barrel re-exports, to the defining file of
 * a reached module, to a fixpoint. Presentation and composition-root modules are reached but
 * terminal: they put no request body of their own on the wire, so following their importers would
 * only list the application's entry points.
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const TERMINAL_TIER = /(?:^|\/)(?:presentations|app)\//u;
const TRANSPORT_CALL = /\brunProviderGatewayRequest\(|\bfetch\(`\$\{runtime\.base_url\}/u;

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
    return list
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .map((part) => {
            const typeOnly = /^type\s/u.test(part);
            const [name = '', local = name] = part
                .replace(/^type\s+/u, '')
                .split(/\s+as\s+/u)
                .map((piece) => piece.trim());
            return { name, local, typeOnly };
        });
}

export function discoverHostedBodyCensus(): HostedBodyCensus {
    const files = listSourceFiles(SRC_ROOT);
    const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));

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
        for (const match of text.matchAll(/export\s*(type\s*)?\{([^}]*)\}\s*from\s*'([^']+)'/gu)) {
            const target = resolveSpecifier(file, match[3] ?? '');
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
        for (const match of text.matchAll(/export\s*\*\s*from\s*'([^']+)'/gu)) {
            const target = resolveSpecifier(file, match[1] ?? '');
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
        for (const match of text.matchAll(/import\s+(type\s+)?([^'";]*?)\s*from\s*'([^']+)'/gu)) {
            const target = resolveSpecifier(file, match[3] ?? '');
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
        for (const match of text.matchAll(/import\(\s*'([^']+)'\s*\)/gu)) {
            const target = resolveSpecifier(file, match[1] ?? '');
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
    const transports = files.filter((file) => TRANSPORT_CALL.test(sources.get(file) ?? ''));
    const reached = new Set(transports);
    for (let grew = true; grew;) {
        grew = false;
        for (const file of files) {
            if (reached.has(file) || isBarrel(file)) {
                continue;
            }
            const importsPropagating = [...(uses.get(file) ?? [])].some(
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
        modules: [...reached].map(toRelative).sort(),
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
