import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

export const LAYOUT_CENSUS_SCHEMA_VERSION = 1;
export const PRODUCTION_ROOTS = ['src'] as const;
export const EXCLUDED_PATH_PATTERNS = [
    '**/__tests__/**',
    '**/__snapshots__/**',
    '**/*.spec.tsx',
    '**/*.test.tsx',
    '**/*.generated.tsx',
    '**/generated/**',
    '**/.generated/**',
    '.agents/worktrees/**',
    'node_modules/**',
    'dist/**',
    'build/**',
    'coverage/**',
    '.git/**',
] as const;

export const ALLOWED_LAYOUT_DISPOSITIONS = [
    'already-migrated',
    'eligible',
    'complex-grid',
    'renderer',
    'responsive-or-dynamic',
    'semantic-wrapper',
    'third-party-generated-test',
    'one-off',
] as const;

export const REVIEWED_LAYOUT_CENSUS_DIGEST = '547431696360e111e8ea002403fd680e1446f775d0bd3a032ddb191aac241eba';

const LEGACY_ONE_OFF_RATIONALE =
    'Native semantics, refs, handlers, positioning, overflow, child selectors, inline styles, spread attributes, or unsupported geometry require owner-specific proof.';

export type LayoutDisposition = (typeof ALLOWED_LAYOUT_DISPOSITIONS)[number];
export type LayoutRiskTier = 'low' | 'medium' | 'high';

export type LayoutRiskFlags = {
    hasRef: boolean;
    hasHandlers: boolean;
    hasSemanticElement: boolean;
    hasResponsiveClasses: boolean;
    hasDynamicClassName: boolean;
    hasConditionalChildren: boolean;
    hasPositioning: boolean;
    hasOverflow: boolean;
    hasChildSelectors: boolean;
    hasInlineStyle: boolean;
    hasSpreadAttributes: boolean;
};

export type LayoutOccurrence = {
    id: string;
    file: string;
    line: number;
    occurrence: number;
    sourceFingerprint: string;
    patternFamily: string;
    patternClass: string;
    currentPattern: string;
    proposedPrimitive: string | null;
    wrapperOwner: string | null;
    nativeElement: string | null;
    role: string | null;
    riskFlags: LayoutRiskFlags;
    riskTier: LayoutRiskTier;
    disposition: LayoutDisposition;
    rationale: string;
    reviewed: boolean;
};

export type LayoutCensusSummary = {
    occurrenceCount: number;
    dispositionCounts: Record<string, number>;
    patternFamilyCounts: Record<string, number>;
    commonPatternClassCounts: Record<string, number>;
};

export type LayoutCensus = {
    schemaVersion: number;
    productionRoots: string[];
    exclusions: string[];
    summary: LayoutCensusSummary;
    occurrences: LayoutOccurrence[];
};

export type CollectLayoutOccurrencesInput = {
    repositoryRoot: string;
    productionRoots?: readonly string[];
    previousCensus?: LayoutCensus | null;
};

export type CreateLayoutCensusInput = CollectLayoutOccurrencesInput;

export type CompareLayoutCensusesInput = {
    actual: LayoutCensus;
    expected: LayoutCensus;
};

export type LayoutCensusDrift = {
    added: LayoutOccurrence[];
    removed: LayoutOccurrence[];
    changed: Array<{ actual: LayoutOccurrence; expected: LayoutOccurrence }>;
};

type ClassNameEvidence = {
    currentPattern: string;
    allTokens: string[];
    layoutTokens: string[];
    dynamic: boolean;
    responsive: boolean;
    bindingEvidence: string[];
    unresolvedBinding: boolean;
};

type ClassBindingResolver = {
    canonicalRepositoryRoot: string;
    repositoryRoot: string;
    sourceFiles: Map<string, ts.SourceFile>;
};

type ClassBindingTarget = {
    initializer: ts.Expression;
    sourceFile: ts.SourceFile;
    key: string;
};

type LocalBindingResolution =
    { kind: 'resolved'; target: ClassBindingTarget } | { kind: 'shadowed' } | { kind: 'not-found' };

type ClassExpressionAnalysis = {
    fragments: string[];
    dynamic: boolean;
    unresolvedBinding: boolean;
    bindingEvidence: string[];
};

type ImportedLayoutTags = {
    primitiveTags: Map<string, string>;
    primitiveNamespaces: Set<string>;
    wrapperTags: Map<string, string>;
    wrapperNamespaces: Set<string>;
    tagSemantics: Map<string, string>;
    namespaceSemantics: Map<string, string>;
};

type CandidateClassification = {
    disposition: LayoutDisposition;
    rationale: string;
    riskTier: LayoutRiskTier;
};

type PendingOccurrence = Omit<LayoutOccurrence, 'line' | 'occurrence'> & {
    line: number;
    sourceStart: number;
};

const primitiveDefaults = new Map<string, string>([
    ['Row', 'div'],
    ['Stack', 'div'],
    ['Grid', 'div'],
    ['Spacer', 'div'],
    ['Divider', 'div'],
]);
const genericIntrinsicElements = new Set(['div', 'span']);
const responsivePrefix = /^(?:(?:sm|md|lg|xl|2xl|max-\[[^\]]+\]|min-\[[^\]]+\])|@[^:]+):/;
const conditionalVariantPrefix = /(?:^|:)(?:group(?:-[^:]+)?|peer(?:-[^:]+)?|state(?:-[^:]+)?|data-[^:]+|aria-[^:]+):/;
const rendererPath = /(?:^|\/)(?:[^/]*(?:Canvas|Renderer|WebGL)[^/]*|renderers?)(?:\/|\.tsx$)/i;
const thirdPartyPath = /(?:^|\/)(?:third[-_]?party|vendor)(?:\/|$)/i;

function toPosixPath(filePath: string): string {
    return filePath.replaceAll('\\', '/');
}

function compareText(left: string, right: string): number {
    return left.localeCompare(right, 'en');
}

function normalizeWhitespace(value: string): string {
    return value.replaceAll(/\s+/g, ' ').trim();
}

function intrinsicElementHasSemantics(tagName: string): boolean {
    return !genericIntrinsicElements.has(tagName);
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function reviewDigestForOccurrences(occurrences: LayoutOccurrence[]): string {
    const reviewEvidence = occurrences.map(({ reviewed: _reviewed, ...occurrence }) => occurrence);
    return createHash('sha256').update(JSON.stringify(reviewEvidence)).digest('hex');
}

function isExcludedPath(repositoryPath: string): boolean {
    const normalizedPath = toPosixPath(repositoryPath);
    const pathSegments = normalizedPath.split('/');
    const fileName = pathSegments.at(-1) ?? '';

    if (pathSegments.includes('__tests__') || pathSegments.includes('__snapshots__')) {
        return true;
    }
    if (pathSegments.includes('generated') || pathSegments.includes('.generated')) {
        return true;
    }
    if (/\.(?:spec|test)\.tsx$/i.test(fileName) || /\.generated\.tsx$/i.test(fileName)) {
        return true;
    }
    if (normalizedPath.startsWith('.agents/worktrees/')) {
        return true;
    }

    const excludedTopLevelDirectories = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
    return excludedTopLevelDirectories.has(pathSegments[0] ?? '');
}

function walkProductionFiles(repositoryRoot: string, productionRoots: readonly string[]): string[] {
    const files: string[] = [];

    function walk(absolutePath: string): void {
        if (!existsSync(absolutePath)) {
            return;
        }
        const repositoryPath = toPosixPath(relative(repositoryRoot, absolutePath));
        if (isExcludedPath(repositoryPath)) {
            return;
        }

        const stat = lstatSync(absolutePath);
        if (stat.isSymbolicLink()) {
            return;
        }
        if (stat.isDirectory()) {
            const entries = readdirSync(absolutePath).sort(compareText);
            for (const entry of entries) {
                walk(resolve(absolutePath, entry));
            }
            return;
        }
        if (stat.isFile() && absolutePath.endsWith('.tsx')) {
            files.push(absolutePath);
        }
    }

    for (const productionRoot of productionRoots) {
        walk(resolve(repositoryRoot, productionRoot));
    }

    return files.sort((left, right) => compareText(toPosixPath(left), toPosixPath(right)));
}

function moduleIsLayoutPrimitive(moduleSpecifier: string): boolean {
    return /(?:^|\/)components\/layout(?:\/|$)/.test(moduleSpecifier);
}

function moduleIsDawWrapper(moduleSpecifier: string): boolean {
    return /(?:^|\/)components\/daw(?:\/|$)/.test(moduleSpecifier);
}

function collectImportedLayoutTags(sourceFile: ts.SourceFile): ImportedLayoutTags {
    const importedTags: ImportedLayoutTags = {
        primitiveTags: new Map(),
        primitiveNamespaces: new Set(),
        wrapperTags: new Map(),
        wrapperNamespaces: new Set(),
        tagSemantics: new Map(),
        namespaceSemantics: new Map(),
    };

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }
        const moduleSpecifier = statement.moduleSpecifier.text;
        const importClause = statement.importClause;
        if (!importClause) {
            continue;
        }

        if (importClause.name) {
            importedTags.tagSemantics.set(importClause.name.text, `${moduleSpecifier}:default`);
        }

        const isPrimitiveImport = moduleIsLayoutPrimitive(moduleSpecifier);
        const isWrapperImport = moduleIsDawWrapper(moduleSpecifier);
        if (!isPrimitiveImport && !isWrapperImport) {
            continue;
        }

        const bindings = importClause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
            importedTags.namespaceSemantics.set(bindings.name.text, moduleSpecifier);
            if (isPrimitiveImport) {
                importedTags.primitiveNamespaces.add(bindings.name.text);
            }
            if (isWrapperImport) {
                importedTags.wrapperNamespaces.add(bindings.name.text);
            }
            continue;
        }
        if (!bindings || !ts.isNamedImports(bindings)) {
            continue;
        }

        for (const element of bindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            const localName = element.name.text;
            importedTags.tagSemantics.set(localName, `${moduleSpecifier}:${importedName}`);
            if (isPrimitiveImport && primitiveDefaults.has(importedName)) {
                importedTags.primitiveTags.set(localName, importedName);
            }
            if (isWrapperImport && importedName.startsWith('Daw')) {
                importedTags.wrapperTags.set(localName, importedName);
            }
        }
    }

    return importedTags;
}

function getCanonicalTagSemantics(tagText: string, importedTags: ImportedLayoutTags): string | null {
    const directSemantics = importedTags.tagSemantics.get(tagText);
    if (directSemantics) {
        return directSemantics;
    }

    const namespaceSeparator = tagText.indexOf('.');
    if (namespaceSeparator < 0) {
        return null;
    }
    const namespace = tagText.slice(0, namespaceSeparator);
    const member = tagText.slice(namespaceSeparator + 1);
    const namespaceModule = importedTags.namespaceSemantics.get(namespace);
    if (namespaceModule) {
        return `${namespaceModule}:${member}`;
    }
    const objectSemantics = importedTags.tagSemantics.get(namespace);
    if (objectSemantics) {
        return `${objectSemantics}.${member}`;
    }
    return null;
}

function getCanonicalImportedTag(
    tagText: string,
    directTags: Map<string, string>,
    namespaces: Set<string>
): string | null {
    const directTag = directTags.get(tagText);
    if (directTag) {
        return directTag;
    }

    const namespaceSeparator = tagText.indexOf('.');
    if (namespaceSeparator < 0) {
        return null;
    }
    const namespace = tagText.slice(0, namespaceSeparator);
    const exportedName = tagText.slice(namespaceSeparator + 1);
    if (!namespaces.has(namespace)) {
        return null;
    }
    return exportedName;
}

function getAttribute(attributes: ts.JsxAttributes, name: string): ts.JsxAttribute | null {
    for (const property of attributes.properties) {
        if (!ts.isJsxAttribute(property)) {
            continue;
        }
        if (property.name.getText() === name) {
            return property;
        }
    }
    return null;
}

function getStaticAttributeValue(attribute: ts.JsxAttribute | null): string | null {
    if (!attribute?.initializer) {
        return null;
    }
    if (ts.isStringLiteral(attribute.initializer)) {
        return attribute.initializer.text;
    }
    if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
        return null;
    }
    const expression = attribute.initializer.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return expression.text;
    }
    return null;
}

function collectStringFragments(node: ts.Node, fragments: string[]): void {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        fragments.push(node.name.text);
        collectStringFragments(node.initializer, fragments);
        return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
        fragments.push(node.name.text);
        return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        fragments.push(node.text);
        return;
    }
    if (ts.isTemplateExpression(node)) {
        fragments.push(node.head.text);
        for (const span of node.templateSpans) {
            collectStringFragments(span.expression, fragments);
            fragments.push(span.literal.text);
        }
        return;
    }
    ts.forEachChild(node, (child) => {
        collectStringFragments(child, fragments);
    });
}

function emptyClassExpressionAnalysis(): ClassExpressionAnalysis {
    return {
        fragments: [],
        dynamic: false,
        unresolvedBinding: false,
        bindingEvidence: [],
    };
}

function mergeClassExpressionAnalyses(
    analyses: ClassExpressionAnalysis[],
    forceDynamic: boolean
): ClassExpressionAnalysis {
    const merged = emptyClassExpressionAnalysis();
    merged.dynamic = forceDynamic;

    for (const analysis of analyses) {
        merged.fragments.push(...analysis.fragments);
        merged.bindingEvidence.push(...analysis.bindingEvidence);
        if (analysis.dynamic) {
            merged.dynamic = true;
        }
        if (analysis.unresolvedBinding) {
            merged.unresolvedBinding = true;
        }
    }

    return merged;
}

function variableDeclarationIsConst(declaration: ts.VariableDeclaration): boolean {
    return (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
}

function bindingNameContainsIdentifier(bindingName: ts.BindingName, identifierText: string): boolean {
    if (ts.isIdentifier(bindingName)) {
        return bindingName.text === identifierText;
    }
    for (const element of bindingName.elements) {
        if (ts.isOmittedExpression(element)) {
            continue;
        }
        if (bindingNameContainsIdentifier(element.name, identifierText)) {
            return true;
        }
    }
    return false;
}

function variableDeclarationsNamed(
    declarationList: ts.VariableDeclarationList,
    identifierText: string
): ts.VariableDeclaration[] {
    return declarationList.declarations.filter((declaration) =>
        bindingNameContainsIdentifier(declaration.name, identifierText)
    );
}

function directVariableDeclarationsNamed(
    statements: ts.NodeArray<ts.Statement>,
    identifierText: string,
    blockScopedOnly: boolean
): ts.VariableDeclaration[] {
    const declarations: ts.VariableDeclaration[] = [];
    for (const statement of statements) {
        if (!ts.isVariableStatement(statement)) {
            continue;
        }
        const isBlockScoped = (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
        if (blockScopedOnly && !isBlockScoped) {
            continue;
        }
        declarations.push(...variableDeclarationsNamed(statement.declarationList, identifierText));
    }
    return declarations;
}

function directValueDeclarationShadows(statements: ts.NodeArray<ts.Statement>, identifierText: string): boolean {
    return statements.some((statement) => {
        if (
            ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement) ||
            ts.isEnumDeclaration(statement)
        ) {
            return statement.name?.text === identifierText;
        }
        return false;
    });
}

function isFunctionScopeNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)
    );
}

function functionScopedVariableShadows(functionNode: ts.FunctionLikeDeclaration, identifierText: string): boolean {
    let shadows = false;
    const body = functionNode.body;
    if (!body) {
        return false;
    }

    function visit(node: ts.Node): void {
        if (shadows) {
            return;
        }
        if (node !== body && isFunctionScopeNode(node)) {
            return;
        }
        if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0) {
            const declarations = variableDeclarationsNamed(node, identifierText);
            if (declarations.length > 0) {
                shadows = true;
                return;
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(body);
    return shadows;
}

function declarationResolution(
    declarations: ts.VariableDeclaration[],
    identifier: ts.Identifier,
    sourceFile: ts.SourceFile
): LocalBindingResolution | null {
    if (declarations.length === 0) {
        return null;
    }
    if (declarations.length !== 1) {
        return { kind: 'shadowed' };
    }

    const declaration = declarations[0];
    const isDirectIdentifier = ts.isIdentifier(declaration.name) && declaration.name.text === identifier.text;
    const isEarlierConst =
        variableDeclarationIsConst(declaration) && declaration.getStart(sourceFile) < identifier.getStart(sourceFile);
    if (!isDirectIdentifier || !isEarlierConst || !declaration.initializer) {
        return { kind: 'shadowed' };
    }

    return {
        kind: 'resolved',
        target: {
            initializer: declaration.initializer,
            sourceFile,
            key: `${sourceFile.fileName}:${identifier.text}:${declaration.getStart(sourceFile)}`,
        },
    };
}

function findLocalConstBinding(identifier: ts.Identifier, sourceFile: ts.SourceFile): LocalBindingResolution {
    let current: ts.Node | undefined = identifier.parent;
    while (current) {
        if (ts.isBlock(current)) {
            const declarations = directVariableDeclarationsNamed(current.statements, identifier.text, true);
            const resolution = declarationResolution(declarations, identifier, sourceFile);
            if (resolution) {
                return resolution;
            }
            if (directValueDeclarationShadows(current.statements, identifier.text)) {
                return { kind: 'shadowed' };
            }
        }

        if (ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current)) {
            const initializer = current.initializer;
            if (initializer && ts.isVariableDeclarationList(initializer)) {
                const declarations = variableDeclarationsNamed(initializer, identifier.text);
                const resolution = declarationResolution(declarations, identifier, sourceFile);
                if (resolution) {
                    return resolution;
                }
            }
        }

        if (ts.isCatchClause(current) && current.variableDeclaration) {
            if (bindingNameContainsIdentifier(current.variableDeclaration.name, identifier.text)) {
                return { kind: 'shadowed' };
            }
        }

        if (isFunctionScopeNode(current)) {
            const functionNameShadows =
                (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) &&
                current.name?.text === identifier.text;
            const parameterShadows = current.parameters.some((parameter) =>
                bindingNameContainsIdentifier(parameter.name, identifier.text)
            );
            if (functionNameShadows || parameterShadows || functionScopedVariableShadows(current, identifier.text)) {
                return { kind: 'shadowed' };
            }
        }

        if (ts.isSourceFile(current)) {
            const declarations = directVariableDeclarationsNamed(current.statements, identifier.text, false);
            const resolution = declarationResolution(declarations, identifier, sourceFile);
            if (resolution) {
                return resolution;
            }
            if (directValueDeclarationShadows(current.statements, identifier.text)) {
                return { kind: 'shadowed' };
            }
        }

        current = current.parent;
    }
    return { kind: 'not-found' };
}

function resolveRepositoryModulePath({
    containingSourceFile,
    moduleSpecifier,
    resolver,
}: {
    containingSourceFile: ts.SourceFile;
    moduleSpecifier: string;
    resolver: ClassBindingResolver;
}): string | null {
    let moduleBase: string;
    if (moduleSpecifier.startsWith('#/')) {
        moduleBase = resolve(resolver.repositoryRoot, 'src', moduleSpecifier.slice(2));
    } else if (moduleSpecifier.startsWith('.')) {
        moduleBase = resolve(dirname(containingSourceFile.fileName), moduleSpecifier);
    } else {
        return null;
    }

    const candidates = [
        moduleBase,
        `${moduleBase}.ts`,
        `${moduleBase}.tsx`,
        resolve(moduleBase, 'index.ts'),
        resolve(moduleBase, 'index.tsx'),
    ];
    for (const candidate of candidates) {
        if (!existsSync(candidate)) {
            continue;
        }
        const canonicalCandidate = realpathSync(candidate);
        const canonicalRepositoryPath = relative(resolver.canonicalRepositoryRoot, canonicalCandidate);
        const escapesRepository =
            canonicalRepositoryPath === '..' ||
            canonicalRepositoryPath.startsWith(`..${sep}`) ||
            isAbsolute(canonicalRepositoryPath);
        if (escapesRepository) {
            continue;
        }
        if (!lstatSync(canonicalCandidate).isFile()) {
            continue;
        }
        return canonicalCandidate;
    }
    return null;
}

function readClassBindingSourceFile(absolutePath: string, resolver: ClassBindingResolver): ts.SourceFile {
    const cached = resolver.sourceFiles.get(absolutePath);
    if (cached) {
        return cached;
    }

    const sourceText = readFileSync(absolutePath, 'utf8');
    let scriptKind = ts.ScriptKind.TS;
    if (absolutePath.endsWith('.tsx')) {
        scriptKind = ts.ScriptKind.TSX;
    }
    const sourceFile = ts.createSourceFile(absolutePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
    const repositoryPath = toPosixPath(relative(resolver.repositoryRoot, absolutePath));
    assertNoParseDiagnostics(sourceFile, repositoryPath);
    resolver.sourceFiles.set(absolutePath, sourceFile);
    return sourceFile;
}

function findImportedConstBinding(
    identifier: ts.Identifier,
    sourceFile: ts.SourceFile,
    resolver: ClassBindingResolver
): ClassBindingTarget | null {
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) {
            continue;
        }

        for (const element of bindings.elements) {
            if (element.name.text !== identifier.text) {
                continue;
            }
            const importedName = element.propertyName?.text ?? element.name.text;
            const modulePath = resolveRepositoryModulePath({
                containingSourceFile: sourceFile,
                moduleSpecifier: statement.moduleSpecifier.text,
                resolver,
            });
            if (!modulePath) {
                return null;
            }
            const importedSourceFile = readClassBindingSourceFile(modulePath, resolver);
            for (const importedStatement of importedSourceFile.statements) {
                if (!ts.isVariableStatement(importedStatement)) {
                    continue;
                }
                const exported = importedStatement.modifiers?.some(
                    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
                );
                if (!exported || (importedStatement.declarationList.flags & ts.NodeFlags.Const) === 0) {
                    continue;
                }
                for (const declaration of importedStatement.declarationList.declarations) {
                    if (!ts.isIdentifier(declaration.name) || declaration.name.text !== importedName) {
                        continue;
                    }
                    if (!declaration.initializer) {
                        return null;
                    }
                    const repositoryPath = toPosixPath(relative(resolver.repositoryRoot, modulePath));
                    return {
                        initializer: declaration.initializer,
                        sourceFile: importedSourceFile,
                        key: `${repositoryPath}:${importedName}:${declaration.getStart(importedSourceFile)}`,
                    };
                }
            }
            return null;
        }
    }
    return null;
}

function resolveClassBinding(
    identifier: ts.Identifier,
    sourceFile: ts.SourceFile,
    resolver: ClassBindingResolver
): ClassBindingTarget | null {
    const localResolution = findLocalConstBinding(identifier, sourceFile);
    if (localResolution.kind === 'shadowed') {
        return null;
    }
    if (localResolution.kind === 'resolved') {
        const localBinding = localResolution.target;
        const repositoryPath = toPosixPath(relative(resolver.repositoryRoot, sourceFile.fileName));
        localBinding.key = `${repositoryPath}:${identifier.text}:${localBinding.initializer.getStart(sourceFile)}`;
        return localBinding;
    }
    return findImportedConstBinding(identifier, sourceFile, resolver);
}

function analyzeClassExpression({
    expression,
    resolver,
    seenBindings,
    sourceFile,
}: {
    expression: ts.Expression;
    resolver: ClassBindingResolver;
    seenBindings: Set<string>;
    sourceFile: ts.SourceFile;
}): ClassExpressionAnalysis {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return {
            fragments: [expression.text],
            dynamic: false,
            unresolvedBinding: false,
            bindingEvidence: [],
        };
    }

    if (ts.isIdentifier(expression)) {
        const binding = resolveClassBinding(expression, sourceFile, resolver);
        if (!binding || seenBindings.has(binding.key)) {
            return {
                fragments: [],
                dynamic: true,
                unresolvedBinding: true,
                bindingEvidence: [`unresolved:${expression.text}`],
            };
        }
        const nextSeenBindings = new Set(seenBindings);
        nextSeenBindings.add(binding.key);
        const analysis = analyzeClassExpression({
            expression: binding.initializer,
            resolver,
            seenBindings: nextSeenBindings,
            sourceFile: binding.sourceFile,
        });
        const initializerText = normalizeWhitespace(binding.initializer.getText(binding.sourceFile));
        analysis.bindingEvidence.unshift(`binding:${binding.key}:${initializerText}`);
        return analysis;
    }

    if (ts.isParenthesizedExpression(expression)) {
        return analyzeClassExpression({ expression: expression.expression, resolver, seenBindings, sourceFile });
    }
    if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
        return analyzeClassExpression({ expression: expression.expression, resolver, seenBindings, sourceFile });
    }
    if (ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) {
        return analyzeClassExpression({ expression: expression.expression, resolver, seenBindings, sourceFile });
    }

    if (ts.isConditionalExpression(expression)) {
        const whenTrue = analyzeClassExpression({
            expression: expression.whenTrue,
            resolver,
            seenBindings,
            sourceFile,
        });
        const whenFalse = analyzeClassExpression({
            expression: expression.whenFalse,
            resolver,
            seenBindings,
            sourceFile,
        });
        return mergeClassExpressionAnalyses([whenTrue, whenFalse], true);
    }

    if (ts.isCallExpression(expression)) {
        const argumentAnalyses = expression.arguments.map((argument) =>
            analyzeClassExpression({ expression: argument, resolver, seenBindings, sourceFile })
        );
        const calleeName = expression.expression.getText(sourceFile).split('.').at(-1) ?? '';
        const knownClassCombiner = calleeName === 'cn' || calleeName === 'clsx';
        return mergeClassExpressionAnalyses(argumentAnalyses, !knownClassCombiner);
    }

    if (ts.isArrayLiteralExpression(expression)) {
        const elementAnalyses = expression.elements.map((element) =>
            analyzeClassExpression({ expression: element, resolver, seenBindings, sourceFile })
        );
        return mergeClassExpressionAnalyses(elementAnalyses, false);
    }

    if (ts.isObjectLiteralExpression(expression)) {
        const analysis = emptyClassExpressionAnalysis();
        analysis.dynamic = true;
        for (const property of expression.properties) {
            if (ts.isPropertyAssignment(property)) {
                if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
                    analysis.fragments.push(property.name.text);
                }
                continue;
            }
            if (ts.isShorthandPropertyAssignment(property)) {
                analysis.fragments.push(property.name.text);
                continue;
            }
            if (ts.isSpreadAssignment(property)) {
                const spreadAnalysis = analyzeClassExpression({
                    expression: property.expression,
                    resolver,
                    seenBindings,
                    sourceFile,
                });
                analysis.fragments.push(...spreadAnalysis.fragments);
                analysis.bindingEvidence.push(...spreadAnalysis.bindingEvidence);
                if (spreadAnalysis.unresolvedBinding) {
                    analysis.unresolvedBinding = true;
                }
            }
        }
        return analysis;
    }

    if (ts.isBinaryExpression(expression)) {
        if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            const rightAnalysis = analyzeClassExpression({
                expression: expression.right,
                resolver,
                seenBindings,
                sourceFile,
            });
            return mergeClassExpressionAnalyses([rightAnalysis], true);
        }
        const leftAnalysis = analyzeClassExpression({
            expression: expression.left,
            resolver,
            seenBindings,
            sourceFile,
        });
        const rightAnalysis = analyzeClassExpression({
            expression: expression.right,
            resolver,
            seenBindings,
            sourceFile,
        });
        return mergeClassExpressionAnalyses([leftAnalysis, rightAnalysis], true);
    }

    if (ts.isTemplateExpression(expression)) {
        const analysis = emptyClassExpressionAnalysis();
        analysis.dynamic = true;
        analysis.fragments.push(expression.head.text);
        for (const span of expression.templateSpans) {
            const spanAnalysis = analyzeClassExpression({
                expression: span.expression,
                resolver,
                seenBindings,
                sourceFile,
            });
            analysis.fragments.push(...spanAnalysis.fragments, span.literal.text);
            analysis.bindingEvidence.push(...spanAnalysis.bindingEvidence);
            if (spanAnalysis.unresolvedBinding) {
                analysis.unresolvedBinding = true;
            }
        }
        return analysis;
    }

    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
        return {
            fragments: [],
            dynamic: true,
            unresolvedBinding: true,
            bindingEvidence: [`unresolved:${normalizeWhitespace(expression.getText(sourceFile))}`],
        };
    }

    const fragments: string[] = [];
    collectStringFragments(expression, fragments);
    return {
        fragments,
        dynamic: true,
        unresolvedBinding: false,
        bindingEvidence: [],
    };
}

function baseLayoutToken(token: string): string {
    const pieces = token.split(':');
    return pieces.at(-1) ?? token;
}

function isLayoutToken(token: string): boolean {
    const baseToken = baseLayoutToken(token);
    return /^(?:flex|inline-flex|flex-(?:row|col|wrap|nowrap)(?:-.+)?|grid|inline-grid|grid-(?:cols|rows|flow)-.+|gap(?:-[xy])?-.+|space-[xy]-.+|items-.+|justify-.+|content-.+|place-(?:items|content|self)-.+)$/.test(
        baseToken
    );
}

function classNameEvidence(
    attribute: ts.JsxAttribute | null,
    sourceFile: ts.SourceFile,
    resolver: ClassBindingResolver
): ClassNameEvidence {
    if (!attribute?.initializer) {
        return {
            currentPattern: '',
            allTokens: [],
            layoutTokens: [],
            dynamic: false,
            responsive: false,
            bindingEvidence: [],
            unresolvedBinding: false,
        };
    }

    let analysis = emptyClassExpressionAnalysis();
    if (ts.isStringLiteral(attribute.initializer)) {
        analysis.fragments.push(attribute.initializer.text);
    } else if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
        analysis = analyzeClassExpression({
            expression: attribute.initializer.expression,
            resolver,
            seenBindings: new Set(),
            sourceFile,
        });
    }

    const allTokens: string[] = [];
    for (const fragment of analysis.fragments) {
        for (const token of fragment.split(/\s+/)) {
            const normalizedToken = token.trim();
            if (normalizedToken.length > 0) {
                allTokens.push(normalizedToken);
            }
        }
    }
    const layoutTokens = allTokens.filter(isLayoutToken);

    const responsive = allTokens.some(
        (token) => responsivePrefix.test(token) || (isLayoutToken(token) && conditionalVariantPrefix.test(token))
    );
    let currentPattern = normalizeWhitespace(analysis.fragments.join(' '));
    if (ts.isJsxExpression(attribute.initializer)) {
        currentPattern = normalizeWhitespace(attribute.initializer.getText(sourceFile));
        const hasResolvedBinding = analysis.bindingEvidence.some((evidence) => evidence.startsWith('binding:'));
        if (hasResolvedBinding && analysis.fragments.length > 0) {
            const resolvedPattern = normalizeWhitespace(analysis.fragments.join(' '));
            currentPattern = `${currentPattern} => ${resolvedPattern}`;
        }
    }
    return {
        currentPattern,
        allTokens,
        layoutTokens,
        dynamic: analysis.dynamic,
        responsive,
        bindingEvidence: analysis.bindingEvidence,
        unresolvedBinding: analysis.unresolvedBinding,
    };
}

function getEnclosingOwnerNode(node: ts.Node): ts.Node | null {
    let current: ts.Node | undefined = node;
    while (current) {
        if (
            (ts.isFunctionDeclaration(current) && current.name) ||
            (ts.isMethodDeclaration(current) && current.name) ||
            (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name))
        ) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

function getEnclosingOwner(node: ts.Node, sourceFile: ts.SourceFile): string {
    const ownerNode = getEnclosingOwnerNode(node);
    if (ownerNode && ts.isFunctionDeclaration(ownerNode) && ownerNode.name) {
        return ownerNode.name.text;
    }
    if (ownerNode && ts.isMethodDeclaration(ownerNode) && ownerNode.name) {
        return ownerNode.name.getText(sourceFile);
    }
    if (ownerNode && ts.isVariableDeclaration(ownerNode) && ts.isIdentifier(ownerNode.name)) {
        return ownerNode.name.text;
    }
    return basename(sourceFile.fileName, '.tsx');
}

function getWrapperOwner(repositoryPath: string, importedWrapper: string | null): string | null {
    if (importedWrapper) {
        return importedWrapper;
    }
    if (!repositoryPath.startsWith('src/components/daw/')) {
        return null;
    }
    const fileName = basename(repositoryPath, '.tsx');
    if (fileName.startsWith('Daw')) {
        return fileName;
    }
    return null;
}

function patternFamilyFor({
    layoutTokens,
    primitiveTag,
    wrapperTag,
}: {
    layoutTokens: string[];
    primitiveTag: string | null;
    wrapperTag: string | null;
}): string {
    if (primitiveTag === 'Grid') {
        return 'grid';
    }
    if (primitiveTag === 'Spacer') {
        return 'spacer';
    }
    if (primitiveTag === 'Divider') {
        return 'divider';
    }
    if (primitiveTag) {
        return 'flex';
    }
    if (wrapperTag && layoutTokens.length === 0) {
        return 'semantic-wrapper';
    }

    const baseTokens = layoutTokens.map(baseLayoutToken);
    if (baseTokens.some((token) => token === 'grid' || token === 'inline-grid' || token.startsWith('grid-'))) {
        return 'grid';
    }
    if (baseTokens.some((token) => token === 'flex' || token === 'inline-flex' || token.startsWith('flex-'))) {
        return 'flex';
    }
    if (baseTokens.some((token) => token.startsWith('space-'))) {
        return 'space';
    }
    return 'alignment';
}

function patternClassFor(patternFamily: string, layoutTokens: string[], primitiveTag: string | null): string {
    if (primitiveTag) {
        return `primitive-${primitiveTag.toLowerCase()}`;
    }
    const baseTokens = layoutTokens.map(baseLayoutToken);
    if (patternFamily === 'grid') {
        if (baseTokens.some((token) => token.startsWith('grid-cols-'))) {
            return 'grid-columns';
        }
        if (baseTokens.some((token) => token.startsWith('grid-rows-'))) {
            return 'grid-rows';
        }
        return 'grid';
    }
    if (baseTokens.some((token) => token === 'flex-col' || token.startsWith('space-y-'))) {
        return 'flex-column';
    }
    if (baseTokens.some((token) => token === 'flex-row' || token.startsWith('space-x-'))) {
        return 'flex-row';
    }
    if (patternFamily === 'semantic-wrapper') {
        return 'semantic-wrapper';
    }
    if (patternFamily === 'flex') {
        return 'flex-row';
    }
    return patternFamily;
}

function proposedPrimitiveFor(
    patternFamily: string,
    layoutTokens: string[],
    primitiveTag: string | null
): string | null {
    if (primitiveTag) {
        return primitiveTag;
    }
    if (patternFamily === 'grid') {
        return 'Grid';
    }
    const baseTokens = layoutTokens.map(baseLayoutToken);
    if (baseTokens.some((token) => token === 'flex-col' || token.startsWith('space-y-'))) {
        return 'Stack';
    }
    if (patternFamily === 'flex' || baseTokens.some((token) => token.startsWith('space-x-'))) {
        return 'Row';
    }
    return null;
}

function hasComplexGrid(layoutTokens: string[], attributes: ts.JsxAttributes, sourceFile: ts.SourceFile): boolean {
    const baseTokens = layoutTokens.map(baseLayoutToken);
    if (baseTokens.some((token) => /^grid-(?:cols|rows)-\[/.test(token) || token.includes('subgrid'))) {
        return true;
    }
    const styleAttribute = getAttribute(attributes, 'style');
    if (!styleAttribute?.initializer) {
        return false;
    }
    return /gridTemplate(?:Columns|Rows)?/.test(styleAttribute.initializer.getText(sourceFile));
}

function riskFlagsFor({
    attributes,
    classEvidence,
    hasConditionalChildren,
    nativeElement,
    role,
}: {
    attributes: ts.JsxAttributes;
    classEvidence: ClassNameEvidence;
    hasConditionalChildren: boolean;
    nativeElement: string | null;
    role: string | null;
}): LayoutRiskFlags {
    let hasRef = false;
    let hasHandlers = false;
    let hasSpreadAttributes = false;
    let hasSemanticAttributes = false;
    let hasInlineStyle = false;

    for (const property of attributes.properties) {
        if (ts.isJsxSpreadAttribute(property)) {
            hasSpreadAttributes = true;
            continue;
        }
        const attributeName = property.name.getText();
        if (attributeName === 'ref') {
            hasRef = true;
        }
        if (attributeName === 'style') {
            hasInlineStyle = true;
        }
        if (/^on[A-Z]/.test(attributeName)) {
            hasHandlers = true;
        }
        if (
            attributeName === 'role' ||
            attributeName.startsWith('aria-') ||
            ['contentEditable', 'draggable', 'href', 'htmlFor', 'tabIndex'].includes(attributeName)
        ) {
            hasSemanticAttributes = true;
        }
    }

    let hasSemanticElement = role !== null || nativeElement === null || hasSemanticAttributes;
    if (nativeElement && intrinsicElementHasSemantics(nativeElement)) {
        hasSemanticElement = true;
    }

    return {
        hasRef,
        hasHandlers,
        hasSemanticElement,
        hasResponsiveClasses: classEvidence.responsive,
        hasDynamicClassName: classEvidence.dynamic,
        hasConditionalChildren,
        hasPositioning: classEvidence.allTokens.some((token) =>
            ['absolute', 'fixed', 'sticky'].includes(baseLayoutToken(token))
        ),
        hasOverflow: classEvidence.allTokens.some((token) => /^overflow(?:-[xy])?-/.test(baseLayoutToken(token))),
        hasChildSelectors: classEvidence.allTokens.some(
            (token) => token.includes('[&') || token.startsWith('*:') || token.includes('[&>')
        ),
        hasInlineStyle,
        hasSpreadAttributes,
    };
}

function elementHasConditionalChildren(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    layoutTokens: string[]
): boolean {
    const usesSpace = layoutTokens.map(baseLayoutToken).some((token) => token.startsWith('space-'));
    if (!usesSpace || ts.isJsxSelfClosingElement(node) || !ts.isJsxElement(node.parent)) {
        return false;
    }

    for (const child of node.parent.children) {
        if (ts.isJsxFragment(child)) {
            return true;
        }
        if (ts.isJsxExpression(child) && child.expression) {
            return true;
        }
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
            let childAttributes: ts.JsxAttributes;
            let childTagName: string;
            if (ts.isJsxElement(child)) {
                childAttributes = child.openingElement.attributes;
                childTagName = child.openingElement.tagName.getText();
            } else {
                childAttributes = child.attributes;
                childTagName = child.tagName.getText();
            }
            if (!/^[a-z]/.test(childTagName)) {
                return true;
            }
            const childClassName = getAttribute(childAttributes, 'className');
            const staticClassName = getStaticAttributeValue(childClassName);
            if (childClassName && staticClassName === null) {
                return true;
            }
            const childClasses = staticClassName?.split(/\s+/) ?? [];
            const childBaseClasses = childClasses.map(baseLayoutToken);
            if (childBaseClasses.includes('hidden') || childBaseClasses.includes('contents')) {
                return true;
            }
            const conditionalDisplayClasses = new Set([
                'block',
                'flex',
                'grid',
                'inline',
                'inline-block',
                'inline-flex',
                'inline-grid',
                'table',
            ]);
            if (
                childClasses.some(
                    (className, index) =>
                        className.includes(':') && conditionalDisplayClasses.has(childBaseClasses[index])
                )
            ) {
                return true;
            }
            if (
                childBaseClasses.some(
                    (className) =>
                        /^-?m(?:[trblxy])?-.+/.test(className) || ['absolute', 'fixed', 'sticky'].includes(className)
                )
            ) {
                return true;
            }
            if (getAttribute(childAttributes, 'hidden')) {
                return true;
            }
        }
    }
    return false;
}

function semanticAncestorEvidence(
    elementNode: ts.JsxElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile
): string[] {
    const evidence: string[] = [];
    let current: ts.Node | undefined = elementNode.parent;
    while (current) {
        if (ts.isJsxElement(current)) {
            const openingElement = current.openingElement;
            const tagText = openingElement.tagName.getText(sourceFile);
            const isCustomElement = !/^[a-z]/.test(tagText);
            const hasIntrinsicSemantics = /^[a-z]/.test(tagText) && intrinsicElementHasSemantics(tagText);
            const hasExplicitRole = getAttribute(openingElement.attributes, 'role') !== null;
            if (isCustomElement || hasIntrinsicSemantics || hasExplicitRole) {
                evidence.push(normalizeWhitespace(openingElement.getText(sourceFile)));
            }
        }
        current = current.parent;
    }
    return evidence;
}

function sourceFingerprintForElement({
    bindingEvidence,
    layoutTokens,
    node,
    sourceFile,
    tagSemantics,
}: {
    bindingEvidence: string[];
    layoutTokens: string[];
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
    sourceFile: ts.SourceFile;
    tagSemantics: string | null;
}): string {
    const evidence = [normalizeWhitespace(node.getText(sourceFile))];
    if (tagSemantics) {
        evidence.push(`import:${tagSemantics}`);
    }
    evidence.push(...bindingEvidence);

    let elementNode: ts.JsxElement | ts.JsxSelfClosingElement;
    if (ts.isJsxOpeningElement(node)) {
        if (!ts.isJsxElement(node.parent)) {
            throw new TypeError('JSX opening element must belong to a JSX element');
        }
        elementNode = node.parent;
    } else {
        elementNode = node;
    }
    const ancestorEvidence = semanticAncestorEvidence(elementNode, sourceFile);
    if (ancestorEvidence.length > 0) {
        evidence.push(`ancestors:${ancestorEvidence.join('\u0001')}`);
    }
    const structuralParent = elementNode.parent;
    if (ts.isJsxElement(structuralParent) || ts.isJsxFragment(structuralParent)) {
        const siblingElements = structuralParent.children.filter(
            (child): child is ts.JsxElement | ts.JsxSelfClosingElement =>
                ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)
        );
        const openingEvidence = (child: ts.JsxElement | ts.JsxSelfClosingElement): string => {
            if (ts.isJsxElement(child)) {
                return normalizeWhitespace(child.openingElement.getText(sourceFile));
            }
            return normalizeWhitespace(child.getText(sourceFile));
        };
        const currentOpeningEvidence = openingEvidence(elementNode);
        const identicalSiblingCount = siblingElements.filter(
            (sibling) => openingEvidence(sibling) === currentOpeningEvidence
        ).length;
        if (identicalSiblingCount > 1) {
            evidence.push(`siblings:${siblingElements.map(openingEvidence).join('\u0001')}`);
        }
    }

    const usesSpace = layoutTokens.map(baseLayoutToken).some((token) => token.startsWith('space-'));
    if (usesSpace && ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent)) {
        for (const child of node.parent.children) {
            const childEvidence = normalizeWhitespace(child.getText(sourceFile));
            if (childEvidence.length > 0) {
                evidence.push(childEvidence);
            }
        }
    }
    return hash(evidence.join('\u0000'));
}

function reviewEvidenceMatches(previous: LayoutOccurrence, current: PendingOccurrence): boolean {
    return (
        previous.id === current.id &&
        previous.file === current.file &&
        previous.sourceFingerprint === current.sourceFingerprint &&
        previous.patternFamily === current.patternFamily &&
        previous.patternClass === current.patternClass &&
        previous.currentPattern === current.currentPattern &&
        previous.proposedPrimitive === current.proposedPrimitive &&
        previous.wrapperOwner === current.wrapperOwner &&
        previous.nativeElement === current.nativeElement &&
        previous.role === current.role &&
        JSON.stringify(previous.riskFlags) === JSON.stringify(current.riskFlags) &&
        previous.riskTier === current.riskTier
    );
}

function hasHighRiskFlags(riskFlags: LayoutRiskFlags): boolean {
    return (
        riskFlags.hasRef ||
        riskFlags.hasHandlers ||
        riskFlags.hasSemanticElement ||
        riskFlags.hasPositioning ||
        riskFlags.hasOverflow ||
        riskFlags.hasChildSelectors ||
        riskFlags.hasInlineStyle ||
        riskFlags.hasSpreadAttributes
    );
}

function characterizedRiskTier(riskFlags: LayoutRiskFlags): LayoutRiskTier {
    if (hasHighRiskFlags(riskFlags)) {
        return 'high';
    }
    if (riskFlags.hasResponsiveClasses || riskFlags.hasDynamicClassName || riskFlags.hasConditionalChildren) {
        return 'medium';
    }
    return 'low';
}

function classifyCandidate({
    complexGrid,
    componentTag,
    hasDynamicRole,
    nativeElement,
    primitiveTag,
    proposedPrimitive,
    rendererOwned,
    repositoryPath,
    riskFlags,
    wrapperOwner,
}: {
    complexGrid: boolean;
    componentTag: string;
    hasDynamicRole: boolean;
    nativeElement: string | null;
    primitiveTag: string | null;
    proposedPrimitive: string | null;
    rendererOwned: boolean;
    repositoryPath: string;
    riskFlags: LayoutRiskFlags;
    wrapperOwner: string | null;
}): CandidateClassification {
    if (wrapperOwner) {
        return {
            disposition: 'semantic-wrapper',
            rationale: `Preserve the ${wrapperOwner} semantic wrapper and review its geometry through the owning component.`,
            riskTier: 'high',
        };
    }
    if (primitiveTag) {
        return {
            disposition: 'already-migrated',
            rationale: `Already uses the ${primitiveTag} layout primitive; retain as a characterized primitive consumer.`,
            riskTier: characterizedRiskTier(riskFlags),
        };
    }
    if (rendererOwned) {
        return {
            disposition: 'renderer',
            rationale: 'Renderer-owned geometry is excluded from mechanical primitive migration.',
            riskTier: 'high',
        };
    }
    if (complexGrid) {
        return {
            disposition: 'complex-grid',
            rationale: 'The grid uses an arbitrary template that the typed Grid contract cannot express exactly.',
            riskTier: 'high',
        };
    }
    if (riskFlags.hasResponsiveClasses || riskFlags.hasDynamicClassName || riskFlags.hasConditionalChildren) {
        let riskTier: LayoutRiskTier = 'medium';
        if (hasHighRiskFlags(riskFlags)) {
            riskTier = 'high';
        }
        return {
            disposition: 'responsive-or-dynamic',
            rationale:
                'Responsive, runtime-computed, or conditional-sibling layout must retain its explicit behavior until separately characterized.',
            riskTier,
        };
    }
    if (thirdPartyPath.test(repositoryPath)) {
        return {
            disposition: 'third-party-generated-test',
            rationale: 'Third-party-owned production markup is recorded but excluded from direct migration.',
            riskTier: 'high',
        };
    }
    if (nativeElement === null) {
        return {
            disposition: 'semantic-wrapper',
            rationale: `Preserve the ${componentTag} component contract and review its geometry through that owner.`,
            riskTier: 'high',
        };
    }
    if (hasDynamicRole) {
        return {
            disposition: 'one-off',
            rationale: 'Runtime role semantics require owner-specific characterization before primitive migration.',
            riskTier: 'high',
        };
    }
    if (proposedPrimitive === null) {
        return {
            disposition: 'one-off',
            rationale: 'This bespoke layout has no supported flex, stack, or grid primitive mapping.',
            riskTier: 'high',
        };
    }

    const riskTier = characterizedRiskTier(riskFlags);
    if (riskTier !== 'low') {
        return {
            disposition: 'eligible',
            rationale: `Static ${nativeElement} geometry maps to ${proposedPrimitive}; preserve its element, classes, and native props during owner-specific migration proof.`,
            riskTier,
        };
    }
    return {
        disposition: 'eligible',
        rationale: `Static low-risk geometry maps directly to ${proposedPrimitive}.`,
        riskTier: 'low',
    };
}

function nodeContainsCanvas(root: ts.Node, sourceFile: ts.SourceFile): boolean {
    let containsCanvas = false;
    function visit(node: ts.Node): void {
        if (containsCanvas) {
            return;
        }
        if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            node.tagName.getText(sourceFile) === 'canvas'
        ) {
            containsCanvas = true;
            return;
        }
        ts.forEachChild(node, visit);
    }
    visit(root);
    return containsCanvas;
}

function assertNoParseDiagnostics(sourceFile: ts.SourceFile, repositoryPath: string): void {
    const diagnostics: unknown = Reflect.get(sourceFile, 'parseDiagnostics');
    if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
        return;
    }
    const diagnostic: unknown = diagnostics[0];
    if (typeof diagnostic !== 'object' || diagnostic === null) {
        throw new SyntaxError(`Failed to parse ${repositoryPath}:1: Unknown parser diagnostic`);
    }
    const diagnosticStart: unknown = Reflect.get(diagnostic, 'start');
    const position = typeof diagnosticStart === 'number' ? diagnosticStart : 0;
    const { line } = sourceFile.getLineAndCharacterOfPosition(position);
    const diagnosticMessage: unknown = Reflect.get(diagnostic, 'messageText');
    let message = 'Unknown parser diagnostic';
    if (typeof diagnosticMessage === 'string') {
        message = diagnosticMessage;
    } else if (typeof diagnosticMessage === 'object' && diagnosticMessage !== null) {
        const chainedMessage: unknown = Reflect.get(diagnosticMessage, 'messageText');
        if (typeof chainedMessage === 'string') {
            message = chainedMessage;
        }
    }
    throw new SyntaxError(`Failed to parse ${repositoryPath}:${line + 1}: ${message}`);
}

function collectSourceFileOccurrences({
    absolutePath,
    bindingResolver,
    previousById,
    repositoryRoot,
}: {
    absolutePath: string;
    bindingResolver: ClassBindingResolver;
    previousById: Map<string, LayoutOccurrence>;
    repositoryRoot: string;
}): PendingOccurrence[] {
    const repositoryPath = toPosixPath(relative(repositoryRoot, absolutePath));
    const sourceFile = readClassBindingSourceFile(absolutePath, bindingResolver);
    const importedTags = collectImportedLayoutTags(sourceFile);
    const rendererOwnerCache = new WeakMap<ts.Node, boolean>();
    const candidateOrdinals = new Map<string, number>();
    const occurrences: PendingOccurrence[] = [];

    function visit(node: ts.Node): void {
        if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
            ts.forEachChild(node, visit);
            return;
        }

        const tagText = node.tagName.getText(sourceFile);
        const primitiveTag = getCanonicalImportedTag(
            tagText,
            importedTags.primitiveTags,
            importedTags.primitiveNamespaces
        );
        let wrapperTag = getCanonicalImportedTag(tagText, importedTags.wrapperTags, importedTags.wrapperNamespaces);
        if (!wrapperTag && tagText.startsWith('Daw')) {
            wrapperTag = tagText;
        }
        const classAttribute = getAttribute(node.attributes, 'className');
        const classEvidence = classNameEvidence(classAttribute, sourceFile, bindingResolver);
        const isCandidate =
            primitiveTag !== null ||
            wrapperTag !== null ||
            classEvidence.layoutTokens.length > 0 ||
            classEvidence.unresolvedBinding;

        if (isCandidate) {
            const ownerNode = getEnclosingOwnerNode(node) ?? sourceFile;
            const owner = getEnclosingOwner(node, sourceFile);
            const ordinalKey = `${owner}\u0000${tagText}`;
            const ordinal = (candidateOrdinals.get(ordinalKey) ?? 0) + 1;
            candidateOrdinals.set(ordinalKey, ordinal);
            const identitySource = `${repositoryPath}\u0000${owner}\u0000${tagText}\u0000${ordinal}`;
            const id = `layout-${hash(identitySource)}`;
            const tagSemantics = getCanonicalTagSemantics(tagText, importedTags);
            const sourceFingerprint = sourceFingerprintForElement({
                bindingEvidence: classEvidence.bindingEvidence,
                layoutTokens: classEvidence.layoutTokens,
                node,
                sourceFile,
                tagSemantics,
            });
            const roleAttribute = getAttribute(node.attributes, 'role');
            const role = getStaticAttributeValue(roleAttribute);
            const hasDynamicRole = roleAttribute !== null && role === null;
            const asElement = getStaticAttributeValue(getAttribute(node.attributes, 'as'));
            let nativeElement: string | null = null;
            if (ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) {
                nativeElement = node.tagName.text;
            } else if (asElement) {
                nativeElement = asElement;
            } else if (primitiveTag) {
                nativeElement = primitiveDefaults.get(primitiveTag) ?? null;
            }
            const riskFlags = riskFlagsFor({
                attributes: node.attributes,
                classEvidence,
                hasConditionalChildren: elementHasConditionalChildren(node, classEvidence.layoutTokens),
                nativeElement,
                role,
            });
            const patternFamily = patternFamilyFor({
                layoutTokens: classEvidence.layoutTokens,
                primitiveTag,
                wrapperTag,
            });
            const patternClass = patternClassFor(patternFamily, classEvidence.layoutTokens, primitiveTag);
            let proposedPrimitive = proposedPrimitiveFor(patternFamily, classEvidence.layoutTokens, primitiveTag);
            let wrapperOwner = getWrapperOwner(repositoryPath, wrapperTag);
            const complexGrid = hasComplexGrid(classEvidence.layoutTokens, node.attributes, sourceFile);
            let rendererOwned = rendererPath.test(repositoryPath);
            if (!rendererOwned) {
                const cachedRendererOwnership = rendererOwnerCache.get(ownerNode);
                if (cachedRendererOwnership === undefined) {
                    rendererOwned = nodeContainsCanvas(ownerNode, sourceFile);
                    rendererOwnerCache.set(ownerNode, rendererOwned);
                } else {
                    rendererOwned = cachedRendererOwnership;
                }
            }
            const classification = classifyCandidate({
                complexGrid,
                componentTag: tagText,
                hasDynamicRole,
                nativeElement,
                primitiveTag,
                proposedPrimitive,
                rendererOwned,
                repositoryPath,
                riskFlags,
                wrapperOwner,
            });
            if (classification.disposition === 'semantic-wrapper' && wrapperOwner === null && nativeElement === null) {
                wrapperOwner = tagText;
            }
            if (classification.disposition !== 'eligible' && classification.disposition !== 'already-migrated') {
                proposedPrimitive = null;
            }

            let currentPattern = classEvidence.currentPattern;
            if (currentPattern.length === 0) {
                currentPattern = primitiveTag ?? wrapperTag ?? tagText;
            }
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            const occurrence: PendingOccurrence = {
                id,
                file: repositoryPath,
                line: line + 1,
                sourceStart: node.getStart(sourceFile),
                sourceFingerprint,
                patternFamily,
                patternClass,
                currentPattern,
                proposedPrimitive,
                wrapperOwner,
                nativeElement,
                role,
                riskFlags,
                riskTier: classification.riskTier,
                disposition: classification.disposition,
                rationale: classification.rationale,
                reviewed: false,
            };
            const previous = previousById.get(id);
            const hasLegacyOneOffReview =
                previous?.disposition === 'one-off' && previous.rationale === LEGACY_ONE_OFF_RATIONALE;
            if (previous?.reviewed && !hasLegacyOneOffReview && reviewEvidenceMatches(previous, occurrence)) {
                occurrence.disposition = previous.disposition;
                occurrence.rationale = previous.rationale;
                occurrence.reviewed = true;
            }
            occurrences.push(occurrence);
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return occurrences;
}

function finalizeOccurrences(pendingOccurrences: PendingOccurrence[]): LayoutOccurrence[] {
    pendingOccurrences.sort((left, right) => {
        const fileComparison = compareText(left.file, right.file);
        if (fileComparison !== 0) {
            return fileComparison;
        }
        if (left.line !== right.line) {
            return left.line - right.line;
        }
        return left.sourceStart - right.sourceStart;
    });

    const lineOrdinals = new Map<string, number>();
    return pendingOccurrences.map(({ sourceStart: _sourceStart, ...occurrence }) => {
        const lineKey = `${occurrence.file}:${occurrence.line}`;
        const lineOccurrence = (lineOrdinals.get(lineKey) ?? 0) + 1;
        lineOrdinals.set(lineKey, lineOccurrence);
        return { ...occurrence, occurrence: lineOccurrence };
    });
}

export function collectLayoutOccurrences({
    repositoryRoot,
    productionRoots = PRODUCTION_ROOTS,
    previousCensus = null,
}: CollectLayoutOccurrencesInput): LayoutOccurrence[] {
    const previousById = new Map<string, LayoutOccurrence>();
    for (const occurrence of previousCensus?.occurrences ?? []) {
        previousById.set(occurrence.id, occurrence);
    }

    const pendingOccurrences: PendingOccurrence[] = [];
    const bindingResolver: ClassBindingResolver = {
        canonicalRepositoryRoot: realpathSync(repositoryRoot),
        repositoryRoot,
        sourceFiles: new Map(),
    };
    const productionFiles = walkProductionFiles(repositoryRoot, productionRoots);
    for (const absolutePath of productionFiles) {
        pendingOccurrences.push(
            ...collectSourceFileOccurrences({ absolutePath, bindingResolver, previousById, repositoryRoot })
        );
    }
    return finalizeOccurrences(pendingOccurrences);
}

function incrementCount(counts: Map<string, number>, key: string): void {
    counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedCountRecord(counts: Map<string, number>): Record<string, number> {
    const record: Record<string, number> = {};
    const entries = [...counts.entries()].sort(([left], [right]) => compareText(left, right));
    for (const [key, count] of entries) {
        record[key] = count;
    }
    return record;
}

function summarizeOccurrences(occurrences: LayoutOccurrence[]): LayoutCensusSummary {
    const dispositionCounts = new Map<string, number>();
    for (const disposition of ALLOWED_LAYOUT_DISPOSITIONS) {
        dispositionCounts.set(disposition, 0);
    }
    const patternFamilyCounts = new Map<string, number>();
    const commonPatternClassCounts = new Map<string, number>();

    for (const occurrence of occurrences) {
        incrementCount(dispositionCounts, occurrence.disposition);
        incrementCount(patternFamilyCounts, occurrence.patternFamily);
        incrementCount(commonPatternClassCounts, occurrence.patternClass);
    }

    return {
        occurrenceCount: occurrences.length,
        dispositionCounts: sortedCountRecord(dispositionCounts),
        patternFamilyCounts: sortedCountRecord(patternFamilyCounts),
        commonPatternClassCounts: sortedCountRecord(commonPatternClassCounts),
    };
}

export function createLayoutCensus({
    repositoryRoot,
    productionRoots = PRODUCTION_ROOTS,
    previousCensus = null,
}: CreateLayoutCensusInput): LayoutCensus {
    const occurrences = collectLayoutOccurrences({ repositoryRoot, productionRoots, previousCensus });
    const reviewDigest = reviewDigestForOccurrences(occurrences);
    if (reviewDigest === REVIEWED_LAYOUT_CENSUS_DIGEST) {
        for (const occurrence of occurrences) {
            occurrence.reviewed = true;
        }
    }
    return {
        schemaVersion: LAYOUT_CENSUS_SCHEMA_VERSION,
        productionRoots: [...productionRoots],
        exclusions: [...EXCLUDED_PATH_PATTERNS],
        summary: summarizeOccurrences(occurrences),
        occurrences,
    };
}

function occurrenceMap(census: LayoutCensus): Map<string, LayoutOccurrence> {
    return new Map(census.occurrences.map((occurrence) => [occurrence.id, occurrence]));
}

export function compareLayoutCensuses({ actual, expected }: CompareLayoutCensusesInput): LayoutCensusDrift {
    const actualById = occurrenceMap(actual);
    const expectedById = occurrenceMap(expected);
    const added: LayoutOccurrence[] = [];
    const removed: LayoutOccurrence[] = [];
    const changed: Array<{ actual: LayoutOccurrence; expected: LayoutOccurrence }> = [];

    for (const occurrence of actual.occurrences) {
        const expectedOccurrence = expectedById.get(occurrence.id);
        if (!expectedOccurrence) {
            added.push(occurrence);
            continue;
        }
        if (JSON.stringify(occurrence) !== JSON.stringify(expectedOccurrence)) {
            changed.push({ actual: occurrence, expected: expectedOccurrence });
        }
    }
    for (const occurrence of expected.occurrences) {
        if (!actualById.has(occurrence.id)) {
            removed.push(occurrence);
        }
    }

    return { added, removed, changed };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((value, index) => value === right[index]);
}

export function validateLayoutCensus(census: LayoutCensus): string[] {
    const errors: string[] = [];
    if (census.schemaVersion !== LAYOUT_CENSUS_SCHEMA_VERSION) {
        errors.push(`schema version must be ${LAYOUT_CENSUS_SCHEMA_VERSION}`);
    }
    if (!arraysEqual(census.productionRoots, PRODUCTION_ROOTS)) {
        errors.push('production roots drift from the declared scanner roots');
    }
    if (!arraysEqual(census.exclusions, EXCLUDED_PATH_PATTERNS)) {
        errors.push('exclusions drift from the declared scanner exclusions');
    }

    const allowedDispositions = new Set<string>(ALLOWED_LAYOUT_DISPOSITIONS);
    const seenIds = new Set<string>();
    for (const occurrence of census.occurrences) {
        if (seenIds.has(occurrence.id)) {
            errors.push(`duplicate occurrence ID: ${occurrence.id}`);
        }
        seenIds.add(occurrence.id);
        if (!allowedDispositions.has(occurrence.disposition)) {
            errors.push(`invalid disposition for ${occurrence.id}: ${String(occurrence.disposition)}`);
        }
        if (occurrence.rationale.trim().length === 0) {
            errors.push(`missing rationale for ${occurrence.id}`);
        }
        if (!occurrence.reviewed) {
            errors.push(`occurrence requires human review: ${occurrence.id}`);
        }
        if (!/^layout-[a-f0-9]{16}$/.test(occurrence.id)) {
            errors.push(`invalid stable ID: ${occurrence.id}`);
        }
        if (!/^[a-f0-9]{16}$/.test(occurrence.sourceFingerprint)) {
            errors.push(`invalid source fingerprint for ${occurrence.id}`);
        }
    }

    const expectedSummary = summarizeOccurrences(census.occurrences);
    if (JSON.stringify(census.summary) !== JSON.stringify(expectedSummary)) {
        errors.push('summary drift: regenerate occurrence and common-pattern-class counts');
    }
    const sortedOccurrences = [...census.occurrences].sort((left, right) => {
        const fileComparison = compareText(left.file, right.file);
        if (fileComparison !== 0) {
            return fileComparison;
        }
        if (left.line !== right.line) {
            return left.line - right.line;
        }
        return left.occurrence - right.occurrence;
    });
    if (JSON.stringify(census.occurrences) !== JSON.stringify(sortedOccurrences)) {
        errors.push('occurrences are not in stable file/line/occurrence order');
    }
    const reviewDigest = reviewDigestForOccurrences(census.occurrences);
    const allOccurrencesReviewed = census.occurrences.every((occurrence) => occurrence.reviewed);
    if (allOccurrencesReviewed && reviewDigest !== REVIEWED_LAYOUT_CENSUS_DIGEST) {
        errors.push('review attestation drift: audited occurrence evidence no longer matches the signed digest');
    }
    return errors;
}

function escapeMarkdown(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('`', '\\`').replaceAll('\n', ' ');
}

function renderCountTable(counts: Record<string, number>): string[] {
    const lines = ['| Class | Occurrences |', '| --- | ---: |'];
    for (const [key, count] of Object.entries(counts)) {
        lines.push(`| ${escapeMarkdown(key)} | ${count} |`);
    }
    return lines;
}

export function renderLayoutCensusMarkdown(census: LayoutCensus): string {
    const lines = [
        '# Layout primitives census',
        '',
        'This is the human-reviewed disposition ledger for the deterministic production-TSX census. It reports evidence only; it is not a migration-coverage or 80% expressibility claim.',
        '',
        `Schema version: ${census.schemaVersion}`,
        '',
        `Production roots: ${census.productionRoots.map((root) => `\`${root}\``).join(', ')}`,
        '',
        'Exact exclusions:',
        '',
    ];
    for (const exclusion of census.exclusions) {
        lines.push(`- \`${exclusion}\``);
    }
    lines.push('', `Occurrence count: ${census.summary.occurrenceCount}`, '', '## Dispositions', '');
    lines.push(...renderCountTable(census.summary.dispositionCounts));
    lines.push('', '## Pattern families', '');
    lines.push(...renderCountTable(census.summary.patternFamilyCounts));
    lines.push('', '## Common pattern classes', '');
    lines.push(...renderCountTable(census.summary.commonPatternClassCounts));
    lines.push(
        '',
        '## Disposition ledger',
        '',
        '| Stable ID | File:line | Pattern | Primitive | Disposition | Reviewed | Rationale |',
        '| --- | --- | --- | --- | --- | --- | --- |'
    );
    for (const occurrence of census.occurrences) {
        const location = `${occurrence.file}:${occurrence.line}#${occurrence.occurrence}`;
        const primitive = occurrence.proposedPrimitive ?? '—';
        const reviewed = occurrence.reviewed ? 'yes' : 'no';
        lines.push(
            `| \`${occurrence.id}\` | \`${escapeMarkdown(location)}\` | \`${escapeMarkdown(occurrence.currentPattern)}\` | ${escapeMarkdown(primitive)} | ${occurrence.disposition} | ${reviewed} | ${escapeMarkdown(occurrence.rationale)} |`
        );
    }
    return `${lines.join('\n')}\n`;
}

function serializeLayoutCensus(census: LayoutCensus): string {
    const metadata = {
        schemaVersion: census.schemaVersion,
        productionRoots: census.productionRoots,
        exclusions: census.exclusions,
        summary: census.summary,
    };
    const lines = JSON.stringify(metadata, null, 2).split('\n');
    lines.pop();
    const lastMetadataLine = lines.at(-1);
    if (lastMetadataLine === undefined) {
        throw new Error('layout census metadata serialization produced no content');
    }
    lines[lines.length - 1] = `${lastMetadataLine},`;
    lines.push('  "occurrences": [');
    for (const [index, occurrence] of census.occurrences.entries()) {
        let suffix = ',';
        if (index === census.occurrences.length - 1) {
            suffix = '';
        }
        lines.push(`    ${JSON.stringify(occurrence)}${suffix}`);
    }
    lines.push('  ]', '}');
    return `${lines.join('\n')}\n`;
}

function readLayoutCensus(censusPath: string): LayoutCensus | null {
    if (!existsSync(censusPath)) {
        return null;
    }
    const parsed: unknown = JSON.parse(readFileSync(censusPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
        throw new TypeError('layout census JSON must contain an object');
    }
    return parsed as LayoutCensus;
}

function printDrift(drift: LayoutCensusDrift): void {
    for (const occurrence of drift.added) {
        console.error(`ADDED ${occurrence.id} ${occurrence.file}:${occurrence.line}`);
    }
    for (const occurrence of drift.removed) {
        console.error(`REMOVED ${occurrence.id} ${occurrence.file}:${occurrence.line}`);
    }
    for (const { actual, expected } of drift.changed) {
        console.error(
            `CHANGED ${actual.id} ${actual.file}:${actual.line} (${expected.sourceFingerprint} -> ${actual.sourceFingerprint})`
        );
    }
}

function writeLayoutCensusArtifacts({
    censusPath,
    ledgerPath,
    repositoryRoot,
}: {
    censusPath: string;
    ledgerPath: string;
    repositoryRoot: string;
}): void {
    const previousCensus = readLayoutCensus(censusPath);
    const census = createLayoutCensus({ repositoryRoot, previousCensus });
    writeFileSync(censusPath, serializeLayoutCensus(census));
    writeFileSync(ledgerPath, renderLayoutCensusMarkdown(census));
    const unreviewedCount = census.occurrences.filter((occurrence) => !occurrence.reviewed).length;
    console.log(`Wrote ${census.summary.occurrenceCount} layout occurrence(s); ${unreviewedCount} require review.`);
}

export function checkLayoutCensusArtifacts({
    censusPath,
    ledgerPath,
    repositoryRoot,
}: {
    censusPath: string;
    ledgerPath: string;
    repositoryRoot: string;
}): boolean {
    const expected = readLayoutCensus(censusPath);
    if (!expected) {
        console.error(`Missing checked-in census: ${toPosixPath(relative(repositoryRoot, censusPath))}`);
        return false;
    }

    let valid = true;
    const validationErrors = validateLayoutCensus(expected);
    for (const error of validationErrors) {
        console.error(error);
        valid = false;
    }

    const actual = createLayoutCensus({ repositoryRoot, previousCensus: expected });
    const drift = compareLayoutCensuses({ actual, expected });
    if (drift.added.length > 0 || drift.removed.length > 0 || drift.changed.length > 0) {
        printDrift(drift);
        valid = false;
    }

    const serializedExpected = serializeLayoutCensus(expected);
    if (readFileSync(censusPath, 'utf8') !== serializedExpected) {
        console.error('Generated JSON formatting drift: run pnpm layout:census:generate.');
        valid = false;
    }
    const renderedLedger = renderLayoutCensusMarkdown(expected);
    if (!existsSync(ledgerPath) || readFileSync(ledgerPath, 'utf8') !== renderedLedger) {
        console.error('Generated Markdown ledger drift: run pnpm layout:census:generate.');
        valid = false;
    }

    if (valid) {
        console.log(`Layout census is current: ${expected.summary.occurrenceCount} reviewed occurrence(s).`);
    }
    return valid;
}

function main(): void {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const censusPath = resolve(repositoryRoot, 'docs/architecture/layout-primitives-census.json');
    const ledgerPath = resolve(repositoryRoot, 'docs/architecture/layout-primitives-census.md');
    const mode = process.argv[2];

    if (mode === '--write') {
        writeLayoutCensusArtifacts({ censusPath, ledgerPath, repositoryRoot });
        return;
    }
    if (mode === '--check') {
        if (!checkLayoutCensusArtifacts({ censusPath, ledgerPath, repositoryRoot })) {
            process.exitCode = 1;
        }
        return;
    }

    console.error('Usage: node --experimental-strip-types scripts/layoutPrimitivesCensus.ts --write|--check');
    process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    main();
}
