#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const {
    MODEL_PATH_PREFIX,
    MODEL_SUPPORT_BARREL_PATH,
    MODEL_TEST_SUPPORT_PATH,
    SOURCE_FILE_RE,
} = require('../.dependency-cruiser.shared.cjs');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ruleName = 'components-no-usecase-transitively';
const useCasesPath = /\/useCases\//;
const leafComponentPath = /(^src\/components\/|\/presentations\/components\/)/;
const sourceFilePath = new RegExp(SOURCE_FILE_RE, 'i');
const moduleRootRepositoryPath = /^src\/modules\/(?:Common\/|Supporting\/)?[^/]+\/repositories(?:\/|$)/;
const tauriBridgeModulePath = /(?:^|\/)utils\/tauriBridge(?:\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx))?$/i;
const commonJsRuntimeNames = new Set(['exports', 'module', 'require']);
const globalObjectNames = new Set(['global', 'globalThis', 'self', 'window']);
const commonJsSurfaceReason = 'CommonJS module, exports, and require are not available under src';

const gates = {
    main: {
        baseline: '.dependency-cruiser-known-violations.json',
    },
    reachability: {
        baseline: '.dependency-cruiser-known-violations-reachability.json',
        config: '.dependency-cruiser.reachability.cjs',
        causal: true,
    },
    types: {
        baseline: '.dependency-cruiser-known-violations-types.json',
        config: '.dependency-cruiser.types.cjs',
    },
    tests: {
        baseline: '.dependency-cruiser-known-violations-tests.json',
        config: '.dependency-cruiser.tests.cjs',
    },
};

function viaName(step) {
    if (typeof step === 'string') {
        return step;
    }
    return step?.name ?? '';
}

function isLeafComponent(filePath) {
    return leafComponentPath.test(filePath);
}

function causalEdge(violation) {
    const path = [violation.from, ...(violation.via ?? []).map(viaName), violation.to].filter(Boolean);
    let lastLeaf = isLeafComponent(violation.from) ? violation.from : null;
    let firstUseCase = null;

    for (const filePath of path) {
        if (useCasesPath.test(filePath)) {
            firstUseCase = filePath;
            break;
        }
        if (isLeafComponent(filePath)) {
            lastLeaf = filePath;
        }
    }

    return {
        type: 'reachability-causal',
        from: lastLeaf ?? violation.from,
        to: firstUseCase ?? violation.to,
        rule: {
            severity: 'error',
            name: ruleName,
        },
    };
}

function canonicalStep(step) {
    if (typeof step === 'string') {
        return { name: step, dependencyTypes: [] };
    }
    return {
        name: step?.name ?? '',
        dependencyTypes: [...(step?.dependencyTypes ?? [])].sort(),
    };
}

function canonicalRow(row) {
    const normalized = {
        type: row.type,
        from: row.from,
        to: row.to,
        rule: {
            severity: row.rule?.severity,
            name: row.rule?.name ?? row.rule,
        },
    };

    if (row.cycle) {
        normalized.cycle = row.cycle.map(canonicalStep).sort((left, right) => left.name.localeCompare(right.name));
    }
    if (row.via) {
        normalized.via = row.via.map(canonicalStep);
    }

    return normalized;
}

function keyOf(row) {
    return JSON.stringify(canonicalRow(row));
}

function sortRows(rows) {
    return [...rows].sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

export function compareRows({ current, known }) {
    const currentKeys = new Set(current.map(keyOf));
    const knownKeys = new Set(known.map(keyOf));
    return {
        novel: current.filter((row) => !knownKeys.has(keyOf(row))),
        stale: known.filter((row) => !currentKeys.has(keyOf(row))),
    };
}

export function collectCausalEdges(cruise) {
    const causalByKey = new Map();
    const violations = (cruise.summary?.violations ?? []).filter(
        (entry) => (entry.rule?.name ?? entry.rule) === ruleName
    );

    for (const violation of violations) {
        const edge = causalEdge(violation);
        causalByKey.set(keyOf(edge), edge);
    }

    for (const module of cruise.modules ?? []) {
        if (!isLeafComponent(module.source ?? '')) {
            continue;
        }
        for (const dependency of module.dependencies ?? []) {
            if (!useCasesPath.test(dependency.resolved ?? '')) {
                continue;
            }
            const edge = {
                type: 'reachability-causal',
                from: module.source,
                to: dependency.resolved,
                rule: {
                    severity: 'error',
                    name: ruleName,
                },
            };
            causalByKey.set(keyOf(edge), edge);
        }
    }

    return sortRows(causalByKey.values());
}

export function findMixedTypeValueExports(sourceText, fileName = 'index.ts') {
    const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return findMixedTypeValueExportsInSourceFile(sourceFile, fileName);
}

function findMixedTypeValueExportsInSourceFile(sourceFile, fileName) {
    const findings = [];

    for (const statement of sourceFile.statements) {
        if (!ts.isExportDeclaration(statement) || !statement.exportClause) {
            continue;
        }
        if (!ts.isNamedExports(statement.exportClause)) {
            continue;
        }

        const specifiers = statement.exportClause.elements;
        const hasType = specifiers.some((specifier) => specifier.isTypeOnly);
        const hasValue = specifiers.some((specifier) => !specifier.isTypeOnly);
        if (hasType && hasValue) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
            findings.push({ file: fileName, line: line + 1 });
        }
    }

    return findings;
}

function toPosixPath(filePath) {
    return filePath.replaceAll('\\', '/');
}

export function isModuleRootIndex(filePath) {
    const match = /^src\/modules\/(?:Common\/|Supporting\/)?[^/]+\/([^/]+)$/.exec(toPosixPath(filePath));
    if (!match) {
        return false;
    }

    return /^index(?:\.(?:js|mjs|cjs|jsx|tsx)|\.(?:d\.)?(?:ts|mts|cts))$/i.test(match[1]);
}

export function isUseCaseBarrel(filePath) {
    return /\/useCases\/index\.ts$/.test(toPosixPath(filePath));
}

const modelPathPrefix = new RegExp(MODEL_PATH_PREFIX);
const modelTestSupportPath = new RegExp(MODEL_TEST_SUPPORT_PATH);
const modelSupportBarrelPath = new RegExp(MODEL_SUPPORT_BARREL_PATH);

function comparePaths(left, right) {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}

export function findModelCasingFindings(filePaths) {
    return [...filePaths]
        .map(toPosixPath)
        .filter((filePath) => {
            const prefixMatch = modelPathPrefix.exec(filePath);
            if (!prefixMatch) {
                return false;
            }
            if (modelTestSupportPath.test(filePath) || modelSupportBarrelPath.test(filePath)) {
                return false;
            }

            const modelPathSegments = filePath.slice(prefixMatch[0].length).split('/');
            return modelPathSegments.some((segment) => !/^[A-Z]/.test(segment));
        })
        .sort(comparePaths)
        .map((file) => ({
            file,
            line: 1,
            reason: 'model directory and file segments must start with an uppercase letter',
        }));
}

function moduleSpecifierText(node) {
    if (!node) {
        return null;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }
    return null;
}

function tauriVendorModule(moduleSpecifier) {
    const normalizedSpecifier = moduleSpecifier.replaceAll('\\', '/');
    if (normalizedSpecifier.startsWith('@tauri-apps/')) {
        return normalizedSpecifier;
    }
    if (tauriBridgeModulePath.test(normalizedSpecifier)) {
        return normalizedSpecifier;
    }
    return null;
}

function entityNameRoot(entityName) {
    if (ts.isIdentifier(entityName)) {
        return entityName;
    }
    if (ts.isQualifiedName(entityName) || ts.isPropertyAccessExpression(entityName)) {
        return entityNameRoot(entityName.expression ?? entityName.left);
    }
    return null;
}

function normalizeFileName(filePath) {
    return toPosixPath(resolve(filePath));
}

function repositoryRelativePath(repositoryRoot, filePath) {
    const relativePath = toPosixPath(relative(repositoryRoot, filePath));
    return relativePath.startsWith('../') || relativePath === '..' ? null : relativePath;
}

function isRepositorySourceFile(repositoryRoot, filePath) {
    const relativePath = repositoryRelativePath(repositoryRoot, filePath);
    return Boolean(relativePath && moduleRootRepositoryPath.test(relativePath) && sourceFilePath.test(relativePath));
}

function hasModifier(node, kind) {
    return (node.modifiers ?? []).some((modifier) => modifier.kind === kind);
}

function isNamedDeclaration(node) {
    return (
        (ts.isClassDeclaration(node) ||
            ts.isEnumDeclaration(node) ||
            ts.isFunctionDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isModuleDeclaration(node)) &&
        Boolean(node.name)
    );
}

function isPrivateMember(member) {
    if (member.name && ts.isPrivateIdentifier(member.name)) {
        return true;
    }
    return (member.modifiers ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword
    );
}

// Anchored to a package's own lib directory. A repository file that happens to be named
// `lib.something.d.ts` is project code, and the type walk skips whole categories of member for a
// library type — misfiling one project file here makes it invisible.
function isTypeScriptLibraryFile(fileName) {
    const posixPath = toPosixPath(fileName);
    return /\/typescript\/lib\//.test(posixPath) || /\/node_modules\/.*\/lib\.[^/]+\.d\.ts$/.test(posixPath);
}

function isExternalDeclarationFile(fileName) {
    return /\/node_modules\//.test(toPosixPath(fileName));
}

function bindingIdentifiers(name) {
    if (!name) {
        return [];
    }
    if (ts.isIdentifier(name)) {
        return [name];
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
        return name.elements.flatMap((element) =>
            ts.isBindingElement(element) ? bindingIdentifiers(element.name) : []
        );
    }
    return [];
}

function symbolAtLocation(context, identifier) {
    try {
        return context.checker.getSymbolAtLocation(identifier) ?? null;
    } catch {
        return null;
    }
}

// In `{ exports }` the identifier resolves to the property it declares, not to the value it reads,
// so ask the checker for the value symbol before deciding the name is a local.
function referencedSymbol(context, node) {
    if (ts.isShorthandPropertyAssignment(node.parent)) {
        try {
            return context.checker.getShorthandAssignmentValueSymbol(node.parent) ?? null;
        } catch {
            return symbolAtLocation(context, node);
        }
    }
    return symbolAtLocation(context, node);
}

// A `declare const require` emits nothing and binds the name to the ambient CommonJS runtime, so it
// is the thing being refused rather than a local that shadows it. Only a declaration this file
// actually emits — an import, a parameter, a binding, a member — means the identifier is something
// else.
function shadowsCommonJsRuntime(sourceFile, declaration) {
    return (
        declaration.getSourceFile() === sourceFile &&
        ts.isDeclaration(declaration) &&
        (declaration.flags & ts.NodeFlags.Ambient) === 0
    );
}

// A CommonJS runtime name that resolves to nothing, or to a declaration outside this file, is the
// ambient one.
function isAmbientIdentifier(context, sourceFile, node) {
    const symbol = referencedSymbol(context, node);
    return !(symbol?.declarations ?? []).some((declaration) => shadowsCommonJsRuntime(sourceFile, declaration));
}

// A declaration's own name introduces the identifier instead of reading it, so `interface Options {
// module: string }` and `const exports = instance.exports` are both clean at the name itself. This
// is what keeps an ambient `.d.ts` from reporting the very names it declares.
function isDeclarationNamePosition(node) {
    const { parent } = node;
    // A shorthand `{ exports }` is the one declaration name that is also a read of the value, which
    // is why `referencedSymbol` asks the checker for that value rather than for the property.
    if (ts.isShorthandPropertyAssignment(parent)) {
        return false;
    }
    return ts.isDeclaration(parent) && parent.name === node;
}

function isGlobalObjectReference(expression) {
    return ts.isIdentifier(expression) && globalObjectNames.has(expression.text);
}

// `foo.module` and `Foo.exports` name a member of something else entirely — but `globalThis.require`
// is the CommonJS runtime itself, reached through the global object rather than by bare name.
function isMemberNamePosition(node) {
    const { parent } = node;
    if (ts.isPropertyAccessExpression(parent)) {
        return parent.name === node && !isGlobalObjectReference(parent.expression);
    }
    if (ts.isQualifiedName(parent)) {
        return parent.right === node;
    }
    return false;
}

// `src` is `"type": "module"` and contains no CommonJS: no `module.exports`, no `require`, and its
// only three `.js` files are ESM wasm-bindgen glue. Refusing the runtime names outright is a
// stronger guarantee than analysing what is done with them. The interpreter this replaced modelled
// export-object identity through aliases, destructuring, `Object.assign` and immediately-invoked
// functions so it could decide which mutations reached the public surface — and every shape it did
// not model passed as clean. A refusal models nothing, so writing the same mutation a different way
// does not evade it: `const own = module.exports` is reported at the alias, before there is any
// mutation to classify.
function findCommonJsSurfaceFindings({ checker, repositoryRoot, sourceFile }) {
    const context = { checker };
    const findings = new Map();
    const report = (node) => {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const finding = {
            file: repositoryRelativePath(repositoryRoot, sourceFile.fileName),
            line: line + 1,
            reason: commonJsSurfaceReason,
        };
        findings.set(`${finding.file}:${finding.line}`, finding);
    };
    const visit = (node) => {
        // `import loader = require('node:path')` is the canonical TypeScript spelling and it holds no
        // `require` identifier at all: the parser turns the call into an external module reference,
        // so the identifier walk below can never see it.
        if (ts.isExternalModuleReference(node)) {
            report(node.parent);
        } else if (
            ts.isIdentifier(node) &&
            commonJsRuntimeNames.has(node.text) &&
            !isDeclarationNamePosition(node) &&
            !isMemberNamePosition(node) &&
            isAmbientIdentifier(context, sourceFile, node)
        ) {
            report(node);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return [...findings.values()];
}

function createRepositoryTypeEnvironment(repositoryRoot) {
    const options = {
        allowJs: true,
        allowSyntheticDefaultImports: true,
        baseUrl: repositoryRoot,
        checkJs: true,
        esModuleInterop: true,
        jsx: ts.JsxEmit.Preserve,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        paths: { '#/*': ['src/*'] },
        resolveJsonModule: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: [],
    };
    const compilerHost = ts.createCompilerHost(options, true);
    return { compilerHost, options };
}

function createRepositoryTypeProgram(rootPaths, environment) {
    const program = ts.createProgram({
        host: environment.compilerHost,
        options: environment.options,
        rootNames: [...new Set(rootPaths.map(normalizeFileName))],
    });
    return { checker: program.getTypeChecker(), program };
}

function resolveRepositoryModuleSpecifier(moduleSpecifier, containingFile, options, moduleResolutionHost) {
    const isRelativeSpecifier = moduleSpecifier.startsWith('.');
    const basePath = isRelativeSpecifier ? resolve(dirname(normalizeFileName(containingFile)), moduleSpecifier) : null;
    if (basePath && sourceFilePath.test(toPosixPath(basePath)) && existsSync(basePath)) {
        return normalizeFileName(basePath);
    }
    try {
        const resolved = ts.resolveModuleName(
            moduleSpecifier,
            normalizeFileName(containingFile),
            options,
            moduleResolutionHost
        ).resolvedModule;
        if (resolved?.resolvedFileName) {
            return normalizeFileName(resolved.resolvedFileName);
        }
    } catch {
        // Fall through to the explicit source-extension probe below.
    }
    if (!isRelativeSpecifier || !basePath) {
        return null;
    }
    const candidates = [
        basePath,
        ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'].map(
            (extension) => `${basePath}${extension}`
        ),
        ...['index.ts', 'index.tsx', 'index.mts', 'index.cts', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'].map(
            (entry) => resolve(basePath, entry)
        ),
    ];
    const existingPath = candidates.find((candidate) => existsSync(candidate));
    return existingPath ? normalizeFileName(existingPath) : null;
}

function collectConsumerTargets(sourceFile, resolveModuleSpecifier, checker) {
    const targets = [];
    const context = { checker };
    const addTarget = (moduleSpecifier, exportedName, all = false) => {
        const targetFile = moduleSpecifier ? resolveModuleSpecifier(moduleSpecifier, sourceFile.fileName) : null;
        if (targetFile) {
            targets.push({ all, exportedName, targetFile });
        }
    };
    const visit = (node) => {
        if (ts.isImportTypeNode(node)) {
            const moduleSpecifier = moduleSpecifierText(node.argument.literal);
            const memberName = node.qualifier ? entityNameRoot(node.qualifier)?.text : null;
            addTarget(moduleSpecifier, memberName ?? '*', !memberName);
        }
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length === 1
        ) {
            addTarget(moduleSpecifierText(node.arguments[0]), '*', true);
        }
        if (ts.isImportDeclaration(node) && node.importClause) {
            const moduleSpecifier = moduleSpecifierText(node.moduleSpecifier);
            if (node.importClause.name) {
                addTarget(moduleSpecifier, 'default');
            }
            const namedBindings = node.importClause.namedBindings;
            if (namedBindings && ts.isNamespaceImport(namedBindings)) {
                addTarget(moduleSpecifier, '*', true);
            } else if (namedBindings && ts.isNamedImports(namedBindings)) {
                for (const element of namedBindings.elements) {
                    addTarget(moduleSpecifier, (element.propertyName ?? element.name).text);
                }
            }
        }
        if (ts.isImportEqualsDeclaration(node)) {
            const moduleReference = node.moduleReference;
            const moduleSpecifier =
                ts.isExternalModuleReference(moduleReference) && moduleReference.expression
                    ? moduleSpecifierText(moduleReference.expression)
                    : null;
            addTarget(moduleSpecifier, '*', true);
        }
        if (ts.isExportDeclaration(node)) {
            const moduleSpecifier = moduleSpecifierText(node.moduleSpecifier);
            if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) {
                addTarget(moduleSpecifier, '*', true);
            } else if (ts.isNamedExports(node.exportClause)) {
                for (const element of node.exportClause.elements) {
                    addTarget(moduleSpecifier, (element.propertyName ?? element.name).text);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return targets;
}

function findRepositoryConsumerPaths(
    repositoryRoot,
    sourcePaths,
    sourceFilesByPath,
    checker,
    options,
    compilerHost,
    targetsByFile
) {
    const resolveModuleSpecifier = (moduleSpecifier, containingFile) =>
        resolveRepositoryModuleSpecifier(moduleSpecifier, containingFile, options, compilerHost);
    return sourcePaths.filter((filePath) => {
        if (isRepositorySourceFile(repositoryRoot, filePath)) {
            return false;
        }
        const sourceFile = sourceFilesByPath.get(normalizeFileName(filePath));
        if (!sourceFile) {
            return false;
        }
        const hasRepositoryImport = (sourceFile.imports ?? []).some((moduleReference) => {
            const targetFile = resolveModuleSpecifier(moduleReference.text, sourceFile.fileName);
            return targetFile && isRepositorySourceFile(repositoryRoot, targetFile);
        });
        if (!hasRepositoryImport && !/\b(?:import|require)\b/.test(sourceFile.text)) {
            return false;
        }
        const targets = collectConsumerTargets(sourceFile, resolveModuleSpecifier, checker);
        const consumesRepository = targets.some(({ targetFile }) => isRepositorySourceFile(repositoryRoot, targetFile));
        if (consumesRepository) {
            targetsByFile.set(normalizeFileName(filePath), targets);
        }
        return consumesRepository;
    });
}

function addToSetMap(map, key, value) {
    if (!value) {
        return;
    }
    const values = map.get(key) ?? new Set();
    values.add(value);
    map.set(key, values);
}

function createRepositoryTypeContext(repositoryRoot, program, environment) {
    return {
        checker: program.getTypeChecker(),
        compilerHost: environment.compilerHost,
        declarationsByFile: new Map(),
        directVendorFiles: new Set(),
        moduleExportsByFile: new Map(),
        options: environment.options,
        programSourceFiles: new Map(
            program.getSourceFiles().map((sourceFile) => [normalizeFileName(sourceFile.fileName), sourceFile])
        ),
        recordsByFile: new Map(),
        repositoryRoot,
        vendorBindingsBySymbol: new Map(),
        vendorModulesByFile: new Map(),
    };
}

function addVendorBinding(context, binding, moduleSpecifier) {
    if (!binding || !moduleSpecifier) {
        return;
    }
    const symbol = symbolAtLocation(context, binding);
    if (symbol) {
        addToSetMap(context.vendorBindingsBySymbol, symbol, moduleSpecifier);
    }
}

function declarationForSymbol(context, sourceFile, node) {
    const symbol = symbolAtLocation(context, node);
    return (symbol && context.declarationsByFile.get(normalizeFileName(sourceFile.fileName))?.get(symbol)) ?? null;
}

function vendorBindingsFor(context, binding) {
    const symbols = new Set([symbolAtLocation(context, binding)].filter(Boolean));
    if (ts.isIdentifier(binding) && ts.isShorthandPropertyAssignment(binding.parent)) {
        try {
            const valueSymbol = context.checker.getShorthandAssignmentValueSymbol(binding.parent);
            if (valueSymbol) {
                symbols.add(valueSymbol);
            }
        } catch {
            // The checker may not resolve shorthand values in malformed JavaScript.
        }
    }
    const modules = new Set();
    for (const symbol of symbols) {
        for (const moduleSpecifier of context.vendorBindingsBySymbol.get(symbol) ?? []) {
            modules.add(moduleSpecifier);
        }
    }
    return modules;
}

function registerVendorModule(context, moduleSpecifier, containingFile) {
    const vendorModule = tauriVendorModule(moduleSpecifier);
    if (vendorModule) {
        context.directVendorFiles.add(normalizeFileName(containingFile));
        const resolvedFile = resolveRepositoryModuleSpecifier(
            moduleSpecifier,
            containingFile,
            context.options,
            context.compilerHost
        );
        if (resolvedFile) {
            addToSetMap(context.vendorModulesByFile, resolvedFile, vendorModule);
        }
    }
    return vendorModule;
}

function collectSyntaxVendorModules(context, node, sourceFile, { includeImplementation = false } = {}) {
    const modules = new Set();
    const seenNodes = new Set();
    const sourceFileName = sourceFile.fileName;
    const addSyntaxModule = (moduleSpecifier) => {
        const vendorModule = registerVendorModule(context, moduleSpecifier, sourceFileName);
        if (vendorModule) {
            modules.add(vendorModule);
        }
    };
    const visitJSDoc = (current) => {
        for (const tag of ts.getJSDocTags(current)) {
            if (tag.typeExpression?.type) {
                visit(tag.typeExpression.type);
            }
        }
    };
    const visitParameter = (parameter) => {
        visitJSDoc(parameter);
        visit(parameter.type);
    };
    const visitSignature = (current) => {
        for (const typeParameter of current.typeParameters ?? []) {
            visit(typeParameter.constraint);
            visit(typeParameter.default);
        }
        for (const parameter of current.parameters ?? []) {
            visitParameter(parameter);
        }
        visit(current.type);
    };
    const visitPublicMember = (member) => {
        if (isPrivateMember(member)) {
            return;
        }
        if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
            visitJSDoc(member);
            visit(member.type);
            return;
        }
        visit(member);
    };
    const visit = (current) => {
        if (!current || seenNodes.has(current)) {
            return;
        }
        seenNodes.add(current);
        visitJSDoc(current);

        if (ts.isImportTypeNode(current)) {
            const moduleSpecifier = moduleSpecifierText(current.argument.literal);
            if (moduleSpecifier) {
                addSyntaxModule(moduleSpecifier);
            }
        }
        if (ts.isTypeReferenceNode(current)) {
            const rootName = entityNameRoot(current.typeName);
            if (rootName) {
                for (const moduleSpecifier of vendorBindingsFor(context, rootName)) {
                    modules.add(moduleSpecifier);
                }
                const declaration = declarationForSymbol(context, sourceFile, rootName);
                if (declaration) {
                    visit(declaration);
                }
            }
        }
        if (ts.isIdentifier(current)) {
            for (const moduleSpecifier of vendorBindingsFor(context, current)) {
                modules.add(moduleSpecifier);
            }
        }
        if (includeImplementation) {
            if (ts.isIdentifier(current)) {
                const declaration = declarationForSymbol(context, sourceFile, current);
                if (declaration && declaration !== current) {
                    visit(declaration);
                }
            }
            ts.forEachChild(current, visit);
            return;
        }
        if (ts.isVariableDeclaration(current)) {
            visit(current.type);
            const initializer = current.initializer;
            if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
                visit(initializer);
            } else if (
                initializer &&
                (ts.isAsExpression(initializer) ||
                    ts.isTypeAssertionExpression(initializer) ||
                    ts.isSatisfiesExpression(initializer))
            ) {
                visit(initializer.type);
                if (ts.isArrowFunction(initializer.expression) || ts.isFunctionExpression(initializer.expression)) {
                    visit(initializer.expression);
                }
            }
            return;
        }
        if (ts.isFunctionLike(current)) {
            visitSignature(current);
            return;
        }
        if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
            for (const typeParameter of current.typeParameters ?? []) {
                visit(typeParameter.constraint);
                visit(typeParameter.default);
            }
            for (const heritageClause of current.heritageClauses ?? []) {
                visit(heritageClause);
            }
            for (const member of current.members) {
                visitPublicMember(member);
            }
            return;
        }
        ts.forEachChild(current, visit);
    };
    visit(node);
    return modules;
}

function registerImportMetadata(context, sourceFile, statement) {
    const sourceFileName = sourceFile.fileName;
    const moduleSpecifier = ts.isImportDeclaration(statement)
        ? moduleSpecifierText(statement.moduleSpecifier)
        : ts.isImportEqualsDeclaration(statement) &&
            ts.isExternalModuleReference(statement.moduleReference) &&
            statement.moduleReference.expression
          ? moduleSpecifierText(statement.moduleReference.expression)
          : null;
    const vendorModule = moduleSpecifier ? registerVendorModule(context, moduleSpecifier, sourceFileName) : null;
    if (!vendorModule) {
        return;
    }
    if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (!clause) {
            return;
        }
        const namedBindings = clause.namedBindings;
        const bindingNodes = [
            clause.name,
            namedBindings && ts.isNamespaceImport(namedBindings) ? namedBindings.name : null,
            ...(namedBindings && ts.isNamedImports(namedBindings)
                ? namedBindings.elements.map((element) => element.name)
                : []),
        ].filter(Boolean);
        for (const binding of bindingNodes) {
            addVendorBinding(context, binding, vendorModule);
        }
        return;
    }
    addVendorBinding(context, statement.name, vendorModule);
}

function collectVendorMetadata(context, sourceFiles) {
    for (const sourceFile of sourceFiles) {
        const declarations = new Map();
        for (const statement of sourceFile.statements) {
            if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) {
                    for (const identifier of bindingIdentifiers(declaration.name)) {
                        const symbol = symbolAtLocation(context, identifier);
                        if (symbol) {
                            declarations.set(symbol, declaration);
                        }
                    }
                }
            } else if (isNamedDeclaration(statement)) {
                const symbol = symbolAtLocation(context, statement.name);
                if (symbol) {
                    declarations.set(symbol, statement);
                }
            }
            registerImportMetadata(context, sourceFile, statement);
        }
        context.declarationsByFile.set(normalizeFileName(sourceFile.fileName), declarations);
    }

    for (const sourceFile of sourceFiles) {
        const visit = (node) => {
            for (const tag of ts.getJSDocTags(node)) {
                if (tag.typeExpression?.type) {
                    collectSyntaxVendorModules(context, tag.typeExpression.type, sourceFile);
                }
            }
            if (ts.isExportDeclaration(node)) {
                const moduleSpecifier = moduleSpecifierText(node.moduleSpecifier);
                if (moduleSpecifier) {
                    registerVendorModule(context, moduleSpecifier, sourceFile.fileName);
                }
            } else if (ts.isImportTypeNode(node)) {
                const moduleSpecifier = moduleSpecifierText(node.argument.literal);
                if (moduleSpecifier) {
                    registerVendorModule(context, moduleSpecifier, sourceFile.fileName);
                }
            }
            if (ts.isVariableDeclaration(node)) {
                const modules = collectSyntaxVendorModules(context, node.initializer ?? node, sourceFile, {
                    includeImplementation: true,
                });
                for (const identifier of bindingIdentifiers(node.name)) {
                    for (const moduleSpecifier of modules) {
                        addVendorBinding(context, identifier, moduleSpecifier);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
}

function vendorModulesForFile(context, fileName) {
    const normalizedFileName = normalizeFileName(fileName);
    const modules = new Set(context.vendorModulesByFile.get(normalizedFileName) ?? []);
    const relativePath = repositoryRelativePath(context.repositoryRoot, normalizedFileName);
    if (relativePath && tauriBridgeModulePath.test(relativePath)) {
        modules.add('#/utils/tauriBridge');
    }
    if (modules.size === 0) {
        const packageMatch = /(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@tauri-apps\/[^/]+)/.exec(
            normalizedFileName
        );
        if (packageMatch) {
            modules.add(packageMatch[1]);
        }
    }
    return modules;
}

function addRepositoryRecord(context, sourceFile, record) {
    const fileName = normalizeFileName(sourceFile.fileName);
    const records = context.recordsByFile.get(fileName) ?? [];
    const completeRecord = { ...record, fileName, sourceFile };
    records.push(completeRecord);
    context.recordsByFile.set(fileName, records);
    return completeRecord;
}

function addDeclarationRecord(context, sourceFile, statement, declaration, exportedName) {
    return addRepositoryRecord(context, sourceFile, {
        diagnosticNode: statement,
        exportedName,
        symbolNode: declaration.name ?? declaration,
        valueNode: declaration,
    });
}

function collectExportRecords(context, sourceFile) {
    const resolveModuleSpecifier = (moduleSpecifier, containingFile) =>
        resolveRepositoryModuleSpecifier(moduleSpecifier, containingFile, context.options, context.compilerHost);

    for (const statement of sourceFile.statements) {
        if (ts.isExportDeclaration(statement)) {
            const moduleSpecifier = moduleSpecifierText(statement.moduleSpecifier);
            const targetFile = moduleSpecifier ? resolveModuleSpecifier(moduleSpecifier, sourceFile.fileName) : null;
            if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                for (const specifier of statement.exportClause.elements) {
                    const localName = (specifier.propertyName ?? specifier.name).text;
                    addRepositoryRecord(context, sourceFile, {
                        diagnosticNode: statement,
                        exportedName: specifier.name.text,
                        moduleSpecifier: moduleSpecifier && tauriVendorModule(moduleSpecifier),
                        symbolNode: specifier.name,
                        targetFile,
                        targetName: moduleSpecifier ? localName : null,
                        valueNode: moduleSpecifier
                            ? specifier
                            : (declarationForSymbol(context, sourceFile, specifier.propertyName ?? specifier.name) ??
                              specifier),
                    });
                }
            } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
                addRepositoryRecord(context, sourceFile, {
                    diagnosticNode: statement,
                    exportedName: statement.exportClause.name.text,
                    moduleSpecifier: moduleSpecifier && tauriVendorModule(moduleSpecifier),
                    symbolNode: statement.exportClause.name,
                    targetFile,
                    targetName: '*',
                    valueNode: statement.exportClause,
                });
            } else if (moduleSpecifier) {
                addRepositoryRecord(context, sourceFile, {
                    diagnosticNode: statement,
                    exportedName: '*',
                    isStarExport: true,
                    moduleSpecifier: tauriVendorModule(moduleSpecifier),
                    targetFile,
                    targetName: '*',
                    valueNode: statement,
                });
            }
            continue;
        }
        if (ts.isExportAssignment(statement)) {
            addRepositoryRecord(context, sourceFile, {
                diagnosticNode: statement,
                exportedName: statement.isExportEquals ? 'export=' : 'default',
                symbolNode: statement.expression,
                valueNode: statement.expression,
            });
            continue;
        }
        if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
            const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
            if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) {
                    for (const identifier of bindingIdentifiers(declaration.name)) {
                        addDeclarationRecord(
                            context,
                            sourceFile,
                            statement,
                            declaration,
                            isDefault ? 'default' : identifier.text
                        );
                    }
                }
            } else if (isNamedDeclaration(statement)) {
                addDeclarationRecord(
                    context,
                    sourceFile,
                    statement,
                    statement,
                    isDefault ? 'default' : statement.name.text
                );
            }
        }
    }
}

function moduleExportSymbols(context, fileName) {
    const normalizedFileName = normalizeFileName(fileName);
    if (context.moduleExportsByFile.has(normalizedFileName)) {
        return context.moduleExportsByFile.get(normalizedFileName);
    }
    const sourceFile = context.programSourceFiles.get(normalizedFileName);
    let symbols = [];
    if (sourceFile?.symbol) {
        try {
            symbols = context.checker.getExportsOfModule(sourceFile.symbol);
        } catch {
            symbols = [];
        }
    }
    context.moduleExportsByFile.set(normalizedFileName, symbols);
    return symbols;
}

function recordsForName(context, fileName, exportedName) {
    return (context.recordsByFile.get(normalizeFileName(fileName)) ?? []).filter(
        (record) => record.exportedName === exportedName
    );
}

function addStarProxyRecords(context) {
    for (const records of context.recordsByFile.values()) {
        for (const record of records.filter((candidate) => candidate.isStarExport && candidate.targetFile)) {
            const targetRecords = context.recordsByFile.get(record.targetFile) ?? [];
            const targetNames = new Set(
                targetRecords
                    .map((targetRecord) => targetRecord.exportedName)
                    .filter((name) => name && name !== '*' && name !== 'default')
            );
            for (const symbol of moduleExportSymbols(context, record.targetFile)) {
                if (symbol.name !== 'default') {
                    targetNames.add(symbol.name);
                }
            }
            for (const targetName of targetNames) {
                const targetSymbols = moduleExportSymbols(context, record.targetFile);
                records.push({
                    ...record,
                    exportedName: targetName,
                    targetName,
                    targetRecord: recordsForName(context, record.targetFile, targetName)[0] ?? {
                        fileName: record.targetFile,
                        sourceFile: context.programSourceFiles.get(record.targetFile),
                        exportedName: targetName,
                        symbol: targetSymbols.find((symbol) => symbol.name === targetName),
                    },
                });
            }
        }
    }
}

function symbolForRecord(context, record, seenRecords = new Set()) {
    if (!record || seenRecords.has(record)) {
        return null;
    }
    seenRecords.add(record);
    if (record.symbol) {
        return record.symbol;
    }
    if (record.targetRecord) {
        const targetSymbol = symbolForRecord(context, record.targetRecord, seenRecords);
        if (targetSymbol) {
            return targetSymbol;
        }
    }
    if (record.targetFile && record.targetName && record.targetName !== '*') {
        const targetSymbol = moduleExportSymbols(context, record.targetFile).find(
            (symbol) => symbol.name === record.targetName
        );
        if (targetSymbol) {
            return targetSymbol;
        }
    }
    const sourceFile = context.programSourceFiles.get(record.fileName);
    if (sourceFile?.symbol && record.exportedName !== '*' && record.exportedName !== 'export=') {
        const moduleSymbol = moduleExportSymbols(context, record.fileName).find(
            (symbol) => symbol.name === record.exportedName
        );
        if (moduleSymbol) {
            return moduleSymbol;
        }
    }
    if (record.symbolNode) {
        try {
            return context.checker.getSymbolAtLocation(record.symbolNode) ?? null;
        } catch {
            return null;
        }
    }
    return null;
}

function collectVendorModulesFromSymbol(context, symbol, sourceFileName, modules, seenSymbols, seenTypes) {
    if (!symbol || seenSymbols.has(symbol)) {
        return Boolean(symbol);
    }
    seenSymbols.add(symbol);
    let resolved = true;
    if (symbol.flags & ts.SymbolFlags.Alias) {
        try {
            const aliasedSymbol = context.checker.getAliasedSymbol(symbol);
            resolved = collectVendorModulesFromSymbol(
                context,
                aliasedSymbol,
                sourceFileName,
                modules,
                seenSymbols,
                seenTypes
            );
        } catch {
            resolved = false;
        }
    }
    const symbolSourceFile = symbol.declarations?.[0]?.getSourceFile?.();
    if (isTypeScriptLibraryFile(symbolSourceFile?.fileName ?? '')) {
        return resolved;
    }
    for (const declaration of symbol.declarations ?? []) {
        const declarationSourceFile = declaration.getSourceFile?.() ?? context.programSourceFiles.get(sourceFileName);
        for (const moduleSpecifier of collectSyntaxVendorModules(context, declaration, declarationSourceFile)) {
            modules.add(moduleSpecifier);
        }
        for (const moduleSpecifier of vendorModulesForFile(context, declarationSourceFile.fileName)) {
            modules.add(moduleSpecifier);
        }
    }
    const location =
        symbol.valueDeclaration ?? symbol.declarations?.[0] ?? context.programSourceFiles.get(sourceFileName);
    if (!location) {
        return false;
    }
    const typeResolved = collectTypeSafely(
        context,
        () => context.checker.getTypeOfSymbolAtLocation(symbol, location),
        location,
        modules,
        seenTypes,
        seenSymbols
    );
    let declaredTypeResolved = true;
    if (
        symbol.flags &
        (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.TypeParameter)
    ) {
        declaredTypeResolved = collectTypeSafely(
            context,
            () => context.checker.getDeclaredTypeOfSymbol(symbol),
            location,
            modules,
            seenTypes,
            seenSymbols
        );
    }
    return resolved && typeResolved && declaredTypeResolved;
}

function collectTypeSafely(context, getType, location, modules, seenTypes, seenSymbols) {
    try {
        const type = getType();
        if (!type) {
            return false;
        }
        collectVendorModulesFromType(context, type, location, modules, seenTypes, seenSymbols);
        return !(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown));
    } catch {
        return false;
    }
}

function collectFactoryPublicType(context, record, modules, seenTypes, seenSymbols) {
    if (!record.valueNode || !ts.isVariableDeclaration(record.valueNode)) {
        return false;
    }
    const initializer = record.valueNode.initializer;
    if (!ts.isCallExpression(initializer) || initializer.arguments.length !== 1) {
        return false;
    }
    const [factoryArgument] = initializer.arguments;
    if (!ts.isFunctionLike(factoryArgument)) {
        return false;
    }
    return collectTypeSafely(
        context,
        () => context.checker.getTypeAtLocation(factoryArgument),
        factoryArgument,
        modules,
        seenTypes,
        seenSymbols
    );
}

function collectVendorModulesFromType(context, type, location, modules, seenTypes, seenSymbols) {
    if (!type || seenTypes.has(type)) {
        return;
    }
    seenTypes.add(type);
    const typeSourceFile = type.symbol?.declarations?.[0]?.getSourceFile?.();
    const isLibraryType = isTypeScriptLibraryFile(typeSourceFile?.fileName ?? '');
    const isExternalType = isExternalDeclarationFile(typeSourceFile?.fileName ?? '');
    const locationSourceFile = location.getSourceFile?.() ?? context.programSourceFiles.get(location.fileName);
    const locationFileName = locationSourceFile?.fileName ?? location.fileName;
    collectVendorModulesFromSymbol(context, type.symbol, locationFileName, modules, seenSymbols, seenTypes);
    collectVendorModulesFromSymbol(context, type.aliasSymbol, locationFileName, modules, seenSymbols, seenTypes);
    for (const nestedType of [
        ...(type.types ?? []),
        ...(type.typeArguments ?? []),
        ...(type.aliasTypeArguments ?? []),
        type.constraint,
        type.default,
    ].filter(Boolean)) {
        collectVendorModulesFromType(context, nestedType, location, modules, seenTypes, seenSymbols);
    }
    // A signature declared by a TypeScript lib type can only mention that declaration's own types
    // and the type arguments it was instantiated with, and those arguments are walked above — so
    // descending into `Uint8Array<ArrayBufferLike>`'s methods finds nothing new and costs
    // everything. A package in `node_modules` is different: its `.d.ts` can name a type from
    // another package, with no type-argument path to it, and the syntax pass never reads a file
    // outside `src`. Skipping those signatures would lose the only route to a Tauri type carried by
    // a third-party callable interface.
    if (!isLibraryType) {
        for (const signature of [...(type.getCallSignatures?.() ?? []), ...(type.getConstructSignatures?.() ?? [])]) {
            for (const parameter of signature.parameters) {
                const parameterLocation = parameter.valueDeclaration ?? location;
                collectTypeSafely(
                    context,
                    // Not the `AtLocation` variant: it mints a fresh Type object per call, which
                    // `seenTypes` — keyed on object identity — can never match, so a recursive or
                    // widely reused signature is walked again at every occurrence.
                    () => context.checker.getTypeOfSymbol(parameter),
                    parameterLocation,
                    modules,
                    seenTypes,
                    seenSymbols
                );
            }
            collectVendorModulesFromType(context, signature.getReturnType(), location, modules, seenTypes, seenSymbols);
            for (const typeParameter of signature.typeParameters ?? []) {
                collectVendorModulesFromSymbol(
                    context,
                    typeParameter,
                    locationFileName,
                    modules,
                    seenSymbols,
                    seenTypes
                );
            }
        }
    }
    if (!isLibraryType && !isExternalType) {
        for (const property of type.getProperties?.() ?? []) {
            const propertyLocation = property.valueDeclaration ?? property.declarations?.[0] ?? location;
            if (isPrivateMember(propertyLocation)) {
                continue;
            }
            collectTypeSafely(
                context,
                () => context.checker.getTypeOfSymbol(property),
                propertyLocation,
                modules,
                seenTypes,
                seenSymbols
            );
        }
    }
    if (!isLibraryType && !isExternalType && type.symbol?.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)) {
        try {
            for (const baseType of context.checker.getBaseTypes(type) ?? []) {
                collectVendorModulesFromType(context, baseType, location, modules, seenTypes, seenSymbols);
            }
        } catch {
            // Not every class-like type has a base-type query.
        }
    }
}

function collectRecordVendorModules(context, record, seenRecords = new Set()) {
    if (!record || seenRecords.has(record)) {
        return new Set();
    }
    seenRecords.add(record);
    const modules = new Set(record.moduleSpecifier ? [record.moduleSpecifier] : []);
    const symbol = symbolForRecord(context, record);
    const seenSymbols = new Set();
    const seenTypes = new Set();
    let publicTypeResolved = false;
    if (symbol) {
        publicTypeResolved = collectVendorModulesFromSymbol(
            context,
            symbol,
            record.fileName,
            modules,
            seenSymbols,
            seenTypes
        );
    }
    if (!publicTypeResolved) {
        publicTypeResolved = collectFactoryPublicType(context, record, modules, seenTypes, seenSymbols);
    }
    for (const node of [record.valueNode, record.symbolNode]) {
        if (!node || (publicTypeResolved && ts.isIdentifier(node))) {
            continue;
        }
        if (!publicTypeResolved || ts.isExportAssignment(record.diagnosticNode)) {
            publicTypeResolved =
                collectTypeSafely(
                    context,
                    () => context.checker.getTypeAtLocation(node),
                    node,
                    modules,
                    seenTypes,
                    seenSymbols
                ) || publicTypeResolved;
        }
        const sourceFile = node.getSourceFile?.() ?? record.sourceFile;
        for (const moduleSpecifier of collectSyntaxVendorModules(context, node, sourceFile, {
            includeImplementation: !publicTypeResolved,
        })) {
            modules.add(moduleSpecifier);
        }
    }
    if (record.targetRecord) {
        for (const moduleSpecifier of collectRecordVendorModules(context, record.targetRecord, seenRecords)) {
            modules.add(moduleSpecifier);
        }
    }
    if (record.targetFile && record.targetName && record.targetName !== '*') {
        for (const targetRecord of recordsForName(context, record.targetFile, record.targetName)) {
            for (const moduleSpecifier of collectRecordVendorModules(context, targetRecord, seenRecords)) {
                modules.add(moduleSpecifier);
            }
        }
        for (const targetSymbol of moduleExportSymbols(context, record.targetFile).filter(
            (candidate) => candidate.name === record.targetName
        )) {
            collectVendorModulesFromSymbol(context, targetSymbol, record.targetFile, modules, seenSymbols, seenTypes);
        }
    }
    return modules;
}

function recordsForExport(context, fileName, exportedName, all = false) {
    const records = context.recordsByFile.get(normalizeFileName(fileName)) ?? [];
    if (all) {
        return records;
    }
    const exact = records.filter((record) => record.exportedName === exportedName);
    if (exact.length > 0) {
        return exact;
    }
    return records.filter((record) => record.exportedName === '*');
}

function collectRepositoryTauriTypeFindings(
    repositoryRoot,
    repositorySourcePaths,
    consumerTargetsByFile,
    program,
    environment
) {
    const context = createRepositoryTypeContext(repositoryRoot, program, environment);
    const sourceFiles = repositorySourcePaths
        .map((filePath) => context.programSourceFiles.get(normalizeFileName(filePath)))
        .filter(Boolean);
    collectVendorMetadata(context, sourceFiles);
    const resolveModuleSpecifier = (moduleSpecifier, containingFile) =>
        resolveRepositoryModuleSpecifier(moduleSpecifier, containingFile, context.options, context.compilerHost);
    const repositoryDependencies = new Map(
        sourceFiles.map((sourceFile) => [
            normalizeFileName(sourceFile.fileName),
            new Set(
                [...(sourceFile.imports ?? [])]
                    .map((moduleReference) => resolveModuleSpecifier(moduleReference.text, sourceFile.fileName))
                    .filter((targetFile) => targetFile && isRepositorySourceFile(repositoryRoot, targetFile))
                    .map(normalizeFileName)
            ),
        ])
    );
    const dependentsByDependency = new Map();
    for (const [sourceFileName, dependencies] of repositoryDependencies) {
        for (const dependency of dependencies) {
            addToSetMap(dependentsByDependency, dependency, sourceFileName);
        }
    }
    const vendorRelevantFiles = new Set();
    const relevanceQueue = [];
    for (const sourceFileName of context.directVendorFiles) {
        if (repositoryDependencies.has(sourceFileName)) {
            vendorRelevantFiles.add(sourceFileName);
            relevanceQueue.push(sourceFileName);
        }
    }
    for (let queueIndex = 0; queueIndex < relevanceQueue.length; queueIndex += 1) {
        const dependency = relevanceQueue[queueIndex];
        for (const dependent of dependentsByDependency.get(dependency) ?? []) {
            if (!vendorRelevantFiles.has(dependent)) {
                vendorRelevantFiles.add(dependent);
                relevanceQueue.push(dependent);
            }
        }
    }
    for (const sourceFile of sourceFiles) {
        if (isRepositorySourceFile(repositoryRoot, sourceFile.fileName)) {
            collectExportRecords(context, sourceFile);
        }
    }
    addStarProxyRecords(context);

    const crossingRecords = new Set();
    for (const targets of consumerTargetsByFile.values()) {
        for (const { all, exportedName, targetFile } of targets) {
            if (!targetFile || !isRepositorySourceFile(repositoryRoot, targetFile)) {
                continue;
            }
            const normalizedTargetFile = normalizeFileName(targetFile);
            if (!vendorRelevantFiles.has(normalizedTargetFile)) {
                continue;
            }
            for (const record of recordsForExport(context, normalizedTargetFile, exportedName, all)) {
                crossingRecords.add(record);
            }
        }
    }

    const findings = new Map();
    for (const record of crossingRecords) {
        for (const moduleSpecifier of collectRecordVendorModules(context, record)) {
            const { line } = record.sourceFile.getLineAndCharacterOfPosition(
                record.diagnosticNode.getStart(record.sourceFile)
            );
            const finding = {
                file: repositoryRelativePath(repositoryRoot, record.fileName),
                line: line + 1,
                reason: `repository public type surface exposes Tauri vendor type from ${moduleSpecifier}`,
            };
            findings.set(`${finding.file}:${finding.line}:${moduleSpecifier}`, finding);
        }
    }
    return [...findings.values()];
}

function walkFiles(directory, symlinkPaths = []) {
    const files = [];
    if (lstatSync(directory).isSymbolicLink()) {
        symlinkPaths.push(directory);
        return files;
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) {
            symlinkPaths.push(entryPath);
        } else if (entry.isDirectory()) {
            files.push(...walkFiles(entryPath, symlinkPaths));
        } else {
            files.push(entryPath);
        }
    }
    return files.sort(comparePaths);
}

// `walkFiles` records a symbolic link and does not follow it, so a linked source file or a linked
// directory keeps everything behind it out of every check below. Under `src/modules` links are
// refused outright; elsewhere under `src` only the ones that hide source matter, which leaves the
// documentation links that sit beside a component alone.
function hidesSourceFromTheWalk(absolutePath, file) {
    if (sourceFilePath.test(file)) {
        return true;
    }
    try {
        return statSync(absolutePath).isDirectory();
    } catch {
        return false;
    }
}

export function findStaticGuardFindings(repositoryRoot = root) {
    const symlinkPaths = [];
    const allSourcePaths = walkFiles(resolve(repositoryRoot, 'src'), symlinkPaths);
    const files = allSourcePaths
        .filter((absolutePath) => /^src\/modules(?:\/|$)/.test(toPosixPath(relative(repositoryRoot, absolutePath))))
        .map((absolutePath) => ({
            absolutePath,
            repoPath: toPosixPath(relative(repositoryRoot, absolutePath)),
        }));
    const symlinkFindings = symlinkPaths.flatMap((absolutePath) => {
        const file = toPosixPath(relative(repositoryRoot, absolutePath));
        if (/^src\/modules(?:\/|$)/.test(file)) {
            return [{ file, line: 1, reason: 'symbolic links are not permitted under src/modules' }];
        }
        if (!hidesSourceFromTheWalk(absolutePath, file)) {
            return [];
        }
        return [{ file, line: 1, reason: 'symbolic link hides source under src from the dependency guard' }];
    });
    const rootIndexes = files
        .map(({ repoPath }) => repoPath)
        .filter(isModuleRootIndex)
        .map((file) => ({ file, line: 1, reason: 'module-root index entry is retired' }));
    const sourcePaths = allSourcePaths.filter((absolutePath) =>
        sourceFilePath.test(toPosixPath(relative(repositoryRoot, absolutePath)))
    );
    const environment = createRepositoryTypeEnvironment(repositoryRoot);
    const { program } = createRepositoryTypeProgram(sourcePaths, environment);
    const checker = program.getTypeChecker();
    const sourceFilesByPath = new Map(
        program.getSourceFiles().map((sourceFile) => [normalizeFileName(sourceFile.fileName), sourceFile])
    );
    const mixedExports = files
        .filter(({ repoPath }) => isUseCaseBarrel(repoPath))
        .flatMap(({ absolutePath, repoPath }) => {
            const sourceFile = sourceFilesByPath.get(normalizeFileName(absolutePath));
            return sourceFile
                ? findMixedTypeValueExportsInSourceFile(sourceFile, repoPath).map((finding) => ({
                      ...finding,
                      reason: 'split mixed value/type exports so type-edge rules can inspect the type export',
                  }))
                : [];
        });
    const commonJsFindings = sourcePaths.flatMap((absolutePath) => {
        const sourceFile = sourceFilesByPath.get(normalizeFileName(absolutePath));
        return sourceFile ? findCommonJsSurfaceFindings({ checker, repositoryRoot, sourceFile }) : [];
    });
    const repositorySourcePaths = sourcePaths.filter((filePath) => isRepositorySourceFile(repositoryRoot, filePath));
    const consumerTargetsByFile = new Map();
    findRepositoryConsumerPaths(
        repositoryRoot,
        sourcePaths,
        sourceFilesByPath,
        checker,
        environment.options,
        environment.compilerHost,
        consumerTargetsByFile
    );
    const repositoryTypeFindings = collectRepositoryTauriTypeFindings(
        repositoryRoot,
        repositorySourcePaths,
        consumerTargetsByFile,
        program,
        environment
    );
    // Dependency-cruiser only reports nodes reachable from imports. Walk every
    // module file here so an unreferenced model path cannot evade the naming gate.
    const modelCasingFindings = findModelCasingFindings(files.map(({ repoPath }) => repoPath));
    // Dependency-cruiser sees resolved edges, so inspect repository declarations to close type laundering through local aliases.
    return [
        ...commonJsFindings,
        ...rootIndexes,
        ...mixedExports,
        ...modelCasingFindings,
        ...repositoryTypeFindings,
        ...symlinkFindings,
    ].sort(
        (left, right) =>
            comparePaths(left.file, right.file) ||
            (left.line ?? 0) - (right.line ?? 0) ||
            comparePaths(left.reason, right.reason)
    );
}

function depcruiseBin() {
    const localBinary = resolve(root, 'node_modules/.bin/depcruise');
    return existsSync(localBinary) ? localBinary : 'depcruise';
}

function runCruise(gate) {
    const args = ['src'];
    if (gate.config) {
        args.push('--config', resolve(root, gate.config));
    }
    args.push('--output-type', 'json', '--no-cache');

    const result = spawnSync(depcruiseBin(), args, {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
        maxBuffer: 128 * 1024 * 1024,
        shell: false,
    });
    const stdout = result.stdout ?? '';
    const jsonStart = stdout.indexOf('{');
    if (result.error || jsonStart < 0) {
        throw result.error ?? new Error(result.stderr || stdout || 'dependency-cruiser produced no JSON');
    }
    return JSON.parse(stdout.slice(jsonStart));
}

function currentRows(gate, cruise) {
    if (gate.causal) {
        return collectCausalEdges(cruise);
    }
    return sortRows((cruise.summary?.violations ?? []).filter((entry) => entry.rule?.severity === 'error'));
}

function readBaseline(gate) {
    const baselinePath = resolve(root, gate.baseline);
    return existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : [];
}

function printRows(label, rows) {
    for (const row of rows) {
        console.error(`  ${label}: ${row.from} → ${row.to} (${row.rule?.name ?? row.rule})`);
    }
}

function validateGate(name, gate, cruise) {
    const current = currentRows(gate, cruise);
    const known = readBaseline(gate);
    const { novel, stale } = compareRows({ current, known });
    if (novel.length > 0 || stale.length > 0) {
        printRows('NEW', novel);
        printRows('STALE', stale);
        return false;
    }

    const warningCount = (cruise.summary?.violations ?? []).filter((entry) => entry.rule?.severity === 'warn').length;
    const warningSuffix = warningCount > 0 ? `; ${warningCount} warning(s) remain visible` : '';
    console.log(`✔ ${name}: ${current.length} exact baseline row(s)${warningSuffix}`);
    return true;
}

function writeBaseline(name, gate, cruise) {
    const rows = currentRows(gate, cruise);
    writeFileSync(resolve(root, gate.baseline), `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`Wrote ${rows.length} ${name} baseline row(s) to ${gate.baseline}`);
}

function main() {
    const staticFindings = findStaticGuardFindings();
    if (staticFindings.length > 0) {
        for (const finding of staticFindings) {
            console.error(`${finding.file}:${finding.line}: ${finding.reason}`);
        }
        process.exit(1);
    }

    const writeIndex = process.argv.indexOf('--write-baseline');
    if (writeIndex >= 0) {
        const name = process.argv[writeIndex + 1];
        const gate = gates[name];
        if (!gate) {
            console.error(`Choose one baseline: ${Object.keys(gates).join(', ')}`);
            process.exit(1);
        }
        writeBaseline(name, gate, runCruise(gate));
        return;
    }

    let valid = true;
    for (const [name, gate] of Object.entries(gates)) {
        valid = validateGate(name, gate, runCruise(gate)) && valid;
    }
    if (!valid) {
        console.error('\nRefresh only after an intentional debt decision:');
        console.error('  node scripts/check-dependency-boundaries.mjs --write-baseline <gate>');
        process.exit(1);
    }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    main();
}
