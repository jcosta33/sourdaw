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

function scriptKindForFile(filePath) {
    const lowerFilePath = filePath.toLowerCase();
    if (lowerFilePath.endsWith('.tsx')) {
        return ts.ScriptKind.TSX;
    }
    if (lowerFilePath.endsWith('.jsx')) {
        return ts.ScriptKind.JSX;
    }
    if (lowerFilePath.endsWith('.js') || lowerFilePath.endsWith('.mjs') || lowerFilePath.endsWith('.cjs')) {
        return ts.ScriptKind.JS;
    }
    return ts.ScriptKind.TS;
}

function entityNameRoot(entityName) {
    if (ts.isIdentifier(entityName)) {
        return entityName;
    }
    if (ts.isQualifiedName(entityName)) {
        return entityNameRoot(entityName.left);
    }
    return null;
}

function isPrivateMember(member) {
    if (member.name && ts.isPrivateIdentifier(member.name)) {
        return true;
    }
    return (member.modifiers ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword
    );
}

function collectRepositoryTauriTypeFindings(sourceText, fileName) {
    const sourceFile = ts.createSourceFile(
        fileName,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        scriptKindForFile(fileName)
    );
    const vendorBindings = new Map();
    const typeDeclarations = new Map();
    const declarations = new Map();

    const addDeclaration = (declaration) => {
        if (declaration.name && ts.isIdentifier(declaration.name)) {
            declarations.set(declaration.name.text, declaration);
        }
    };

    const addTypeDeclaration = (declaration) => {
        addDeclaration(declaration);
        if (declaration.name && ts.isIdentifier(declaration.name)) {
            typeDeclarations.set(declaration.name.text, declaration);
        }
    };

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const moduleSpecifier = moduleSpecifierText(statement.moduleSpecifier);
            const vendorModule = moduleSpecifier ? tauriVendorModule(moduleSpecifier) : null;
            if (vendorModule && statement.importClause) {
                if (statement.importClause.name) {
                    vendorBindings.set(statement.importClause.name.text, {
                        moduleSpecifier: vendorModule,
                        importedName: 'default',
                    });
                }
                const namedBindings = statement.importClause.namedBindings;
                if (namedBindings && ts.isNamespaceImport(namedBindings)) {
                    vendorBindings.set(namedBindings.name.text, {
                        moduleSpecifier: vendorModule,
                        importedName: '*',
                    });
                }
                if (namedBindings && ts.isNamedImports(namedBindings)) {
                    for (const element of namedBindings.elements) {
                        vendorBindings.set(element.name.text, {
                            moduleSpecifier: vendorModule,
                            importedName: (element.propertyName ?? element.name).text,
                        });
                    }
                }
            }
        } else if (ts.isImportEqualsDeclaration(statement)) {
            const moduleReference = statement.moduleReference;
            const moduleSpecifier =
                ts.isExternalModuleReference(moduleReference) && moduleReference.expression
                    ? moduleSpecifierText(moduleReference.expression)
                    : null;
            const vendorModule = moduleSpecifier ? tauriVendorModule(moduleSpecifier) : null;
            if (vendorModule) {
                vendorBindings.set(statement.name.text, {
                    moduleSpecifier: vendorModule,
                    importedName: '*',
                });
            }
        } else if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
            addTypeDeclaration(statement);
        } else if (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) {
            addDeclaration(statement);
        } else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                addDeclaration(declaration);
            }
        }
    }

    const findings = new Map();
    const addFinding = (node, moduleSpecifier) => {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const finding = {
            file: fileName,
            line: line + 1,
            reason: `repository public type surface exposes Tauri vendor type from ${moduleSpecifier}`,
        };
        findings.set(`${finding.line}:${moduleSpecifier}`, finding);
    };

    const collectJSDocModules = (node, visit) => {
        for (const tag of ts.getJSDocTags(node)) {
            if (tag.typeExpression?.type) {
                visit(tag.typeExpression.type);
            }
        }
    };

    const collectModules = (visitSubject) => {
        const modules = new Map();
        const seenDeclarations = new Set();

        const addModule = (moduleSpecifier) => {
            const vendorModule = tauriVendorModule(moduleSpecifier);
            if (vendorModule) {
                modules.set(vendorModule, vendorModule);
            }
        };

        const vendorForEntityName = (entityName) => {
            const rootName = entityNameRoot(entityName);
            return rootName ? vendorBindings.get(rootName.text) : undefined;
        };

        const visitTypeParameters = (typeParameters) => {
            for (const typeParameter of typeParameters ?? []) {
                visit(typeParameter.constraint);
                visit(typeParameter.default);
            }
        };

        const visitSignature = (signature) => {
            visitTypeParameters(signature.typeParameters);
            for (const parameter of signature.parameters ?? []) {
                visit(parameter.type);
                collectJSDocModules(parameter, visit);
            }
            visit(signature.type);
            collectJSDocModules(signature, visit);
        };

        const visitMember = (member) => {
            if (isPrivateMember(member)) {
                return;
            }
            if (
                ts.isMethodSignature(member) ||
                ts.isMethodDeclaration(member) ||
                ts.isCallSignatureDeclaration(member) ||
                ts.isConstructSignatureDeclaration(member) ||
                ts.isIndexSignatureDeclaration(member) ||
                ts.isConstructorDeclaration(member) ||
                ts.isGetAccessorDeclaration(member) ||
                ts.isSetAccessorDeclaration(member)
            ) {
                visitSignature(member);
                return;
            }
            if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
                visit(member.type);
            }
        };

        const visitInitializer = (initializer) => {
            if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
                visitSignature(initializer);
                return;
            }
            if (
                ts.isAsExpression(initializer) ||
                ts.isTypeAssertionExpression(initializer) ||
                ts.isSatisfiesExpression(initializer)
            ) {
                visit(initializer.type);
                visitInitializer(initializer.expression);
            }
        };

        const visitDeclaration = (declaration) => {
            if (!declaration || seenDeclarations.has(declaration)) {
                return;
            }
            seenDeclarations.add(declaration);

            if (ts.isTypeAliasDeclaration(declaration)) {
                visitTypeParameters(declaration.typeParameters);
                visit(declaration.type);
                collectJSDocModules(declaration, visit);
                return;
            }
            if (ts.isInterfaceDeclaration(declaration)) {
                visitTypeParameters(declaration.typeParameters);
                for (const heritageClause of declaration.heritageClauses ?? []) {
                    for (const type of heritageClause.types) {
                        visit(type);
                    }
                }
                for (const member of declaration.members) {
                    visitMember(member);
                }
                collectJSDocModules(declaration, visit);
                return;
            }
            if (ts.isClassDeclaration(declaration)) {
                visitTypeParameters(declaration.typeParameters);
                for (const heritageClause of declaration.heritageClauses ?? []) {
                    for (const type of heritageClause.types) {
                        visit(type);
                    }
                }
                for (const member of declaration.members) {
                    visitMember(member);
                }
                collectJSDocModules(declaration, visit);
                return;
            }
            if (ts.isFunctionDeclaration(declaration)) {
                visitSignature(declaration);
                return;
            }
            if (ts.isVariableDeclaration(declaration)) {
                visit(declaration.type);
                collectJSDocModules(declaration, visit);
                visitInitializer(declaration.initializer);
            }
        };

        const visit = (node) => {
            if (!node) {
                return;
            }
            if (ts.isImportTypeNode(node)) {
                const moduleSpecifier = moduleSpecifierText(node.argument.literal);
                if (moduleSpecifier) {
                    addModule(moduleSpecifier);
                }
            }
            if (ts.isTypeReferenceNode(node)) {
                const vendorBinding = vendorForEntityName(node.typeName);
                if (vendorBinding) {
                    addModule(vendorBinding.moduleSpecifier);
                }
                const rootName = entityNameRoot(node.typeName);
                const declaration = rootName ? typeDeclarations.get(rootName.text) : undefined;
                visitDeclaration(declaration);
            }
            if (ts.isTypeQueryNode(node)) {
                const vendorBinding = vendorForEntityName(node.exprName);
                if (vendorBinding) {
                    addModule(vendorBinding.moduleSpecifier);
                }
            }
            ts.forEachChild(node, visit);
        };

        visitDeclaration(visitSubject);
        return modules.values();
    };

    const addDeclarationFindings = (reportNode, declaration) => {
        for (const moduleSpecifier of collectModules(declaration)) {
            addFinding(reportNode, moduleSpecifier);
        }
    };

    const hasExportModifier = (node) =>
        (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

    for (const statement of sourceFile.statements) {
        if (ts.isExportDeclaration(statement)) {
            const moduleSpecifier = moduleSpecifierText(statement.moduleSpecifier);
            const vendorModule = moduleSpecifier ? tauriVendorModule(moduleSpecifier) : null;
            if (vendorModule) {
                addFinding(statement, vendorModule);
                continue;
            }
            if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
                continue;
            }
            for (const specifier of statement.exportClause.elements) {
                const localName = (specifier.propertyName ?? specifier.name).text;
                const vendorBinding = vendorBindings.get(localName);
                if (vendorBinding) {
                    addFinding(specifier, vendorBinding.moduleSpecifier);
                }
                addDeclarationFindings(specifier, declarations.get(localName));
            }
            continue;
        }

        if (!hasExportModifier(statement)) {
            continue;
        }
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                addDeclarationFindings(statement, declaration);
            }
        } else {
            addDeclarationFindings(statement, statement);
        }
    }

    return findings.values();
}

function isModuleRootRepositorySource(filePath) {
    return moduleRootRepositoryPath.test(filePath) && sourceFilePath.test(filePath);
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
    const repositoryTypeFindings = files
        .filter(({ repoPath }) => isModuleRootRepositorySource(repoPath))
        .flatMap(({ absolutePath, repoPath }) => [
            ...collectRepositoryTauriTypeFindings(readFileSync(absolutePath, 'utf8'), repoPath),
        ]);
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
