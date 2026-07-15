#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

function isIdentifierNamed(node, name) {
    return ts.isIdentifier(node) && node.text === name;
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
            ts.isTypeAliasDeclaration(node)) &&
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

function isTypeScriptLibraryFile(fileName) {
    return /(?:\/typescript\/lib\/|\/lib\.[^/]+\.d\.ts$)/.test(toPosixPath(fileName));
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

function propertyNameText(name) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return null;
}

function isModuleExportsObject(node) {
    if (isIdentifierNamed(node, 'exports')) {
        return true;
    }
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
        return false;
    }
    const objectName = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
    return isIdentifierNamed(node.expression, 'module') && propertyNameText(objectName) === 'exports';
}

function commonJsExportName(left) {
    if (!ts.isPropertyAccessExpression(left) && !ts.isElementAccessExpression(left)) {
        return null;
    }
    if (!isModuleExportsObject(left.expression)) {
        return null;
    }
    const name = ts.isPropertyAccessExpression(left) ? left.name : left.argumentExpression;
    return propertyNameText(name);
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

function parseRepositorySourceFile(filePath) {
    return ts.createSourceFile(
        filePath,
        readFileSync(filePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.getScriptKindFromFileName(filePath)
    );
}

function collectConsumerTargets(sourceFile, resolveModuleSpecifier) {
    const targets = [];
    const addTarget = (moduleSpecifier, exportedName, all = false) => {
        const targetFile = moduleSpecifier ? resolveModuleSpecifier(moduleSpecifier, sourceFile.fileName) : null;
        if (targetFile) {
            targets.push({ all, exportedName, targetFile });
        }
    };
    const visit = (node) => {
        if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, 'require') && node.arguments.length === 1) {
            const moduleSpecifier = moduleSpecifierText(node.arguments[0]);
            const parent = node.parent;
            if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
                addTarget(moduleSpecifier, parent.name.text);
            } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
                const name = propertyNameText(parent.argumentExpression);
                addTarget(moduleSpecifier, name ?? '*', !name);
            } else if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
                if (ts.isObjectBindingPattern(parent.name)) {
                    for (const element of parent.name.elements) {
                        if (ts.isBindingElement(element)) {
                            const name = propertyNameText(element.propertyName ?? element.name);
                            addTarget(moduleSpecifier, name ?? '*', !name);
                        }
                    }
                } else {
                    addTarget(moduleSpecifier, '*', true);
                }
            } else {
                addTarget(moduleSpecifier, '*', true);
            }
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

function findRepositoryConsumerPaths(repositoryRoot, sourcePaths, options, compilerHost, targetsByFile) {
    const resolveModuleSpecifier = (moduleSpecifier, containingFile) =>
        resolveRepositoryModuleSpecifier(moduleSpecifier, containingFile, options, compilerHost);
    return sourcePaths.filter((filePath) => {
        if (isRepositorySourceFile(repositoryRoot, filePath)) {
            return false;
        }
        const sourceFile = parseRepositorySourceFile(filePath);
        const targets = collectConsumerTargets(sourceFile, resolveModuleSpecifier);
        const consumesRepository = targets.some(({ targetFile }) => isRepositorySourceFile(repositoryRoot, targetFile));
        if (consumesRepository) {
            targetsByFile.set(normalizeFileName(filePath), targets);
        }
        return consumesRepository;
    });
}

function collectRepositoryTauriTypeFindings(repositoryRoot, repositorySourcePaths, consumerTargetsByFile, environment) {
    const { checker, program } = createRepositoryTypeProgram(
        [...repositorySourcePaths, ...consumerTargetsByFile.keys()],
        environment
    );
    const programSourceFiles = new Map(
        program.getSourceFiles().map((sourceFile) => [normalizeFileName(sourceFile.fileName), sourceFile])
    );
    const sourceFiles = repositorySourcePaths
        .map((filePath) => programSourceFiles.get(normalizeFileName(filePath)))
        .filter(Boolean);
    const options = environment.options;
    const moduleResolutionHost = environment.compilerHost;
    const directVendorFiles = new Set();
    const vendorModulesByFile = new Map();
    const vendorBindingsByFile = new Map();
    const declarationsByFile = new Map();
    const recordsByFile = new Map();

    const addToSetMap = (map, key, value) => {
        if (!value) {
            return;
        }
        const values = map.get(key) ?? new Set();
        values.add(value);
        map.set(key, values);
    };

    const addBinding = (sourceFileName, bindingName, moduleSpecifier) => {
        if (!bindingName || !moduleSpecifier) {
            return;
        }
        addToSetMap(vendorBindingsByFile, `${normalizeFileName(sourceFileName)}:${bindingName}`, moduleSpecifier);
    };

    const resolveModuleSpecifier = (moduleSpecifier, containingFile) =>
        resolveRepositoryModuleSpecifier(moduleSpecifier, containingFile, options, moduleResolutionHost);

    const registerVendorModule = (moduleSpecifier, containingFile) => {
        const vendorModule = tauriVendorModule(moduleSpecifier);
        if (!vendorModule) {
            return null;
        }
        directVendorFiles.add(normalizeFileName(containingFile));
        const resolvedFile = resolveModuleSpecifier(moduleSpecifier, containingFile);
        if (resolvedFile) {
            addToSetMap(vendorModulesByFile, resolvedFile, vendorModule);
        }
        return vendorModule;
    };

    const collectSyntaxVendorModules = (node, sourceFile, seenNodes = new Set()) => {
        const modules = new Set();
        const sourceFileName = sourceFile.fileName;
        const addSyntaxModule = (moduleSpecifier) => {
            const vendorModule = registerVendorModule(moduleSpecifier, sourceFileName);
            if (vendorModule) {
                modules.add(vendorModule);
            }
        };
        const visit = (current) => {
            if (!current || seenNodes.has(current)) {
                return;
            }
            seenNodes.add(current);

            if (ts.isImportTypeNode(current)) {
                const moduleSpecifier = moduleSpecifierText(current.argument.literal);
                if (moduleSpecifier) {
                    addSyntaxModule(moduleSpecifier);
                }
            }
            if (ts.isTypeReferenceNode(current)) {
                const rootName = entityNameRoot(current.typeName);
                if (rootName) {
                    for (const moduleSpecifier of vendorBindingsByFile.get(
                        `${normalizeFileName(sourceFileName)}:${rootName.text}`
                    ) ?? []) {
                        modules.add(moduleSpecifier);
                    }
                    const localDeclaration = declarationsByFile
                        .get(normalizeFileName(sourceFileName))
                        ?.get(rootName.text);
                    if (localDeclaration) {
                        for (const moduleSpecifier of collectSyntaxVendorModules(
                            localDeclaration,
                            sourceFile,
                            seenNodes
                        )) {
                            modules.add(moduleSpecifier);
                        }
                    }
                }
            }
            if (ts.isIdentifier(current)) {
                for (const moduleSpecifier of vendorBindingsByFile.get(
                    `${normalizeFileName(sourceFileName)}:${current.text}`
                ) ?? []) {
                    modules.add(moduleSpecifier);
                }
            }
            if (
                ts.isCallExpression(current) &&
                isIdentifierNamed(current.expression, 'require') &&
                current.arguments.length === 1
            ) {
                const moduleSpecifier = moduleSpecifierText(current.arguments[0]);
                if (moduleSpecifier) {
                    addSyntaxModule(moduleSpecifier);
                }
            }
            for (const tag of ts.getJSDocTags(current)) {
                if (tag.typeExpression?.type) {
                    for (const moduleSpecifier of collectSyntaxVendorModules(
                        tag.typeExpression.type,
                        sourceFile,
                        seenNodes
                    )) {
                        modules.add(moduleSpecifier);
                    }
                }
            }
            if (ts.isFunctionLike(current)) {
                for (const typeParameter of current.typeParameters ?? []) {
                    visit(typeParameter);
                }
                for (const parameter of current.parameters ?? []) {
                    visit(parameter);
                }
                visit(current.type);
                return;
            }
            if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
                for (const typeParameter of current.typeParameters ?? []) {
                    visit(typeParameter);
                }
                for (const heritageClause of current.heritageClauses ?? []) {
                    visit(heritageClause);
                }
                for (const member of current.members) {
                    if (!isPrivateMember(member)) {
                        visit(member);
                    }
                }
                return;
            }
            ts.forEachChild(current, visit);
        };
        visit(node);
        return modules;
    };

    const scanVendorMetadata = (sourceFile) => {
        const sourceFileName = sourceFile.fileName;
        const visit = (node) => {
            for (const tag of ts.getJSDocTags(node)) {
                if (tag.typeExpression?.type) {
                    collectSyntaxVendorModules(tag.typeExpression.type, sourceFile);
                }
            }
            if (ts.isImportDeclaration(node)) {
                const moduleSpecifier = moduleSpecifierText(node.moduleSpecifier);
                const vendorModule = moduleSpecifier ? registerVendorModule(moduleSpecifier, sourceFileName) : null;
                if (vendorModule && node.importClause) {
                    if (node.importClause.name) {
                        addBinding(sourceFileName, node.importClause.name.text, vendorModule);
                    }
                    const namedBindings = node.importClause.namedBindings;
                    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
                        addBinding(sourceFileName, namedBindings.name.text, vendorModule);
                    }
                    if (namedBindings && ts.isNamedImports(namedBindings)) {
                        for (const element of namedBindings.elements) {
                            addBinding(sourceFileName, element.name.text, vendorModule);
                        }
                    }
                }
            } else if (ts.isImportEqualsDeclaration(node)) {
                const moduleReference = node.moduleReference;
                const moduleSpecifier =
                    ts.isExternalModuleReference(moduleReference) && moduleReference.expression
                        ? moduleSpecifierText(moduleReference.expression)
                        : null;
                const vendorModule = moduleSpecifier ? registerVendorModule(moduleSpecifier, sourceFileName) : null;
                if (vendorModule) {
                    addBinding(sourceFileName, node.name.text, vendorModule);
                }
            } else if (ts.isExportDeclaration(node)) {
                const moduleSpecifier = moduleSpecifierText(node.moduleSpecifier);
                if (moduleSpecifier) {
                    registerVendorModule(moduleSpecifier, sourceFileName);
                }
            } else if (ts.isImportTypeNode(node)) {
                const moduleSpecifier = moduleSpecifierText(node.argument.literal);
                if (moduleSpecifier) {
                    registerVendorModule(moduleSpecifier, sourceFileName);
                }
            } else if (
                ts.isCallExpression(node) &&
                isIdentifierNamed(node.expression, 'require') &&
                node.arguments.length === 1
            ) {
                const moduleSpecifier = moduleSpecifierText(node.arguments[0]);
                if (moduleSpecifier) {
                    registerVendorModule(moduleSpecifier, sourceFileName);
                }
            }

            if (ts.isVariableDeclaration(node)) {
                const moduleSpecifiers = collectSyntaxVendorModules(node, sourceFile);
                for (const identifier of bindingIdentifiers(node.name)) {
                    for (const moduleSpecifier of moduleSpecifiers) {
                        addBinding(sourceFileName, identifier.text, moduleSpecifier);
                    }
                }
            }

            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    };

    for (const sourceFile of sourceFiles) {
        scanVendorMetadata(sourceFile);
    }

    const repositoryDependencies = new Map();
    for (const sourceFile of sourceFiles) {
        const dependencies = new Set();
        for (const moduleReference of sourceFile.imports ?? []) {
            const targetFile = resolveModuleSpecifier(moduleReference.text, sourceFile.fileName);
            if (targetFile && isRepositorySourceFile(repositoryRoot, targetFile)) {
                dependencies.add(normalizeFileName(targetFile));
            }
        }
        repositoryDependencies.set(normalizeFileName(sourceFile.fileName), dependencies);
    }
    const vendorRelevantFiles = new Set(directVendorFiles);
    let expandedRelevantFiles = true;
    while (expandedRelevantFiles) {
        expandedRelevantFiles = false;
        for (const [sourceFileName, dependencies] of repositoryDependencies) {
            if (
                !vendorRelevantFiles.has(sourceFileName) &&
                [...dependencies].some((dependency) => vendorRelevantFiles.has(dependency))
            ) {
                vendorRelevantFiles.add(sourceFileName);
                expandedRelevantFiles = true;
            }
        }
    }

    const vendorModulesForFile = (fileName) => {
        const normalizedFileName = normalizeFileName(fileName);
        const modules = new Set(vendorModulesByFile.get(normalizedFileName) ?? []);
        const relativePath = repositoryRelativePath(repositoryRoot, normalizedFileName);
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
    };

    const addRecord = (sourceFile, record) => {
        const fileName = normalizeFileName(sourceFile.fileName);
        const records = recordsByFile.get(fileName) ?? [];
        records.push({ ...record, fileName, sourceFile });
        recordsByFile.set(fileName, records);
    };

    const addDeclarationRecord = (sourceFile, statement, declaration, exportedName) => {
        addRecord(sourceFile, {
            diagnosticNode: statement,
            exportedName,
            symbolNode: declaration.name ?? declaration,
            valueNode: declaration,
        });
    };

    const collectExportRecords = (sourceFile) => {
        const declarations = new Map();
        for (const statement of sourceFile.statements) {
            if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) {
                    for (const identifier of bindingIdentifiers(declaration.name)) {
                        declarations.set(identifier.text, declaration);
                    }
                }
                continue;
            }
            if (isNamedDeclaration(statement)) {
                declarations.set(statement.name.text, statement);
            }
        }
        declarationsByFile.set(normalizeFileName(sourceFile.fileName), declarations);

        for (const statement of sourceFile.statements) {
            if (ts.isExportDeclaration(statement)) {
                const moduleSpecifier = moduleSpecifierText(statement.moduleSpecifier);
                const targetFile = moduleSpecifier
                    ? resolveModuleSpecifier(moduleSpecifier, sourceFile.fileName)
                    : null;
                if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                    for (const specifier of statement.exportClause.elements) {
                        const localName = (specifier.propertyName ?? specifier.name).text;
                        addRecord(sourceFile, {
                            diagnosticNode: statement,
                            exportedName: specifier.name.text,
                            moduleSpecifier: moduleSpecifier && tauriVendorModule(moduleSpecifier),
                            symbolNode: specifier.name,
                            targetFile,
                            targetName: moduleSpecifier ? localName : null,
                            valueNode: moduleSpecifier ? specifier : (declarations.get(localName) ?? specifier),
                        });
                    }
                } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
                    addRecord(sourceFile, {
                        diagnosticNode: statement,
                        exportedName: statement.exportClause.name.text,
                        moduleSpecifier: moduleSpecifier && tauriVendorModule(moduleSpecifier),
                        symbolNode: statement.exportClause.name,
                        targetFile,
                        targetName: '*',
                        valueNode: statement.exportClause,
                    });
                } else if (moduleSpecifier) {
                    addRecord(sourceFile, {
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
                addRecord(sourceFile, {
                    diagnosticNode: statement,
                    exportedName: statement.isExportEquals ? 'export=' : 'default',
                    symbolNode: statement.expression,
                    valueNode: statement.expression,
                });
                continue;
            }

            if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
                continue;
            }
            const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
            if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) {
                    for (const identifier of bindingIdentifiers(declaration.name)) {
                        addDeclarationRecord(
                            sourceFile,
                            statement,
                            declaration,
                            isDefault ? 'default' : identifier.text
                        );
                    }
                }
            } else if (isNamedDeclaration(statement)) {
                addDeclarationRecord(sourceFile, statement, statement, isDefault ? 'default' : statement.name.text);
            }
        }

        const visitCommonJs = (node) => {
            if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
                ts.forEachChild(node, visitCommonJs);
                return;
            }
            const propertyName = commonJsExportName(node.left);
            const isWholeModuleAssignment =
                ts.isPropertyAccessExpression(node.left) &&
                isIdentifierNamed(node.left.expression, 'module') &&
                isIdentifierNamed(node.left.name, 'exports');
            if (!propertyName && !isWholeModuleAssignment) {
                ts.forEachChild(node, visitCommonJs);
                return;
            }

            const statement = node.parent && ts.isExpressionStatement(node.parent) ? node.parent : node;
            if (isWholeModuleAssignment) {
                addRecord(sourceFile, {
                    diagnosticNode: statement,
                    exportedName: 'default',
                    isCommonJs: true,
                    symbolNode: node.right,
                    valueNode: node.right,
                });
                if (ts.isObjectLiteralExpression(node.right)) {
                    for (const property of node.right.properties) {
                        if (ts.isPropertyAssignment(property)) {
                            const exportedName = propertyNameText(property.name);
                            if (exportedName) {
                                addRecord(sourceFile, {
                                    diagnosticNode: statement,
                                    exportedName,
                                    isCommonJs: true,
                                    symbolNode: property.initializer,
                                    valueNode: property.initializer,
                                });
                            }
                        } else if (ts.isShorthandPropertyAssignment(property)) {
                            addRecord(sourceFile, {
                                diagnosticNode: statement,
                                exportedName: property.name.text,
                                isCommonJs: true,
                                symbolNode: property.name,
                                valueNode: property.name,
                            });
                        }
                    }
                }
            } else {
                addRecord(sourceFile, {
                    diagnosticNode: statement,
                    exportedName: propertyName,
                    isCommonJs: true,
                    symbolNode: node.right,
                    valueNode: node.right,
                });
            }
            ts.forEachChild(node, visitCommonJs);
        };
        visitCommonJs(sourceFile);
    };

    for (const sourceFile of sourceFiles) {
        if (isRepositorySourceFile(repositoryRoot, sourceFile.fileName)) {
            collectExportRecords(sourceFile);
        }
    }

    const moduleExportSymbols = (fileName) => {
        const sourceFile = programSourceFiles.get(normalizeFileName(fileName));
        if (!sourceFile?.symbol) {
            return [];
        }
        try {
            return checker.getExportsOfModule(sourceFile.symbol);
        } catch {
            return [];
        }
    };

    const recordsForName = (fileName, exportedName) =>
        (recordsByFile.get(normalizeFileName(fileName)) ?? []).filter((record) => record.exportedName === exportedName);

    const addStarProxyRecords = () => {
        for (const records of recordsByFile.values()) {
            for (const record of records.filter((candidate) => candidate.isStarExport && candidate.targetFile)) {
                const targetRecords = recordsByFile.get(record.targetFile) ?? [];
                const targetNames = new Set(
                    targetRecords
                        .map((targetRecord) => targetRecord.exportedName)
                        .filter((name) => name && name !== '*' && name !== 'default')
                );
                for (const symbol of moduleExportSymbols(record.targetFile)) {
                    if (symbol.name !== 'default') {
                        targetNames.add(symbol.name);
                    }
                }
                for (const targetName of targetNames) {
                    const proxy = {
                        ...record,
                        exportedName: targetName,
                        targetName,
                        targetRecord: recordsForName(record.targetFile, targetName)[0] ?? {
                            fileName: record.targetFile,
                            sourceFile: programSourceFiles.get(record.targetFile),
                            exportedName: targetName,
                            symbol: moduleExportSymbols(record.targetFile).find((symbol) => symbol.name === targetName),
                        },
                    };
                    records.push(proxy);
                }
            }
        }
    };
    addStarProxyRecords();

    const symbolForRecord = (record, seenRecords = new Set()) => {
        if (!record || seenRecords.has(record)) {
            return null;
        }
        seenRecords.add(record);
        if (record.symbol) {
            return record.symbol;
        }
        if (record.targetRecord) {
            const targetSymbol = symbolForRecord(record.targetRecord, seenRecords);
            if (targetSymbol) {
                return targetSymbol;
            }
        }
        if (record.targetFile && record.targetName && record.targetName !== '*') {
            const targetSymbol = moduleExportSymbols(record.targetFile).find(
                (symbol) => symbol.name === record.targetName
            );
            if (targetSymbol) {
                return targetSymbol;
            }
        }
        const sourceFile = programSourceFiles.get(record.fileName);
        if (sourceFile?.symbol && record.exportedName !== '*' && record.exportedName !== 'export=') {
            const moduleSymbol = moduleExportSymbols(record.fileName).find(
                (symbol) => symbol.name === record.exportedName
            );
            if (moduleSymbol) {
                return moduleSymbol;
            }
        }
        if (record.symbolNode) {
            try {
                return checker.getSymbolAtLocation(record.symbolNode) ?? null;
            } catch {
                return null;
            }
        }
        return null;
    };

    const symbolDeclarationsModule = (symbol, sourceFileName) => {
        const modules = new Set();
        for (const declaration of symbol?.declarations ?? []) {
            for (const moduleSpecifier of collectSyntaxVendorModules(
                declaration,
                declaration.getSourceFile() ?? programSourceFiles.get(sourceFileName)
            )) {
                modules.add(moduleSpecifier);
            }
            for (const moduleSpecifier of vendorModulesForFile(declaration.getSourceFile().fileName)) {
                modules.add(moduleSpecifier);
            }
        }
        return modules;
    };

    function collectTypeSafely(getType, location, modules, seenTypes, seenSymbols) {
        try {
            collectVendorModulesFromType(getType(), location, modules, seenTypes, seenSymbols);
        } catch {
            // An unresolved declaration must not abort the boundary scan.
        }
    }

    const collectVendorModulesFromSymbol = (symbol, sourceFileName, modules, seenSymbols, seenTypes) => {
        if (!symbol || seenSymbols.has(symbol)) {
            return;
        }
        seenSymbols.add(symbol);
        if (symbol.flags & ts.SymbolFlags.Alias) {
            try {
                const aliasedSymbol = checker.getAliasedSymbol(symbol);
                collectVendorModulesFromSymbol(aliasedSymbol, sourceFileName, modules, seenSymbols, seenTypes);
            } catch {
                // Unresolved aliases are covered by the syntax metadata fallback.
            }
        }
        const symbolSourceFile = symbol.declarations?.[0]?.getSourceFile?.();
        if (isTypeScriptLibraryFile(symbolSourceFile?.fileName ?? '')) {
            return;
        }
        for (const moduleSpecifier of symbolDeclarationsModule(symbol, sourceFileName)) {
            modules.add(moduleSpecifier);
        }
        const location = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? programSourceFiles.get(sourceFileName);
        if (!location) {
            return;
        }
        collectTypeSafely(
            () => checker.getTypeOfSymbolAtLocation(symbol, location),
            location,
            modules,
            seenTypes,
            seenSymbols
        );
        if (
            symbol.flags &
            (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.TypeParameter)
        ) {
            collectTypeSafely(() => checker.getDeclaredTypeOfSymbol(symbol), location, modules, seenTypes, seenSymbols);
        }
    };

    const collectVendorModulesFromType = (type, location, modules, seenTypes, seenSymbols) => {
        if (!type || seenTypes.has(type)) {
            return;
        }
        seenTypes.add(type);
        const typeSourceFile = type.symbol?.declarations?.[0]?.getSourceFile?.();
        const isLibraryType = isTypeScriptLibraryFile(typeSourceFile?.fileName ?? '');
        const isExternalType = isExternalDeclarationFile(typeSourceFile?.fileName ?? '');
        collectVendorModulesFromSymbol(type.symbol, location.getSourceFile().fileName, modules, seenSymbols, seenTypes);
        collectVendorModulesFromSymbol(
            type.aliasSymbol,
            location.getSourceFile().fileName,
            modules,
            seenSymbols,
            seenTypes
        );
        for (const nestedType of [
            ...(type.types ?? []),
            ...(type.typeArguments ?? []),
            ...(type.aliasTypeArguments ?? []),
            type.constraint,
            type.default,
        ].filter(Boolean)) {
            collectVendorModulesFromType(nestedType, location, modules, seenTypes, seenSymbols);
        }
        for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
            for (const parameter of signature.parameters) {
                const parameterLocation = parameter.valueDeclaration ?? location;
                collectTypeSafely(
                    () => checker.getTypeOfSymbolAtLocation(parameter, parameterLocation),
                    parameterLocation,
                    modules,
                    seenTypes,
                    seenSymbols
                );
            }
            collectVendorModulesFromType(signature.getReturnType(), location, modules, seenTypes, seenSymbols);
            for (const typeParameter of signature.typeParameters ?? []) {
                collectVendorModulesFromSymbol(
                    typeParameter,
                    location.getSourceFile().fileName,
                    modules,
                    seenSymbols,
                    seenTypes
                );
            }
        }
        if (!isLibraryType && !isExternalType) {
            for (const property of type.getProperties?.() ?? []) {
                const propertyLocation = property.valueDeclaration ?? property.declarations?.[0] ?? location;
                if (isPrivateMember(propertyLocation)) {
                    continue;
                }
                collectTypeSafely(
                    () => checker.getTypeOfSymbolAtLocation(property, propertyLocation),
                    propertyLocation,
                    modules,
                    seenTypes,
                    seenSymbols
                );
            }
        }
        if (
            !isLibraryType &&
            !isExternalType &&
            type.symbol?.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)
        ) {
            try {
                const baseTypes = checker.getBaseTypes(type) ?? [];
                for (const baseType of baseTypes) {
                    collectVendorModulesFromType(baseType, location, modules, seenTypes, seenSymbols);
                }
            } catch {
                // Not every class-like type has a base-type query.
            }
        }
    };

    const collectRecordVendorModules = (record, seenRecords = new Set()) => {
        if (!record || seenRecords.has(record)) {
            return new Set();
        }
        seenRecords.add(record);
        const modules = new Set(record.moduleSpecifier ? [record.moduleSpecifier] : []);
        const symbol = symbolForRecord(record);
        const seenSymbols = new Set();
        const seenTypes = new Set();
        if (symbol) {
            collectVendorModulesFromSymbol(symbol, record.fileName, modules, seenSymbols, seenTypes);
        }
        for (const node of [record.valueNode, record.symbolNode]) {
            if (!node) {
                continue;
            }
            if (!symbol || record.isCommonJs || ts.isExportAssignment(record.diagnosticNode)) {
                collectTypeSafely(() => checker.getTypeAtLocation(node), node, modules, seenTypes, seenSymbols);
            }
            for (const moduleSpecifier of collectSyntaxVendorModules(
                node,
                node.getSourceFile?.() ?? record.sourceFile
            )) {
                modules.add(moduleSpecifier);
            }
        }
        if (record.targetRecord) {
            for (const moduleSpecifier of collectRecordVendorModules(record.targetRecord, seenRecords)) {
                modules.add(moduleSpecifier);
            }
        }
        if (record.targetFile && record.targetName && record.targetName !== '*') {
            for (const targetRecord of recordsForName(record.targetFile, record.targetName)) {
                for (const moduleSpecifier of collectRecordVendorModules(targetRecord, seenRecords)) {
                    modules.add(moduleSpecifier);
                }
            }
            if (programSourceFiles.has(record.targetFile)) {
                for (const symbol of moduleExportSymbols(record.targetFile).filter(
                    (candidate) => candidate.name === record.targetName
                )) {
                    collectVendorModulesFromSymbol(symbol, record.targetFile, modules, seenSymbols, seenTypes);
                }
            }
        }
        return modules;
    };

    const recordsForExport = (fileName, exportedName, all = false) => {
        const records = recordsByFile.get(normalizeFileName(fileName)) ?? [];
        if (all) {
            return records;
        }
        const exact = records.filter((record) => record.exportedName === exportedName);
        if (exact.length > 0) {
            return exact;
        }
        return records.filter((record) => record.exportedName === '*');
    };

    const crossingRecords = new Set();
    const markConsumerTarget = (targetFile, exportedName, all = false) => {
        if (!targetFile || !isRepositorySourceFile(repositoryRoot, targetFile)) {
            return;
        }
        if (!vendorRelevantFiles.has(normalizeFileName(targetFile))) {
            return;
        }
        for (const record of recordsForExport(targetFile, exportedName, all)) {
            crossingRecords.add(record);
        }
    };

    for (const targets of consumerTargetsByFile.values()) {
        for (const { all, exportedName, targetFile } of targets) {
            if (isRepositorySourceFile(repositoryRoot, targetFile)) {
                markConsumerTarget(targetFile, exportedName, all);
            }
        }
    }

    const findings = new Map();
    for (const record of crossingRecords) {
        for (const moduleSpecifier of collectRecordVendorModules(record)) {
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
    return findings.values();
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

export function findStaticGuardFindings(repositoryRoot = root) {
    const symlinkPaths = [];
    const files = walkFiles(resolve(repositoryRoot, 'src/modules'), symlinkPaths).map((absolutePath) => ({
        absolutePath,
        repoPath: toPosixPath(relative(repositoryRoot, absolutePath)),
    }));
    const symlinkFindings = symlinkPaths.map((absolutePath) => ({
        file: toPosixPath(relative(repositoryRoot, absolutePath)),
        line: 1,
        reason: 'symbolic links are not permitted under src/modules',
    }));
    const rootIndexes = files
        .map(({ repoPath }) => repoPath)
        .filter(isModuleRootIndex)
        .map((file) => ({ file, line: 1, reason: 'module-root index entry is retired' }));
    const mixedExports = files
        .filter(({ repoPath }) => isUseCaseBarrel(repoPath))
        .flatMap(({ absolutePath, repoPath }) =>
            findMixedTypeValueExports(readFileSync(absolutePath, 'utf8'), repoPath).map((finding) => ({
                ...finding,
                reason: 'split mixed value/type exports so type-edge rules can inspect the type export',
            }))
        );
    const sourcePaths = walkFiles(resolve(repositoryRoot, 'src')).filter((absolutePath) =>
        sourceFilePath.test(toPosixPath(relative(repositoryRoot, absolutePath)))
    );
    const environment = createRepositoryTypeEnvironment(repositoryRoot);
    const repositorySourcePaths = sourcePaths.filter((filePath) => isRepositorySourceFile(repositoryRoot, filePath));
    const consumerTargetsByFile = new Map();
    findRepositoryConsumerPaths(
        repositoryRoot,
        sourcePaths,
        environment.options,
        environment.compilerHost,
        consumerTargetsByFile
    );
    const repositoryTypeFindings = collectRepositoryTauriTypeFindings(
        repositoryRoot,
        repositorySourcePaths,
        consumerTargetsByFile,
        environment
    );
    // Dependency-cruiser only reports nodes reachable from imports. Walk every
    // module file here so an unreferenced model path cannot evade the naming gate.
    const modelCasingFindings = findModelCasingFindings(files.map(({ repoPath }) => repoPath));
    // Dependency-cruiser sees resolved edges, so inspect repository declarations to close type laundering through local aliases.
    return [
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
