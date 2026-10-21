import { abortExportFiles, appendExportFile, beginExportFile, commitExportFiles, desktopPathJoin, sealExportFile } from '#/utils/desktopBridge';

/** A batch owns only native-issued transaction tokens; paths are granted and checked in Rust. */
export async function streamExportToNative(input: {
    directoryPath?: string;
    selectedFilePath?: string;
    checkCancelled: () => void;
}) {
    const tokens: string[] = [];
    const names = new Set<string>();
    let closed = false;
    let fileOpen = false;
    return {
        async beginFile(name: string) {
            input.checkCancelled();
            if (closed || fileOpen || names.has(name) || /[\\/]/u.test(name)) throw new Error('Invalid export entry order or name.');
            const extension = name.slice(name.lastIndexOf('.'));
            const path = input.directoryPath ? await desktopPathJoin(input.directoryPath, name)
                : input.selectedFilePath?.replace(/\.[a-z0-9]+$/iu, extension);
            if (!path) throw new Error('No native export destination was selected.');
            const token = await beginExportFile(path);
            tokens.push(token); names.add(name); fileOpen = true;
            return {
                writer: { checkCancelled: input.checkCancelled, async write(bytes: Uint8Array) {
                    input.checkCancelled();
                    await appendExportFile(token, bytes);
                } },
                async finish() { input.checkCancelled(); await sealExportFile(token); fileOpen = false; },
            };
        },
        async commit(onCommitBegin: () => void) {
            input.checkCancelled();
            if (closed || fileOpen || tokens.length === 0) throw new Error('Export has no completed files.');
            onCommitBegin();
            await commitExportFiles(tokens);
            closed = true;
        },
        async abort() {
            if (closed) return;
            await abortExportFiles(tokens);
            closed = true;
        },
    };
}
