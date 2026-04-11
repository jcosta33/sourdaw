/**
 * Splits a TypeScript module that contains multiple exported "roots" into:
 * - one file per root under `<originalBasename>/`
 * - optional `helpers.ts` for symbols shared by more than one root
 *
 * By default: rewrites imports across `src/` and deletes the original file (no barrel).
 * Use `--barrel` to keep a re-export **shim at the original file path** (e.g. `foo.ts`), not a folder index.
 *
 * **Never** emits `index.ts` / `index.tsx` inside `<basename>/`. Approved contract barrels live only at
 * module roots such as `useCases/index.ts`, `stores/index.ts`, `events/index.ts` (maintained by hand).
 * This codemod only emits concrete files: `<basename>/<exportName>.ts` and optional `helpers.ts`.
 *
 * Note: jscodeshift reports 0 "ok" / many "skipped" because the transform returns `null` and writes
 * via the filesystem instead of returning modified `fileInfo.source`.
 *
 * For whole-repo runs, pass **`--run-in-band`** (or `-c 1`) so only one transform runs at a time. Parallel
 * workers mutate `src/` concurrently and can race (ENOENT / half-written imports) when many files split.
 *
 * Scope: **only** files whose path contains a `useCases` or `repositories` directory segment. No override.
 *
 * Split **roots** (separate output files) are **functions**, **classes**, **`const` bindings whose value is
 * a function / arrow / call** (e.g. `inject` factories), and **default exports** of those shapes. **Not** roots:
 * `const` data (`[]`, `{}`, literals), enums, type-only exports, or `export { … } from '…'` re-exports.
 *
 * Limitations (will skip with a console warning rather than emit a broken tree):
 * - Cross-file mutation (`=`, `++`, `--`) of a binding whose definition lives in another emitted chunk
 *   (unless `--allowCrossFileAssignment=true`). Required for ESM: you cannot reassign an imported live binding.
 *   Covers non-exported `let`/`const` shared state via an internal `symbolLocationMap` (not just exports).
 * - Importers that use `import * as ns from './splitTarget'`, side-effect-only `import './splitTarget'`,
 *   or a mix of symbols where some cannot be mapped to a split file.
 * - Side-effect-only imports (`import './x'`) from the original file are copied into every emitted chunk;
 *   ESM caches modules so this is usually safe, but non-idempotent side effects can run once per chunk in
 *   some bundlers — review manually after splitting.
 * - `--barrel` mode does not run `validateImportRewritesCanComplete` (importers keep the original path).
 * - `export * from './splitTarget'` is expanded to one `export *` per output file (may diverge from exact
 *   star-export semantics if submodules export overlapping names).
 * - Dynamic `import()` with non-literal specifiers is not adjusted; string-literal relative
 *   `import('./x')` in emitted files are depth-adjusted via regex (no full-file re-parse).
 * - `vi.mock('…')` / `jest.mock('…')` with a factory that returns a plain object literal are rewritten to
 *   per-output-file mocks when the string resolves to the split target (same rules as imports).
 */
import { FileInfo, API, Options } from 'jscodeshift';
import * as fs from 'fs';
import * as path from 'path';

function isUseCasesOrRepositoriesPath(filePath: string): boolean {
  const norm = path.normalize(filePath).replace(/\\/g, '/');
  return norm.split('/').filter(Boolean).some((s) => s === 'useCases' || s === 'repositories');
}

function getAllTsFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!filePath.includes('node_modules') && !filePath.includes('.git') && !filePath.includes('dist')) {
        results = results.concat(getAllTsFiles(filePath));
      }
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      results.push(filePath);
    }
  }
  return results;
}

function resolveImportToAbsolute(importerPath: string, source: string): string {
  const absImporter = path.isAbsolute(importerPath)
    ? importerPath
    : path.resolve(process.cwd(), importerPath);
  if (source.startsWith('#/')) {
    return path.resolve(process.cwd(), 'src', source.slice(2));
  }
  return path.resolve(path.dirname(absImporter), source);
}

function pathMatchesSplitTarget(resolved: string, targetFilePath: string): boolean {
  const norm = path.normalize(resolved);
  const absTarget = path.isAbsolute(targetFilePath)
    ? path.normalize(targetFilePath)
    : path.resolve(process.cwd(), targetFilePath);
  const noExt = absTarget.replace(/\.[^.]+$/, '');
  if (norm === noExt || norm === absTarget) return true;
  const base = path.basename(absTarget);
  if ((base === 'index.ts' || base === 'index.tsx') && norm === path.dirname(absTarget)) {
    return true;
  }
  return false;
}

function appendSubPath(source: string, sub: string): string {
  const s = source.replace(/\/$/, '');
  return `${s}/${sub}`;
}

/** Map an import/export specifier to which split output file owns that symbol. */
function resolveSpecifierOwner(spec: any, exportLocationMap: Map<string, string>): string | undefined {
  if (!spec) return undefined;
  if (spec.type === 'ImportSpecifier' && spec.imported?.type === 'Identifier') {
    return exportLocationMap.get(spec.imported.name);
  }
  if (spec.type === 'ExportSpecifier') {
    const sourceName =
      spec.local?.type === 'Identifier'
        ? spec.local.name
        : spec.exported?.type === 'Identifier'
          ? spec.exported.name
          : undefined;
    if (sourceName) return exportLocationMap.get(sourceName);
  }
  if (spec.type === 'ImportDefaultSpecifier' && spec.local?.type === 'Identifier') {
    return exportLocationMap.get('default');
  }
  return undefined;
}

/**
 * Abort before writing if any importer uses a pattern we cannot rewrite (namespace import,
 * side-effect-only import, or a symbol not mapped to a split file).
 */
function validateImportRewritesCanComplete(
  j: any,
  filePath: string,
  exportLocationMap: Map<string, string>
): string | null {
  const srcDir = path.resolve(process.cwd(), 'src');
  const allFiles = getAllTsFiles(srcDir);
  for (const importerPath of allFiles) {
    if (importerPath === filePath) continue;
    if (!fs.existsSync(importerPath)) continue;
    let content: string;
    try {
      content = fs.readFileSync(importerPath, 'utf-8');
    } catch {
      continue;
    }
    let rootAst: any;
    try {
      rootAst = j(content);
    } catch {
      // Some TS sources parse under tsserver but not @babel/parser; skip validation for that file.
      continue;
    }

    const checkPath = (pathNode: any): string | null => {
      const srcNode = pathNode.node.source?.value;
      if (typeof srcNode !== 'string') return null;
      const resolved = resolveImportToAbsolute(importerPath, srcNode);
      if (!pathMatchesSplitTarget(resolved, filePath)) return null;

      if (pathNode.node.type === 'ExportAllDeclaration') {
        return null;
      }

      const specs = pathNode.node.specifiers;
      if (!specs || specs.length === 0) {
        return `side-effect-only import of split module (${importerPath})`;
      }
      if (specs.some((s: any) => s.type === 'ImportNamespaceSpecifier')) {
        return `namespace import of split module (${importerPath})`;
      }
      for (const spec of specs) {
        if (resolveSpecifierOwner(spec, exportLocationMap) === undefined) {
          return `unmapped import/export symbol from split module (${importerPath})`;
        }
      }
      return null;
    };

    let err: string | null = null;
    rootAst.find(j.ImportDeclaration).forEach((pathNode: any) => {
      if (!err) err = checkPath(pathNode);
    });
    if (err) return err;

    rootAst.find(j.ExportNamedDeclaration, { source: (s: any) => !!s }).forEach((pathNode: any) => {
      if (!err) err = checkPath(pathNode);
    });
    if (err) return err;
  }
  return null;
}

/** One level deeper than the original file → relative specifiers need an extra `../` segment. */
function adjustRelativeSpecifier(spec: string, depthDelta: number): string {
  if (!spec.startsWith('.') || depthDelta === 0) return spec;
  let s = spec;
  for (let i = 0; i < depthDelta; i++) {
    s = path.join('..', s);
  }
  s = s.replace(/\\/g, '/');
  if (!s.startsWith('.')) s = `./${s}`;
  return s;
}

/**
 * Deepen relative specifiers in `import('./x')` / `import("../x")` without re-parsing the whole file.
 * Full AST round-trip via jscodeshift can throw on valid TS emit (e.g. `export type { … }` patterns).
 */
function rewriteRelativeSpecifiersInSource(_j: any, source: string, depthIncrease: number): string {
  if (depthIncrease === 0) return source;
  return source.replace(
    /\bimport\s*\(\s*(['"])(\.\.?[^'"]*)\1\s*\)/g,
    (match, quote: string, spec: string) => {
      if (!spec.startsWith('.')) return match;
      return `import(${quote}${adjustRelativeSpecifier(spec, depthIncrease)}${quote})`;
    }
  );
}

/**
 * Split `vi.mock` / `jest.mock` of the monolith into one mock per emitted file when the factory
 * returns a plain object (`() => ({ a: vi.fn(), … })`). Required after importers switch to subpaths.
 */
function rewriteViMocksForSplitTarget(
  j: any,
  rootAst: any,
  importerPath: string,
  targetFilePath: string,
  exportLocationMap: Map<string, string>,
  appendSubPath: (src: string, sub: string) => string
): boolean {
  let changed = false;
  const toSplit: Array<{ path: any; mockCallee: any; srcStr: string; byOwner: Map<string, any[]> }> = [];

  rootAst.find(j.CallExpression).forEach((p: any) => {
    const callee = p.node.callee;
    const isVitestMock =
      callee?.type === 'MemberExpression' &&
      callee.object?.type === 'Identifier' &&
      callee.object.name === 'vi' &&
      callee.property?.type === 'Identifier' &&
      callee.property.name === 'mock';
    const isJestMock =
      callee?.type === 'MemberExpression' &&
      callee.object?.type === 'Identifier' &&
      callee.object.name === 'jest' &&
      callee.property?.type === 'Identifier' &&
      callee.property.name === 'mock';
    if (!isVitestMock && !isJestMock) return;

    const arg0 = p.node.arguments[0];
    if (!arg0 || (arg0.type !== 'Literal' && arg0.type !== 'StringLiteral')) return;
    const srcStr = arg0.value;
    if (typeof srcStr !== 'string') return;

    const resolved = resolveImportToAbsolute(importerPath, srcStr);
    if (!pathMatchesSplitTarget(resolved, targetFilePath)) return;

    const arg1 = p.node.arguments[1];
    if (!arg1) return;

    let objExpr: any;
    if (arg1.type === 'ArrowFunctionExpression' && arg1.body.type === 'ObjectExpression') {
      objExpr = arg1.body;
    } else {
      return;
    }

    const byOwner = new Map<string, any[]>();
    const unmapped: string[] = [];
    for (const prop of objExpr.properties) {
      if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
      const key =
        prop.key.type === 'Identifier'
          ? prop.key.name
          : prop.key.type === 'Literal' || prop.key.type === 'StringLiteral'
            ? prop.key.value
            : null;
      if (typeof key !== 'string') continue;
      const owner = exportLocationMap.get(key);
      if (!owner) {
        unmapped.push(key);
        continue;
      }
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push(prop);
    }
    if (unmapped.length > 0) {
      console.warn(
        `[split-use-cases] vi.mock/jest.mock(${srcStr}) has unmapped keys (${unmapped.join(', ')}) — skipping mock rewrite in ${importerPath}`
      );
      return;
    }
    if (byOwner.size === 0) return;

    const mockCallee = isVitestMock
      ? j.memberExpression(j.identifier('vi'), j.identifier('mock'))
      : j.memberExpression(j.identifier('jest'), j.identifier('mock'));

    toSplit.push({ path: p, mockCallee, srcStr, byOwner });
  });

  toSplit.sort((a, b) => (b.path.node.start ?? 0) - (a.path.node.start ?? 0));

  for (const item of toSplit) {
    const { path: p, mockCallee, srcStr, byOwner } = item;
    if (byOwner.size === 1) {
      const owner = [...byOwner.keys()][0];
      p.node.arguments[0] = j.literal(appendSubPath(srcStr, owner));
      changed = true;
      continue;
    }

    const stmts: any[] = [];
    for (const [owner, props] of byOwner.entries()) {
      const newSrc = appendSubPath(srcStr, owner);
      const newObj = j.objectExpression(props);
      const newArrow = j.arrowFunctionExpression([], newObj);
      stmts.push(j.expressionStatement(j.callExpression(mockCallee, [j.literal(newSrc), newArrow])));
    }
    const parent = p.parentPath;
    if (parent?.node?.type !== 'ExpressionStatement') continue;
    // `replaceWith` with multiple statements is unreliable here; insert siblings then drop the original.
    for (let i = stmts.length - 1; i >= 0; i -= 1) {
      parent.insertBefore(stmts[i]);
    }
    parent.prune();
    changed = true;
  }

  return changed;
}

/** Preserve original top-level declaration order (avoids TDZ / const-order bugs). */
function sortNodesByAstOrder<T extends { astNode: any }>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    const s = a.astNode?.start ?? 0;
    const t = b.astNode?.start ?? 0;
    return s - t;
  });
}

/**
 * Order nodes so dependencies are emitted first (avoids TDZ when a helper references a sibling
 * binding in the same emitted file). Falls back to source order on cycles.
 */
function sortNodesByDependency<T extends NodeMeta>(nodes: T[], contextLabel: string): T[] {
  if (nodes.length <= 1) return nodes;
  const set = new Set(nodes);
  const indegree = new Map<T, number>();
  const adj = new Map<T, T[]>();
  for (const n of nodes) {
    indegree.set(n, 0);
    adj.set(n, []);
  }
  for (const n of nodes) {
    for (const dep of n.dependencies) {
      if (set.has(dep as T)) {
        indegree.set(n, (indegree.get(n) ?? 0) + 1);
        adj.get(dep as T)!.push(n);
      }
    }
  }
  const queue = nodes
    .filter((n) => indegree.get(n) === 0)
    .sort((a, b) => (a.astNode?.start ?? 0) - (b.astNode?.start ?? 0));
  const out: T[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const m of adj.get(n) ?? []) {
      const v = (indegree.get(m) ?? 0) - 1;
      indegree.set(m, v);
      if (v === 0) {
        queue.push(m);
        queue.sort((a, b) => (a.astNode?.start ?? 0) - (b.astNode?.start ?? 0));
      }
    }
  }
  if (out.length !== nodes.length) {
    console.warn(
      `[split-use-cases] dependency cycle in ${contextLabel} — falling back to source order (${out.length}/${nodes.length} nodes ordered)`
    );
    return sortNodesByAstOrder(nodes);
  }
  return out;
}

function isTypeOnlyDefinition(meta: NodeMeta): boolean {
  const ast = meta.astNode;
  if (ast.type === 'TSTypeAliasDeclaration' || ast.type === 'TSInterfaceDeclaration') return true;
  if (ast.type === 'ExportNamedDeclaration') {
    if (ast.exportKind === 'type') return true;
    const d = ast.declaration;
    if (d?.type === 'TSTypeAliasDeclaration' || d?.type === 'TSInterfaceDeclaration') return true;
  }
  return false;
}

/**
 * ESM forbids assigning to (or mutating with ++/--) an imported live binding from another emitted file.
 * Also catches non-exported `let` / `const` shared state: `exportLocationMap` only listed *exported* names,
 * so assignments to `nativeEngineReady` etc. were missed and splits produced broken files.
 *
 * Uses a map of **every** top-level defined name → output chunk (same placement rules as exports).
 */
function hasCrossFileMutationOfForeignSymbol(
  j: any,
  roots: NodeMeta[],
  exclusiveAuxiliaries: Map<NodeMeta, NodeMeta>,
  sharedAuxiliaries: Set<NodeMeta>,
  rootFileNames: string[],
  symbolLocationMap: Map<string, string>,
  depsSharedNodes: Set<NodeMeta>
): boolean {
  const scanAst = (node: any, currentFile: string): boolean => {
    let bad = false;
    j(node)
      .find(j.AssignmentExpression)
      .forEach((p: any) => {
        const left = p.node.left;
        if (left.type !== 'Identifier') return;
        const owner = symbolLocationMap.get(left.name);
        if (owner !== undefined && owner !== currentFile) {
          bad = true;
        }
      });
    j(node)
      .find(j.UpdateExpression)
      .forEach((p: any) => {
        const arg = p.node.argument;
        if (arg.type !== 'Identifier') return;
        const owner = symbolLocationMap.get(arg.name);
        if (owner !== undefined && owner !== currentFile) {
          bad = true;
        }
      });
    return bad;
  };

  if (sharedAuxiliaries.size > 0) {
    for (const node of sharedAuxiliaries) {
      const currentFile = depsSharedNodes.has(node) ? node.definedNames[0]! : 'helpers';
      if (scanAst(node.astNode, currentFile)) return true;
    }
  }

  for (let i = 0; i < roots.length; i++) {
    const fname = rootFileNames[i];
    const toScan: any[] = [roots[i].astNode];
    exclusiveAuxiliaries.forEach((owner, aux) => {
      if (owner === roots[i]) toScan.push(aux.astNode);
    });
    for (const ast of toScan) {
      if (scanAst(ast, fname)) return true;
    }
  }
  return false;
}

/** Where each top-level binding name lands after the split (includes non-exported `let` / helpers-only symbols). */
function buildSymbolLocationMap(
  nodesMeta: NodeMeta[],
  roots: NodeMeta[],
  rootFileNames: string[],
  exclusiveAuxiliaries: Map<NodeMeta, NodeMeta>,
  sharedAuxiliaries: Set<NodeMeta>,
  depsSharedNodes: Set<NodeMeta>
): Map<string, string> {
  const map = new Map<string, string>();
  nodesMeta.forEach((node) => {
    if (node.definedNames.length === 0) return;
    let targetFileName: string;
    if (roots.includes(node)) {
      targetFileName = rootFileNames[roots.indexOf(node)];
    } else {
      const owner = exclusiveAuxiliaries.get(node);
      if (owner) {
        targetFileName = rootFileNames[roots.indexOf(owner)];
      } else if (sharedAuxiliaries.has(node)) {
        targetFileName = depsSharedNodes.has(node) ? node.definedNames[0]! : 'helpers';
      } else {
        return;
      }
    }
    node.definedNames.forEach((name) => map.set(name, targetFileName));
    if (node.astNode.type === 'ExportNamedDeclaration' && node.astNode.specifiers) {
      node.astNode.specifiers.forEach((spec: any) => {
        if (spec.exported && spec.exported.type === 'Identifier') {
          map.set(spec.exported.name, targetFileName);
        }
      });
    }
    if (node.astNode.type === 'ExportDefaultDeclaration') {
      map.set('default', targetFileName);
    }
  });
  return map;
}

interface NodeMeta {
  astNode: any;
  isExported: boolean;
  isBehavioral: boolean;
  definedNames: string[];
  referencedNames: Set<string>;
  dependencies: Set<NodeMeta>;
}

export default function transform(fileInfo: FileInfo, api: API, options: Options) {
  const ext = path.extname(fileInfo.path);
  if (path.basename(fileInfo.path, ext) === 'index') {
    return null;
  }

  if (!isUseCasesOrRepositoriesPath(fileInfo.path)) {
    return null;
  }

  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const imports = root.find(j.ImportDeclaration).nodes();
  const program = root.find(j.Program).get();
  const topLevelNodes = program.node.body;

  const nodesMeta: NodeMeta[] = [];

  /** Strip `as Type` / parens so `const x = (() => {}) as Foo` is recognized as a function root. */
  const unwrapValueExpression = (init: any): any => {
    let e = init;
    while (e) {
      if (e.type === 'TSAsExpression' || e.type === 'TypeCastExpression' || e.type === 'AsExpression') {
        e = e.expression;
        continue;
      }
      if (e.type === 'ParenthesizedExpression' || e.type === 'TSNonNullExpression') {
        e = e.expression;
        continue;
      }
      break;
    }
    return e;
  };

  /** Split roots: functions/classes and `const` whose value is a function, IIFE, or call (e.g. `inject`(...)). Not data (`[]`, `{}`, literals, enums). */
  const isVariableDeclarationSplitRoot = (decl: any): boolean => {
    if (decl.type !== 'VariableDeclaration') return false;
    return decl.declarations.every((d: any) => {
      if (d.type !== 'VariableDeclarator' || !d.init) return false;
      const inner = unwrapValueExpression(d.init);
      return (
        inner.type === 'ArrowFunctionExpression' ||
        inner.type === 'FunctionExpression' ||
        inner.type === 'CallExpression'
      );
    });
  };

  const isBehavioralNodeInner = (node: any): boolean => {
    if (!node) return false;
    if (node.type === 'TSTypeAliasDeclaration' || node.type === 'TSInterfaceDeclaration') return false;
    if (node.type === 'TSEnumDeclaration') return false;
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') return true;
    if (node.type === 'VariableDeclaration') return isVariableDeclarationSplitRoot(node);
    return false;
  };

  const isBehavioralNode = (node: any): boolean => {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        if (node.exportKind === 'type') return false;
        return isBehavioralNodeInner(node.declaration);
      }
      return false;
    }
    if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration;
      if (!d) return false;
      if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') return true;
      if (
        d.type === 'ArrowFunctionExpression' ||
        d.type === 'FunctionExpression' ||
        d.type === 'CallExpression'
      ) {
        return true;
      }
      return false;
    }
    return isBehavioralNodeInner(node);
  };

  const extractDefinedNames = (decl: any) => {
    const names: string[] = [];
    if (!decl) return names;

    if (
      decl.type === 'FunctionDeclaration' || 
      decl.type === 'ClassDeclaration' || 
      decl.type === 'TSTypeAliasDeclaration' || 
      decl.type === 'TSInterfaceDeclaration' ||
      decl.type === 'TSEnumDeclaration'
    ) {
      if (decl.id && decl.id.type === 'Identifier') {
        names.push(decl.id.name);
      }
    } else if (decl.type === 'VariableDeclaration') {
      decl.declarations.forEach((d: any) => {
        if (d.type === 'VariableDeclarator') {
           if (d.id.type === 'Identifier') {
             names.push(d.id.name);
           } else {
             // Handle destructuring
             j(d.id).find(j.Identifier).forEach(p => names.push(p.node.name));
           }
        }
      });
    }
    return names;
  };

  topLevelNodes.forEach((node: any) => {
    if (node.type === 'ImportDeclaration') return;
    
    const meta: NodeMeta = {
      astNode: node,
      isExported: false,
      isBehavioral: isBehavioralNode(node),
      definedNames: [],
      referencedNames: new Set(),
      dependencies: new Set()
    };

    if (node.type === 'ExportNamedDeclaration') {
      meta.isExported = true;
      if (node.declaration) {
        meta.definedNames = extractDefinedNames(node.declaration);
      } else if (node.specifiers) {
        node.specifiers.forEach((spec: any) => {
          if (spec.exported && spec.exported.type === 'Identifier') {
            meta.definedNames.push(spec.exported.name);
          }
        });
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      meta.isExported = true;
      if (node.declaration) {
        if (node.declaration.id && node.declaration.id.type === 'Identifier') {
          meta.definedNames.push(node.declaration.id.name);
        } else if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
          meta.definedNames.push(node.declaration.id.name);
        } else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
          meta.definedNames.push(node.declaration.id.name);
        }
      }
    } else {
      meta.definedNames = extractDefinedNames(node);
    }

    const findIdentifiers = (ast: any) => {
       j(ast).find(j.Identifier).forEach(p => {
          const parent = p.parentPath.node;
          // Object literal / destructuring property keys are not value references (e.g. inject deps pattern).
          // Babel uses `ObjectProperty` for `{ a: b }` in patterns; estree uses `Property`.
          // Shorthand `{ x }` uses one Identifier as both key and value — it is a real reference.
          if ((parent.type === 'Property' || parent.type === 'ObjectProperty') && !parent.computed) {
            const shorthand = (parent as { shorthand?: boolean }).shorthand === true;
            if (!shorthand) {
              if (parent.key === p.node) return;
              if (parent.key?.type === 'Identifier' && parent.key.name === p.node.name) return;
            }
          }
          if (parent.type === 'MemberExpression' && parent.property === p.node && !parent.computed) return;
          if (meta.definedNames.includes(p.node.name)) return;
          meta.referencedNames.add(p.node.name);
       });
       j(ast).find(j.JSXIdentifier).forEach(p => {
          if (meta.definedNames.includes(p.node.name)) return;
          meta.referencedNames.add(p.node.name);
       });
       // TS type positions (e.g. `new Map<string, Foo>()`) are not visited by `find(Identifier)` because
       // jscodeshift does not match `TSTypeReference` nodes reliably — walk the subtree.
       const visitTsRefs = (n: any) => {
         if (!n || typeof n !== 'object') return;
         if (n.type === 'TSTypeReference' && n.typeName?.type === 'Identifier') {
           const name = n.typeName.name;
           if (!meta.definedNames.includes(name)) meta.referencedNames.add(name);
         }
         for (const key of Object.keys(n)) {
           if (key === 'loc' || key === 'start' || key === 'end' || key === 'tokens' || key === 'lines') continue;
           const v = (n as any)[key];
           if (Array.isArray(v)) v.forEach(visitTsRefs);
           else if (v && typeof v === 'object' && 'type' in v) visitTsRefs(v);
         }
       };
       visitTsRefs(ast);
    };
    
    findIdentifiers(node);
    nodesMeta.push(meta);
  });

  nodesMeta.forEach(node => {
    node.referencedNames.forEach(refName => {
      const provider = nodesMeta.find(n => n !== node && n.definedNames.includes(refName));
      if (provider) {
        node.dependencies.add(provider);
      }
    });
  });

  const isReferencedByAnotherNode = (targetNode: NodeMeta) => {
    return nodesMeta.some(n => n !== targetNode && n.dependencies.has(targetNode));
  };

  let roots = nodesMeta.filter(n => n.isExported && n.isBehavioral && !isReferencedByAnotherNode(n));

  if (roots.length === 0) {
     const exportedBehavioral = nodesMeta.filter(n => n.isExported && n.isBehavioral);
     if (exportedBehavioral.length > 1) {
        roots = exportedBehavioral;
     }
  }

  if (roots.length <= 1) {
    return null;
  }

  const getReachableNodes = (startNode: NodeMeta) => {
    const reachable = new Set<NodeMeta>();
    const queue = [startNode];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!reachable.has(current)) {
        reachable.add(current);
        current.dependencies.forEach(dep => queue.push(dep));
      }
    }
    return reachable;
  };

  const rootReachability = new Map<NodeMeta, Set<NodeMeta>>();
  roots.forEach(root => {
    rootReachability.set(root, getReachableNodes(root));
  });

  const auxiliaries = nodesMeta.filter(n => !roots.includes(n));
  const sharedAuxiliaries = new Set<NodeMeta>();
  const exclusiveAuxiliaries = new Map<NodeMeta, NodeMeta>();
  const sideEffects = new Set<NodeMeta>();

  auxiliaries.forEach(aux => {
    if (aux.definedNames.length === 0 && !aux.isExported) {
       sideEffects.add(aux);
       return;
    }

    const reachingRoots = roots.filter(root => rootReachability.get(root)!.has(aux));
    if (reachingRoots.length > 1) {
      sharedAuxiliaries.add(aux);
    } else if (reachingRoots.length === 1) {
      exclusiveAuxiliaries.set(aux, reachingRoots[0]);
    } else {
      sharedAuxiliaries.add(aux); 
    }
  });

  // Shared helpers (e.g. `bridges`) may depend on types (`ProofAudioBridge`) that would otherwise be
  // classified exclusive to a single root — co-locate those deps in helpers with the shared state.
  let promoted = true;
  while (promoted) {
    promoted = false;
    for (const shared of sharedAuxiliaries) {
      for (const dep of shared.dependencies) {
        if (roots.includes(dep)) continue;
        if (sharedAuxiliaries.has(dep)) continue;
        sharedAuxiliaries.add(dep);
        exclusiveAuxiliaries.delete(dep);
        promoted = true;
      }
    }
  }

  // Types/interfaces referenced only from type positions can miss dependency edges; pull them into
  // helpers next to any shared node that references them by name (e.g. `bridges` + `ProofAudioBridge`).
  const pullTypeDepsIntoShared = () => {
    const nameToMeta = new Map<string, NodeMeta>();
    nodesMeta.forEach((m) => {
      m.definedNames.forEach((n) => nameToMeta.set(n, m));
    });
    let changed = true;
    while (changed) {
      changed = false;
      for (const shared of sharedAuxiliaries) {
        for (const refName of shared.referencedNames) {
          const target = nameToMeta.get(refName);
          if (!target) continue;
          if (roots.includes(target)) continue;
          if (sharedAuxiliaries.has(target)) continue;
          const ast = target.astNode;
          if (
            ast.type !== 'TSTypeAliasDeclaration' &&
            ast.type !== 'TSInterfaceDeclaration' &&
            ast.type !== 'TSEnumDeclaration'
          ) {
            continue;
          }
          sharedAuxiliaries.add(target);
          exclusiveAuxiliaries.delete(target);
          changed = true;
        }
      }
    }
  };
  pullTypeDepsIntoShared();

  /** Inject dependency objects (`*Dependencies`) must be in their own module so `inject(deps)` sees a fully initialized object (avoids circular-init `_deps === undefined`). */
  const isDepsSharedNode = (node: NodeMeta) =>
    node.definedNames.length === 1 && /Dependencies$/.test(node.definedNames[0]!);

  const depsSharedNodes = new Set([...sharedAuxiliaries].filter(isDepsSharedNode));
  const helpersSharedNodes = new Set([...sharedAuxiliaries].filter((n) => !depsSharedNodes.has(n)));

  const getExportName = (node: NodeMeta, index: number = 0) => {
    const ast = node.astNode;
    if (ast.type === 'ExportDefaultDeclaration') {
      if (ast.declaration.id && ast.declaration.id.name) return ast.declaration.id.name;
      return 'defaultExport';
    }
    if (node.definedNames.length > 0) return node.definedNames[0];
    if (ast.type === 'ExportNamedDeclaration' && ast.specifiers && ast.specifiers.length > 0) {
      return ast.specifiers[0].exported.name;
    }
    return `useCase_${index}`;
  };

  const reservedRootFileNames = new Set<string>();
  if (helpersSharedNodes.size > 0) {
    reservedRootFileNames.add('helpers');
  }
  depsSharedNodes.forEach((n) => reservedRootFileNames.add(n.definedNames[0]!));

  const rootFileNames = roots.map((rootNode, index) => {
    let base = getExportName(rootNode, index);
    let candidate = base;
    let n = 0;
    while (reservedRootFileNames.has(candidate)) {
      n += 1;
      candidate = `${base}_${n}`;
    }
    reservedRootFileNames.add(candidate);
    return candidate;
  });

  const exportLocationMap = new Map<string, string>();
  nodesMeta.forEach(node => {
    if (node.isExported) {
      let targetFileName = 'helpers';
      if (roots.includes(node)) {
        targetFileName = rootFileNames[roots.indexOf(node)];
      } else {
        const owner = exclusiveAuxiliaries.get(node);
        if (owner) {
          targetFileName = rootFileNames[roots.indexOf(owner)];
        } else if (sharedAuxiliaries.has(node)) {
          targetFileName = depsSharedNodes.has(node) ? node.definedNames[0]! : 'helpers';
        }
      }
      node.definedNames.forEach(name => exportLocationMap.set(name, targetFileName));
      if (node.astNode.type === 'ExportNamedDeclaration' && node.astNode.specifiers) {
        node.astNode.specifiers.forEach((spec: any) => {
          if (spec.exported && spec.exported.type === 'Identifier') {
            exportLocationMap.set(spec.exported.name, targetFileName);
          }
        });
      }
      if (node.astNode.type === 'ExportDefaultDeclaration') exportLocationMap.set('default', targetFileName);
    }
  });

  const symbolLocationMap = buildSymbolLocationMap(
    nodesMeta,
    roots,
    rootFileNames,
    exclusiveAuxiliaries,
    sharedAuxiliaries,
    depsSharedNodes
  );

  const allowCrossFileAssignment =
    options.allowCrossFileAssignment === true || options.allowCrossFileAssignment === 'true';
  if (
    !allowCrossFileAssignment &&
    hasCrossFileMutationOfForeignSymbol(
      j,
      roots,
      exclusiveAuxiliaries,
      sharedAuxiliaries,
      rootFileNames,
      symbolLocationMap,
      depsSharedNodes
    )
  ) {
    console.warn(
      `[split-use-cases] skip (cross-file mutation of binding owned by another chunk): ${fileInfo.path}`
    );
    return null;
  }

  const useBarrel = options.barrel === true || options.barrel === 'true';

  if (!useBarrel) {
    const importRewriteBlocker = validateImportRewritesCanComplete(j, fileInfo.path, exportLocationMap);
    if (importRewriteBlocker) {
      console.warn(`[split-use-cases] skip (${importRewriteBlocker}): ${fileInfo.path}`);
      return null;
    }
  }

  const filePath = fileInfo.path;
  const dirName = path.dirname(filePath);
  const extName = path.extname(filePath);
  const baseName = path.basename(filePath, extName);
  const newDirPath = path.join(dirName, baseName);
  const isDryRun = options.dry || options.d;

  if (!isDryRun && !fs.existsSync(newDirPath)) {
    fs.mkdirSync(newDirPath, { recursive: true });
  }

  const getRequiredImports = (activeRefs: Set<string>, targetFileDepthIncrease: number) => {
    const reqImports: any[] = [];
    imports.forEach((imp: any) => {
      const neededSpecifiers = (imp.specifiers || []).filter((spec: any) => {
        if (spec.type === 'ImportSpecifier' && spec.local?.type === 'Identifier') {
          return activeRefs.has(spec.local.name);
        }
        if (spec.type === 'ImportDefaultSpecifier' && spec.local?.type === 'Identifier') {
          return activeRefs.has(spec.local.name);
        }
        if (spec.type === 'ImportNamespaceSpecifier' && spec.local?.type === 'Identifier') {
          return activeRefs.has(spec.local.name);
        }
        return false;
      });

      if (neededSpecifiers.length > 0 || !imp.specifiers || imp.specifiers.length === 0) {
        let source = imp.source.value;
        if (source.startsWith('.')) {
           for (let i = 0; i < targetFileDepthIncrease; i++) source = path.join('..', source);
           source = source.replace(/\\/g, '/');
           if (!source.startsWith('.')) source = './' + source;
        }
        const decl = j.importDeclaration(neededSpecifiers.length > 0 ? neededSpecifiers : imp.specifiers, j.literal(source));
        if (imp.importKind === 'type') {
          decl.importKind = 'type';
        }
        reqImports.push(decl);
      }
    });
    return reqImports;
  };

  const rootFileNameSet = new Set(rootFileNames);

  const depsFileNames = Array.from(depsSharedNodes)
    .map((n) => n.definedNames[0]!)
    .sort();

  const nameToMeta = new Map<string, NodeMeta>();
  nodesMeta.forEach((m) => {
    for (const n of m.definedNames) {
      nameToMeta.set(n, m);
    }
  });

  /**
   * Import symbols from `helpers` or sibling `*Dependencies` modules (same split folder).
   * Root-to-root imports are handled by `buildSiblingRootImports`.
   */
  const pushInternalSharedImports = (refs: Set<string>, currentFile: string, reqImports: any[]) => {
    const byFile = new Map<string, Set<string>>();
    for (const name of refs) {
      const ownerFile = symbolLocationMap.get(name);
      if (!ownerFile || ownerFile === currentFile) continue;
      if (rootFileNameSet.has(ownerFile)) continue;
      if (ownerFile === 'helpers') {
        if (helpersSharedNodes.size === 0) continue;
        if (!byFile.has('helpers')) byFile.set('helpers', new Set());
        byFile.get('helpers')!.add(name);
      } else if (depsFileNames.includes(ownerFile)) {
        if (!byFile.has(ownerFile)) byFile.set(ownerFile, new Set());
        byFile.get(ownerFile)!.add(name);
      }
    }
    for (const f of Array.from(byFile.keys()).sort()) {
      const names = Array.from(byFile.get(f)!).sort();
      const typeNames = names.filter((nm) => {
        const meta = nameToMeta.get(nm);
        return meta && isTypeOnlyDefinition(meta);
      });
      const valueNames = names.filter((nm) => !typeNames.includes(nm));
      if (typeNames.length > 0) {
        const specifiers = typeNames.map((name) => j.importSpecifier(j.identifier(name)));
        const decl = j.importDeclaration(specifiers, j.literal(`./${f}`));
        decl.importKind = 'type';
        reqImports.push(decl);
      }
      if (valueNames.length > 0) {
        const specifiers = valueNames.map((name) => j.importSpecifier(j.identifier(name)));
        reqImports.push(j.importDeclaration(specifiers, j.literal(`./${f}`)));
      }
    }
  };

  /**
   * When roots are split into separate files, one root may reference another root's exports by name.
   * Those symbols are not satisfied by the original `imports` list (they were same-file bindings).
   */
  const buildSiblingRootImports = (activeRefs: Set<string>, currentOwnerFile: string): any[] => {
    if (currentOwnerFile === 'helpers' || depsFileNames.includes(currentOwnerFile)) {
      return [];
    }
    const byOwner = new Map<string, Set<string>>();
    for (const name of activeRefs) {
      const owner = symbolLocationMap.get(name);
      if (!owner || owner === currentOwnerFile || owner === 'helpers' || depsFileNames.includes(owner)) continue;
      if (!rootFileNameSet.has(owner)) continue;
      if (!byOwner.has(owner)) byOwner.set(owner, new Set());
      byOwner.get(owner)!.add(name);
    }
    const out: any[] = [];
    const ownersSorted = Array.from(byOwner.keys()).sort();
    for (const owner of ownersSorted) {
      const names = Array.from(byOwner.get(owner)!).sort();
      const specifiers = names.map((name) => j.importSpecifier(j.identifier(name)));
      out.push(j.importDeclaration(specifiers, j.literal(`./${owner}`)));
    }
    return out;
  };

  const buildBarrelSource = () => {
    const printOpts = { quote: 'single' as const, trailingComma: true };
    const parts: string[] = [];
    imports.forEach((imp: any) => {
      if (!imp.specifiers || imp.specifiers.length === 0) {
        parts.push(j(imp).toSource(printOpts));
      }
    });
    sideEffects.forEach(node => {
      parts.push(j(node.astNode).toSource(printOpts));
    });
    // Helpers output always wraps declarations as exports, so re-export the module when it exists.
    if (helpersSharedNodes.size > 0) {
      parts.push(`export * from './${baseName}/helpers';`);
    }
    depsFileNames.forEach((d) => {
      parts.push(`export * from './${baseName}/${d}';`);
    });
    roots.forEach((_, idx) => {
      parts.push(`export * from './${baseName}/${rootFileNames[idx]}';`);
    });
    return parts.join('\n') + '\n';
  };

  const filesToWrite = new Map<string, string>();

  const sideEffectAstNodes = sortNodesByAstOrder(Array.from(sideEffects)).map((n) => n.astNode);
  /** Run module-level side effects once: in helpers if it exists, otherwise only in the first root file. */
  const emitSideEffectsInHelpers = helpersSharedNodes.size > 0;

  if (helpersSharedNodes.size > 0) {
    const refs = new Set<string>();
    const sharedFileNodes: any[] = [];
    sortNodesByDependency([...helpersSharedNodes], path.basename(filePath)).forEach((node) => {
      node.referencedNames.forEach((r) => refs.add(r));
      let ast = node.astNode;
      if (!node.isExported) {
        if (ast.type === 'FunctionDeclaration' || ast.type === 'ClassDeclaration' || ast.type === 'VariableDeclaration' || ast.type === 'TSEnumDeclaration') {
          ast = j.exportNamedDeclaration(ast);
        } else if (ast.type === 'TSTypeAliasDeclaration' || ast.type === 'TSInterfaceDeclaration') {
          const decl = j.exportNamedDeclaration(ast);
          (decl as { exportKind?: string }).exportKind = 'type';
          ast = decl;
        }
      }
      sharedFileNodes.push(ast);
    });
    const reqImports = getRequiredImports(refs, 1);
    pushInternalSharedImports(refs, 'helpers', reqImports);
    const siblingImportsHelpers = buildSiblingRootImports(refs, 'helpers');
    const sharedAst = j.program([
      ...reqImports,
      ...siblingImportsHelpers,
      ...(emitSideEffectsInHelpers ? sideEffectAstNodes : []),
      ...sharedFileNodes,
    ]);
    let sharedSource = j(sharedAst).toSource({ quote: 'single', trailingComma: true });
    sharedSource = rewriteRelativeSpecifiersInSource(j, sharedSource, 1);
    const sharedFilePath = path.join(newDirPath, `helpers${extName}`);
    filesToWrite.set(sharedFilePath, sharedSource);
  }

  for (const depsNode of sortNodesByDependency(Array.from(depsSharedNodes), `${path.basename(filePath)} → *Dependencies`)) {
    const depsName = depsNode.definedNames[0]!;
    const refs = new Set<string>();
    depsNode.referencedNames.forEach((r) => refs.add(r));
    let ast = depsNode.astNode;
    if (!depsNode.isExported) {
      if (
        ast.type === 'FunctionDeclaration' ||
        ast.type === 'ClassDeclaration' ||
        ast.type === 'VariableDeclaration' ||
        ast.type === 'TSEnumDeclaration'
      ) {
        ast = j.exportNamedDeclaration(ast);
      } else if (ast.type === 'TSTypeAliasDeclaration' || ast.type === 'TSInterfaceDeclaration') {
        const decl = j.exportNamedDeclaration(ast);
        (decl as { exportKind?: string }).exportKind = 'type';
        ast = decl;
      }
    }
    const reqImports = getRequiredImports(refs, 1);
    pushInternalSharedImports(refs, depsName, reqImports);
    const siblingImportsDeps = buildSiblingRootImports(refs, depsName);
    const depsAst = j.program([...reqImports, ...siblingImportsDeps, ast]);
    let depsSource = j(depsAst).toSource({ quote: 'single', trailingComma: true });
    depsSource = rewriteRelativeSpecifiersInSource(j, depsSource, 1);
    const depsFilePath = path.join(newDirPath, `${depsName}${extName}`);
    filesToWrite.set(depsFilePath, depsSource);
  }

  for (let index = 0; index < roots.length; index++) {
    const rootNode = roots[index];
    const expName = rootFileNames[index];
    const myAuxiliaries: NodeMeta[] = [];
    exclusiveAuxiliaries.forEach((owner, aux) => { if (owner === rootNode) myAuxiliaries.push(aux); });
    const myNodes = [rootNode, ...myAuxiliaries, ...sideEffects];
    const myRefs = new Set<string>();
    myNodes.forEach(n => n.referencedNames.forEach(r => myRefs.add(r)));
    const reqImports = getRequiredImports(myRefs, 1);
    pushInternalSharedImports(myRefs, expName, reqImports);
    const siblingImportsRoot = buildSiblingRootImports(myRefs, expName);
    const includeSideEffectsHere = emitSideEffectsInHelpers ? false : index === 0;
    const orderedBundle = sortNodesByDependency([rootNode, ...myAuxiliaries], `${path.basename(filePath)} → ${expName}`);
    const newAstNodes = [
      ...reqImports,
      ...siblingImportsRoot,
      ...(includeSideEffectsHere ? sideEffectAstNodes : []),
      ...orderedBundle.map((n) => n.astNode),
    ];
    const newAst = j.program(newAstNodes);
    let newSource = j(newAst).toSource({ quote: 'single', trailingComma: true });
    newSource = rewriteRelativeSpecifiersInSource(j, newSource, 1);
    const newFilePath = path.join(newDirPath, `${expName}${extName}`);
    filesToWrite.set(newFilePath, newSource);
  }

  const barrelSource = buildBarrelSource();

  const filesToUpdate = new Map<string, string>();

  if (!useBarrel) {
    const srcDir = path.resolve(process.cwd(), 'src');
    const allFiles = getAllTsFiles(srcDir);
    try {
      allFiles.forEach(importerPath => {
        if (importerPath === filePath) return;
        if (!fs.existsSync(importerPath)) return;
        const content = fs.readFileSync(importerPath, 'utf-8');
        let rootAst: any;
        try {
          rootAst = j(content);
        } catch {
          console.warn(`[split-use-cases] skip importer rewrite (parse failed): ${importerPath}`);
          return;
        }
        let changed = false;

        const updateStatement = (pathNode: any) => {
          const srcNode = pathNode.node.source?.value;
          if (typeof srcNode !== 'string') return;
          const resolved = resolveImportToAbsolute(importerPath, srcNode);
          if (!pathMatchesSplitTarget(resolved, filePath)) return;

          if (pathNode.node.type === 'ExportAllDeclaration') {
            const starExportChunks: string[] = [];
            if (helpersSharedNodes.size > 0) starExportChunks.push('helpers');
            starExportChunks.push(...depsFileNames, ...rootFileNames);
            const newExports = starExportChunks.map((sub: string) =>
              j.exportAllDeclaration(j.literal(appendSubPath(srcNode, sub)), null)
            );
            j(pathNode).replaceWith(newExports);
            changed = true;
            return;
          }

          const specs = pathNode.node.specifiers;
          if (!specs || specs.length === 0) return;

          const newMap = new Map<string, any[]>();
          let allResolved = true;
          specs.forEach((spec: any) => {
            const owner = resolveSpecifierOwner(spec, exportLocationMap);
            if (!owner) {
              allResolved = false;
              return;
            }
            const targetSrc = appendSubPath(srcNode, owner);
            if (!newMap.has(targetSrc)) newMap.set(targetSrc, []);
            newMap.get(targetSrc)!.push(spec);
          });
          if (!allResolved || newMap.size === 0) return;

          const newNodes = Array.from(newMap.entries()).map(([src, specList]) => {
            if (pathNode.node.type === 'ImportDeclaration') {
              const decl = j.importDeclaration(specList, j.literal(src));
              if (pathNode.node.importKind === 'type') {
                decl.importKind = 'type';
              }
              return decl;
            }
            const decl = j.exportNamedDeclaration(null, specList, j.literal(src));
            if ((pathNode.node as { exportKind?: string }).exportKind === 'type') {
              (decl as { exportKind?: string }).exportKind = 'type';
            }
            return decl;
          });
          j(pathNode).replaceWith(newNodes);
          changed = true;
        };

        rootAst.find(j.ImportDeclaration).forEach(updateStatement);
        rootAst.find(j.ExportNamedDeclaration, { source: (s: any) => !!s }).forEach(updateStatement);
        rootAst.find(j.ExportAllDeclaration).forEach(updateStatement);

        if (
          rewriteViMocksForSplitTarget(
            j,
            rootAst,
            importerPath,
            filePath,
            exportLocationMap,
            appendSubPath
          )
        ) {
          changed = true;
        }

        if (changed) filesToUpdate.set(importerPath, rootAst.toSource({ quote: 'single', trailingComma: true }));
      });
    } catch (e) {
      console.error('[split-use-cases] import rewrite failed:', e);
      return null;
    }
  }

  if (!isDryRun) {
    filesToWrite.forEach((srcTxt, targetPath) => fs.writeFileSync(targetPath, srcTxt, 'utf-8'));
    if (useBarrel) {
      fs.writeFileSync(filePath, barrelSource, 'utf-8');
    } else {
      filesToUpdate.forEach((srcTxt, targetPath) => fs.writeFileSync(targetPath, srcTxt, 'utf-8'));
      fs.unlinkSync(filePath);
    }
  } else {
    filesToWrite.forEach((_, p) => console.log(`[Dry Run] Would create: ${p}`));
    if (useBarrel) {
      console.log(`[Dry Run] Would write barrel (replace original): ${filePath}`);
    } else {
      filesToUpdate.forEach((_, p) => console.log(`[Dry Run] Would update imports in: ${p}`));
      console.log(`[Dry Run] Would delete original file: ${filePath}`);
    }
  }
  return null;
}

export const parser = 'tsx';
