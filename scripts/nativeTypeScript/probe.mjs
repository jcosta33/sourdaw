import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

export async function probeNativeTypeScript(binary, clientRoot) {
    // Importing the real client and starting its service happen only inside the
    // explicitly invoked preparation/probe command, after resource admission.
    const { API, TypeFlags } = await import(
        clientRoot ? pathToFileURL(join(clientRoot, 'dist/api/sync/api.js')).href : 'typescript/unstable/sync'
    );
    const { isTypeAliasDeclaration } = await import(
        clientRoot ? pathToFileURL(join(clientRoot, 'dist/ast/index.js')).href : 'typescript/unstable/ast'
    );
    const { createVirtualFileSystem } = await import(
        clientRoot ? pathToFileURL(join(clientRoot, 'dist/api/fs.js')).href : 'typescript/unstable/fs'
    );
    const root = resolve(process.cwd(), '__native_typescript_capability_probe__').replaceAll('\\', '/');
    const config = `${root}/tsconfig.json`;
    const inputPath = `${root}/input.ts`;
    const api = new API({
        tsserverPath: binary,
        cwd: process.cwd(),
        fs: createVirtualFileSystem({
            [config]: JSON.stringify({ compilerOptions: { strict: true, target: 'ESNext' }, files: ['input.ts'] }),
            [inputPath]: 'export type Input = Promise<void>;',
        }),
    });
    try {
        const snapshot = api.updateSnapshot({ openProjects: [config] });
        try {
            const project = snapshot.getProject(config);
            if (!project) throw new Error('Native probe project was not opened');
            const source = project.program.getSourceFile(inputPath);
            const declaration = source?.statements.find(isTypeAliasDeclaration);
            if (!declaration) throw new Error('Native probe source alias was not parsed');
            const input = project.checker.getTypeFromTypeNode(declaration.type);
            if (!input || input.isErrorType()) throw new Error('Native probe Promise type failed');
            const result = project.checker.getAwaitedType(input);
            if (!result || result.flags !== TypeFlags.Void)
                throw new Error('Native getAwaitedType did not resolve Promise<void> to void');
            if (project.checker.getAwaitedType(input) !== result)
                throw new Error('Native awaited type did not retain registry identity');
            return { method: 'getAwaitedType', result: 'void' };
        } finally {
            snapshot.dispose();
        }
    } finally {
        api.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (!process.argv[2]) throw new Error('Expected an explicit locally built native compiler path');
    process.stdout.write(
        `${JSON.stringify(await probeNativeTypeScript(process.argv[2], process.argv[3] || undefined))}\n`
    );
}
