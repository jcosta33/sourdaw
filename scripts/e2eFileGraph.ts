import { isAbsolute, resolve } from 'node:path';

import ts from 'typescript';

import type { SourceNode } from './e2eAffectedGraph.ts';

export type CruiseScope = { roots: readonly string[]; exclude: string; doNotFollow: string };

/**
 * The dependency-cruiser file graph over `scope.roots`, resolved through the root TypeScript aliases,
 * or why it cannot be trusted.
 */
export async function cruiseFileGraph(
    root: string,
    scope: CruiseScope
): Promise<{ kind: 'modules'; modules: SourceNode[] } | { kind: 'full'; reason: string }> {
    const configPath = resolve(root, 'tsconfig.json');
    const config = ts.getParsedCommandLineOfConfigFile(
        configPath,
        {},
        {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
                throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
            },
        }
    );
    if (config === undefined || config.errors.length > 0) {
        throw new Error('invalid dependency graph TypeScript configuration');
    }
    if (
        config.options.baseUrl === undefined &&
        config.options.paths !== undefined &&
        Object.keys(config.options.paths).length > 0
    ) {
        const declaringBase = config.options.pathsBasePath;
        // The installed alias plugin rebases inherited baseUrl, but not inherited implicit paths.
        if (
            typeof declaringBase !== 'string' ||
            !isAbsolute(declaringBase) ||
            resolve(declaringBase) !== resolve(root)
        ) {
            return {
                kind: 'full',
                reason: 'TypeScript alias declaring base is not preserved by the dependency resolver',
            };
        }
    }
    // The resolver reads aliases from configPath, but otherwise substitutes cwd for an implicit base.
    const graphConfig = { ...config, options: { ...config.options, baseUrl: config.options.baseUrl ?? resolve(root) } };
    if (process.env.TS_NODE_PROJECT || process.env.TS_NODE_BASEURL) {
        return { kind: 'full', reason: 'caller TypeScript alias override prevents proving the requested root' };
    }
    const { cruise } = await import('dependency-cruiser');
    const result = await cruise(
        [...scope.roots],
        {
            baseDir: root,
            outputType: 'json',
            doNotFollow: { path: scope.doNotFollow },
            exclude: { path: scope.exclude },
            tsConfig: { fileName: configPath },
            tsPreCompilationDeps: 'specify',
        },
        undefined,
        { tsConfig: graphConfig }
    );
    if (result.exitCode !== 0 || typeof result.output !== 'string') {
        return { kind: 'full', reason: 'dependency graph did not complete' };
    }
    const parsed: unknown = JSON.parse(result.output);
    if (typeof parsed !== 'object' || parsed === null || !('modules' in parsed) || !Array.isArray(parsed.modules)) {
        return { kind: 'full', reason: 'malformed dependency graph' };
    }
    return { kind: 'modules', modules: parsed.modules as SourceNode[] };
}
