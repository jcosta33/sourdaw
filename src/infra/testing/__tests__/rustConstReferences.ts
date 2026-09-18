import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

/**
 * A numeric literal as Rust writes it in a const value, where `20_000`-style
 * digit separators are legal (`const X: f32 = 20_000.0;`). Exported because
 * the clamp readers that consume resolved bounds accept the same grammar.
 */
export const RUST_NUMBER = String.raw`-?\d(?:_?\d)*(?:\.\d(?:_?\d)*)?(?:e-?\d(?:_?\d)*)?`;

export type RustConstReferences = {
    /** The wire name an all-caps arm identifier resolves to, when it names a literal `&str` const. */
    readonly wireName: (identifier: string) => string | null;
    /** The number an all-caps bound identifier resolves to, when it names a literal numeric const. */
    readonly number: (identifier: string) => number | null;
};

export type RustConstDeclaration =
    { readonly kind: 'string'; readonly text: string } | { readonly kind: 'number'; readonly value: number };

function stripComments(source: string): string {
    return source.replaceAll(/\/\*[\S\s]*?\*\//g, ' ').replaceAll(/\/\/[^\n]*/g, ' ');
}

/**
 * Follows one Rust file's const references to the values their modules author.
 *
 * Authored by the shared-constants campaign's census repairs
 * (`declaredRangeVsKnobTravel` / `descriptorEngineParamWeld`), which replaced
 * literal `set_param` arms and clamp bounds with named consts; it lives here so
 * every module's specs can read the crate without a cross-module deep import.
 *
 * A const arrives through `use crate::params::{…}`, a path-qualified
 * `use crate::params::DECAY`, `use super::DEFAULT_THRESHOLD_DB`, or as a
 * module-local declaration. The local name is bound to the module the `use`
 * path names, and the module's own `(pub)? const NAME: TYPE = VALUE;` is read
 * **as text** — never through an import, because nothing in `crates/` is
 * importable from a browser spec.
 *
 * Resolves only a const whose value is a numeric literal or a double-quoted
 * string literal. Everything else — a computed value, a tuple const, a `pub
 * use` re-export, a glob import, or a path into another crate — stays
 * unresolved, and the arm or wire value carrying it falls out of the census
 * rather than being guessed at.
 */
export function readRustConstReferences(file: string): RustConstReferences {
    const source = stripComments(readFileSync(file, 'utf8'));

    /** The crate's `src/` directory: `crate::` paths root here. */
    let crateRoot = dirname(file);
    while (basename(crateRoot) !== 'src' && dirname(crateRoot) !== crateRoot) {
        crateRoot = dirname(crateRoot);
    }
    if (basename(crateRoot) !== 'src') {
        return { wireName: () => null, number: () => null };
    }

    /**
     * The file's own module path in crate terms (`gluten/vca.rs` →
     * `['gluten', 'vca']`, `gluten/mod.rs` → `['gluten']`, a crate-root
     * `lib.rs` → `[]`): `super::` walks up this list, `self::` extends it.
     */
    const fileSegment = relative(crateRoot, file);
    const pathSegments = fileSegment
        .split(sep)
        .map((part, index, all) => (index === all.length - 1 ? part.replace(/\.rs$/, '') : part));
    if (pathSegments[pathSegments.length - 1] === 'mod') {
        pathSegments.pop();
    }
    // The crate-root file is the root module itself, not a child of one.
    const moduleSegments = fileSegment === 'lib.rs' || fileSegment === 'main.rs' ? [] : pathSegments;

    /** `crate::proof::metering` → that module's file, trying both Rust layouts. */
    const moduleFile = (segments: readonly string[]): string | null => {
        if (segments.length === 0) {
            return (
                [join(crateRoot, 'lib.rs'), join(crateRoot, 'main.rs')].find((candidate) => existsSync(candidate)) ??
                null
            );
        }
        const base = join(crateRoot, ...segments);
        return [`${base}.rs`, join(base, 'mod.rs')].find((candidate) => existsSync(candidate)) ?? null;
    };

    // Local name → the module file and const name a `use` binds it to.
    const imports = new Map<string, { readonly file: string | null; readonly name: string }>();
    for (const statement of source.matchAll(/^[ \t]*(pub\s+)?use\s+([^;]+);/gm)) {
        if (statement[1] !== undefined) {
            // A re-export: the value's author is another hop away, so it stays
            // a gap rather than being chased through `pub use` chains.
            continue;
        }
        const tree = statement[2]!;
        if (tree.includes('*')) {
            continue;
        }
        const braced = /^([\w:]*::)?\{([^}]*)\}$/.exec(tree);
        const single = braced === null ? /^([\w:]*::)?(\w+)(?:\s+as\s+(\w+))?$/.exec(tree) : null;
        if (braced === null && single === null) {
            continue;
        }
        const prefix = (braced?.[1] ?? single![1] ?? '').split('::').filter((segment) => segment !== '');
        let items: readonly { readonly name: string; readonly local: string }[];
        if (braced !== null) {
            const clauses = braced[2]!.split(',').map((item) => /^(\w+)(?:\s+as\s+(\w+))?$/.exec(item.trim()));
            items = clauses
                .filter((item): item is RegExpExecArray => item !== null)
                .map((item) => ({ name: item[1]!, local: item[2] ?? item[1]! }));
        } else {
            items = [{ name: single![2]!, local: single![3] ?? single![2]! }];
        }
        if (items.length === 0) {
            continue;
        }

        // `crate::` roots at the crate; `self::` extends this file's module;
        // `super::` (repeatable) walks up it, and may then hand back to
        // `crate::`/`self::`. Any other head is another crate, whose sources
        // this census has no business reading.
        let base: readonly string[] | null = null;
        let rest = [...prefix];
        if (rest[0] === 'crate') {
            base = [];
            rest = rest.slice(1);
        } else if (rest[0] === 'self') {
            base = moduleSegments;
            rest = rest.slice(1);
        } else if (rest[0] === 'super') {
            let supers = 0;
            while (rest[supers] === 'super') {
                supers++;
            }
            const after = rest[supers];
            if (after === 'crate') {
                base = [];
                rest = rest.slice(supers + 1);
            } else if ((after === undefined || after === 'self') && supers <= moduleSegments.length) {
                base = moduleSegments.slice(0, moduleSegments.length - supers);
                rest = rest.slice(supers + (after === 'self' ? 1 : 0));
            }
        }
        if (base === null) {
            continue;
        }
        const target = moduleFile([...base, ...rest]);
        for (const item of items) {
            imports.set(item.local, { file: target, name: item.name });
        }
    }

    /** One module file's literal const declarations, read once per run. */
    const declarationsFor = (path: string | null): ReadonlyMap<string, RustConstDeclaration | null> => {
        if (path === null) {
            return new Map();
        }
        const cached = rustConstDeclarations.get(path);
        if (cached !== undefined) {
            return cached;
        }
        const declarations = new Map<string, RustConstDeclaration | null>();
        const text = stripComments(readFileSync(path, 'utf8'));
        const declaration =
            /(?:^|\n)[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?const[ \t]+([A-Z][A-Z0-9_]*)[ \t]*:[ \t]*([^=\n]+?)[ \t]*=[ \t]*([^;\n]+);/g;
        for (const match of text.matchAll(declaration)) {
            const type = match[2]!.trim();
            const value = match[3]!.trim();
            if (type === '&str' || type === "&'static str") {
                const string = /^"([\w-]+)"$/.exec(value);
                declarations.set(match[1]!, string === null ? null : { kind: 'string', text: string[1]! });
                continue;
            }
            const numericType = /^(?:f32|f64|u\d+|i\d+|usize|isize)$/.test(type);
            const numericLiteral = new RegExp(`^${RUST_NUMBER}$`).test(value);
            if (numericType && numericLiteral) {
                declarations.set(match[1]!, { kind: 'number', value: Number(value.replaceAll('_', '')) });
                continue;
            }
            declarations.set(match[1]!, null);
        }
        rustConstDeclarations.set(path, declarations);
        return declarations;
    };

    const own = declarationsFor(file);
    const declarationFor = (identifier: string): RustConstDeclaration | null => {
        const local = own.get(identifier);
        if (local !== undefined) {
            return local;
        }
        const binding = imports.get(identifier);
        if (binding === undefined) {
            return null;
        }
        return declarationsFor(binding.file).get(binding.name) ?? null;
    };

    return {
        wireName: (identifier) => {
            const declaration = declarationFor(identifier);
            return declaration !== null && declaration.kind === 'string' ? declaration.text : null;
        },
        number: (identifier) => {
            const declaration = declarationFor(identifier);
            return declaration !== null && declaration.kind === 'number' ? declaration.value : null;
        },
    };
}

/**
 * Module-file const declarations are shared by every scanned file that imports
 * them (`params.rs` is read by half the crate), so they are parsed once.
 */
const rustConstDeclarations = new Map<string, ReadonlyMap<string, RustConstDeclaration | null>>();
