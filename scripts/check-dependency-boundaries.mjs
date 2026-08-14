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
const unsupportedCommonJsSurfaceReason = 'unsupported CommonJS public-surface mutation cannot be statically inspected';

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

function bindingPropertyNameText(name) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return null;
}

function staticExpressionName(checker, expression) {
    if (!expression) {
        return null;
    }
    if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) {
        return expression.text;
    }
    try {
        const type = checker.getTypeAtLocation(expression);
        if (type.flags & ts.TypeFlags.StringLiteral) {
            return type.value;
        }
        if (type.flags & ts.TypeFlags.NumberLiteral) {
            return String(type.value);
        }
    } catch {
        return null;
    }
    return null;
}

function staticPropertyName(context, name) {
    if (!name) {
        return null;
    }
    if (ts.isComputedPropertyName(name)) {
        return staticExpressionName(context.checker, name.expression);
    }
    return bindingPropertyNameText(name);
}

function bindingElementPropertyName(context, element) {
    if (element.propertyName) {
        return staticPropertyName(context, element.propertyName);
    }
    return ts.isIdentifier(element.name) ? element.name.text : null;
}

function staticMemberName(checker, node) {
    if (ts.isPropertyAccessExpression(node)) {
        return node.name.text;
    }
    if (ts.isElementAccessExpression(node)) {
        return staticExpressionName(checker, node.argumentExpression);
    }
    return null;
}

function symbolAtLocation(context, identifier) {
    try {
        return context.checker.getSymbolAtLocation(identifier) ?? null;
    } catch {
        return null;
    }
}

function hasLocalDeclaration(context, sourceFile, identifier) {
    const symbol = symbolAtLocation(context, identifier);
    if (!symbol) {
        return true;
    }
    return (symbol.declarations ?? []).some(
        (declaration) => declaration.getSourceFile() === sourceFile && ts.isDeclaration(declaration)
    );
}

function isUnshadowedIdentifier(context, sourceFile, node, name) {
    return isIdentifierNamed(node, name) && !hasLocalDeclaration(context, sourceFile, node);
}

function unwrapCommonJsExpression(expression) {
    let current = expression;
    while (
        current &&
        (ts.isParenthesizedExpression(current) ||
            ts.isAsExpression(current) ||
            ts.isTypeAssertionExpression(current) ||
            ts.isSatisfiesExpression(current) ||
            ts.isNonNullExpression(current))
    ) {
        current = current.expression;
    }
    return current;
}

function createCommonJsFlow() {
    const initialExportsObject = {};
    const moduleObject = {};
    const objectAssignIdentity = {};
    const objectIdentity = {};
    const requireIdentity = {};
    const staticMembersByIdentity = new Map([[initialExportsObject, new Map()]]);
    return {
        aliases: new Map(),
        currentModuleExports: initialExportsObject,
        exportsBinding: initialExportsObject,
        inexactStaticMemberIdentities: new Set(),
        lexicalBindings: new Map(),
        lexicalScopes: [new Set()],
        moduleBinding: moduleObject,
        moduleObject,
        moduleRequireBinding: requireIdentity,
        nodeIdentities: new Map(),
        objectAssignBinding: objectAssignIdentity,
        objectAssignIdentity,
        objectBinding: objectIdentity,
        objectIdentity,
        requireBinding: requireIdentity,
        requireIdentity,
        staticMembersByIdentity,
        symbolIdentities: new Map(),
    };
}

function cloneCommonJsFlow(flow) {
    return {
        ...flow,
        aliases: new Map(flow.aliases),
        inexactStaticMemberIdentities: new Set(flow.inexactStaticMemberIdentities),
        lexicalBindings: new Map([...flow.lexicalBindings].map(([name, identities]) => [name, [...identities]])),
        lexicalScopes: flow.lexicalScopes.map((scope) => new Set(scope)),
        nodeIdentities: new Map(flow.nodeIdentities),
        staticMembersByIdentity: new Map(
            [...flow.staticMembersByIdentity].map(([identity, members]) => [identity, new Map(members)])
        ),
        symbolIdentities: new Map(flow.symbolIdentities),
    };
}

function createCommonJsIdentity(flow, node = null) {
    if (node && flow.nodeIdentities.has(node)) {
        return flow.nodeIdentities.get(node);
    }
    const identity = {};
    if (node) {
        flow.nodeIdentities.set(node, identity);
    }
    return identity;
}

function commonJsResult(flow, node, identity = createCommonJsIdentity(flow, node)) {
    return { identity, valueNode: node };
}

function commonJsSymbolIdentity(flow, symbol, node) {
    if (flow.aliases.has(symbol)) {
        return flow.aliases.get(symbol);
    }
    if (!flow.symbolIdentities.has(symbol)) {
        flow.symbolIdentities.set(symbol, createCommonJsIdentity(flow, node));
    }
    return flow.symbolIdentities.get(symbol);
}

function commonJsValueSymbol(context, node) {
    if (ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)) {
        try {
            return context.checker.getShorthandAssignmentValueSymbol(node.parent) ?? symbolAtLocation(context, node);
        } catch {
            // Malformed JavaScript can leave a shorthand without a resolvable value symbol.
        }
    }
    return symbolAtLocation(context, node);
}

function commonJsLexicalBinding(flow, name) {
    const bindings = flow.lexicalBindings.get(name);
    return bindings?.length ? { identity: bindings.at(-1), name } : null;
}

function isCommonJsRuntimeName(name) {
    return name === 'exports' || name === 'module' || name === 'require';
}

function bindCommonJsLexical(flow, name, identity) {
    const scope = flow.lexicalScopes.at(-1);
    const bindings = flow.lexicalBindings.get(name) ?? [];
    if (scope.has(name)) {
        bindings[bindings.length - 1] = identity;
    } else {
        scope.add(name);
        bindings.push(identity);
    }
    flow.lexicalBindings.set(name, bindings);
}

function popCommonJsLexicalScope(flow) {
    for (const name of flow.lexicalScopes.pop()) {
        const bindings = flow.lexicalBindings.get(name);
        bindings.pop();
        if (bindings.length === 0) {
            flow.lexicalBindings.delete(name);
        }
    }
}

function commonJsIdentifierResult(context, sourceFile, flow, node) {
    const lexicalBinding = commonJsLexicalBinding(flow, node.text);
    if (lexicalBinding) {
        return commonJsResult(flow, node, lexicalBinding.identity);
    }
    const symbol = commonJsValueSymbol(context, node);
    if (symbol && flow.aliases.has(symbol)) {
        return commonJsResult(flow, node, flow.aliases.get(symbol));
    }
    if (isUnshadowedIdentifier(context, sourceFile, node, 'Object')) {
        return commonJsResult(flow, node, flow.objectBinding);
    }
    if (isUnshadowedIdentifier(context, sourceFile, node, 'module')) {
        return commonJsResult(flow, node, flow.moduleBinding);
    }
    if (isUnshadowedIdentifier(context, sourceFile, node, 'exports')) {
        return commonJsResult(flow, node, flow.exportsBinding);
    }
    if (isUnshadowedIdentifier(context, sourceFile, node, 'require')) {
        return commonJsResult(flow, node, flow.requireBinding);
    }
    return commonJsResult(flow, node, symbol ? commonJsSymbolIdentity(flow, symbol, node) : undefined);
}

function certainStaticMemberResult(flow, owner, memberName, node) {
    if (owner.identity === flow.moduleObject) {
        if (memberName === 'exports') {
            return commonJsResult(flow, node, flow.currentModuleExports);
        }
        if (memberName === 'require') {
            return commonJsResult(flow, node, flow.moduleRequireBinding);
        }
    }
    if (owner.identity === flow.objectIdentity && memberName === 'assign') {
        return commonJsResult(flow, node, flow.objectAssignBinding);
    }
    const member = memberName ? flow.staticMembersByIdentity.get(owner.identity)?.get(memberName) : null;
    return member ?? commonJsResult(flow, node);
}

function recordCertainStaticMember(flow, ownerIdentity, memberName, result) {
    let members = flow.staticMembersByIdentity.get(ownerIdentity);
    if (!members) {
        members = new Map();
        flow.staticMembersByIdentity.set(ownerIdentity, members);
        flow.inexactStaticMemberIdentities.add(ownerIdentity);
    }
    members.set(memberName, result);
}

function invalidateCertainStaticMembers(flow, ownerIdentity) {
    flow.staticMembersByIdentity.get(ownerIdentity)?.clear();
    flow.inexactStaticMemberIdentities.add(ownerIdentity);
}

function computedPropertyExpression(name) {
    return name && ts.isComputedPropertyName(name) ? name.expression : null;
}

function bindCertainValue(context, sourceFile, flow, name, result, effects, statement) {
    if (ts.isIdentifier(name)) {
        if (isCommonJsRuntimeName(name.text)) {
            bindCommonJsLexical(flow, name.text, result.identity);
        }
        const symbol = symbolAtLocation(context, name);
        if (symbol) {
            flow.aliases.set(symbol, result.identity);
        }
        return;
    }

    if (ts.isObjectBindingPattern(name)) {
        for (const element of name.elements) {
            const computedExpression = computedPropertyExpression(element.propertyName);
            if (computedExpression) {
                evaluateCertainExpression(context, sourceFile, flow, computedExpression, effects, statement);
            }
            const memberName = element.dotDotDotToken ? null : bindingElementPropertyName(context, element);
            const memberResult = memberName
                ? certainStaticMemberResult(flow, result, memberName, element)
                : commonJsResult(flow, element);
            bindCertainValue(context, sourceFile, flow, element.name, memberResult, effects, statement);
        }
        return;
    }

    if (ts.isArrayBindingPattern(name)) {
        for (let index = 0; index < name.elements.length; index += 1) {
            const element = name.elements[index];
            if (!ts.isBindingElement(element)) {
                continue;
            }
            const memberResult = element.dotDotDotToken
                ? commonJsResult(flow, element)
                : certainStaticMemberResult(flow, result, String(index), element);
            bindCertainValue(context, sourceFile, flow, element.name, memberResult, effects, statement);
        }
    }
}

function certainAssignmentTarget(context, sourceFile, flow, left, effects, statement) {
    const node = unwrapCommonJsExpression(left);
    if (ts.isIdentifier(node)) {
        const lexicalBinding = commonJsLexicalBinding(flow, node.text);
        if (lexicalBinding) {
            return { kind: 'lexical', lexicalBinding };
        }
        const symbol = commonJsValueSymbol(context, node);
        if (symbol && flow.aliases.has(symbol)) {
            return { identifier: node, kind: 'alias', symbol };
        }
        if (isUnshadowedIdentifier(context, sourceFile, node, 'Object')) {
            return { kind: 'objectBinding' };
        }
        if (isUnshadowedIdentifier(context, sourceFile, node, 'module')) {
            return { kind: 'moduleBinding' };
        }
        if (isUnshadowedIdentifier(context, sourceFile, node, 'exports')) {
            return { kind: 'exportsBinding' };
        }
        if (isUnshadowedIdentifier(context, sourceFile, node, 'require')) {
            return { kind: 'requireBinding' };
        }
        return symbol && hasLocalDeclaration(context, sourceFile, node)
            ? { identifier: node, kind: 'alias', symbol }
            : null;
    }
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
        return null;
    }
    const owner = evaluateCertainExpression(context, sourceFile, flow, node.expression, effects, statement);
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        evaluateCertainExpression(context, sourceFile, flow, node.argumentExpression, effects, statement);
    }
    const memberName = staticMemberName(context.checker, node);
    if (owner.identity === flow.objectIdentity && memberName === 'assign') {
        return { kind: 'objectAssign' };
    }
    if (owner.identity === flow.moduleObject && memberName === 'exports') {
        return { kind: 'moduleExports' };
    }
    if (owner.identity === flow.moduleObject && memberName === 'require') {
        return { kind: 'moduleRequire' };
    }
    return { kind: 'property', memberName, ownerIdentity: owner.identity };
}

function applyCertainAssignment(flow, target, result, effects, statement) {
    if (!target) {
        return;
    }
    if (target.kind === 'moduleBinding') {
        flow.moduleBinding = result.identity;
        return;
    }
    if (target.kind === 'objectBinding') {
        flow.objectBinding = result.identity;
        return;
    }
    if (target.kind === 'objectAssign') {
        flow.objectAssignBinding = result.identity;
        return;
    }
    if (target.kind === 'exportsBinding') {
        flow.exportsBinding = result.identity;
        return;
    }
    if (target.kind === 'requireBinding') {
        flow.requireBinding = result.identity;
        return;
    }
    if (target.kind === 'alias') {
        flow.aliases.set(target.symbol, result.identity);
        effects.onBindingAssignment?.({ binding: target.identifier, result, statement });
        return;
    }
    if (target.kind === 'lexical') {
        const bindings = flow.lexicalBindings.get(target.lexicalBinding.name);
        bindings[bindings.length - 1] = result.identity;
        return;
    }
    if (target.kind === 'moduleExports') {
        flow.currentModuleExports = result.identity;
        effects.onModuleExportsAssignment?.({ result, statement });
        return;
    }
    if (target.kind === 'moduleRequire') {
        flow.moduleRequireBinding = result.identity;
        return;
    }
    if (target.kind !== 'property') {
        return;
    }
    if (target.ownerIdentity === flow.currentModuleExports) {
        if (target.memberName) {
            effects.onExportPropertyAssignment?.({ exportedName: target.memberName, result, statement });
        } else {
            effects.onUnsupportedExportMutation?.({ statement });
        }
    }
    if (target.memberName) {
        recordCertainStaticMember(flow, target.ownerIdentity, target.memberName, result);
        return;
    }
    invalidateCertainStaticMembers(flow, target.ownerIdentity);
    if (target.ownerIdentity === flow.moduleObject) {
        flow.moduleRequireBinding = createCommonJsIdentity(flow);
    }
    if (target.ownerIdentity === flow.objectIdentity) {
        flow.objectAssignBinding = createCommonJsIdentity(flow);
    }
}

function applyCertainAssignmentPattern(context, sourceFile, flow, pattern, result, effects, statement) {
    const node = unwrapCommonJsExpression(pattern);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        applyCertainAssignmentPattern(context, sourceFile, flow, node.left, result, effects, statement);
        return;
    }
    if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
            if (ts.isSpreadAssignment(property)) {
                applyCertainAssignmentPattern(
                    context,
                    sourceFile,
                    flow,
                    property.expression,
                    commonJsResult(flow, property),
                    effects,
                    statement
                );
                continue;
            }
            const computedExpression = computedPropertyExpression(property.name);
            if (computedExpression) {
                evaluateCertainExpression(context, sourceFile, flow, computedExpression, effects, statement);
            }
            const memberName = staticPropertyName(context, property.name);
            const memberResult = memberName
                ? certainStaticMemberResult(flow, result, memberName, property)
                : commonJsResult(flow, property);
            if (ts.isShorthandPropertyAssignment(property)) {
                applyCertainAssignmentPattern(
                    context,
                    sourceFile,
                    flow,
                    property.name,
                    memberResult,
                    effects,
                    statement
                );
            } else if (ts.isPropertyAssignment(property)) {
                applyCertainAssignmentPattern(
                    context,
                    sourceFile,
                    flow,
                    property.initializer,
                    memberResult,
                    effects,
                    statement
                );
            }
        }
        return;
    }
    if (ts.isArrayLiteralExpression(node)) {
        for (let index = 0; index < node.elements.length; index += 1) {
            const element = node.elements[index];
            if (ts.isOmittedExpression(element)) {
                continue;
            }
            const memberResult = ts.isSpreadElement(element)
                ? commonJsResult(flow, element)
                : certainStaticMemberResult(flow, result, String(index), element);
            applyCertainAssignmentPattern(
                context,
                sourceFile,
                flow,
                ts.isSpreadElement(element) ? element.expression : element,
                memberResult,
                effects,
                statement
            );
        }
        return;
    }
    const target = certainAssignmentTarget(context, sourceFile, flow, node, effects, statement);
    applyCertainAssignment(flow, target, result, effects, statement);
}

function applyCertainObjectAssign(flow, target, sources) {
    if (!target) {
        return;
    }
    const targetIdentity = target.identity;
    for (const source of sources) {
        const members = flow.staticMembersByIdentity.get(source.identity);
        const sourceIsInexact = !members || flow.inexactStaticMemberIdentities.has(source.identity);

        if (targetIdentity === flow.moduleObject) {
            if (members?.has('require')) {
                flow.moduleRequireBinding = members.get('require').identity;
            } else if (sourceIsInexact) {
                flow.moduleRequireBinding = createCommonJsIdentity(flow);
            }
        }
        if (targetIdentity === flow.objectIdentity) {
            if (members?.has('assign')) {
                flow.objectAssignBinding = members.get('assign').identity;
            } else if (sourceIsInexact) {
                flow.objectAssignBinding = createCommonJsIdentity(flow);
            }
        }

        let targetMembers = flow.staticMembersByIdentity.get(targetIdentity);
        if (!targetMembers) {
            targetMembers = new Map();
            flow.staticMembersByIdentity.set(targetIdentity, targetMembers);
            flow.inexactStaticMemberIdentities.add(targetIdentity);
        }
        if (sourceIsInexact) {
            targetMembers.clear();
            flow.inexactStaticMemberIdentities.add(targetIdentity);
        }
        for (const [memberName, memberResult] of members ?? []) {
            targetMembers.set(memberName, memberResult);
        }
    }
}

function isCertainIifeStatement(statement) {
    return (
        ts.isBlock(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isDoStatement(statement) ||
        ts.isEmptyStatement(statement) ||
        ts.isExpressionStatement(statement) ||
        ts.isForInStatement(statement) ||
        ts.isForOfStatement(statement) ||
        ts.isForStatement(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isIfStatement(statement) ||
        ts.isReturnStatement(statement) ||
        ts.isSwitchStatement(statement) ||
        ts.isThrowStatement(statement) ||
        ts.isTryStatement(statement) ||
        ts.isWhileStatement(statement) ||
        ts.isVariableStatement(statement)
    );
}

function directCertainIife(node) {
    const callee = unwrapCommonJsExpression(node.expression);
    if (
        node.questionDotToken ||
        (!ts.isArrowFunction(callee) && !ts.isFunctionExpression(callee)) ||
        callee.asteriskToken ||
        hasModifier(callee, ts.SyntaxKind.AsyncKeyword) ||
        (ts.isBlock(callee.body) && !callee.body.statements.every(isCertainIifeStatement))
    ) {
        return null;
    }
    return callee;
}

function evaluateCertainObjectLiteral(context, sourceFile, flow, node, effects, statement) {
    const result = commonJsResult(flow, node);
    const members = new Map();
    let inexact = false;
    for (const property of node.properties) {
        if (property.name && ts.isComputedPropertyName(property.name)) {
            evaluateCertainExpression(context, sourceFile, flow, property.name.expression, effects, statement);
        }
        const memberName = property.name ? staticPropertyName(context, property.name) : null;
        if (ts.isPropertyAssignment(property)) {
            const memberResult = evaluateCertainExpression(
                context,
                sourceFile,
                flow,
                property.initializer,
                effects,
                statement
            );
            if (memberName) {
                members.set(memberName, memberResult);
            } else {
                members.clear();
                inexact = true;
            }
        } else if (ts.isShorthandPropertyAssignment(property)) {
            const memberResult = evaluateCertainExpression(
                context,
                sourceFile,
                flow,
                property.name,
                effects,
                statement
            );
            members.set(property.name.text, memberResult);
        } else if (ts.isSpreadAssignment(property)) {
            const spreadResult = evaluateCertainExpression(
                context,
                sourceFile,
                flow,
                property.expression,
                effects,
                statement
            );
            const spreadMembers = flow.staticMembersByIdentity.get(spreadResult.identity);
            if (!spreadMembers || flow.inexactStaticMemberIdentities.has(spreadResult.identity)) {
                members.clear();
                inexact = true;
            }
            for (const [spreadMemberName, spreadMemberResult] of spreadMembers ?? []) {
                members.set(spreadMemberName, spreadMemberResult);
            }
        } else if (memberName) {
            members.set(memberName, commonJsResult(flow, property));
        } else if (property.name) {
            members.clear();
            inexact = true;
        }
    }
    flow.staticMembersByIdentity.set(result.identity, members);
    if (inexact) {
        flow.inexactStaticMemberIdentities.add(result.identity);
    }
    return result;
}

function evaluateCertainArrayLiteral(context, sourceFile, flow, node, effects, statement) {
    const result = commonJsResult(flow, node);
    const members = new Map();
    let inexact = false;
    for (let index = 0; index < node.elements.length; index += 1) {
        const element = node.elements[index];
        if (ts.isOmittedExpression(element)) {
            continue;
        }
        if (ts.isSpreadElement(element)) {
            evaluateCertainExpression(context, sourceFile, flow, element.expression, effects, statement);
            members.clear();
            inexact = true;
            continue;
        }
        const memberResult = evaluateCertainExpression(context, sourceFile, flow, element, effects, statement);
        if (!inexact) {
            members.set(String(index), memberResult);
        }
    }
    flow.staticMembersByIdentity.set(result.identity, members);
    if (inexact) {
        flow.inexactStaticMemberIdentities.add(result.identity);
    }
    return result;
}

function evaluateCertainCall(context, sourceFile, flow, node, effects, statement) {
    const iife = directCertainIife(node);
    const calleeResult = evaluateCertainExpression(context, sourceFile, flow, node.expression, effects, statement);
    const argumentResults = node.arguments.map((argument) =>
        evaluateCertainExpression(context, sourceFile, flow, argument, effects, statement)
    );

    if (iife) {
        flow.lexicalScopes.push(new Set());
        try {
            for (let index = 0; index < iife.parameters.length; index += 1) {
                const parameter = iife.parameters[index];
                const argumentResult = parameter.dotDotDotToken ? null : argumentResults[index];
                const parameterResult =
                    argumentResult ??
                    (parameter.initializer
                        ? evaluateCertainExpression(
                              context,
                              sourceFile,
                              flow,
                              parameter.initializer,
                              effects,
                              statement
                          )
                        : commonJsResult(flow, parameter));
                bindCertainValue(context, sourceFile, flow, parameter.name, parameterResult, effects, statement);
            }
            if (!ts.isBlock(iife.body)) {
                return evaluateCertainExpression(context, sourceFile, flow, iife.body, effects, statement);
            }
            const completion = executeCertainStatements(context, sourceFile, flow, iife.body.statements, effects);
            return completion?.result ?? commonJsResult(flow, node);
        } finally {
            popCommonJsLexicalScope(flow);
        }
    }

    const result = commonJsResult(flow, node);
    if (!node.questionDotToken && calleeResult.identity === flow.requireIdentity) {
        effects.onRequireCall?.({ call: node, result, statement });
    }
    if (!node.questionDotToken && node.arguments.length >= 2 && calleeResult.identity === flow.objectAssignIdentity) {
        effects.onObjectAssign?.({ argumentResults, call: node, statement });
        applyCertainObjectAssign(flow, argumentResults[0], argumentResults.slice(1));
        return argumentResults[0] ?? result;
    }
    return result;
}

function isLogicalAssignmentOperator(kind) {
    return (
        kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
        kind === ts.SyntaxKind.BarBarEqualsToken ||
        kind === ts.SyntaxKind.QuestionQuestionEqualsToken
    );
}

function isLiveCommonJsExportTarget(flow, target) {
    return (
        target?.kind === 'moduleExports' ||
        (target?.kind === 'property' && target.ownerIdentity === flow.currentModuleExports)
    );
}

function evaluateCertainExpression(context, sourceFile, flow, expression, effects, statement) {
    const node = unwrapCommonJsExpression(expression);
    if (!node) {
        return commonJsResult(flow, expression);
    }
    if (ts.isIdentifier(node)) {
        return commonJsIdentifierResult(context, sourceFile, flow, node);
    }
    if (ts.isBinaryExpression(node)) {
        if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const assignmentPattern = unwrapCommonJsExpression(node.left);
            if (ts.isObjectLiteralExpression(assignmentPattern) || ts.isArrayLiteralExpression(assignmentPattern)) {
                const result = evaluateCertainExpression(context, sourceFile, flow, node.right, effects, statement);
                applyCertainAssignmentPattern(context, sourceFile, flow, assignmentPattern, result, effects, statement);
                return result;
            }
            const target = certainAssignmentTarget(context, sourceFile, flow, assignmentPattern, effects, statement);
            const result = evaluateCertainExpression(context, sourceFile, flow, node.right, effects, statement);
            applyCertainAssignment(flow, target, result, effects, statement);
            return result;
        }
        if (isLogicalAssignmentOperator(node.operatorToken.kind)) {
            const target = certainAssignmentTarget(context, sourceFile, flow, node.left, effects, statement);
            evaluateCertainExpression(context, sourceFile, flow, node.right, effects, statement);
            if (isLiveCommonJsExportTarget(flow, target)) {
                effects.onUnsupportedExportMutation?.({ statement });
            }
            return commonJsResult(flow, node);
        }
        evaluateCertainExpression(context, sourceFile, flow, node.left, effects, statement);
        if (
            node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        ) {
            return commonJsResult(flow, node);
        }
        const right = evaluateCertainExpression(context, sourceFile, flow, node.right, effects, statement);
        return node.operatorToken.kind === ts.SyntaxKind.CommaToken ? right : commonJsResult(flow, node);
    }
    if (ts.isCallExpression(node)) {
        return evaluateCertainCall(context, sourceFile, flow, node, effects, statement);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const owner = evaluateCertainExpression(context, sourceFile, flow, node.expression, effects, statement);
        if (ts.isElementAccessExpression(node) && node.argumentExpression) {
            evaluateCertainExpression(context, sourceFile, flow, node.argumentExpression, effects, statement);
        }
        const memberName = staticMemberName(context.checker, node);
        return certainStaticMemberResult(flow, owner, memberName, node);
    }
    if (ts.isObjectLiteralExpression(node)) {
        return evaluateCertainObjectLiteral(context, sourceFile, flow, node, effects, statement);
    }
    if (ts.isArrayLiteralExpression(node)) {
        return evaluateCertainArrayLiteral(context, sourceFile, flow, node, effects, statement);
    }
    if (ts.isConditionalExpression(node)) {
        evaluateCertainExpression(context, sourceFile, flow, node.condition, effects, statement);
        return commonJsResult(flow, node);
    }
    if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) {
            evaluateCertainExpression(context, sourceFile, flow, span.expression, effects, statement);
        }
        return commonJsResult(flow, node);
    }
    if (ts.isNewExpression(node)) {
        evaluateCertainExpression(context, sourceFile, flow, node.expression, effects, statement);
        for (const argument of node.arguments ?? []) {
            evaluateCertainExpression(context, sourceFile, flow, argument, effects, statement);
        }
        return commonJsResult(flow, node);
    }
    if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
        evaluateCertainExpression(context, sourceFile, flow, node.operand, effects, statement);
        return commonJsResult(flow, node);
    }
    if (
        ts.isAwaitExpression(node) ||
        ts.isDeleteExpression(node) ||
        ts.isTypeOfExpression(node) ||
        ts.isVoidExpression(node) ||
        ts.isSpreadElement(node)
    ) {
        evaluateCertainExpression(context, sourceFile, flow, node.expression, effects, statement);
    }
    return commonJsResult(flow, node);
}

function isUnsupportedCommonJsControlStatement(statement) {
    return (
        ts.isDoStatement(statement) ||
        ts.isForInStatement(statement) ||
        ts.isForOfStatement(statement) ||
        ts.isForStatement(statement) ||
        ts.isIfStatement(statement) ||
        ts.isSwitchStatement(statement) ||
        ts.isTryStatement(statement) ||
        ts.isWhileStatement(statement)
    );
}

function staticControlValue(expression) {
    const node = unwrapCommonJsExpression(expression);
    if (node.kind === ts.SyntaxKind.TrueKeyword) {
        return { known: true, value: true };
    }
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
        return { known: true, value: false };
    }
    if (node.kind === ts.SyntaxKind.NullKeyword) {
        return { known: true, value: null };
    }
    if (ts.isStringLiteralLike(node)) {
        return { known: true, value: node.text };
    }
    if (ts.isNumericLiteral(node)) {
        return { known: true, value: Number(node.text) };
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
        const operand = staticControlValue(node.operand);
        return operand.known ? { known: true, value: !operand.value } : { known: false };
    }
    return { known: false };
}

function staticControlBoolean(expression) {
    const result = staticControlValue(expression);
    return result.known ? Boolean(result.value) : null;
}

// Probe possible control subtrees independently; speculative state never rejoins
// the certain top-level CommonJS flow.
function possibleCommonJsSubtreeMutation(context, sourceFile, outerFlow, rootStatement) {
    const tracker = { mutated: false };
    const markMutation = () => {
        tracker.mutated = true;
    };
    const mutationEffects = (flow) => ({
        onExportPropertyAssignment: markMutation,
        onModuleExportsAssignment: markMutation,
        onObjectAssign: ({ argumentResults }) => {
            const target = argumentResults[0];
            const sources = argumentResults.slice(1);
            const sourceMayContain = (memberName = null) =>
                sources.some((source) => {
                    const members = flow.staticMembersByIdentity.get(source.identity);
                    return (
                        !members ||
                        flow.inexactStaticMemberIdentities.has(source.identity) ||
                        (memberName ? members.has(memberName) : members.size > 0)
                    );
                });
            if (
                (target?.identity === flow.currentModuleExports && sourceMayContain()) ||
                (target?.identity === flow.moduleObject && sourceMayContain('exports'))
            ) {
                markMutation();
            }
        },
        onUnsupportedControlFlowMutation: markMutation,
        onUnsupportedExportMutation: markMutation,
    });
    const evaluate = (flow, expression, statement) =>
        evaluateCertainExpression(context, sourceFile, flow, expression, mutationEffects(flow), statement);

    function bindLoopInitializer(flow, initializer, statement) {
        const effects = mutationEffects(flow);
        const fallback = commonJsResult(flow, statement.expression ?? statement);
        if (ts.isVariableDeclarationList(initializer)) {
            for (const declaration of initializer.declarations) {
                const value = declaration.initializer ? evaluate(flow, declaration.initializer, statement) : fallback;
                bindCertainValue(context, sourceFile, flow, declaration.name, value, effects, statement);
            }
            return;
        }
        applyCertainAssignmentPattern(context, sourceFile, flow, initializer, fallback, effects, statement);
    }

    function scanStatements(flow, statements) {
        for (const statement of statements) {
            const completion = scanStatement(flow, statement);
            if (tracker.mutated) {
                return null;
            }
            if (completion) {
                return completion;
            }
        }
        return null;
    }

    function scanStatement(flow, statement) {
        if (ts.isBlock(statement)) {
            flow.lexicalScopes.push(new Set());
            try {
                return scanStatements(flow, statement.statements);
            } finally {
                popCommonJsLexicalScope(flow);
            }
        }
        if (ts.isIfStatement(statement)) {
            evaluate(flow, statement.expression, statement);
            if (tracker.mutated) {
                return;
            }
            const condition = staticControlBoolean(statement.expression);
            if (condition !== null) {
                const branch = condition ? statement.thenStatement : statement.elseStatement;
                return branch ? scanStatement(flow, branch) : null;
            }
            scanStatement(cloneCommonJsFlow(flow), statement.thenStatement);
            if (!tracker.mutated && statement.elseStatement) {
                scanStatement(cloneCommonJsFlow(flow), statement.elseStatement);
            }
            return null;
        }
        if (ts.isSwitchStatement(statement)) {
            evaluate(flow, statement.expression, statement);
            if (tracker.mutated) {
                return null;
            }
            const clauses = [...statement.caseBlock.clauses];
            const discriminant = staticControlValue(statement.expression);
            const casesAreStatic = clauses.every(
                (clause) => ts.isDefaultClause(clause) || staticControlValue(clause.expression).known
            );
            let startIndexes = clauses.map((_, index) => index);
            let deterministic = false;
            if (discriminant.known && casesAreStatic) {
                const match = clauses.findIndex(
                    (clause) =>
                        ts.isCaseClause(clause) && staticControlValue(clause.expression).value === discriminant.value
                );
                const start = match >= 0 ? match : clauses.findIndex(ts.isDefaultClause);
                startIndexes = start >= 0 ? [start] : [];
                deterministic = true;
            }
            for (const startIndex of startIndexes) {
                const branchFlow = cloneCommonJsFlow(flow);
                let completion = null;
                for (let clauseIndex = startIndex; clauseIndex < clauses.length; clauseIndex += 1) {
                    const clause = clauses[clauseIndex];
                    if (ts.isCaseClause(clause)) {
                        evaluate(branchFlow, clause.expression, statement);
                    }
                    completion = scanStatements(branchFlow, clause.statements);
                    if (tracker.mutated || completion) {
                        break;
                    }
                }
                if (tracker.mutated) {
                    return null;
                }
                if (completion?.kind === 'break' && !completion.label) {
                    completion = null;
                }
                if (deterministic && completion) {
                    return completion;
                }
            }
            return null;
        }
        if (
            ts.isDoStatement(statement) ||
            ts.isForInStatement(statement) ||
            ts.isForOfStatement(statement) ||
            ts.isForStatement(statement) ||
            ts.isWhileStatement(statement)
        ) {
            if (ts.isForStatement(statement) && statement.initializer) {
                if (ts.isVariableDeclarationList(statement.initializer)) {
                    bindLoopInitializer(flow, statement.initializer, statement);
                } else {
                    evaluate(flow, statement.initializer, statement);
                }
            }
            if (ts.isForInStatement(statement) || ts.isForOfStatement(statement)) {
                evaluate(flow, statement.expression, statement);
            }
            const condition =
                (ts.isForStatement(statement) && statement.condition) ||
                (ts.isWhileStatement(statement) && statement.expression) ||
                null;
            if (condition) {
                evaluate(flow, condition, statement);
                if (staticControlBoolean(condition) === false) {
                    return;
                }
            }
            if (tracker.mutated) {
                return;
            }
            const iterationFlow = cloneCommonJsFlow(flow);
            if (ts.isForInStatement(statement) || ts.isForOfStatement(statement)) {
                bindLoopInitializer(iterationFlow, statement.initializer, statement);
            }
            scanStatement(iterationFlow, statement.statement);
            const tailFlow = cloneCommonJsFlow(flow);
            if (!tracker.mutated && ts.isForStatement(statement) && statement.incrementor) {
                evaluate(tailFlow, statement.incrementor, statement);
            }
            if (!tracker.mutated && ts.isDoStatement(statement)) {
                evaluate(tailFlow, statement.expression, statement);
            }
            return null;
        }
        if (ts.isTryStatement(statement)) {
            scanStatement(cloneCommonJsFlow(flow), statement.tryBlock);
            if (tracker.mutated) {
                return;
            }
            if (statement.catchClause) {
                const catchFlow = cloneCommonJsFlow(flow);
                catchFlow.lexicalScopes.push(new Set());
                if (statement.catchClause.variableDeclaration) {
                    bindCertainValue(
                        context,
                        sourceFile,
                        catchFlow,
                        statement.catchClause.variableDeclaration.name,
                        commonJsResult(catchFlow, statement.catchClause.variableDeclaration),
                        mutationEffects(catchFlow),
                        statement
                    );
                }
                scanStatements(catchFlow, statement.catchClause.block.statements);
                popCommonJsLexicalScope(catchFlow);
            }
            if (statement.finallyBlock && !tracker.mutated) {
                scanStatement(cloneCommonJsFlow(flow), statement.finallyBlock);
            }
            return null;
        }
        if (ts.isBreakStatement(statement)) {
            return { kind: 'break', label: statement.label?.text ?? null };
        }
        if (ts.isContinueStatement(statement)) {
            return { kind: 'continue', label: statement.label?.text ?? null };
        }
        return executeCertainStatement(context, sourceFile, flow, statement, mutationEffects(flow));
    }

    scanStatement(cloneCommonJsFlow(outerFlow), rootStatement);
    return tracker.mutated;
}

function executeCertainStatement(context, sourceFile, flow, statement, effects) {
    if (isUnsupportedCommonJsControlStatement(statement)) {
        if (
            effects.onUnsupportedControlFlowMutation &&
            possibleCommonJsSubtreeMutation(context, sourceFile, flow, statement)
        ) {
            effects.onUnsupportedControlFlowMutation({ statement });
        }
        return null;
    }
    if (ts.isBlock(statement)) {
        flow.lexicalScopes.push(new Set());
        try {
            return executeCertainStatements(context, sourceFile, flow, statement.statements, effects);
        } finally {
            popCommonJsLexicalScope(flow);
        }
    }
    if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
            const result = declaration.initializer
                ? evaluateCertainExpression(context, sourceFile, flow, declaration.initializer, effects, statement)
                : commonJsResult(flow, declaration);
            bindCertainValue(context, sourceFile, flow, declaration.name, result, effects, statement);
        }
        return null;
    }
    if (ts.isExpressionStatement(statement)) {
        evaluateCertainExpression(context, sourceFile, flow, statement.expression, effects, statement);
        return null;
    }
    if (ts.isExportAssignment(statement)) {
        evaluateCertainExpression(context, sourceFile, flow, statement.expression, effects, statement);
        return null;
    }
    if (ts.isReturnStatement(statement)) {
        const result = statement.expression
            ? evaluateCertainExpression(context, sourceFile, flow, statement.expression, effects, statement)
            : commonJsResult(flow, statement);
        return { kind: 'return', result };
    }
    if (ts.isThrowStatement(statement)) {
        evaluateCertainExpression(context, sourceFile, flow, statement.expression, effects, statement);
        return { kind: 'throw' };
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
        bindCertainValue(
            context,
            sourceFile,
            flow,
            statement.name,
            commonJsResult(flow, statement),
            effects,
            statement
        );
    }
    return null;
}

// Unsupported control flow is inspected only for possible public CommonJS mutations;
// stored, indirect, async, and generator function bodies remain inert.
function executeCertainStatements(context, sourceFile, flow, statements, effects = {}) {
    for (const statement of statements) {
        const completion = executeCertainStatement(context, sourceFile, flow, statement, effects);
        if (completion) {
            return completion;
        }
    }
    return null;
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
    const addRequireTarget = (node) => {
        if (node.arguments.length !== 1) {
            return;
        }
        const moduleSpecifier = moduleSpecifierText(node.arguments[0]);
        const parent = node.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
            addTarget(moduleSpecifier, parent.name.text);
        } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
            const name = staticExpressionName(checker, parent.argumentExpression);
            addTarget(moduleSpecifier, name ?? '*', !name);
        } else if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
            if (ts.isObjectBindingPattern(parent.name)) {
                for (const element of parent.name.elements) {
                    if (element.dotDotDotToken) {
                        addTarget(moduleSpecifier, '*', true);
                        continue;
                    }
                    const name = bindingElementPropertyName(context, element);
                    addTarget(moduleSpecifier, name ?? '*', !name);
                }
            } else {
                addTarget(moduleSpecifier, '*', true);
            }
        } else {
            addTarget(moduleSpecifier, '*', true);
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
    executeCertainStatements(context, sourceFile, createCommonJsFlow(), sourceFile.statements, {
        onRequireCall: ({ call }) => addRequireTarget(call),
    });
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
        unsupportedCommonJsFindings: new Map(),
        vendorBindingsBySymbol: new Map(),
        vendorModulesByRequireCall: new Map(),
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
        if (ts.isCallExpression(current)) {
            for (const moduleSpecifier of context.vendorModulesByRequireCall.get(current) ?? []) {
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
        executeCertainStatements(context, sourceFile, createCommonJsFlow(), sourceFile.statements, {
            onRequireCall: ({ call }) => {
                if (call.arguments.length !== 1) {
                    return;
                }
                const moduleSpecifier = moduleSpecifierText(call.arguments[0]);
                const vendorModule = moduleSpecifier
                    ? registerVendorModule(context, moduleSpecifier, sourceFile.fileName)
                    : null;
                if (vendorModule) {
                    addToSetMap(context.vendorModulesByRequireCall, call, vendorModule);
                }
            },
        });
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

function replaceCommonJsRecords(context, sourceFile, exportedNames = null) {
    const fileName = normalizeFileName(sourceFile.fileName);
    const records = context.recordsByFile.get(fileName) ?? [];
    context.recordsByFile.set(
        fileName,
        records.filter((record) => !record.isCommonJs || exportedNames?.has(record.exportedName) === false)
    );
}

function addDeclarationRecord(context, sourceFile, statement, declaration, exportedName) {
    return addRepositoryRecord(context, sourceFile, {
        diagnosticNode: statement,
        exportedName,
        symbolNode: declaration.name ?? declaration,
        valueNode: declaration,
    });
}

function commonJsPropertyRecords(context, sourceFile, statement, valueNode) {
    let type;
    try {
        type = context.checker.getTypeAtLocation(valueNode);
        if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
            return null;
        }
        if (type.getStringIndexType?.() || type.getNumberIndexType?.()) {
            return null;
        }
    } catch {
        return null;
    }
    const properties = type.getProperties?.() ?? null;
    if (!properties) {
        return null;
    }
    return properties
        .filter((symbol) => !symbol.name.startsWith('__@'))
        .map((symbol) => {
            const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? null;
            return {
                diagnosticNode: statement,
                exportedName: symbol.name,
                isCommonJs: true,
                symbol,
                symbolNode: declaration?.name ?? declaration,
                valueNode: declaration ?? valueNode,
            };
        });
}

function enumerateCommonJsProperties(context, sourceFile, statement, valueNode) {
    const records = commonJsPropertyRecords(context, sourceFile, statement, valueNode);
    if (!records) {
        return false;
    }
    for (const record of records) {
        addRepositoryRecord(context, sourceFile, record);
    }
    return true;
}

function addUnsupportedCommonJsFinding(context, sourceFile, statement) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
    const finding = {
        file: repositoryRelativePath(context.repositoryRoot, sourceFile.fileName),
        line: line + 1,
        reason: unsupportedCommonJsSurfaceReason,
    };
    context.unsupportedCommonJsFindings.set(`${finding.file}:${finding.line}:${finding.reason}`, finding);
}

function collectCommonJsObjectAssign(context, sourceFile, statement, argumentResults, flow) {
    if (argumentResults[0]?.identity !== flow.currentModuleExports) {
        return;
    }

    const recordsByName = new Map();
    for (const source of argumentResults.slice(1)) {
        const records = commonJsPropertyRecords(context, sourceFile, statement, source.valueNode);
        if (!records) {
            addUnsupportedCommonJsFinding(context, sourceFile, statement);
            recordsByName.clear();
            continue;
        }
        for (const record of records) {
            recordsByName.set(record.exportedName, record);
        }
    }
    replaceCommonJsRecords(context, sourceFile, new Set(recordsByName.keys()));
    for (const record of recordsByName.values()) {
        addRepositoryRecord(context, sourceFile, record);
    }
}

function collectCommonJsModuleAssignment(context, sourceFile, statement, result) {
    replaceCommonJsRecords(context, sourceFile);
    addRepositoryRecord(context, sourceFile, {
        diagnosticNode: statement,
        exportedName: 'default',
        isCommonJs: true,
        symbolNode: result.valueNode,
        valueNode: result.valueNode,
    });
    enumerateCommonJsProperties(context, sourceFile, statement, result.valueNode);
}

function collectCommonJsPropertyAssignment(context, sourceFile, statement, exportedName, result) {
    replaceCommonJsRecords(context, sourceFile, new Set([exportedName]));
    addRepositoryRecord(context, sourceFile, {
        diagnosticNode: statement,
        exportedName,
        isCommonJs: true,
        symbolNode: result.valueNode,
        valueNode: result.valueNode,
    });
}

function collectExportRecords(context, sourceFile) {
    const resolveModuleSpecifier = (moduleSpecifier, containingFile) =>
        resolveRepositoryModuleSpecifier(moduleSpecifier, containingFile, context.options, context.compilerHost);
    const commonJsFlow = createCommonJsFlow();
    const commonJsEffects = {
        onExportPropertyAssignment: ({ exportedName, result, statement }) =>
            collectCommonJsPropertyAssignment(context, sourceFile, statement, exportedName, result),
        onModuleExportsAssignment: ({ result, statement }) =>
            collectCommonJsModuleAssignment(context, sourceFile, statement, result),
        onObjectAssign: ({ argumentResults, statement }) =>
            collectCommonJsObjectAssign(context, sourceFile, statement, argumentResults, commonJsFlow),
        onUnsupportedControlFlowMutation: ({ statement }) =>
            addUnsupportedCommonJsFinding(context, sourceFile, statement),
        onUnsupportedExportMutation: ({ statement }) => addUnsupportedCommonJsFinding(context, sourceFile, statement),
    };
    executeCertainStatements(context, sourceFile, commonJsFlow, sourceFile.statements, commonJsEffects);

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
    // Signatures declared by a lib or vendor type can only mention that declaration's own types and
    // the type arguments it was instantiated with, and those arguments are already walked above.
    // Descending into them anyway walks every method of types like `Uint8Array<ArrayBufferLike>`,
    // and `getTypeOfSymbolAtLocation` mints a fresh Type per parameter that `seenTypes` — keyed on
    // object identity — can never match. That is unbounded: one repository export of a project type
    // whose members are generic lib types took the pre-pass from 13s to hours and past 4 GB.
    if (!isLibraryType && !isExternalType) {
        for (const signature of [...(type.getCallSignatures?.() ?? []), ...(type.getConstructSignatures?.() ?? [])]) {
            for (const parameter of signature.parameters) {
                const parameterLocation = parameter.valueDeclaration ?? location;
                collectTypeSafely(
                    context,
                    () => context.checker.getTypeOfSymbolAtLocation(parameter, parameterLocation),
                    parameterLocation,
                    modules,
                    seenTypes,
                    seenSymbols
                );
            }
            collectVendorModulesFromType(
                context,
                signature.getReturnType(),
                location,
                modules,
                seenTypes,
                seenSymbols
            );
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
                () => context.checker.getTypeOfSymbolAtLocation(property, propertyLocation),
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
        if (!publicTypeResolved || record.isCommonJs || ts.isExportAssignment(record.diagnosticNode)) {
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
    const fallback = records.filter((record) => record.isCommonJs && record.exportedName === 'default');
    return [...records.filter((record) => record.exportedName === '*'), ...fallback];
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
    return [...context.unsupportedCommonJsFindings.values(), ...findings.values()];
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
    const allSourcePaths = walkFiles(resolve(repositoryRoot, 'src'), symlinkPaths);
    const files = allSourcePaths
        .filter((absolutePath) => /^src\/modules(?:\/|$)/.test(toPosixPath(relative(repositoryRoot, absolutePath))))
        .map((absolutePath) => ({
            absolutePath,
            repoPath: toPosixPath(relative(repositoryRoot, absolutePath)),
        }));
    const symlinkFindings = symlinkPaths
        .filter((absolutePath) => /^src\/modules(?:\/|$)/.test(toPosixPath(relative(repositoryRoot, absolutePath))))
        .map((absolutePath) => ({
            file: toPosixPath(relative(repositoryRoot, absolutePath)),
            line: 1,
            reason: 'symbolic links are not permitted under src/modules',
        }));
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
