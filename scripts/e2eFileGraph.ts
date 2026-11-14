import { isAbsolute, resolve } from 'node:path';

import { API, DiagnosticCategory } from 'typescript/unstable/sync';

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
    const api = new API({ cwd: root });
    let snapshot: ReturnType<API['updateSnapshot']> | undefined;
    let config: ReturnType<API['parseConfigFile']>;
    try {
        config = api.parseConfigFile(configPath);
        snapshot = api.updateSnapshot({ openProjects: [configPath] });
        const project = snapshot.getProject(configPath);
        if (!project) {
            throw new Error('invalid dependency graph TypeScript configuration');
        }
        const errors = [
            ...project.program.getConfigFileParsingDiagnostics(),
            ...project.program.getProgramDiagnostics(),
        ].filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error);
        if (errors.length > 0) {
            throw new Error(errors.map((diagnostic) => diagnostic.text).join('\n'));
        }
    } finally {
        try {
            snapshot?.dispose();
        } finally {
            api.close();
        }
    }
    const baseUrl = 'baseUrl' in config.options ? config.options.baseUrl : undefined;
    if (
        baseUrl === undefined &&
        config.options.paths !== undefined &&
        typeof config.options.paths === 'object' &&
        config.options.paths !== null &&
        Object.keys(config.options.paths).length > 0
    ) {
        const declaringBase = 'pathsBasePath' in config.options ? config.options.pathsBasePath : undefined;
        // The patched resolver receives this native declaring base, including inherited paths.
        if (typeof declaringBase !== 'string' || !isAbsolute(declaringBase)) {
            return {
                kind: 'full',
                reason: 'TypeScript alias declaring base is not preserved by the dependency resolver',
            };
        }
    }
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
        { tsConfig: config }
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
