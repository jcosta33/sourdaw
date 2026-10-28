import {
    abortExportFiles,
    appendExportFile,
    beginExportFile,
    commitExportFiles,
    desktopPathJoin,
    sealExportFile,
} from '#/utils/desktopBridge';

/** A batch owns only native-issued transaction tokens; paths are granted and checked in Rust. */
export async function streamExportToNative(input: {
    directoryPath?: string;
    selectedFilePath?: string;
    checkCancelled: () => void;
}) {
    const tokens: string[] = [];
    const pendingBegins = new Set<Promise<string>>();
    const names = new Set<string>();
    let closed = false;
    let closing = false;
    let abortPending: Promise<void> | undefined;
    let fileOpen = false;
    const checkOpen = () => {
        input.checkCancelled();
        if (closed || closing) {
            throw new Error('Export cancelled');
        }
    };
    const abort = async () => {
        if (closed) {
            return;
        }
        if (abortPending) {
            await abortPending;
            return;
        }
        closing = true;
        const pending = (async () => {
            await Promise.allSettled(pendingBegins);
            await abortExportFiles([...tokens]);
            tokens.length = 0;
            closed = true;
        })();
        abortPending = pending;
        try {
            await pending;
        } finally {
            abortPending = undefined;
        }
    };
    return {
        async beginFile(name: string) {
            checkOpen();
            if (fileOpen || names.has(name) || /[\\/]/u.test(name)) {
                throw new Error('Invalid export entry order or name.');
            }
            const extension = name.slice(name.lastIndexOf('.'));
            let path: string | undefined;
            if (input.directoryPath) {
                path = await desktopPathJoin(input.directoryPath, name);
            } else {
                path = input.selectedFilePath?.replace(/\.[a-z0-9]+$/iu, extension);
            }
            checkOpen();
            if (!path) {
                throw new Error('No native export destination was selected.');
            }
            const beginning = beginExportFile(path).then((token) => {
                tokens.push(token);
                return token;
            });
            pendingBegins.add(beginning);
            let token: string;
            try {
                token = await beginning;
                checkOpen();
            } catch (error) {
                await abort();
                throw error;
            } finally {
                pendingBegins.delete(beginning);
            }
            names.add(name);
            fileOpen = true;
            return {
                writer: {
                    checkCancelled: input.checkCancelled,
                    async write(bytes: Uint8Array) {
                        checkOpen();
                        await appendExportFile(token, bytes);
                        checkOpen();
                    },
                },
                async finish() {
                    checkOpen();
                    await sealExportFile(token);
                    checkOpen();
                    fileOpen = false;
                },
            };
        },
        async commit(onCommitBegin: () => void) {
            checkOpen();
            if (fileOpen || tokens.length === 0) {
                throw new Error('Export has no completed files.');
            }
            onCommitBegin();
            await commitExportFiles(tokens);
            closed = true;
        },
        abort,
    };
}
