// @ts-check
// Standalone ESLint config for Sourdaw — React 19 + Compiler, TypeScript, Tailwind v4.
// Extended with:
// - architecture/layer restrictions
// - import ordering + no default exports
// - TanStack Query linting
// - local Sourdaw-specific rules for agentic drift
// - stronger TypeScript promise/import enforcement

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import eslint from '@eslint/js';
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
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
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
function isProductionSourceFile(filename) {
    const normalized = normalizeFilePath(filename);
    return (
        (normalized.includes('/src/') || normalized.startsWith('src/')) &&
        !normalized.endsWith('.d.ts') &&
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
    const relativeMatch = /\/src\/modules\/(.+)$/.exec(resolvedSource);
    if (!relativeMatch) return null;

    return parseModulePath(relativeMatch[1]);
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
function getNonModuleImporterFolder(filename) {
    const normalized = normalizeFilePath(filename);
    if (!isProductionSourceFile(normalized)) return null;

    const match = /(?:^|\/)src\/([^/]+)(?:\/|$)/.exec(normalized);
    const sourceFolder = match?.[1];
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
                        'Do not import React into domain logic layers. Move UI concerns outward or extract pure domain code.',
                },
            },
            /** @param {import('eslint').Rule.RuleContext} context */
            create(context) {
                if (!isDomainLogicFile(context.filename)) return {};

                return {
                    /** @param {any} node */
                    ImportDeclaration(node) {
                        const value = node.source.value;
                        if (typeof value !== 'string') return;

                        if (value === 'react' || value.startsWith('react/')) {
                            context.report({
                                node,
                                messageId: 'noReactInDomainLogic',
                            });
                        }
                    },
                };
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
                 * @returns {void}
                 */
                function reportIfPrivateModuleImport(node, source) {
                    const importedModule = getModuleImportLocation(context.filename, source);
                    if (!importedModule) return;

                    const importerModule = getModuleLocation(context.filename);
                    if (importerModule?.moduleName === importedModule.moduleName) return;

                    const target = getNonModulePrivateImportTarget(importedModule.importPath);
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
                        if (isTypeOnlyImportDeclaration(node)) return;

                        const value = node.source.value;
                        if (typeof value !== 'string') return;

                        reportIfPrivateModuleImport(node, value);
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
    eslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    eslintPluginPromise.configs['flat/recommended'],
    eslintPluginComments.recommended,
    eslintPluginJsxA11yX.flatConfigs.recommended,
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
            // Standalone agent helper scripts run via `npx tsx`, not part of the
            // `src` application tree and intentionally excluded from
            // tsconfig.eslint.json — ignore so the type-aware parser does not
            // fatal on files outside any tsconfig project.
            '.agents/',
            'src/routeTree.gen.ts',
            'src/modules/AudioEngine/wasm/*.js',
            'test-debug.mjs',
            'test-jscodeshift.js',
            'test-manual-fix.mjs',
            'test-manual-fix.ts',
            '**/*.md',
        ],
    },

    // ─── Global settings ─────────────────────────────────────────────────────
    {
        linterOptions: {
            reportUnusedDisableDirectives: true,
        },
        plugins: {
            unicorn: eslintPluginUnicorn,
            '@stylistic': eslintPluginStylistic,
            'import-x': eslintPluginImport,
            '@tanstack/query': eslintPluginQuery,
            sourdaw: sourdawPlugin,
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
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
            // ── Code style ────────────────────────────────────────────────────
            '@stylistic/linebreak-style': ['error', 'unix'],
            '@stylistic/eol-last': ['error', 'always'],
            '@stylistic/spaced-comment': [
                'error',
                'always',
                {
                    line: { markers: ['/'], exceptions: ['/', '#'] },
                    block: { markers: ['!'], exceptions: ['*'], balanced: true },
                },
            ],
            'prefer-template': 'error',
            'no-var': 'error',
            eqeqeq: 'error',
            'no-eval': 'error',
            'no-extra-bind': 'error',
            curly: ['error', 'all'],
            semi: ['error', 'always'],
            quotes: ['error', 'single', { avoidEscape: true }],
            'block-scoped-var': 'error',
            'array-callback-return': 'error',
            'object-shorthand': ['error', 'always', { ignoreConstructors: false, avoidQuotes: true }],
            'no-case-declarations': 'error',
            'no-void': ['warn', { allowAsStatement: true }],
            'no-invalid-this': 'error',
            'require-await': 'off',
            'max-statements-per-line': ['error', { max: 1 }],
            'prefer-exponentiation-operator': 'error',
            'prefer-rest-params': 'error',
            'prefer-spread': 'error',
            'no-debugger': 'error',
            'no-constant-condition': 'warn',
            'prefer-const': ['error', { destructuring: 'all', ignoreReadBeforeAssign: true }],
            'no-unreachable': 'error',
            'no-unused-labels': 'error',
            'no-useless-computed-key': 'error',
            'no-useless-concat': 'error',
            'no-useless-escape': 'error',
            'no-useless-rename': ['error', { ignoreDestructuring: false, ignoreImport: false, ignoreExport: false }],
            'no-undef': 'off',
            'no-nested-ternary': 'error',
            'no-unneeded-ternary': 'error',
            'default-case-last': 'error',
            'consistent-return': 'error',

            // ── Import hygiene ────────────────────────────────────────────────
            'import-x/no-default-export': 'error',
            'import-x/first': 'error',
            'import-x/newline-after-import': 'error',
            'import-x/no-duplicates': 'error',
            'import-x/order': [
                'error',
                {
                    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
                    pathGroups: [
                        { pattern: 'react', group: 'external', position: 'before' },
                        { pattern: '@tauri-apps/**', group: 'external', position: 'after' },
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

            // ── Unicorn ───────────────────────────────────────────────────────
            'unicorn/error-message': 'error',
            'unicorn/escape-case': 'error',
            'unicorn/no-instanceof-array': 'error',
            'unicorn/number-literal-case': 'error',
            'unicorn/prefer-array-find': 'error',
            'unicorn/prefer-default-parameters': 'error',
            'unicorn/prefer-includes': 'error',
            'unicorn/prefer-string-starts-ends-with': 'error',
            'unicorn/prefer-string-replace-all': 'error',
            'unicorn/prefer-dom-node-text-content': 'warn',
            'unicorn/prefer-type-error': 'error',
            'unicorn/throw-new-error': 'error',
            'unicorn/no-array-for-each': 'error',
            'unicorn/explicit-length-check': 'error',
            'unicorn/no-new-array': 'error',
            'unicorn/no-useless-length-check': 'error',
            'unicorn/catch-error-name': 'error',

            // ── Promise ──────────────────────────────────────────────────────
            'promise/param-names': 'error',
            'promise/always-return': 'warn',
            'promise/catch-or-return': 'warn',
        },
    },

    // ─── TypeScript files ────────────────────────────────────────────────────
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        rules: {
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-dupe-class-members': 'off',
            '@typescript-eslint/no-dupe-class-members': 'error',
            // AGENTS.md L148: `any` is forbidden except at a boundary with immediate narrowing.
            '@typescript-eslint/no-explicit-any': 'error',
            'no-implied-eval': 'off',
            '@typescript-eslint/no-implied-eval': 'error',
            'dot-notation': 'off',
            '@typescript-eslint/dot-notation': ['error', { allowKeywords: true }],
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-for-in-array': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'warn',
            '@typescript-eslint/switch-exhaustiveness-check': 'warn',
            // AGENTS.md L148: soundness — unsafe `any` propagation is forbidden.
            '@typescript-eslint/no-unsafe-argument': 'error',
            '@typescript-eslint/no-unsafe-assignment': 'error',
            '@typescript-eslint/no-unsafe-call': 'error',
            '@typescript-eslint/no-unsafe-member-access': 'error',
            '@typescript-eslint/no-unsafe-return': 'error',
            'require-await': 'off',
            '@typescript-eslint/require-await': 'warn',
            '@typescript-eslint/restrict-plus-operands': 'error',
            '@typescript-eslint/restrict-template-expressions': [
                'warn',
                {
                    allowAny: false,
                    allowBoolean: true,
                    allowNullish: false,
                    allowNumber: true,
                    allowRegExp: true,
                },
            ],
            '@typescript-eslint/unbound-method': 'off',
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
            ],
            '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/prefer-promise-reject-errors': 'warn',

            // AGENTS.md L147: Prefer `type` over `interface`.
            '@typescript-eslint/consistent-type-definitions': ['error', 'type'],

            // AGENTS.md L148: `{}`, unconstrained `object` are forbidden placeholder types.
            '@typescript-eslint/no-empty-object-type': 'error',

            // AGENTS.md L148: `@ts-expect-error`/`@ts-ignore`/`@ts-nocheck` without justification forbidden.
            '@typescript-eslint/ban-ts-comment': [
                'error',
                {
                    'ts-expect-error': 'allow-with-description',
                    'ts-ignore': true,
                    'ts-nocheck': true,
                    'ts-check': false,
                    minimumDescriptionLength: 10,
                },
            ],

            // AGENTS.md L147 / L149 — sourdaw custom rules for forms/imports.
            'sourdaw/no-enum': 'error',
            'sourdaw/no-multiple-function-exports': 'warn',
            'sourdaw/no-namespace-import': 'error',
            'sourdaw/no-nonmodule-private-module-import': 'warn',
            'sourdaw/no-type-only-private-module-import': 'warn',
            'sourdaw/no-type-assertion-escape': 'error',

            // AGENTS.md L150: No single-letter variable names.
            // `_` is kept for intentionally-unused destructured positional slots.
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

            // AGENTS.md L150: No single-letter generic type parameters.
            '@typescript-eslint/naming-convention': [
                'error',
                {
                    selector: 'typeParameter',
                    format: ['PascalCase'],
                    custom: { regex: '^.{2,}$', match: true },
                },
            ],
        },
    },

    // ─── React components (JSX) ──────────────────────────────────────────────
    {
        files: ['**/*.{tsx,jsx}'],
        rules: {
            'jsx-quotes': ['error', 'prefer-double'],

            // Children manipulation is fine for DAW components (e.g. slot patterns)
            '@eslint-react/no-children-for-each': 'off',
            '@eslint-react/no-children-count': 'off',
            '@eslint-react/no-children-map': 'off',
            '@eslint-react/no-children-to-array': 'off',

            // React 19: no forwardRef needed
            '@eslint-react/no-forward-ref': 'error',

            // Naming conventions
            '@eslint-react/naming-convention-context-name': 'error',

            // DAW UX allowances
            'jsx-a11y-x/no-autofocus': 'off',
            'jsx-a11y-x/no-noninteractive-element-interactions': 'off',
            'jsx-a11y-x/label-has-associated-control': [
                'warn',
                {
                    controlComponents: ['Slider', 'Select', 'Switch', 'Input', 'Knob', 'Checkbox', 'SelectTrigger'],
                    depth: 3,
                },
            ],
            'jsx-a11y-x/interactive-supports-focus': 'warn',
            'jsx-a11y-x/click-events-have-key-events': 'warn',
            'jsx-a11y-x/no-static-element-interactions': 'warn',
            'jsx-a11y-x/role-supports-aria-props': 'warn',

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
            'func-style': ['warn', 'declaration', { allowArrowFunctions: false }],
            'sourdaw/no-react-in-domain-logic': 'error',
            'sourdaw/no-usecase-repository-reexport': 'error',
        },
    },

    // ─── Presentation-layer import restrictions ──────────────────────────────
    {
        files: [
            'src/**/presentations/views/**/*.{ts,tsx}',
            'src/**/presentations/components/**/*.{ts,tsx}',
            'src/**/presentations/hooks/**/*.{ts,tsx}',
        ],
        rules: {
            '@typescript-eslint/no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '@tauri-apps/api/core',
                            message:
                                'Do not use Tauri APIs directly in presentation code. Go through repositories, adapters, or use cases.',
                        },
                        {
                            name: '@tauri-apps/api/event',
                            message:
                                'Do not use Tauri APIs directly in presentation code. Go through repositories, adapters, or use cases.',
                        },
                        {
                            name: '@tauri-apps/api/window',
                            message:
                                'Do not use Tauri APIs directly in presentation code. Go through repositories, adapters, or use cases.',
                        },
                    ],
                    patterns: [
                        {
                            group: ['**/repositories/**'],
                            message:
                                'Do not import repositories directly into presentation code. Go through a hook, use case, or presentation adapter.',
                        },
                        {
                            group: ['**/src-tauri/**', '**/@tauri-apps/api/**'],
                            message:
                                'Do not import Tauri bridge code into presentation code. Use repositories/adapters.',
                        },
                    ],
                },
            ],
        },
    },

    // ─── Domain-layer import restrictions ────────────────────────────────────
    {
        files: [
            'src/**/useCases/**/*.{ts,tsx}',
            'src/**/services/**/*.{ts,tsx}',
            'src/**/validators/**/*.{ts,tsx}',
            'src/**/transformers/**/*.{ts,tsx}',
        ],
        rules: {
            '@typescript-eslint/no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'react',
                            message: 'Do not import React into domain logic. Keep domain logic UI-free.',
                        },
                        {
                            name: '@tauri-apps/api/core',
                            message: 'Do not import Tauri APIs into domain logic. Use repositories or adapters.',
                        },
                        {
                            name: '@tauri-apps/api/event',
                            message: 'Do not import Tauri APIs into domain logic. Use repositories or adapters.',
                        },
                    ],
                    patterns: [
                        {
                            group: ['**/presentations/**'],
                            message: 'Do not import presentation code into use cases/services/validators/transformers.',
                        },
                    ],
                },
            ],
        },
    },

    // ─── Repository-layer rules ──────────────────────────────────────────────
    {
        files: ['src/**/repositories/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/presentations/**'],
                            message: 'Repositories must not depend on presentation-layer modules.',
                        },
                    ],
                },
            ],
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
            'jsx-a11y-x/no-static-element-interactions': 'off',
            'jsx-a11y-x/click-events-have-key-events': 'off',
            '@typescript-eslint/unbound-method': 'off',
            'sourdaw/no-manual-memoization': 'off',
            'sourdaw/no-useeffect-derived-state': 'off',
            // Vitest `vi.mock()` calls sit between imports by design (Vitest hoists them),
            // which triggers false positives for `import-x/first`.
            'import-x/first': 'off',
            // `import * as subject from '../module'` is the canonical "test the whole surface" pattern.
            'sourdaw/no-namespace-import': 'off',
            // Mocks and minimal stubs often use `{}` as a placeholder shape.
            '@typescript-eslint/no-empty-object-type': 'off',
            // Tests frequently use short names (`t`, `p`, `a`, `b`) for intermediate values.
            'id-length': 'off',
            // Tests frequently parameterise generics with `T`, `K` etc. for brevity.
            '@typescript-eslint/naming-convention': 'off',
            // `as any` in tests is sometimes necessary to construct partial mocks of complex types.
            'sourdaw/no-type-assertion-escape': 'off',
            '@typescript-eslint/no-unsafe-argument': 'warn',
            '@typescript-eslint/no-unsafe-assignment': 'warn',
            '@typescript-eslint/no-unsafe-call': 'warn',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unsafe-return': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            // Unawaited async in a test body (fire-and-forget, intentional ordering
            // assertions) is acceptable; production keeps this at 'error'.
            '@typescript-eslint/no-floating-promises': 'warn',
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

    // ─── d.ts files ──────────────────────────────────────────────────────────
    {
        files: ['**/*.d.ts'],
        extends: [tseslint.configs.disableTypeChecked],
        rules: {
            // Declaration merging into an existing global interface (e.g. augmenting
            // DOM's `Window` or `FileSystemHandle`) is only expressible with
            // `interface` — a `type` alias collides (TS2300). The project-wide
            // "prefer type" rule (AGENTS.md L147) is therefore inapplicable in
            // ambient declaration files, whose whole purpose is such merges.
            '@typescript-eslint/consistent-type-definitions': 'off',
        },
    },

    // ─── Prettier (must be last) ─────────────────────────────────────────────
    eslintPluginPrettierRecommended,
    {
        files: ['**/*.{ts,tsx,mts,cts,js,jsx}'],
        rules: {
            curly: ['error', 'all'],
        },
    }
);
