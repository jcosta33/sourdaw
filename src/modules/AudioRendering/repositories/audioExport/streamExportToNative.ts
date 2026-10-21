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
    requireReportPairs?: boolean;
    checkCancelled: () => void;
}) {
    const tokens: string[] = [];
    const names = new Set<string>();
    const completed = new Set<string>();
    const tokenByName = new Map<string, string>();
    const pairs = new Map<string, string>();
    let closed = false;
    let fileOpen = false;
    return {
        async beginFile(name: string) {
            input.checkCancelled();
            if (closed || fileOpen || names.has(name) || /[\\/]/u.test(name)) {
                throw new Error('Invalid export entry order or name.');
            }
            const extension = name.slice(name.lastIndexOf('.'));
            let path: string | undefined;
            if (input.directoryPath) {
                path = await desktopPathJoin(input.directoryPath, name);
            } else {
                path = input.selectedFilePath?.replace(/\.[a-z0-9]+$/iu, extension);
            }
            if (!path) {
                throw new Error('No native export destination was selected.');
            }
            const token = await beginExportFile(path);
            tokens.push(token);
            names.add(name);
            tokenByName.set(name, token);
            fileOpen = true;
            return {
                writer: {
                    checkCancelled: input.checkCancelled,
                    async write(bytes: Uint8Array) {
                        input.checkCancelled();
                        await appendExportFile(token, bytes);
                    },
                },
                async finish() {
                    input.checkCancelled();
                    await sealExportFile(token);
                    fileOpen = false;
                    completed.add(name);
                },
            };
        },
        registerReportPair(audioName: string, reportName: string) {
            if (
                !input.requireReportPairs ||
                reportName !== `${audioName}.loudness.json` ||
                !completed.has(audioName) ||
                !completed.has(reportName) ||
                pairs.has(audioName)
            ) {
                throw new Error('Invalid WAV report pair.');
            }
            pairs.set(audioName, reportName);
        },
        async commit(onCommitBegin: () => void) {
            input.checkCancelled();
            if (closed || fileOpen || tokens.length === 0) {
                throw new Error('Export has no completed files.');
            }
            if (
                input.requireReportPairs &&
                (pairs.size * 2 !== completed.size ||
                    [...completed].some((name) =>
                        name.endsWith('.wav') ? !pairs.has(name) : ![...pairs.values()].includes(name)
                    ))
            ) {
                throw new Error('WAV report pairs are incomplete.');
            }
            const commitTokens = input.requireReportPairs
                ? [...pairs].flatMap(([audio, report]) => [tokenByName.get(report)!, tokenByName.get(audio)!])
                : tokens;
            onCommitBegin();
            await commitExportFiles(commitTokens);
            closed = true;
        },
        async abort() {
            if (closed) {
                return;
            }
            await abortExportFiles(tokens);
            closed = true;
        },
    };
}
