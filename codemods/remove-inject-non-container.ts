/**
 * Codemod: remove-inject-non-container
 *
 * Removes `inject({ ... })(factory)` when deps are plain imports (not `logger` / `eventBus`).
 * Keeps `inject` when the deps object includes `logger` or `eventBus`.
 *
 * Transforms (typical):
 *   export const muteTrack = inject({ updateTrack })(({ updateTrack }) =>
 *     function muteTrack(...) { ... }
 *   );
 * →
 *   export function muteTrack(...) { ... }
 *
 * Also handles:
 *   - `({ a: alias }) =>` — rewrites `alias` to `a` in the emitted function body
 *   - `() => { return function f() { ... } }`
 *   - `({ a }) => (x) => a(x)` → `export function name(x) { return a(x); }`
 *   - `async` / `generator` preserved from the inner function
 *
 * Skips:
 *   - `inject({ logger })`, `inject({ eventBus })`, or any mix that includes those keys
 *   - `inject(deps, options)` (e.g. `{ lazy: true }`)
 *   - `inject(foo)` when `foo` is not a same-file `const`/`let`/`export const` object literal (or has spread)
 *   - Deps object values that are not plain identifiers (e.g. lazy `() => fn`, thunks) — ObjectPattern unwrap unsafe
 *   - Factory shape we cannot unwrap (no single inner function / inner arrow) — multi-statement factories unchanged
 *     (e.g. `(deps) => { const x = ...; return function f() {} }`, or `({ a }) => { const ...; return function ... }`)
 *   - `(deps) =>` when `deps` is passed as a value (e.g. `foo(deps)`) — only `deps.member` patterns are inlined
 *
 * Identifier deps (`inject(fooDependencies)`):
 *   - Resolves `fooDependencies` from the same file to `{ a: impl, ... }` (unwraps `as const` / `satisfies`).
 *   - Factory `({ a }) => …` — same as inline object deps.
 *   - Factory `(d) => …` — replaces `d.methodName` with the bound identifier from the deps object.
 *     Only when **every** deps property is `identKey: identValue` (no methods, getters, spreads, computed keys).
 *     Optional chaining (`d?.x`) is not rewritten — such files are skipped if `d` would remain.
 *
 * Historical migration reference. Do not run unless a human explicitly assigns
 * this codemod execution as the task.
 *
 * Human-approved dry run:
 *
 *   npx jscodeshift -t codemods/remove-inject-non-container.ts <path-or-dir> -d -p --parser=tsx --extensions=ts
 *
 * jscodeshift results: `ok` = transformed (review printed diff); `skipped` = no match (e.g. specs, or skip rules above).
 *
 * Suggested dry-run spot checks:
 *   - Simple: `.../toggleTrackState/muteTrack.ts`
 *   - Alias rename: `.../loopStation/createSlot.ts`
 *   - Block + return: `.../setlist/renameSetlist.ts`
 *   - Two exports: `.../folder.ts`
 *   - Must not change: `.../addTrack.ts` (eventBus)
 *   - Identifier deps: `importMidiFile.ts` (same-file deps + ObjectPattern), `trackShortcuts.ts` (`(d) =>` member inlining)
 *
 * Human-approved apply: same command without `-d -p`.
 *
 * Verification (syntax of printed output, not full project typecheck):
 *
 *   node scripts/verify-remove-inject-output.mjs <file.ts> [...]
 *
 * Guarantees: skips unsafe patterns; preserves inner function bodies that are extracted; does not drop
 * statements inside those bodies. ObjectPattern renames do not rewrite identifiers used as non-computed
 * member properties (`x.tracks`) or as object literal keys (`{ tracks: mapped }`), so alias patterns like
 * `{ trackStore: tracks }` cannot corrupt `.tracks` or model field names. For `(d) =>` member inlining, a
 * pre-scan requires every non-binding use of `d` to be `d.member` where `member` is a key in the resolved deps
 * object (so optional chaining, unknown members, or `d` in other positions skip the transform). Post-replacement
 * throws are avoided so a file with multiple exports cannot end up half-transformed if a later check fails.
 * Does not prove behavioral equivalence — run tests and `pnpm typecheck` after applying across the repo.
 */
import { FileInfo, API } from 'jscodeshift';
import type {
    ArrowFunctionExpression,
    FunctionDeclaration,
    FunctionExpression,
    Identifier,
    ObjectExpression,
    ObjectPattern,
    VariableDeclaration,
} from 'jscodeshift';
import type { ASTPath } from 'jscodeshift';

export const parser = 'tsx';

const CONTAINER_KEYS = new Set(['logger', 'eventBus']);

function depsObjectHasContainerService(deps: ObjectExpression): boolean {
    for (const prop of deps.properties) {
        if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
        const key = prop.key;
        if (key.type === 'Identifier' && CONTAINER_KEYS.has(key.name)) return true;
        if (key.type === 'Literal' && typeof key.value === 'string' && CONTAINER_KEYS.has(key.value)) {
            return true;
        }
    }
    return false;
}

function objectExpressionHasSpread(obj: ObjectExpression): boolean {
    return obj.properties.some((p) => p.type === 'SpreadElement');
}

/** Unwrap `as const`, `satisfies`, parentheses to reach an object literal. */
function unwrapObjectExpressionFromInitializer(node: unknown): ObjectExpression | null {
    if (!node || typeof node !== 'object') return null;
    const n = node as { type?: string; expression?: unknown };
    switch (n.type) {
        case 'ObjectExpression':
            return n as ObjectExpression;
        case 'TSAsExpression':
        case 'AsExpression':
        case 'TSSatisfiesExpression':
        case 'ParenthesizedExpression':
            return unwrapObjectExpressionFromInitializer(n.expression);
        default:
            return null;
    }
}

function buildMemberReplacementMapFromObjectExpression(obj: ObjectExpression): Map<string, string> {
    const map = new Map<string, string>();
    for (const prop of obj.properties) {
        if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
        const key = prop.key;
        const value = prop.value;
        if (key.type !== 'Identifier' || value.type !== 'Identifier') continue;
        map.set(key.name, value.name);
    }
    return map;
}

/**
 * For `(d) =>` member inlining: only safe when every property is `key: importedFn` (identifiers).
 * Skips method values, getters, spreads, computed keys — would leave `d` references or wrong semantics.
 */
function depsObjectIsIdentifierOnlyForMemberInline(obj: ObjectExpression): boolean {
    return depsObjectPropertyValuesAreAllIdentifiers(obj);
}

/** Every property value must be an Identifier — rules out lazy thunks and non-trivial DI wiring. */
function depsObjectPropertyValuesAreAllIdentifiers(obj: ObjectExpression): boolean {
    for (const prop of obj.properties) {
        if (prop.type === 'SpreadElement') return false;
        if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') return false;
        const key = prop.key;
        const value = prop.value;
        if (key.type !== 'Identifier' || value.type !== 'Identifier') return false;
    }
    return true;
}

/** Map of `const foo = { ... }` / `export const foo = { ... }` names → object literals (same file only). */
function buildDepsIdentifierToObjectMap(root: JRoot, j: API['jscodeshift']): Map<string, ObjectExpression> {
    const map = new Map<string, ObjectExpression>();

    root.find(j.VariableDeclaration).forEach((path) => {
        for (const decl of path.node.declarations) {
            if (decl.type !== 'VariableDeclarator' || decl.id.type !== 'Identifier' || !decl.init) continue;
            const obj = unwrapObjectExpressionFromInitializer(decl.init);
            if (obj) map.set(decl.id.name, obj);
        }
    });

    return map;
}

type DepsArgNode = Identifier | ObjectExpression;

function resolveDepsObject(depsArg: DepsArgNode, depsMap: Map<string, ObjectExpression>): ObjectExpression | null {
    if (depsArg.type === 'ObjectExpression') return depsArg;
    if (depsArg.type === 'Identifier') {
        return depsMap.get(depsArg.name) ?? null;
    }
    return null;
}

type RenameMap = Map<string, string>;

function buildRenameMapFromObjectPattern(pattern: ObjectPattern): RenameMap {
    const map: RenameMap = new Map();
    for (const prop of pattern.properties) {
        if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
        const key = prop.key;
        const value = prop.value;
        if (key.type !== 'Identifier' || value.type !== 'Identifier') continue;
        if (key.name !== value.name) {
            map.set(value.name, key.name);
        }
    }
    return map;
}

/**
 * Factory `({ foo }) =>` with deps `{ foo: Bar }` (shorthand destructuring, aliased value in inject object).
 * After unwrap, body references must use `Bar`, not `foo`. `buildRenameMapFromObjectPattern` only handles
 * `({ foo: alias })` style.
 */
function augmentRenameMapFromDepsObjectPattern(
    renames: RenameMap,
    pattern: ObjectPattern,
    resolvedDeps: ObjectExpression
): void {
    const depValueByKey = new Map<string, string>();
    for (const prop of resolvedDeps.properties) {
        if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
        const key = prop.key;
        const value = prop.value;
        if (key.type !== 'Identifier' || value.type !== 'Identifier') continue;
        depValueByKey.set(key.name, value.name);
    }
    for (const prop of pattern.properties) {
        if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
        const key = prop.key;
        const value = prop.value;
        if (key.type !== 'Identifier' || value.type !== 'Identifier') continue;
        if (key.name !== value.name) continue;
        const depVal = depValueByKey.get(key.name);
        if (depVal && depVal !== key.name) {
            renames.set(key.name, depVal);
        }
    }
}

/** True if this Identifier is a binding position (decl, pattern, import, param), not a reference. */
function isBindingIdentifier(path: ASTPath<Identifier>): boolean {
    const parent = path.parent?.node as Record<string, unknown> | undefined;
    if (!parent) return false;
    const node = path.node;

    if (parent.type === 'VariableDeclarator' && parent.id === node) return true;
    if (parent.type === 'FunctionDeclaration' && parent.id === node) return true;
    if (parent.type === 'FunctionExpression' && parent.id === node) return true;
    if (parent.type === 'ImportSpecifier' && parent.local === node) return true;
    if (parent.type === 'ImportDefaultSpecifier' && parent.local === node) return true;
    if (parent.type === 'ImportNamespaceSpecifier' && parent.local === node) return true;
    if (parent.type === 'TSParameterProperty' && parent.parameter === node) return true;

    if (
        (parent.type === 'FunctionDeclaration' ||
            parent.type === 'FunctionExpression' ||
            parent.type === 'ArrowFunctionExpression') &&
        Array.isArray(parent.params) &&
        (parent.params as unknown[]).includes(node)
    ) {
        return true;
    }
    if (parent.type === 'RestElement' && parent.argument === node) return true;
    if (parent.type === 'AssignmentPattern' && parent.left === node) return true;

    if (parent.type === 'ObjectProperty' && parent.value === node) {
        const pp = path.parent?.parent?.node as { type?: string } | undefined;
        if (pp?.type === 'ObjectPattern') return true;
    }
    if (parent.type === 'Property' && parent.value === node) {
        const pp = path.parent?.parent?.node as { type?: string } | undefined;
        if (pp?.type === 'ObjectPattern') return true;
    }

    if (parent.type === 'ArrayPattern' && Array.isArray(parent.elements) && parent.elements.includes(node)) {
        return true;
    }

    return false;
}

/**
 * Do not rename identifiers that are property names (`obj.foo`) or non-shorthand object literal keys
 * (`{ foo: bar }`). Otherwise alias renames like `trackStore: tracks` → `tracks`→`trackStore` corrupt
 * `trackState.tracks` and `{ tracks: mapped }`.
 */
function isPropertyNameOrObjectLiteralKeyNotRenameTarget(path: ASTPath<Identifier>): boolean {
    const parent = path.parent?.node as Record<string, unknown> | undefined;
    if (!parent) return false;
    const node = path.node;

    if (parent.type === 'MemberExpression') {
        const mem = parent as { computed?: boolean; property?: unknown };
        if (!mem.computed && mem.property === node) return true;
    }
    if (parent.type === 'OptionalMemberExpression') {
        const mem = parent as { computed?: boolean; property?: unknown };
        if (!mem.computed && mem.property === node) return true;
    }
    if (parent.type === 'ObjectProperty' && parent.key === node && parent.value !== node) {
        const pp = path.parent?.parent?.node as { type?: string } | undefined;
        if (pp?.type === 'ObjectExpression') return true;
    }
    return false;
}

type JRoot = ReturnType<API['jscodeshift']>;

function isUnderSubtree(path: ASTPath<unknown>, subtreeRoot: object): boolean {
    let p: ASTPath<unknown> | null | undefined = path;
    while (p) {
        if (p.node === subtreeRoot) return true;
        p = p.parent as ASTPath<unknown> | null | undefined;
    }
    return false;
}

function applyRenamesInSubtree(j: API['jscodeshift'], fileRoot: JRoot, subtreeRoot: object, renames: RenameMap): void {
    if (renames.size === 0) return;

    fileRoot.find(j.Identifier).forEach((path: ASTPath<Identifier>) => {
        if (!renames.has(path.node.name)) return;
        if (isBindingIdentifier(path)) return;
        if (isPropertyNameOrObjectLiteralKeyNotRenameTarget(path)) return;
        if (!isUnderSubtree(path, subtreeRoot)) return;

        const next = renames.get(path.node.name);
        if (next) path.node.name = next;
    });
}

/**
 * For `(d) =>` inlining we only rewrite `d.methodName` → bound import when `methodName` is in the deps map.
 * Any other use of `d`, or `d.unknown` where `unknown` is not in the map, would be wrong or half-transformed.
 */
function memberInlinePatternIsUnsafe(
    j: API['jscodeshift'],
    fileRoot: JRoot,
    subtreeRoot: object,
    paramName: string,
    memberMap: Map<string, string>
): boolean {
    let unsafe = false;

    fileRoot.find(j.Identifier).forEach((path: ASTPath<Identifier>) => {
        if (unsafe) return;
        if (path.node.name !== paramName) return;
        if (isBindingIdentifier(path)) return;
        if (!isUnderSubtree(path, subtreeRoot)) return;

        const parent = path.parent?.node as Record<string, unknown> | undefined;
        if (!parent) {
            unsafe = true;
            return;
        }

        if (parent.type === 'ChainExpression') {
            unsafe = true;
            return;
        }

        if (parent.type === 'MemberExpression') {
            const mem = parent as {
                object: unknown;
                property: unknown;
                computed?: boolean;
                optional?: boolean;
            };
            if (mem.object !== path.node) {
                unsafe = true;
                return;
            }
            if (mem.optional) {
                unsafe = true;
                return;
            }
            if (mem.computed) {
                unsafe = true;
                return;
            }
            const propNode = mem.property as { type?: string };
            if (propNode.type !== 'Identifier') {
                unsafe = true;
                return;
            }
            const key = (mem.property as Identifier).name;
            if (!memberMap.has(key)) {
                unsafe = true;
                return;
            }
            return;
        }

        unsafe = true;
    });

    return unsafe;
}

function applyMemberReplacementsInSubtree(
    j: API['jscodeshift'],
    fileRoot: JRoot,
    subtreeRoot: object,
    paramName: string,
    memberKeyToImportName: Map<string, string>
): void {
    if (memberKeyToImportName.size === 0) return;

    fileRoot.find(j.MemberExpression).forEach((path) => {
        const node = path.node;
        if (node.object.type !== 'Identifier' || node.object.name !== paramName) return;
        if (node.computed) return;
        if (node.property.type !== 'Identifier') return;
        if (!isUnderSubtree(path, subtreeRoot)) return;

        const importName = memberKeyToImportName.get(node.property.name);
        if (!importName) return;

        j(path).replaceWith(j.identifier(importName));
    });
}

type ExtractedInner =
    | { kind: 'function'; fn: FunctionDeclaration | FunctionExpression }
    | { kind: 'arrow'; fn: ArrowFunctionExpression };

function extractInnerFromFactory(factory: ArrowFunctionExpression): ExtractedInner | null {
    const body = factory.body;

    // Arrow body is BlockStatement | Expression; inner named function is FunctionExpression.
    if (body.type === 'FunctionExpression') {
        return { kind: 'function', fn: body };
    }

    if (body.type === 'BlockStatement') {
        if (body.body.length !== 1) return null;
        const stmt = body.body[0];
        if (stmt.type !== 'ReturnStatement' || !stmt.argument) return null;
        const arg = stmt.argument;
        if (arg.type === 'FunctionExpression') {
            return { kind: 'function', fn: arg };
        }
        // Some parsers emit `FunctionDeclaration` as the return argument (esp. TypeScript).
        if ((arg as { type?: string }).type === 'FunctionDeclaration') {
            return { kind: 'function', fn: arg as unknown as FunctionDeclaration };
        }
        if (arg.type === 'ArrowFunctionExpression') {
            return { kind: 'arrow', fn: arg };
        }
        return null;
    }

    if (body.type === 'ArrowFunctionExpression') {
        return { kind: 'arrow', fn: body };
    }

    return null;
}

/**
 * `j.functionDeclaration(..., generator, async)` does not set `async` on the built node (ast-types/recast quirk:
 * the 5th argument is misrouted). Copy `generator` / `async` from the source after building.
 */
function copyAsyncGeneratorOntoFunctionDeclaration(
    fnNode: FunctionDeclaration,
    generator: boolean,
    asyncFlag: boolean
): void {
    fnNode.generator = generator;
    fnNode.async = asyncFlag;
}

function arrowToFunctionDeclaration(
    j: API['jscodeshift'],
    arrow: ArrowFunctionExpression,
    name: string
): FunctionDeclaration {
    const id = j.identifier(name);
    let fnNode: FunctionDeclaration;
    if (arrow.body.type === 'BlockStatement') {
        fnNode = j.functionDeclaration(
            id,
            arrow.params,
            arrow.body,
            arrow.generator,
            arrow.async
        ) as FunctionDeclaration;
    } else {
        const ret = j.returnStatement(arrow.body as never);
        const block = j.blockStatement([ret]);
        fnNode = j.functionDeclaration(id, arrow.params, block, arrow.generator, arrow.async) as FunctionDeclaration;
    }
    copyAsyncGeneratorOntoFunctionDeclaration(fnNode, Boolean(arrow.generator), Boolean(arrow.async));
    return fnNode;
}

function replaceExportConstInjectWithFunction(
    j: API['jscodeshift'],
    fileRoot: JRoot,
    varDeclPath: ASTPath<VariableDeclaration>,
    exportName: string,
    inner: ExtractedInner,
    renames: RenameMap,
    memberInline: { paramName: string; map: Map<string, string> } | null
): void {
    let fnNode: FunctionDeclaration;

    if (inner.kind === 'function') {
        const fn = inner.fn;
        applyRenamesInSubtree(j, fileRoot, fn, renames);
        if (memberInline) {
            applyMemberReplacementsInSubtree(j, fileRoot, fn, memberInline.paramName, memberInline.map);
        }

        if (fn.type === 'FunctionExpression') {
            const id = j.identifier(exportName);
            fnNode = j.functionDeclaration(id, fn.params, fn.body, fn.generator, fn.async) as FunctionDeclaration;
            copyAsyncGeneratorOntoFunctionDeclaration(fnNode, Boolean(fn.generator), Boolean(fn.async));
            (fnNode as { returnType?: unknown }).returnType = (fn as FunctionExpression).returnType;
            (fnNode as { typeParameters?: unknown }).typeParameters = (fn as FunctionExpression).typeParameters;
        } else {
            const fd = fn as FunctionDeclaration;
            fnNode = j.functionDeclaration(
                j.identifier(exportName),
                fd.params,
                fd.body,
                fd.generator,
                fd.async
            ) as FunctionDeclaration;
            copyAsyncGeneratorOntoFunctionDeclaration(fnNode, Boolean(fd.generator), Boolean(fd.async));
            (fnNode as { returnType?: unknown }).returnType = fd.returnType;
            (fnNode as { typeParameters?: unknown }).typeParameters = fd.typeParameters;
        }
    } else {
        const arrow = inner.fn;
        applyRenamesInSubtree(j, fileRoot, arrow, renames);
        if (memberInline) {
            applyMemberReplacementsInSubtree(j, fileRoot, arrow, memberInline.paramName, memberInline.map);
        }
        fnNode = arrowToFunctionDeclaration(j, arrow, exportName);
        (fnNode as { returnType?: unknown }).returnType = (arrow as unknown as { returnType?: unknown }).returnType;
        (fnNode as { typeParameters?: unknown }).typeParameters = (
            arrow as unknown as { typeParameters?: unknown }
        ).typeParameters;
    }

    const exportWrap = j(varDeclPath).closest(j.ExportNamedDeclaration);
    if (exportWrap.length > 0) {
        exportWrap.replaceWith(j.exportNamedDeclaration(fnNode));
    } else {
        j(varDeclPath).replaceWith(j.exportNamedDeclaration(fnNode));
    }
}

export default function transform(fileInfo: FileInfo, api: API): string | null {
    const j = api.jscodeshift;
    const root = j(fileInfo.source);
    let modified = false;

    const candidates = root
        .find(j.VariableDeclaration, {
            declarations: [
                {
                    type: 'VariableDeclarator',
                    id: { type: 'Identifier' },
                    init: {
                        type: 'CallExpression',
                    },
                },
            ],
        })
        .paths() as ASTPath<VariableDeclaration>[];

    const depsMap = buildDepsIdentifierToObjectMap(root, j);

    for (let i = candidates.length - 1; i >= 0; i -= 1) {
        const varDeclPath = candidates[i];
        const decl = varDeclPath.node.declarations[0];
        if (decl.type !== 'VariableDeclarator' || decl.id.type !== 'Identifier' || !decl.init) continue;
        const exportName = decl.id.name;

        const outerCall = decl.init;
        if (outerCall.type !== 'CallExpression') continue;

        const innerInjectCall = outerCall.callee;
        if (innerInjectCall.type !== 'CallExpression') continue;
        const injectId = innerInjectCall.callee;
        if (injectId.type !== 'Identifier' || injectId.name !== 'inject') continue;

        const injectArgs = innerInjectCall.arguments;
        if (injectArgs.length !== 1) continue;
        const depsArg = injectArgs[0];
        if (depsArg.type !== 'ObjectExpression' && depsArg.type !== 'Identifier') continue;

        const resolvedObj = resolveDepsObject(depsArg as DepsArgNode, depsMap);
        if (!resolvedObj) continue;
        if (objectExpressionHasSpread(resolvedObj)) continue;
        if (depsObjectHasContainerService(resolvedObj)) continue;

        const factory = outerCall.arguments[0];
        if (!factory || factory.type !== 'ArrowFunctionExpression') continue;
        if (factory.params.length !== 1) continue;
        const p0 = factory.params[0];

        let renames: RenameMap;
        let memberInline: { paramName: string; map: Map<string, string> } | null = null;

        if (p0.type === 'ObjectPattern') {
            if (!depsObjectPropertyValuesAreAllIdentifiers(resolvedObj)) continue;
            renames = buildRenameMapFromObjectPattern(p0);
            augmentRenameMapFromDepsObjectPattern(renames, p0, resolvedObj);
        } else if (p0.type === 'Identifier') {
            if (!depsObjectIsIdentifierOnlyForMemberInline(resolvedObj)) continue;
            const memberMap = buildMemberReplacementMapFromObjectExpression(resolvedObj);
            if (memberMap.size === 0) continue;
            renames = new Map();
            memberInline = {
                paramName: p0.name,
                map: memberMap,
            };
        } else {
            continue;
        }

        const extracted = extractInnerFromFactory(factory);
        if (!extracted) continue;

        if (memberInline) {
            if (memberInlinePatternIsUnsafe(j, root, extracted.fn, memberInline.paramName, memberInline.map)) {
                continue;
            }
        }

        replaceExportConstInjectWithFunction(j, root, varDeclPath, exportName, extracted, renames, memberInline);
        modified = true;
    }

    if (!modified) return null;

    const remainingInject = root.find(j.CallExpression, {
        callee: { type: 'Identifier', name: 'inject' },
    });
    if (remainingInject.length === 0) {
        root.find(j.ImportDeclaration).forEach((importPath) => {
            const src = importPath.node.source.value;
            if (typeof src !== 'string' || !src.includes('/di/inject')) return;
            const specifiers = importPath.node.specifiers ?? [];
            const injectSpecifier = specifiers.find(
                (s) => s.type === 'ImportSpecifier' && (s as { imported?: Identifier }).imported?.name === 'inject'
            );
            if (!injectSpecifier) return;
            if (specifiers.length === 1) {
                j(importPath).remove();
            } else {
                importPath.node.specifiers = specifiers.filter((s) => s !== injectSpecifier);
            }
        });
    }

    return root.toSource({ quote: 'single' });
}
