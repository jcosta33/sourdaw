// @ts-check
// Retained ESLint config for Sourdaw — only the rules oxlint 1.74 cannot run.
// oxlint (.oxlintrc.json) is the primary linter: ESLint core/recommended,
// unicorn, promise, import-x, jsx-a11y and all typescript-eslint rules
// (incl. type-aware via tsgolint) live there. Retained here:
// - local Sourdaw-specific rules for agentic drift (custom inline plugin)
// - @eslint-react + react-hooks v7 (React Compiler) presets
// - TanStack Query linting
// - eslint-comments hygiene, prettier-as-lint, @stylistic/spaced-comment
// - import-x/order, @typescript-eslint/naming-convention, id-length, and a
//   handful of core rules whose oxlint implementations diverge semantically

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import eslintPluginReact from '@eslint-react/eslint-plugin';
import eslintPluginComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import eslintPluginStylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import eslintPluginImport, { createNodeResolver } from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import eslintPluginJsxA11yX from 'eslint-plugin-jsx-a11y-x';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import eslintPluginPromise from 'eslint-plugin-promise';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginQuery from '@tanstack/eslint-plugin-query';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Small recursive AST walker for local custom rules.
 * @param {any} node
 * @param {(node: any) => void} visit
 */
function traverse(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);

    for (const key of Object.keys(node)) {
        if (
            key === 'parent' ||
            key === 'loc' ||
            key === 'range' ||
            key === 'tokens' ||
            key === 'comments' ||
            key === 'leadingComments' ||
            key === 'trailingComments'
        ) {
            continue;
        }

        const value = node[key];

        if (Array.isArray(value)) {
            for (const item of value) {
                traverse(item, visit);
            }
            continue;
        }

        traverse(value, visit);
    }
}

/**
 * @param {any} node
 * @returns {boolean}
 */
function isReactEffectCall(node) {
    if (!node || node.type !== 'CallExpression') return false;
    return (
        (node.callee.type === 'Identifier' &&
            (node.callee.name === 'useEffect' || node.callee.name === 'useLayoutEffect')) ||
        (node.callee.type === 'MemberExpression' &&
            node.callee.property?.type === 'Identifier' &&
            (node.callee.property.name === 'useEffect' || node.callee.property.name === 'useLayoutEffect'))
    );
}

/**
 * @param {any} node
 * @returns {boolean}
 */
function isFunctionLike(node) {
    return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';
}

/**
 * @param {any} node
 * @param {Set<string>} injectBindings
 * @returns {boolean}
 */
function isInjectCallExpression(node, injectBindings) {
    if (node?.type !== 'CallExpression') return false;

    let callee = node.callee;
    while (callee?.type === 'CallExpression') {
        callee = callee.callee;
    }

    return callee?.type === 'Identifier' && injectBindings.has(callee.name);
}

/**
 * @param {any} node
 * @param {Set<string>} injectBindings
 * @returns {boolean}
 */
function isFunctionValue(node, injectBindings) {
    return isFunctionLike(node) || isInjectCallExpression(node, injectBindings);
}

/**
 * @param {any} callNode
 * @returns {any | null}
 */
function getEffectBody(callNode) {
    const callback = callNode.arguments?.[0];
    if (!isFunctionLike(callback)) return null;

    if (callback.body?.type === 'BlockStatement') return callback.body;
    return callback.body ?? null;
}

/**
 * @param {any} node
 * @returns {boolean}
 */
function isFetchLikeCall(node) {
    if (!node || node.type !== 'CallExpression') return false;

    // fetch(...)
    if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') return true;

    // axios.get/post/request(...)
    if (
        node.callee.type === 'MemberExpression' &&
        node.callee.object?.type === 'Identifier' &&
        node.callee.object.name === 'axios' &&
        node.callee.property?.type === 'Identifier' &&
        ['get', 'post', 'put', 'patch', 'delete', 'request'].includes(node.callee.property.name)
    ) {
        return true;
    }

    // queryClient.fetchQuery / prefetchQuery / ensureQueryData / refetchQueries / invalidateQueries
    if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property?.type === 'Identifier' &&
        ['fetchQuery', 'prefetchQuery', 'ensureQueryData', 'refetchQueries', 'invalidateQueries'].includes(
            node.callee.property.name
        )
    ) {
        return true;
    }

    // common API client patterns
    if (
        node.callee.type === 'MemberExpression' &&
        node.callee.object?.type === 'Identifier' &&
        ['api', 'apiClient', 'client', 'http', 'httpClient'].includes(node.callee.object.name)
    ) {
        return true;
    }

    return false;
}

/**
 * @param {any} node
 * @returns {boolean}
 */
function isUseStateSetterCall(node) {
    return (
        node?.type === 'CallExpression' && node.callee?.type === 'Identifier' && /^set[A-Z0-9_]/.test(node.callee.name)
    );
}

/**
 * @param {any} body
 * @returns {boolean}
 */
function bodyContainsAsyncOrFetch(body) {
    let found = false;
    traverse(body, (node) => {
        if (found) return;
        if (node.type === 'AwaitExpression' || isFetchLikeCall(node)) {
            found = true;
        }
    });
    return found;
}

/**
 * @param {any} body
 * @returns {boolean}
 */
function bodyLooksLikeDerivedStateEffect(body) {
    let setterCalls = 0;
    let nonSetterCalls = 0;
    let assignments = 0;

    traverse(body, (node) => {
        if (node.type === 'CallExpression') {
            if (isUseStateSetterCall(node)) {
                setterCalls += 1;
            } else if (node.callee?.type !== 'Identifier' || !['console', 'Math'].includes(node.callee.name)) {
                nonSetterCalls += 1;
            }
        }

        if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression' || node.type === 'NewExpression') {
            assignments += 1;
        }
    });

    return setterCalls > 0 && nonSetterCalls === 0 && assignments === 0;
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isPresentationFile(filename) {
    const normalized = filename.replaceAll('\\', '/');
    return (
        normalized.includes('/presentations/views/') ||
        normalized.includes('/presentations/hooks/') ||
        normalized.includes('/presentations/components/')
    );
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isDomainLogicFile(filename) {
    const normalized = filename.replaceAll('\\', '/');
    return (
        normalized.includes('/useCases/') ||
        normalized.includes('/services/') ||
        normalized.includes('/validators/') ||
        normalized.includes('/transformers/')
    );
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeFilePath(value) {
    return value.replaceAll('\\', '/');
}

/**
 * @param {string} filename
 * @param {string} source
 * @returns {boolean}
 */
function isInjectImportSource(filename, source) {
    if (source === '#/infra/di/inject') return true;
    if (!source.startsWith('.')) return false;

    const resolvedSource = normalizeFilePath(resolve(dirname(filename), source));
    return resolvedSource.endsWith('/src/infra/di/inject') || resolvedSource.endsWith('/src/infra/di/inject.ts');
}

/**
 * @param {any} node
 * @param {string} filename
 * @param {Set<string>} injectBindings
 * @returns {void}
 */
function collectInjectBindings(node, filename, injectBindings) {
    const value = node.source?.value;
    if (typeof value !== 'string') return;
    if (!isInjectImportSource(filename, value)) return;

    for (const specifier of node.specifiers ?? []) {
        if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported?.type === 'Identifier' &&
            specifier.imported.name === 'inject'
        ) {
            injectBindings.add(specifier.local.name);
        }
    }
}

/**
 * @param {string} filename
 * @returns {string | null}
 */
function getSourceRoot(filename) {
    const normalized = normalizeFilePath(filename);
    const match = /^(.*\/src)(?:\/|$)/.exec(normalized);
    return match?.[1] ?? null;
}

/**
 * @param {string} filename
 * @param {string} source
 * @returns {string | null}
 */
function resolveSourceExportFile(filename, source) {
    let basePath;
    if (source.startsWith('.')) {
        basePath = resolve(dirname(filename), source);
    } else if (source.startsWith('#/')) {
        const sourceRoot = getSourceRoot(filename);
        if (!sourceRoot) return null;

        basePath = resolve(sourceRoot, source.slice(2));
    } else {
        return null;
    }

    const normalizedBasePath = normalizeFilePath(basePath);
    const candidates = normalizedBasePath.endsWith('.ts')
        ? [normalizedBasePath]
        : [`${normalizedBasePath}.ts`, `${normalizedBasePath}/index.ts`];

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** @type {Map<string, Set<string>>} */
const exportedFunctionNamesCache = new Map();

/**
 * @param {any} program
 * @param {string} filename
 * @param {Set<string>} seenFiles
 * @returns {Set<string>}
 */
function collectExportedFunctionNamesFromProgram(program, filename, seenFiles) {
    /** @type {Map<string, any>} */
    const localFunctionValues = new Map();
    /** @type {Set<string>} */
    const exportedFunctionNames = new Set();
    /** @type {Set<string>} */
    const injectBindings = new Set();

    for (const statement of program.body ?? []) {
        if (statement.type === 'ImportDeclaration') {
            collectInjectBindings(statement, filename, injectBindings);
        }
    }

    for (const statement of program.body ?? []) {
        if (statement.type === 'FunctionDeclaration') {
            if (statement.id?.name) {
                localFunctionValues.set(statement.id.name, statement);
            }
            continue;
        }

        if (statement.type === 'VariableDeclaration') {
            for (const declarator of statement.declarations ?? []) {
                if (declarator.id?.type !== 'Identifier') continue;
                if (!isFunctionValue(declarator.init, injectBindings)) continue;

                localFunctionValues.set(declarator.id.name, declarator.id);
            }
            continue;
        }

        if (statement.type !== 'ExportNamedDeclaration') continue;
        if (statement.exportKind === 'type') continue;

        if (statement.declaration?.type === 'FunctionDeclaration') {
            if (statement.declaration.id?.name) {
                exportedFunctionNames.add(statement.declaration.id.name);
            }
            continue;
        }

        if (statement.declaration?.type === 'VariableDeclaration') {
            for (const declarator of statement.declaration.declarations ?? []) {
                if (declarator.id?.type !== 'Identifier') continue;
                if (!isFunctionValue(declarator.init, injectBindings)) continue;

                exportedFunctionNames.add(declarator.id.name);
            }
            continue;
        }

        if (statement.source) {
            const value = statement.source.value;
            if (typeof value !== 'string') continue;

            const sourceFunctionNames = getExportedFunctionNamesFromSource(filename, value, seenFiles);
            for (const specifier of statement.specifiers ?? []) {
                if (specifier.exportKind === 'type') continue;
                if (specifier.local?.type !== 'Identifier') continue;
                if (!sourceFunctionNames.has(specifier.local.name)) continue;

                const exportedName = specifier.exported?.name ?? specifier.local.name;
                exportedFunctionNames.add(exportedName);
            }
            continue;
        }

        for (const specifier of statement.specifiers ?? []) {
            if (specifier.exportKind === 'type') continue;
            if (specifier.local?.type !== 'Identifier') continue;
            if (!localFunctionValues.has(specifier.local.name)) continue;

            const exportedName = specifier.exported?.name ?? specifier.local.name;
            exportedFunctionNames.add(exportedName);
        }
    }

    for (const statement of program.body ?? []) {
        if (statement.type !== 'ExportAllDeclaration') continue;
        if (statement.exportKind === 'type') continue;

        const value = statement.source?.value;
        if (typeof value !== 'string') continue;

        const sourceFunctionNames = getExportedFunctionNamesFromSource(filename, value, seenFiles);
        for (const name of sourceFunctionNames) {
            exportedFunctionNames.add(name);
        }
    }

    return exportedFunctionNames;
}

/**
 * @param {string} filename
 * @param {string} source
 * @param {Set<string>} seenFiles
 * @returns {Set<string>}
 */
function getExportedFunctionNamesFromSource(filename, source, seenFiles) {
    const sourceFile = resolveSourceExportFile(filename, source);
    if (!sourceFile) return new Set();
    if (seenFiles.has(sourceFile)) return new Set();

    const cached = exportedFunctionNamesCache.get(sourceFile);
    if (cached) return cached;

    seenFiles.add(sourceFile);
    try {
        const text = readFileSync(sourceFile, 'utf8');
        const parsed = tseslint.parser.parseForESLint(text, {
            filePath: sourceFile,
            sourceType: 'module',
            ecmaVersion: 'latest',
        });
        const exportedFunctionNames = collectExportedFunctionNamesFromProgram(parsed.ast, sourceFile, seenFiles);
        exportedFunctionNamesCache.set(sourceFile, exportedFunctionNames);
        return exportedFunctionNames;
    } catch {
        return new Set();
    } finally {
        seenFiles.delete(sourceFile);
    }
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isTestFile(filename) {
    const normalized = normalizeFilePath(filename);
    return (
        normalized.includes('/__tests__/') ||
        normalized.endsWith('/setupTests.ts') ||
        normalized.endsWith('.mock.ts') ||
        /\.(spec|test)\.[cm]?[jt]sx?$/.test(normalized)
    );
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isDeclarationFile(filename) {
    const normalized = normalizeFilePath(filename);
    return /\.d\.[cm]?ts$/.test(normalized);
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isFixtureFile(filename) {
    const normalized = normalizeFilePath(filename);
    return (
        normalized.includes('/__fixtures__/') ||
        normalized.includes('/fixtures/') ||
        normalized.includes('/__mocks__/') ||
        normalized.includes('/mocks/') ||
        normalized.includes('/mock/') ||
        /\.(fixture|fixtures|mock)\.[cm]?[jt]sx?$/.test(normalized)
    );
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isProductionSourceFile(filename) {
    const normalized = normalizeFilePath(filename);
    return (
        (normalized.includes('/src/') || normalized.startsWith('src/')) &&
        !isDeclarationFile(normalized) &&
        !isTestFile(normalized)
    );
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isProductionUseCaseFile(filename) {
    const normalized = normalizeFilePath(filename);
    return (
        normalized.includes('/src/modules/') &&
        normalized.includes('/useCases/') &&
        normalized.endsWith('.ts') &&
        !normalized.includes('/__tests__/') &&
        !normalized.endsWith('.spec.ts') &&
        !normalized.endsWith('.test.ts')
    );
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isProductionUseCaseOrRepositoryFile(filename) {
    const normalized = normalizeFilePath(filename);
    const isModuleSource = normalized.includes('/src/modules/') || normalized.startsWith('src/modules/');
    return (
        isProductionSourceFile(normalized) &&
        isModuleSource &&
        (normalized.includes('/useCases/') || normalized.includes('/repositories/')) &&
        normalized.endsWith('.ts') &&
        !normalized.endsWith('/index.ts')
    );
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isProductionRepositoryFile(filename) {
    const normalized = normalizeFilePath(filename);
    const isModuleSource = normalized.includes('/src/modules/') || normalized.startsWith('src/modules/');
    return (
        isProductionSourceFile(normalized) &&
        isModuleSource &&
        normalized.includes('/repositories/') &&
        !isFixtureFile(normalized) &&
        /\.[cm]?tsx?$/.test(normalized)
    );
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isProductionModelFile(filename) {
    const normalized = normalizeFilePath(filename);
    const isModuleSource = normalized.includes('/src/modules/') || normalized.startsWith('src/modules/');
    return (
        isProductionSourceFile(normalized) &&
        isModuleSource &&
        normalized.includes('/models/') &&
        !isFixtureFile(normalized) &&
        /\.[cm]?tsx?$/.test(normalized)
    );
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isApprovedReactImportFile(filename) {
    const sourceRelativePath = getSourceRelativePath(filename);
    if (!sourceRelativePath) return false;

    if (sourceRelativePath.startsWith('components/')) return true;
    if (sourceRelativePath === 'app/App.tsx') return true;
    if (sourceRelativePath === 'app/main.tsx') return true;
    if (/^routes\/.+\.tsx?$/.test(sourceRelativePath)) return true;
    if (/^modules\/.+\/presentations\/(?:views|components|hooks|helpers)\//.test(sourceRelativePath)) return true;
    if (sourceRelativePath === 'infra/store/useStore.ts') return true;
    if (sourceRelativePath === 'infra/store/useStoreSelector.ts') return true;
    // DialogService is an approved React UI subsystem (confirm / prompt / notify
    // views + hooks) relocated from Workspace's presentation layer into the
    // shared kernel at src/infra/dialogService (ADR 0011 W6.1). Same rationale as
    // the infra/store React-binding entries above.
    if (/^infra\/dialogService\//.test(sourceRelativePath)) return true;

    return sourceRelativePath === 'utils/UI/useContextMenuDismiss.ts';
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function isReactImportSource(source) {
    return (
        source === 'react' || source.startsWith('react/') || source === 'react-dom' || source.startsWith('react-dom/')
    );
}

const moduleSubgroupFolders = new Set(['Common', 'Supporting']);

/**
 * @param {string} modulePath
 * @returns {{ moduleName: string; importPath: string } | null}
 */
function parseModulePath(modulePath) {
    const segments = modulePath.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    const [firstSegment, secondSegment] = segments;
    if (moduleSubgroupFolders.has(firstSegment)) {
        if (!secondSegment) return null;

        return {
            moduleName: `${firstSegment}/${secondSegment}`,
            importPath: segments.slice(2).join('/'),
        };
    }

    return {
        moduleName: firstSegment,
        importPath: segments.slice(1).join('/'),
    };
}

/**
 * @param {string} filename
 * @returns {{ moduleName: string; moduleRoot: string } | null}
 */
function getModuleLocation(filename) {
    const normalizedFilename = normalizeFilePath(filename);
    const match = /^(.*\/src\/modules\/)(.+)$/.exec(normalizedFilename);
    if (!match) return null;

    const modulePath = parseModulePath(match[2]);
    if (!modulePath) return null;

    return { moduleName: modulePath.moduleName, moduleRoot: `${match[1]}${modulePath.moduleName}` };
}

/**
 * @param {{ moduleName: string; moduleRoot: string }} moduleLocation
 * @param {string} source
 * @returns {boolean}
 */
function isSameModuleRepositoryAliasPath(moduleLocation, source) {
    const repositoryPath = `#/modules/${moduleLocation.moduleName}/repositories`;
    return source === repositoryPath || source.startsWith(`${repositoryPath}/`);
}

/**
 * @param {string} filename
 * @param {{ moduleName: string; moduleRoot: string }} moduleLocation
 * @param {string} source
 * @returns {boolean}
 */
function isSameModuleRepositoryRelativePath(filename, moduleLocation, source) {
    const resolvedSource = normalizeFilePath(resolve(dirname(filename), source));
    return (
        resolvedSource === `${moduleLocation.moduleRoot}/repositories` ||
        resolvedSource.startsWith(`${moduleLocation.moduleRoot}/repositories/`)
    );
}

/**
 * @param {string} filename
 * @param {string} source
 * @returns {boolean}
 */
function isSameModuleRepositoryReexportPath(filename, source) {
    const moduleLocation = getModuleLocation(filename);
    if (!moduleLocation) return false;

    if (source.startsWith('#/modules/')) {
        return isSameModuleRepositoryAliasPath(moduleLocation, source);
    }

    if (!source.startsWith('.')) return false;
    return isSameModuleRepositoryRelativePath(filename, moduleLocation, source);
}

/**
 * @param {string} filename
 * @param {string} source
 * @returns {{ moduleName: string; importPath: string } | null}
 */
function getModuleImportLocation(filename, source) {
    const aliasMatch = /^#\/modules\/(.+)$/.exec(source);
    if (aliasMatch) {
        return parseModulePath(aliasMatch[1]);
    }

    if (!source.startsWith('.')) return null;

    const resolvedSource = normalizeFilePath(resolve(dirname(filename), source));
    const sourceRoot = getSourceRoot(filename);
    const moduleRoot = sourceRoot ? `${sourceRoot}/modules/` : null;
    if (moduleRoot && resolvedSource.startsWith(moduleRoot)) {
        return parseModulePath(resolvedSource.slice(moduleRoot.length));
    }

    const moduleMarker = '/src/modules/';
    const moduleMarkerIndex = resolvedSource.lastIndexOf(moduleMarker);
    if (moduleMarkerIndex < 0) return null;

    return parseModulePath(resolvedSource.slice(moduleMarkerIndex + moduleMarker.length));
}

const privateModuleFolders = new Set([
    'engine',
    'errors',
    'handlers',
    'models',
    'repositories',
    'runtime',
    'services',
    'transformers',
    'validators',
    'worklets',
]);

const privatePresentationFolders = new Set(['components', 'context', 'hooks', 'renderers', 'stores']);

/**
 * @param {string} importPath
 * @returns {string | null}
 */
function getPrivateImportFolder(importPath) {
    const [firstSegment, secondSegment] = importPath.split('/');

    if (privateModuleFolders.has(firstSegment)) {
        return firstSegment;
    }

    if (firstSegment !== 'presentations' || !secondSegment) {
        return null;
    }

    if (privatePresentationFolders.has(secondSegment)) {
        return `presentations/${secondSegment}`;
    }

    return null;
}

const nonModuleImporterFolders = new Set(['app', 'infra', 'routes']);

/**
 * @param {string} filename
 * @returns {string | null}
 */
function getSourceRelativePath(filename) {
    const normalized = normalizeFilePath(filename);
    const sourceMarker = '/src/';
    const sourceIndex = normalized.lastIndexOf(sourceMarker);

    if (sourceIndex >= 0) {
        return normalized.slice(sourceIndex + sourceMarker.length);
    }

    if (normalized.startsWith('src/')) {
        return normalized.slice('src/'.length);
    }

    return null;
}

/**
 * @param {string} filename
 * @returns {string | null}
 */
function getNonModuleImporterFolder(filename) {
    const normalized = normalizeFilePath(filename);
    if (!isProductionSourceFile(normalized)) return null;

    const sourceRelativePath = getSourceRelativePath(normalized);
    const sourceFolder = sourceRelativePath?.split('/')[0];
    if (!sourceFolder) return null;
    if (!nonModuleImporterFolders.has(sourceFolder)) return null;

    return sourceFolder;
}

const moduleContractFolders = new Set(['events', 'stores', 'useCases']);

/**
 * @param {string} importPath
 * @returns {string | null}
 */
function getDeepContractImportFolder(importPath) {
    const segments = importPath.split('/').filter(Boolean);
    const [firstSegment, secondSegment] = segments;

    if (moduleContractFolders.has(firstSegment)) {
        if (segments.length > 1) {
            return firstSegment;
        }

        return null;
    }

    if (firstSegment === 'presentations' && secondSegment === 'views' && segments.length > 2) {
        return 'presentations/views';
    }

    return null;
}

/**
 * @param {string} importPath
 * @returns {boolean}
 */
function isUseCaseImportPath(importPath) {
    const [firstSegment] = importPath.split('/').filter(Boolean);
    return firstSegment === 'useCases';
}

/**
 * @param {string} importPath
 * @returns {string | null}
 */
function getModelLayerImportTarget(importPath) {
    const [firstSegment] = importPath.split('/').filter(Boolean);
    if (firstSegment === 'useCases') return 'useCases';
    if (firstSegment === 'stores') return 'stores';

    return null;
}

/**
 * @param {string} importPath
 * @returns {boolean}
 */
function isStoresContractImportPath(importPath) {
    const segments = importPath.split('/').filter(Boolean);
    const [firstSegment, secondSegment] = segments;
    if (firstSegment !== 'stores') return false;

    return segments.length === 1 || (segments.length === 2 && /^index(?:\.[cm]?tsx?)?$/.test(secondSegment));
}

/**
 * @param {string} filename
 * @param {string} source
 * @returns {{ moduleName: string; importPath: string } | null}
 */
function getForeignStoresContractImportLocation(filename, source) {
    const importedModule = getModuleImportLocation(filename, source);
    if (!importedModule) return null;
    if (!isStoresContractImportPath(importedModule.importPath)) return null;

    const importerModule = getModuleLocation(filename);
    if (importerModule?.moduleName === importedModule.moduleName) return null;

    return importedModule;
}

/**
 * @param {any} specifier
 * @returns {string | null}
 */
function getImportSpecifierImportedName(specifier) {
    if (specifier.imported?.type === 'Identifier') {
        return specifier.imported.name;
    }

    if (specifier.imported?.type === 'Literal' && typeof specifier.imported.value === 'string') {
        return specifier.imported.value;
    }

    return null;
}

/**
 * @param {any} specifier
 * @returns {string | null}
 */
function getExportSpecifierLocalName(specifier) {
    if (specifier.local?.type === 'Identifier') {
        return specifier.local.name;
    }

    if (specifier.local?.type === 'Literal' && typeof specifier.local.value === 'string') {
        return specifier.local.value;
    }

    return null;
}

/**
 * @param {any} specifier
 * @returns {string | null}
 */
function getExportSpecifierExportedName(specifier) {
    if (specifier.exported?.type === 'Identifier') {
        return specifier.exported.name;
    }

    if (specifier.exported?.type === 'Literal' && typeof specifier.exported.value === 'string') {
        return specifier.exported.value;
    }

    return getExportSpecifierLocalName(specifier);
}

/**
 * @param {string} filename
 * @param {string} source
 * @returns {boolean}
 */
function isCreateStoreImportSource(filename, source) {
    if (source === '#/infra/store/createStore') return true;
    if (!source.startsWith('.')) return false;

    const resolvedSource = normalizeFilePath(resolve(dirname(filename), source));
    return (
        resolvedSource.endsWith('/src/infra/store/createStore') ||
        resolvedSource.endsWith('/src/infra/store/createStore.ts')
    );
}

/**
 * @param {string} filename
 * @param {string} source
 * @returns {boolean}
 */
function isStoreConstructorImportSource(filename, source) {
    if (source === '#/helpers/Store/Store' || source === '#/infra/store/Store') return true;
    if (!source.startsWith('.')) return false;

    const resolvedSource = normalizeFilePath(resolve(dirname(filename), source));
    return (
        resolvedSource.endsWith('/src/helpers/Store/Store') ||
        resolvedSource.endsWith('/src/helpers/Store/Store.ts') ||
        resolvedSource.endsWith('/src/infra/store/Store') ||
        resolvedSource.endsWith('/src/infra/store/Store.ts')
    );
}

/**
 * @param {any} node
 * @returns {any}
 */
function unwrapTypeScriptExpression(node) {
    let current = node;
    while (
        current?.type === 'TSAsExpression' ||
        current?.type === 'TSTypeAssertion' ||
        current?.type === 'TSNonNullExpression' ||
        current?.type === 'TSInstantiationExpression' ||
        current?.type === 'TSSatisfiesExpression'
    ) {
        current = current.expression;
    }

    return current;
}

/** @type {Map<string, Set<string>>} */
const exportedStoreInstanceNamesCache = new Map();

/**
 * @param {any} program
 * @param {string} filename
 * @param {Set<string>} seenFiles
 * @returns {Set<string>}
 */
function collectExportedStoreInstanceNamesFromProgram(program, filename, seenFiles) {
    /** @type {Set<string>} */
    const createStoreBindings = new Set();
    /** @type {Set<string>} */
    const storeConstructorBindings = new Set();
    /** @type {Set<string>} */
    const localStoreInstanceNames = new Set();
    /** @type {Set<string>} */
    const exportedStoreInstanceNames = new Set();

    for (const statement of program.body ?? []) {
        if (statement.type !== 'ImportDeclaration') continue;

        const value = statement.source?.value;
        if (typeof value !== 'string') continue;

        for (const specifier of statement.specifiers ?? []) {
            if (specifier.type === 'ImportSpecifier' && isCreateStoreImportSource(filename, value)) {
                const importedName = getImportSpecifierImportedName(specifier);
                if (importedName === 'createStore') {
                    createStoreBindings.add(specifier.local.name);
                }
                continue;
            }

            if (isStoreConstructorImportSource(filename, value)) {
                if (specifier.type === 'ImportDefaultSpecifier') {
                    storeConstructorBindings.add(specifier.local.name);
                    continue;
                }

                if (specifier.type === 'ImportSpecifier') {
                    const importedName = getImportSpecifierImportedName(specifier);
                    if (importedName === 'Store') {
                        storeConstructorBindings.add(specifier.local.name);
                    }
                }
            }
        }
    }

    /**
     * @param {any} expression
     * @returns {boolean}
     */
    function isStoreInstanceExpression(expression) {
        const unwrappedExpression = unwrapTypeScriptExpression(expression);
        if (
            unwrappedExpression?.type === 'CallExpression' &&
            unwrappedExpression.callee?.type === 'Identifier' &&
            createStoreBindings.has(unwrappedExpression.callee.name)
        ) {
            return true;
        }

        return (
            unwrappedExpression?.type === 'NewExpression' &&
            unwrappedExpression.callee?.type === 'Identifier' &&
            storeConstructorBindings.has(unwrappedExpression.callee.name)
        );
    }

    /**
     * @param {any} declaration
     * @returns {void}
     */
    function collectLocalStoreInstanceNames(declaration) {
        if (declaration?.type !== 'VariableDeclaration') return;

        for (const declarator of declaration.declarations ?? []) {
            if (declarator.id?.type !== 'Identifier') continue;
            if (!isStoreInstanceExpression(declarator.init)) continue;

            localStoreInstanceNames.add(declarator.id.name);
        }
    }

    for (const statement of program.body ?? []) {
        if (statement.type === 'VariableDeclaration') {
            collectLocalStoreInstanceNames(statement);
            continue;
        }

        if (statement.type === 'ExportNamedDeclaration') {
            collectLocalStoreInstanceNames(statement.declaration);
        }
    }

    for (const statement of program.body ?? []) {
        if (statement.type === 'ExportNamedDeclaration') {
            if (statement.exportKind === 'type') continue;

            if (statement.declaration?.type === 'VariableDeclaration') {
                for (const declarator of statement.declaration.declarations ?? []) {
                    if (declarator.id?.type === 'Identifier' && localStoreInstanceNames.has(declarator.id.name)) {
                        exportedStoreInstanceNames.add(declarator.id.name);
                    }
                }
                continue;
            }

            if (statement.source) {
                const value = statement.source.value;
                if (typeof value !== 'string') continue;

                const sourceStoreInstanceNames = getExportedStoreInstanceNamesFromSource(filename, value, seenFiles);
                for (const specifier of statement.specifiers ?? []) {
                    if (specifier.exportKind === 'type') continue;

                    const localName = getExportSpecifierLocalName(specifier);
                    const exportedName = getExportSpecifierExportedName(specifier);
                    if (!localName || !exportedName) continue;
                    if (!sourceStoreInstanceNames.has(localName)) continue;

                    exportedStoreInstanceNames.add(exportedName);
                }
                continue;
            }

            for (const specifier of statement.specifiers ?? []) {
                if (specifier.exportKind === 'type') continue;

                const localName = getExportSpecifierLocalName(specifier);
                const exportedName = getExportSpecifierExportedName(specifier);
                if (!localName || !exportedName) continue;
                if (!localStoreInstanceNames.has(localName)) continue;

                exportedStoreInstanceNames.add(exportedName);
            }
            continue;
        }

        if (statement.type !== 'ExportAllDeclaration') continue;
        if (statement.exportKind === 'type') continue;

        const value = statement.source?.value;
        if (typeof value !== 'string') continue;

        const sourceStoreInstanceNames = getExportedStoreInstanceNamesFromSource(filename, value, seenFiles);
        for (const name of sourceStoreInstanceNames) {
            exportedStoreInstanceNames.add(name);
        }
    }

    return exportedStoreInstanceNames;
}

/**
 * @param {string} filename
 * @param {string} source
 * @param {Set<string>} seenFiles
 * @returns {Set<string>}
 */
function getExportedStoreInstanceNamesFromSource(filename, source, seenFiles) {
    const sourceFile = resolveSourceExportFile(filename, source);
    if (!sourceFile) return new Set();
    if (seenFiles.has(sourceFile)) return new Set();

    const cached = exportedStoreInstanceNamesCache.get(sourceFile);
    if (cached) return cached;

    seenFiles.add(sourceFile);
    try {
        const text = readFileSync(sourceFile, 'utf8');
        const parsed = tseslint.parser.parseForESLint(text, {
            filePath: sourceFile,
            sourceType: 'module',
            ecmaVersion: 'latest',
        });
        const exportedStoreInstanceNames = collectExportedStoreInstanceNamesFromProgram(
            parsed.ast,
            sourceFile,
            seenFiles
        );
        exportedStoreInstanceNamesCache.set(sourceFile, exportedStoreInstanceNames);
        return exportedStoreInstanceNames;
    } catch {
        return new Set();
    } finally {
        seenFiles.delete(sourceFile);
    }
}

/**
 * @param {any} node
 * @returns {string | null}
 */
function getStaticMemberPropertyName(node) {
    if (node?.property?.type === 'Identifier' && !node.computed) {
        return node.property.name;
    }

    if (node?.property?.type === 'Literal' && typeof node.property.value === 'string') {
        return node.property.value;
    }

    return null;
}

/**
 * @param {string} importPath
 * @returns {string | null}
 */
function getNonModulePrivateImportTarget(importPath) {
    const privateFolder = getPrivateImportFolder(importPath);
    if (privateFolder) {
        return privateFolder;
    }

    return getDeepContractImportFolder(importPath);
}

/**
 * @param {any} node
 * @returns {string | null}
 */
function getLiteralStringValue(node) {
    if (node?.type === 'Literal' && typeof node.value === 'string') {
        return node.value;
    }

    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
        const [quasi] = node.quasis;
        const cooked = quasi.value?.cooked;
        if (typeof cooked === 'string') {
            return cooked;
        }

        const raw = quasi.value?.raw;
        if (typeof raw === 'string') {
            return raw;
        }
    }

    return null;
}

/**
 * @param {any} node
 * @returns {boolean}
 */
function isTypeOnlyImportDeclaration(node) {
    if (node.importKind === 'type') {
        return true;
    }

    const specifiers = node.specifiers ?? [];
    return (
        specifiers.length > 0 &&
        specifiers.every((specifier) => specifier.type === 'ImportSpecifier' && specifier.importKind === 'type')
    );
}

/**
 * @param {any} node
 * @returns {string | null}
 */
function getTypeQueryImportSource(node) {
    const argument = node.argument;
    if (argument?.type === 'Literal' && typeof argument.value === 'string') {
        return argument.value;
    }

    if (argument?.type === 'TSLiteralType' && argument.literal?.type === 'Literal') {
        const value = argument.literal.value;
        if (typeof value === 'string') {
            return value;
        }
    }

    return null;
}

/**
 * @param {(node: any, source: string) => void} reportSource
 * @returns {import('eslint').Rule.RuleListener}
 */
function createReactImportSourceVisitors(reportSource) {
    return {
        /** @param {any} node */
        ImportDeclaration(node) {
            const value = node.source.value;
            if (typeof value !== 'string') return;

            reportSource(node, value);
        },
        /** @param {any} node */
        ExportAllDeclaration(node) {
            const value = getLiteralStringValue(node.source);
            if (!value) return;

            reportSource(node, value);
        },
        /** @param {any} node */
        ExportNamedDeclaration(node) {
            const value = getLiteralStringValue(node.source);
            if (!value) return;

            reportSource(node, value);
        },
        /** @param {any} node */
        ImportExpression(node) {
            const value = getLiteralStringValue(node.source);
            if (!value) return;

            reportSource(node, value);
        },
        /** @param {any} node */
        TSImportType(node) {
            const value = getTypeQueryImportSource(node);
            if (!value) return;

            reportSource(node, value);
        },
    };
}

const sourdawPlugin = {
    meta: {
        name: 'eslint-plugin-sourdaw',
    },
    rules: {
        'no-useeffect-fetching': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Disallow fetching/query execution in useEffect/useLayoutEffect. Use TanStack Query hooks.',
                },
                schema: [],
                messages: {
                    noUseEffectFetching:
                        'Do not fetch data in useEffect/useLayoutEffect. Use a TanStack Query hook or repository-backed query hook instead.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                return {
                    /** @param {any} node */
                    CallExpression(node) {
                        if (!isReactEffectCall(node)) return;
                        const body = getEffectBody(node);
                        if (!body) return;

                        let found = false;
                        traverse(body, (inner) => {
                            if (found) return;
                            if (isFetchLikeCall(inner)) {
                                found = true;
                                context.report({
                                    node: inner,
                                    messageId: 'noUseEffectFetching',
                                });
                            }
                        });
                    },
                };
            },
        },

        'no-useeffect-derived-state': {
            meta: {
                type: 'suggestion',
                docs: {
                    description: 'Warn when useEffect/useLayoutEffect appears to only mirror data into local state.',
                },
                schema: [],
                messages: {
                    noDerivedStateEffect:
                        'This effect looks like derived state. Derive during render, move to a selector/transformer, or justify the imperative sync explicitly.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                return {
                    /** @param {any} node */
                    CallExpression(node) {
                        if (!isReactEffectCall(node)) return;
                        const body = getEffectBody(node);
                        if (!body || body.type !== 'BlockStatement') return;
                        if (bodyContainsAsyncOrFetch(body)) return;
                        if (!bodyLooksLikeDerivedStateEffect(body)) return;

                        context.report({
                            node,
                            messageId: 'noDerivedStateEffect',
                        });
                    },
                };
            },
        },

        'no-manual-memoization': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Disallow useMemo/useCallback/React.memo in app code. Prefer React Compiler and architectural simplification.',
                },
                schema: [],
                messages: {
                    noManualMemoization:
                        'Manual memoization is not allowed here. Prefer architectural simplification and let React Compiler handle memoization.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                // Local binding names for `memo` imported from 'react' (handles
                // `import { memo }` and `import { memo as m }`). A bare `memo()`
                // call only counts as manual memoization when it resolves to
                // React's memo — not to some unrelated function named `memo`.
                /** @type {Set<string>} */
                const reactMemoBindings = new Set();

                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        if (node.source.value !== 'react') return;
                        for (const spec of node.specifiers) {
                            if (
                                spec.type === 'ImportSpecifier' &&
                                spec.imported?.type === 'Identifier' &&
                                spec.imported.name === 'memo'
                            ) {
                                reactMemoBindings.add(spec.local.name);
                            }
                        }
                    },
                    /** @param {any} node */
                    CallExpression(node) {
                        if (
                            node.callee.type === 'Identifier' &&
                            (node.callee.name === 'useMemo' || node.callee.name === 'useCallback')
                        ) {
                            context.report({
                                node,
                                messageId: 'noManualMemoization',
                            });
                        }

                        // Bare `memo(...)` imported from react (e.g. `import { memo }`).
                        if (
                            node.callee.type === 'Identifier' &&
                            reactMemoBindings.has(node.callee.name)
                        ) {
                            context.report({
                                node,
                                messageId: 'noManualMemoization',
                            });
                        }

                        if (
                            node.callee.type === 'MemberExpression' &&
                            node.callee.object?.type === 'Identifier' &&
                            node.callee.object.name === 'React' &&
                            node.callee.property?.type === 'Identifier' &&
                            node.callee.property.name === 'memo'
                        ) {
                            context.report({
                                node,
                                messageId: 'noManualMemoization',
                            });
                        }
                    },
                };
            },
        },

        'no-tauri-api-in-ui': {
            meta: {
                type: 'problem',
                docs: {
                    description: 'Disallow direct @tauri-apps/api usage in presentation code.',
                },
                schema: [],
                messages: {
                    noTauriApiInUi:
                        'Do not use @tauri-apps/api directly in presentation code. Go through a repository, adapter, or use case.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isPresentationFile(context.filename)) return {};

                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        const value = node.source.value;
                        if (typeof value !== 'string') return;

                        if (value.startsWith('@tauri-apps/api')) {
                            context.report({
                                node,
                                messageId: 'noTauriApiInUi',
                            });
                        }
                    },
                };
            },
        },

        'no-react-in-domain-logic': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Disallow React imports in domain logic layers such as useCases/services/validators/transformers.',
                },
                schema: [],
                messages: {
                    noReactInDomainLogic:
                        'Do not import or re-export React/ReactDOM APIs in domain logic layers. Move UI concerns outward or extract pure domain code.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isDomainLogicFile(context.filename)) return {};

                return createReactImportSourceVisitors((node, source) => {
                    if (!isReactImportSource(source)) return;

                    context.report({
                        node,
                        messageId: 'noReactInDomainLogic',
                    });
                });
            },
        },

        'no-react-import-outside-ui': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Warn when production files import or re-export React/ReactDOM outside approved UI/adaptor files.',
                },
                schema: [],
                messages: {
                    noReactImportOutsideUi:
                        'Do not import or re-export `{{source}}` outside approved UI/adaptor files. Keep React APIs in presentation, route, approved app entrypoint, store adapter, or UI utility code.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isProductionSourceFile(context.filename) || isFixtureFile(context.filename)) return {};
                if (isDomainLogicFile(context.filename)) return {};
                if (isApprovedReactImportFile(context.filename)) return {};

                /**
                 * @param {any} node
                 * @param {string} source
                 * @returns {void}
                 */
                function reportIfReactImport(node, source) {
                    if (!isReactImportSource(source)) return;

                    context.report({
                        node,
                        messageId: 'noReactImportOutsideUi',
                        data: { source },
                    });
                }

                return createReactImportSourceVisitors(reportIfReactImport);
            },
        },

        'no-type-only-private-module-import': {
            meta: {
                type: 'problem',
                docs: {
                    description: 'Warn on type-only imports from another module private folder.',
                },
                schema: [],
                messages: {
                    noTypeOnlyPrivateModuleImport:
                        'Do not import types from another module private folder (`{{folder}}`). Use an events contract, public value contract derivation, or a local consumer-owned type.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isProductionSourceFile(context.filename)) return {};

                /**
                 * @param {any} node
                 * @param {string} source
                 * @returns {void}
                 */
                function reportIfPrivateTypeImport(node, source) {
                    const importedModule = getModuleImportLocation(context.filename, source);
                    if (!importedModule) return;

                    const importerModule = getModuleLocation(context.filename);
                    if (importerModule?.moduleName === importedModule.moduleName) return;

                    const folder = getPrivateImportFolder(importedModule.importPath);
                    if (!folder) return;

                    context.report({
                        node,
                        messageId: 'noTypeOnlyPrivateModuleImport',
                        data: { folder },
                    });
                }

                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        if (!isTypeOnlyImportDeclaration(node)) return;

                        const value = node.source.value;
                        if (typeof value !== 'string') return;

                        reportIfPrivateTypeImport(node, value);
                    },
                    /** @param {any} node */
                    TSImportType(node) {
                        const value = getTypeQueryImportSource(node);
                        if (!value) return;

                        reportIfPrivateTypeImport(node, value);
                    },
                };
            },
        },

        'no-nonmodule-private-module-import': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Warn when non-module production files import module private folders or deep contract files.',
                },
                schema: [],
                messages: {
                    noNonmodulePrivateModuleImport:
                        'Do not import module private folders or deep contract files (`{{target}}`) from `src/{{sourceFolder}}/`. Import from the module contract-folder barrel instead.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                const sourceFolder = getNonModuleImporterFolder(context.filename);
                if (!sourceFolder) return {};

                /**
                 * @param {any} node
                 * @param {string} source
                 * @param {boolean} includePrivateFolders
                 * @returns {void}
                 */
                function reportIfPrivateModuleImport(node, source, includePrivateFolders) {
                    const importedModule = getModuleImportLocation(context.filename, source);
                    if (!importedModule) return;

                    const importerModule = getModuleLocation(context.filename);
                    if (importerModule?.moduleName === importedModule.moduleName) return;

                    const target = includePrivateFolders
                        ? getNonModulePrivateImportTarget(importedModule.importPath)
                        : getDeepContractImportFolder(importedModule.importPath);
                    if (!target) return;

                    context.report({
                        node,
                        messageId: 'noNonmodulePrivateModuleImport',
                        data: { sourceFolder, target },
                    });
                }

                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        const value = node.source.value;
                        if (typeof value !== 'string') return;

                        reportIfPrivateModuleImport(node, value, !isTypeOnlyImportDeclaration(node));
                    },
                    /** @param {any} node */
                    ExportAllDeclaration(node) {
                        const value = getLiteralStringValue(node.source);
                        if (!value) return;

                        reportIfPrivateModuleImport(node, value, true);
                    },
                    /** @param {any} node */
                    ExportNamedDeclaration(node) {
                        const value = getLiteralStringValue(node.source);
                        if (!value) return;

                        reportIfPrivateModuleImport(node, value, true);
                    },
                    /** @param {any} node */
                    ImportExpression(node) {
                        const value = getLiteralStringValue(node.source);
                        if (!value) return;

                        reportIfPrivateModuleImport(node, value, true);
                    },
                    /** @param {any} node */
                    TSImportType(node) {
                        const value = getTypeQueryImportSource(node);
                        if (!value) return;

                        reportIfPrivateModuleImport(node, value, false);
                    },
                };
            },
        },

        'no-repository-usecase-import': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Warn when production repository files import or re-export use-case layer APIs.',
                },
                schema: [],
                messages: {
                    noRepositoryUsecaseImport:
                        'Do not import use cases from repository files. Repositories are I/O internals called by use cases, not callers of them.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isProductionRepositoryFile(context.filename)) return {};

                /**
                 * @param {any} node
                 * @param {string} source
                 * @returns {void}
                 */
                function reportIfUseCaseImport(node, source) {
                    const importedModule = getModuleImportLocation(context.filename, source);
                    if (!importedModule) return;
                    if (!isUseCaseImportPath(importedModule.importPath)) return;

                    context.report({
                        node,
                        messageId: 'noRepositoryUsecaseImport',
                    });
                }

                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        const value = node.source.value;
                        if (typeof value !== 'string') return;

                        reportIfUseCaseImport(node, value);
                    },
                    /** @param {any} node */
                    ExportAllDeclaration(node) {
                        const value = getLiteralStringValue(node.source);
                        if (!value) return;

                        reportIfUseCaseImport(node, value);
                    },
                    /** @param {any} node */
                    ExportNamedDeclaration(node) {
                        const value = getLiteralStringValue(node.source);
                        if (!value) return;

                        reportIfUseCaseImport(node, value);
                    },
                    /** @param {any} node */
                    ImportExpression(node) {
                        const value = getLiteralStringValue(node.source);
                        if (!value) return;

                        reportIfUseCaseImport(node, value);
                    },
                    /** @param {any} node */
                    TSImportType(node) {
                        const value = getTypeQueryImportSource(node);
                        if (!value) return;

                        reportIfUseCaseImport(node, value);
                    },
                };
            },
        },

        'no-model-layer-upward-import': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Warn when production model files import or re-export use-case or store layer APIs.',
                },
                schema: [],
                messages: {
                    noModelLayerUpwardImport:
                        'Do not import `{{target}}` from model files. Models must stay below stores/use cases; move orchestration to use cases or local consumer-owned types.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isProductionModelFile(context.filename)) return {};

                /**
                 * @param {any} node
                 * @param {string} source
                 * @returns {void}
                 */
                function reportIfModelLayerImport(node, source) {
                    const importedModule = getModuleImportLocation(context.filename, source);
                    if (!importedModule) return;

                    const target = getModelLayerImportTarget(importedModule.importPath);
                    if (!target) return;

                    context.report({
                        node,
                        messageId: 'noModelLayerUpwardImport',
                        data: { target },
                    });
                }

                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        const value = node.source.value;
                        if (typeof value !== 'string') return;

                        reportIfModelLayerImport(node, value);
                    },
                    /** @param {any} node */
                    ExportAllDeclaration(node) {
                        const value = getLiteralStringValue(node.source);
                        if (!value) return;

                        reportIfModelLayerImport(node, value);
                    },
                    /** @param {any} node */
                    ExportNamedDeclaration(node) {
                        const value = getLiteralStringValue(node.source);
                        if (!value) return;

                        reportIfModelLayerImport(node, value);
                    },
                    /** @param {any} node */
                    ImportExpression(node) {
                        const value = getLiteralStringValue(node.source);
                        if (!value) return;

                        reportIfModelLayerImport(node, value);
                    },
                    /** @param {any} node */
                    TSImportType(node) {
                        const value = getTypeQueryImportSource(node);
                        if (!value) return;

                        reportIfModelLayerImport(node, value);
                    },
                };
            },
        },

        'no-foreign-store-write': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Warn when production code writes directly to a store imported from another module stores contract.',
                },
                schema: [],
                messages: {
                    noForeignStoreWrite:
                        'Do not call `{{method}}` on `{{storeName}}` from `{{moduleName}}/stores`. Route writes through the owning module use-case or action boundary.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isProductionSourceFile(context.filename) || isFixtureFile(context.filename)) return {};

                const sourceCode = context.sourceCode;

                /** @type {Map<any, { storeName: string; moduleName: string }>} */
                const foreignStoreBindings = new Map();

                /**
                 * @param {any} specifier
                 * @returns {any | null}
                 */
                function getImportVariable(specifier) {
                    const variables = sourceCode.getDeclaredVariables(specifier);
                    return variables.find((variable) => variable.name === specifier.local?.name) ?? null;
                }

                /**
                 * @param {any} identifier
                 * @returns {any | null}
                 */
                function getResolvedVariable(identifier) {
                    let scope = sourceCode.getScope(identifier);
                    while (scope) {
                        const variable = scope.set.get(identifier.name);
                        if (variable) {
                            return variable;
                        }

                        scope = scope.upper;
                    }

                    return null;
                }

                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        if (isTypeOnlyImportDeclaration(node)) return;

                        const value = node.source.value;
                        if (typeof value !== 'string') return;

                        const importedModule = getForeignStoresContractImportLocation(context.filename, value);
                        if (!importedModule) return;

                        const storeExportNames = getExportedStoreInstanceNamesFromSource(
                            context.filename,
                            value,
                            new Set()
                        );

                        for (const specifier of node.specifiers ?? []) {
                            if (specifier.type !== 'ImportSpecifier') continue;
                            if (specifier.importKind === 'type') continue;
                            if (specifier.local?.type !== 'Identifier') continue;

                            const storeName = getImportSpecifierImportedName(specifier);
                            if (!storeName) continue;
                            if (!storeExportNames.has(storeName)) continue;

                            const importedVariable = getImportVariable(specifier);
                            if (!importedVariable) continue;

                            foreignStoreBindings.set(importedVariable, {
                                storeName,
                                moduleName: importedModule.moduleName,
                            });
                        }
                    },
                    /** @param {any} node */
                    VariableDeclarator(node) {
                        if (node.parent?.kind !== 'const') return;
                        if (node.id?.type !== 'Identifier') return;
                        if (node.init?.type !== 'Identifier') return;

                        const sourceVariable = getResolvedVariable(node.init);
                        if (!sourceVariable) return;

                        const binding = foreignStoreBindings.get(sourceVariable);
                        if (!binding) return;

                        const variables = sourceCode.getDeclaredVariables(node);
                        const aliasVariable = variables.find((variable) => variable.name === node.id.name);
                        if (!aliasVariable) return;

                        foreignStoreBindings.set(aliasVariable, binding);
                    },
                    /** @param {any} node */
                    CallExpression(node) {
                        const callee = node.callee;
                        if (callee?.type !== 'MemberExpression') return;

                        const method = getStaticMemberPropertyName(callee);
                        if (method !== 'set' && method !== 'update') return;
                        if (callee.object?.type !== 'Identifier') return;

                        const resolvedVariable = getResolvedVariable(callee.object);
                        if (!resolvedVariable) return;

                        const binding = foreignStoreBindings.get(resolvedVariable);
                        if (!binding) return;

                        context.report({
                            node,
                            messageId: 'noForeignStoreWrite',
                            data: {
                                method,
                                storeName: binding.storeName,
                                moduleName: binding.moduleName,
                            },
                        });
                    },
                };
            },
        },

        'no-usecase-repository-reexport': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Disallow laundering same-module repository exports through production use-case files.',
                },
                schema: [],
                messages: {
                    noUsecaseRepositoryReexport:
                        'Do not re-export repositories from use-case files. Write a use-case function that imports the repository privately.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isProductionUseCaseFile(context.filename)) return {};

                /**
                 * @param {any} node
                 * @returns {void}
                 */
                function reportIfRepositoryReexport(node) {
                    const value = node.source?.value;
                    if (typeof value !== 'string') return;
                    if (!isSameModuleRepositoryReexportPath(context.filename, value)) return;

                    context.report({
                        node,
                        messageId: 'noUsecaseRepositoryReexport',
                    });
                }

                return {
                    /** @param {any} node */
                    ExportAllDeclaration(node) {
                        reportIfRepositoryReexport(node);
                    },
                    /** @param {any} node */
                    ExportNamedDeclaration(node) {
                        reportIfRepositoryReexport(node);
                    },
                };
            },
        },

        'no-multiple-function-exports': {
            meta: {
                type: 'suggestion',
                docs: {
                    description:
                        'Warn when production use-case or repository files export more than one function value.',
                },
                schema: [],
                messages: {
                    noMultipleFunctionExports:
                        'Use-case and repository files must export at most one function value. Found {{count}} exported functions: {{names}}.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isProductionUseCaseOrRepositoryFile(context.filename)) return {};

                /** @type {Map<string, any>} */
                const localFunctionValues = new Map();
                /** @type {Map<string, any>} */
                const sourceExportedFunctionValues = new Map();
                /** @type {Set<string>} */
                const directlyExportedNames = new Set();
                /** @type {Set<string>} */
                const explicitlyExportedNames = new Set();
                /** @type {Set<string>} */
                const injectBindings = new Set();

                /**
                 * @param {any} node
                 * @param {string | null | undefined} name
                 * @returns {void}
                 */
                function registerFunctionValue(node, name) {
                    if (!name) return;
                    localFunctionValues.set(name, node);
                }

                /**
                 * @param {any} node
                 * @param {string | null | undefined} name
                 * @returns {void}
                 */
                function registerDirectExport(node, name) {
                    registerFunctionValue(node, name);
                    if (!name) return;
                    directlyExportedNames.add(name);
                }

                /**
                 * @param {any} node
                 * @param {string | null | undefined} name
                 * @returns {void}
                 */
                function registerSourceExport(node, name) {
                    if (!name) return;
                    sourceExportedFunctionValues.set(name, node);
                }

                /**
                 * @param {any} declarator
                 * @returns {void}
                 */
                function registerVariableFunctionValue(declarator) {
                    if (declarator.id?.type !== 'Identifier') return;
                    if (!isFunctionValue(declarator.init, injectBindings)) return;

                    registerFunctionValue(declarator.id, declarator.id.name);
                }

                /**
                 * @param {any} declarator
                 * @returns {void}
                 */
                function registerExportedVariableFunctionValue(declarator) {
                    if (declarator.id?.type !== 'Identifier') return;
                    if (!isFunctionValue(declarator.init, injectBindings)) return;

                    registerDirectExport(declarator.id, declarator.id.name);
                }

                /**
                 * @returns {Array<{ name: string; node: any }>}
                 */
                function getExportedFunctionValues() {
                    /** @type {Array<{ name: string; node: any }>} */
                    const exportedFunctionValues = [];
                    const seenNames = new Set();

                    for (const name of directlyExportedNames) {
                        const node = localFunctionValues.get(name);
                        if (!node || seenNames.has(name)) continue;

                        exportedFunctionValues.push({ name, node });
                        seenNames.add(name);
                    }

                    for (const name of explicitlyExportedNames) {
                        const node = localFunctionValues.get(name);
                        if (!node || seenNames.has(name)) continue;

                        exportedFunctionValues.push({ name, node });
                        seenNames.add(name);
                    }

                    for (const [name, node] of sourceExportedFunctionValues) {
                        if (!node || seenNames.has(name)) continue;

                        exportedFunctionValues.push({ name, node });
                        seenNames.add(name);
                    }

                    return exportedFunctionValues;
                }

                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        collectInjectBindings(node, context.filename, injectBindings);
                    },
                    /** @param {any} node */
                    FunctionDeclaration(node) {
                        const parentType = node.parent?.type;
                        if (parentType !== 'Program' && parentType !== 'ExportNamedDeclaration') return;

                        registerFunctionValue(node, node.id?.name);
                    },
                    /** @param {any} node */
                    VariableDeclarator(node) {
                        const declaration = node.parent;
                        const parentType = declaration?.parent?.type;
                        if (
                            declaration?.type !== 'VariableDeclaration' ||
                            (parentType !== 'Program' && parentType !== 'ExportNamedDeclaration')
                        ) {
                            return;
                        }

                        registerVariableFunctionValue(node);
                    },
                    /** @param {any} node */
                    ExportNamedDeclaration(node) {
                        if (node.exportKind === 'type') return;

                        if (node.source) {
                            const value = node.source.value;
                            if (typeof value !== 'string') return;

                            const sourceFunctionNames = getExportedFunctionNamesFromSource(
                                context.filename,
                                value,
                                new Set()
                            );
                            for (const specifier of node.specifiers ?? []) {
                                if (specifier.exportKind === 'type') continue;
                                if (specifier.local?.type !== 'Identifier') continue;
                                if (!sourceFunctionNames.has(specifier.local.name)) continue;

                                const exportedName = specifier.exported?.name ?? specifier.local.name;
                                registerSourceExport(specifier, exportedName);
                            }
                            return;
                        }

                        if (node.declaration?.type === 'FunctionDeclaration') {
                            registerDirectExport(node.declaration, node.declaration.id?.name);
                            return;
                        }

                        if (node.declaration?.type === 'VariableDeclaration') {
                            for (const declarator of node.declaration.declarations ?? []) {
                                registerExportedVariableFunctionValue(declarator);
                            }
                            return;
                        }

                        for (const specifier of node.specifiers ?? []) {
                            if (specifier.exportKind === 'type') continue;
                            if (specifier.local?.type !== 'Identifier') continue;

                            explicitlyExportedNames.add(specifier.local.name);
                        }
                    },
                    /** @param {any} node */
                    ExportAllDeclaration(node) {
                        if (node.exportKind === 'type') return;

                        const value = node.source?.value;
                        if (typeof value !== 'string') return;

                        const sourceFunctionNames = getExportedFunctionNamesFromSource(
                            context.filename,
                            value,
                            new Set()
                        );
                        for (const name of sourceFunctionNames) {
                            registerSourceExport(node, name);
                        }
                    },
                    /** @param {any} node */
                    'Program:exit'(node) {
                        const exportedFunctionValues = getExportedFunctionValues();
                        if (exportedFunctionValues.length <= 1) return;

                        const reportTarget = exportedFunctionValues[1]?.node ?? node;
                        context.report({
                            node: reportTarget,
                            messageId: 'noMultipleFunctionExports',
                            data: {
                                count: String(exportedFunctionValues.length),
                                names: exportedFunctionValues.map((value) => value.name).join(', '),
                            },
                        });
                    },
                };
            },
        },

        // AGENTS.md L147: Prefer `as const` objects over `enum`.
        'no-enum': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Disallow `enum` declarations. Use `as const` objects instead (AGENTS.md § React 19 & Coding Conventions).',
                },
                schema: [],
                messages: {
                    noEnum: 'Do not use `enum`. Use an `as const` object instead. See AGENTS.md § React 19 & Coding Conventions → TypeScript Forms.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                return {
                    /** @param {any} node */
                    TSEnumDeclaration(node) {
                        context.report({ node, messageId: 'noEnum' });
                    },
                };
            },
        },

        // AGENTS.md L149: Never use namespace imports (`import * as X`). Zod is exempted because
        // `import * as z from 'zod'` is the standard documented pattern (docs/02-forms.md).
        'no-namespace-import': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Disallow namespace imports (`import * as X`). Always import named exports individually (AGENTS.md § React 19 & Coding Conventions).',
                },
                schema: [],
                messages: {
                    noNamespaceImport:
                        'Do not use namespace imports (`import * as X from ...`). Import named exports individually. See AGENTS.md § React 19 & Coding Conventions.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        const source = node.source.value;
                        if (source === 'zod' || (typeof source === 'string' && source.startsWith('zod/'))) return;

                        for (const specifier of node.specifiers ?? []) {
                            if (specifier.type === 'ImportNamespaceSpecifier') {
                                context.report({ node: specifier, messageId: 'noNamespaceImport' });
                            }
                        }
                    },
                };
            },
        },

        // AGENTS.md L148: `as`, `as any`, or `as unknown as …` to silence compiler errors is forbidden.
        // Catches `x as any` and the `x as unknown as T` double-assertion escape hatch.
        'no-type-assertion-escape': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Disallow `as any` and `as unknown as X` — forbidden soundness escapes (AGENTS.md § TypeScript — soundness).',
                },
                schema: [],
                messages: {
                    noAsAny:
                        '`as any` is forbidden. Fix the value or the type. Use `unknown` + narrowing, `satisfies`, or Zod validation at I/O boundaries.',
                    noAsUnknownAs:
                        '`as unknown as X` double-assertion is forbidden — it silences the type checker. Narrow via `unknown` + type guards or validate with Zod at I/O boundaries.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                return {
                    /** @param {any} node */
                    TSAsExpression(node) {
                        // `x as any`
                        if (node.typeAnnotation?.type === 'TSAnyKeyword') {
                            context.report({ node, messageId: 'noAsAny' });
                            return;
                        }
                        // `x as unknown as T`: outer TSAsExpression where inner is `as unknown`
                        if (
                            node.expression?.type === 'TSAsExpression' &&
                            node.expression.typeAnnotation?.type === 'TSUnknownKeyword'
                        ) {
                            context.report({ node, messageId: 'noAsUnknownAs' });
                        }
                    },
                };
            },
        },
    },
};
export default defineConfig(
    // ─── Base configs ────────────────────────────────────────────────────────
    // Only configs whose rules oxlint 1.74 cannot run are kept here. Everything
    // oxlint covers (ESLint core/recommended, unicorn, promise, import-x,
    // jsx-a11y, and all typescript-eslint rules incl. type-aware via tsgolint)
    // lives in .oxlintrc.json and is intentionally absent below so the two
    // linters never double-report.
    eslintPluginComments.recommended,
    eslintPluginReact.configs['recommended-type-checked'],
    eslintPluginReactHooks.configs.flat['recommended-latest'],
    eslintPluginQuery.configs['flat/recommended'],

    // ─── Ignores ─────────────────────────────────────────────────────────────
    {
        ignores: [
            'build/',
            'dist/',
            'node_modules/',
            'public/',
            'coverage/',
            'storybook-static/',
            // Standalone agent helper scripts run via
            // `node --experimental-strip-types`, not part of the `src` app tree
            // and intentionally excluded from tsconfig.eslint.json — ignore so
            // the type-aware parser does not fatal on files outside any project.
            '.agents/',
            'src/routeTree.gen.ts',
            // wasm-bindgen output. Both the glue `.js` and the `.d.ts` are
            // rewritten wholesale by `pnpm wasm:all`, including the
            // `/* eslint-disable */` header wasm-bindgen emits, so any
            // in-file fix is erased on the next build.
            'src/modules/AudioEngine/wasm/*.js',
            'src/modules/AudioEngine/wasm/*.d.ts',
            'test-debug.mjs',
            'test-manual-fix.mjs',
            'test-manual-fix.ts',
            '**/*.md',
        ],
    },

    // ─── Global settings ─────────────────────────────────────────────────────
    // NOTE: reportUnusedDisableDirectives is intentionally off — disable
    // directives in src now suppress oxlint-owned rules (oxlint honors
    // eslint-disable comments), so ESLint cannot tell they are still in use,
    // and oxlint conversely cannot see the retained rules below. Neither tool
    // can own that hygiene without false positives in a split setup.
    {
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
        plugins: {
            '@stylistic': eslintPluginStylistic,
            '@typescript-eslint': tseslint.plugin,
            'import-x': eslintPluginImport,
            'jsx-a11y-x': eslintPluginJsxA11yX,
            promise: eslintPluginPromise,
            '@tanstack/query': eslintPluginQuery,
            sourdaw: sourdawPlugin,
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
            parser: tseslint.parser,
            parserOptions: {
                project: './tsconfig.eslint.json',
                tsconfigRootDir: import.meta.dirname,
                ecmaFeatures: { jsx: true },
            },
        },
        settings: {
            react: { version: 'detect' },
            'import-x/resolver-next': [createTypeScriptImportResolver(), createNodeResolver()],
        },
    },

    // ─── All JS/TS files ─────────────────────────────────────────────────────
    {
        files: ['**/*.{js,jsx,ts,tsx,mts,cts}'],
        rules: {
            // ── Retained ESLint-core rules (not implemented by oxlint 1.74) ──
            'consistent-return': 'error',
            'no-invalid-this': 'error',
            'no-octal': 'error',
            // Oxlint's preserve-caught-error does not recognise an attached
            // `cause` on AggregateError (false positive); ESLint enforces it.
            'preserve-caught-error': 'error',
            // Oxlint's no-useless-computed-key reports computed keys with TS
            // assertions (`['--x' as string]`); ESLint enforces it.
            'no-useless-computed-key': 'error',
            // Oxlint's no-void treats `() => void x` as an allowed statement;
            // ESLint enforces the warn on expression-position `void`.
            'no-void': ['warn', { allowAsStatement: true }],

            // ── Code style not covered by oxlint ─────────────────────────────
            '@stylistic/spaced-comment': [
                'error',
                'always',
                {
                    line: { markers: ['/'], exceptions: ['/', '#'] },
                    block: { markers: ['!'], exceptions: ['*'], balanced: true },
                },
            ],

            // ── Import hygiene retained in ESLint ────────────────────────────
            // oxlint 1.74 has no import/order implementation.
            'import-x/order': [
                'error',
                {
                    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
                    pathGroups: [
                        { pattern: 'react', group: 'external', position: 'before' },
                        { pattern: 'src/**', group: 'internal', position: 'before' },
                    ],
                    pathGroupsExcludedImportTypes: ['react'],
                    'newlines-between': 'always',
                    alphabetize: {
                        order: 'asc',
                        caseInsensitive: true,
                    },
                },
            ],
            'sourdaw/no-react-import-outside-ui': 'warn',

            // ── Promise rules retained in ESLint ─────────────────────────────
            // Oxlint's no-return-wrap also fires on non-promise callbacks
            // (stricter); ESLint keeps the exact current semantics.
            'promise/no-return-wrap': 'error',

            // ── a11y retained in ESLint ──────────────────────────────────────
            // jsx-a11y-x (fork) defaults differ from oxlint's jsx-a11y
            // implementation for this rule; severity mirrors the preset.
            'jsx-a11y-x/interactive-supports-focus': 'error',
        },
    },

    // ─── TypeScript files ────────────────────────────────────────────────────
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        rules: {
            // AGENTS.md L150: No single-letter generic type parameters.
            // oxlint 1.74 has no naming-convention implementation.
            '@typescript-eslint/naming-convention': [
                'error',
                {
                    selector: 'typeParameter',
                    format: ['PascalCase'],
                    custom: { regex: '^.{2,}$', match: true },
                },
            ],

            // AGENTS.md L150: No single-letter variable names.
            // `_` is kept for intentionally-unused destructured positional slots.
            // Oxlint's id-length also reports TS type members (stricter); ESLint
            // keeps the exact current semantics.
            'id-length': [
                'error',
                {
                    min: 2,
                    exceptions: [
                        '_',
                        'x',
                        'y',
                        'z',
                        'w',
                        'h',
                        'r',
                        'g',
                        'b',
                        'a',
                        'i',
                        'j',
                        'k',
                        'v',
                        'e',
                        't',
                        'c',
                        'd',
                        'f',
                        'm',
                        'q',
                        's',
                        'u',
                        'p',
                        'l',
                        'n',
                        'A',
                        'B',
                        'C',
                        'D',
                        'E',
                        'F',
                        'G',
                        'H',
                        'I',
                        'J',
                        'K',
                        'L',
                        'M',
                        'N',
                        'O',
                        'P',
                        'Q',
                        'R',
                        'S',
                        'T',
                        'U',
                        'V',
                        'W',
                        'X',
                        'Y',
                        'Z',
                    ],
                    properties: 'never',
                },
            ],

            // AGENTS.md L147 / L149 — sourdaw custom rules for forms/imports.
            'sourdaw/no-enum': 'error',
            'sourdaw/no-foreign-store-write': 'warn',
            'sourdaw/no-model-layer-upward-import': 'error',
            'sourdaw/no-multiple-function-exports': 'error',
            'sourdaw/no-namespace-import': 'error',
            'sourdaw/no-nonmodule-private-module-import': 'error',
            'sourdaw/no-repository-usecase-import': 'error',
            'sourdaw/no-type-only-private-module-import': 'error',
            'sourdaw/no-type-assertion-escape': 'error',
        },
    },

    // ─── React components (JSX) ──────────────────────────────────────────────
    {
        files: ['**/*.{tsx,jsx}'],
        rules: {
            // Children manipulation is fine for DAW components (e.g. slot patterns)
            '@eslint-react/no-children-for-each': 'off',
            '@eslint-react/no-children-count': 'off',
            '@eslint-react/no-children-map': 'off',
            '@eslint-react/no-children-to-array': 'off',

            // React 19: no forwardRef needed
            '@eslint-react/no-forward-ref': 'error',

            // New in @eslint-react v5 preset. False positive for the registry-lookup pattern
            // (DeviceInspector: `resolveDeviceLayout()` returns a stable component from a Map,
            // so no per-render state reset occurs). Matches pre-upgrade (v4) behavior.
            '@eslint-react/static-components': 'off',

            // Naming conventions
            '@eslint-react/naming-convention-context-name': 'error',

            // DAW UX allowances
            'jsx-a11y-x/interactive-supports-focus': 'warn',

            // React Compiler/purity allowances
            'react-hooks/refs': 'warn',
            'react-hooks/purity': 'warn',
            '@eslint-react/purity': 'warn',
            'react-hooks/set-state-in-effect': 'warn',
            '@eslint-react/set-state-in-effect': 'warn',
            '@eslint-react/unsupported-syntax': 'warn',

            // Prevent leaked JSX conditions
            '@eslint-react/no-leaked-conditional-rendering': 'error',

            // Local architecture rules
            'sourdaw/no-useeffect-fetching': 'error',
            'sourdaw/no-useeffect-derived-state': 'warn',
            'sourdaw/no-manual-memoization': 'error',
            'sourdaw/no-tauri-api-in-ui': 'error',

            // No default React import
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "ImportDeclaration[source.value='react'] :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)",
                    message:
                        'Default React import not allowed since we use the TypeScript jsx-transform. If you need a global type that collides with a React named export (such as `MouseEvent`), use `globalThis.MouseEvent`.',
                },
            ],
        },
    },

    // ─── TanStack Query conventions ──────────────────────────────────────────
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        rules: {
            '@tanstack/query/exhaustive-deps': 'error',
            '@tanstack/query/no-unstable-deps': 'error',
            '@tanstack/query/stable-query-client': 'error',
        },
    },

    // ─── Business-layer conventions ──────────────────────────────────────────
    {
        files: [
            'src/**/useCases/**/*.ts',
            'src/**/repositories/**/*.ts',
            'src/**/transformers/**/*.ts',
            'src/**/models/**/*.ts',
            'src/**/stores/**/*.ts',
            'src/**/events/**/*.ts',
            'src/**/services/**/*.ts',
            'src/**/validators/**/*.ts',
            'src/helpers/**/*.ts',
        ],
        rules: {
            'sourdaw/no-react-in-domain-logic': 'error',
            'sourdaw/no-usecase-repository-reexport': 'error',
        },
    },

    // ─── Project-specific restrictions ───────────────────────────────────────
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        ignores: [
            '**/*.spec.{ts,tsx}',
            'src/helpers/Store/Storage/LocalStorageStorage.ts',
            'src/helpers/Store/Storage/SessionStorageStorage.ts',
            'src/modules/DevTools/repositories/devToolsStorageRepository.ts',
            'src/modules/Project/repositories/projectRepository.ts',
            'src/modules/Project/useCases/recentProjects.ts',
            'src/modules/Command/stores/undoStore.ts',
        ],
        rules: {
            'no-restricted-syntax': [
                'warn',
                {
                    selector: "CallExpression[callee.object.name='localStorage']",
                    message: 'Do not use `localStorage` directly, use the `Store` with `LocalStorageStorage` instead.',
                },
                {
                    selector:
                        "CallExpression[callee.object.object.name='window'][callee.object.property.name='localStorage']",
                    message: 'Do not use `localStorage` directly, use the `Store` with `LocalStorageStorage` instead.',
                },
                {
                    selector: "CallExpression[callee.object.name='sessionStorage']",
                    message:
                        'Do not use `sessionStorage` directly, use the `Store` with `SessionStorageStorage` instead.',
                },
                {
                    selector:
                        "CallExpression[callee.object.object.name='window'][callee.object.property.name='sessionStorage']",
                    message:
                        'Do not use `sessionStorage` directly, use the `Store` with `SessionStorageStorage` instead.',
                },
            ],
        },
    },

    // ─── Test files ──────────────────────────────────────────────────────────
    {
        files: [
            '**/*.spec.{ts,tsx}',
            '**/*.test.{ts,tsx}',
            '**/setupTests.ts',
            // Non-.spec test scaffolding: mock factories and __tests__ helpers.
            '**/*.mock.ts',
            '**/__tests__/**/*.{ts,tsx}',
        ],
        rules: {
            '@eslint-react/no-unnecessary-use-prefix': 'off',
            '@eslint-react/no-missing-context-display-name': 'off',
            '@eslint-react/no-create-ref': 'off',
            '@eslint-react/no-unstable-context-value': 'off',
            'sourdaw/no-manual-memoization': 'off',
            'sourdaw/no-useeffect-derived-state': 'off',
            // `import * as subject from '../module'` is the canonical "test the whole surface" pattern.
            'sourdaw/no-namespace-import': 'off',
            // Tests frequently use short names (`t`, `p`, `a`, `b`) for intermediate values.
            'id-length': 'off',
            // Tests frequently parameterise generics with `T`, `K` etc. for brevity.
            '@typescript-eslint/naming-convention': 'off',
            // `as any` in tests is sometimes necessary to construct partial mocks of complex types.
            'sourdaw/no-type-assertion-escape': 'off',
        },
    },

    // ─── shadcn / Radix UI primitives ────────────────────────────────────────
    // Radix documents its public API as `import * as Primitive from '@radix-ui/...'`.
    // These wrappers in `src/components/` follow that convention.
    {
        files: ['src/components/**/*.{ts,tsx}'],
        rules: {
            'sourdaw/no-namespace-import': 'off',
        },
    },

    // ─── Node scripts ───────────────────────────────────────────────────────
    {
        files: ['scripts/**/*.{js,mjs,cjs}'],
        extends: [tseslint.configs.disableTypeChecked, eslintPluginReact.configs['disable-type-checked']],
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                project: false,
            },
        },
    },

    // ─── d.ts files ──────────────────────────────────────────────────────────
    {
        files: ['**/*.d.ts'],
        extends: [tseslint.configs.disableTypeChecked],
    },

    // ─── Prettier (must be last) ─────────────────────────────────────────────
    // oxlint has no prettier integration; formatting drift stays gated here.
    eslintPluginPrettierRecommended
);
