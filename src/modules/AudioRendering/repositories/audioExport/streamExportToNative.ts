import {
    abortExportFiles,
    appendExportFile,
    beginExportFile,
    commitExportFiles,
    desktopPathJoin,
    sealExportFile,
} from '#/utils/desktopBridge';

import { type ExportByteWriter } from '../../models/ExportAudioSource';

type NativeExportBatch = {
    beginFile: (name: string) => Promise<{ writer: ExportByteWriter; finish: () => Promise<void> }>;
    registerReportPair: (audioName: string, reportName: string) => void;
    commit: (onCommitBegin: () => void) => Promise<void>;
    abort: () => Promise<void>;
};

function createNativeExportEntry(
    token: string,
    checkOpen: () => void,
    checkCancelled: () => void,
    onFinish: () => void
): Awaited<ReturnType<NativeExportBatch['beginFile']>> {
    return {
        writer: {
            checkCancelled,
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
            onFinish();
        },
    };
}

/**
 * Pairs each completed WAV with its completed `.loudness.json` report and orders their commit.
 * Reports need a picked directory: a single picked file has no place for its neighbour.
 */
function createReportPairLedger(input: { requireReportPairs?: boolean; directoryPath?: string }) {
    const required = input.requireReportPairs === true;
    if (required && !input.directoryPath) {
        throw new Error('WAV reports require a native export directory.');
    }
    const completed = new Map<string, string>();
    const pairs = new Map<string, string>();
    const tokenOf = (name: string): string => {
        const token = completed.get(name);
        if (token === undefined) {
            throw new Error('Invalid WAV report pair.');
        }
        return token;
    };
    return {
        complete(name: string, token: string) {
            completed.set(name, token);
        },
        register(audioName: string, reportName: string) {
            if (
                !required ||
                !audioName.endsWith('.wav') ||
                reportName !== `${audioName}.loudness.json` ||
                !completed.has(audioName) ||
                !completed.has(reportName) ||
                pairs.has(audioName)
            ) {
                throw new Error('Invalid WAV report pair.');
            }
            pairs.set(audioName, reportName);
        },
        commitOrder(tokens: readonly string[]): readonly string[] {
            if (!required) {
                return tokens;
            }
            if (pairs.size * 2 !== completed.size) {
                throw new Error('WAV report pairs are incomplete.');
            }
            // Native replacement is ordered, not atomic across the batch: publish each report before its WAV.
            return [...pairs].flatMap(([audio, report]) => [tokenOf(report), tokenOf(audio)]);
        },
    };
}

/** A batch owns only native-issued transaction tokens; paths are granted and checked in Rust. */
export async function streamExportToNative(input: {
    directoryPath?: string;
    selectedFilePath?: string;
    requireReportPairs?: boolean;
    checkCancelled: () => void;
}): Promise<NativeExportBatch> {
    const reportPairs = createReportPairLedger(input);
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
            return createNativeExportEntry(token, checkOpen, input.checkCancelled, () => {
                fileOpen = false;
                reportPairs.complete(name, token);
            });
        },
        registerReportPair(audioName: string, reportName: string) {
            checkOpen();
            reportPairs.register(audioName, reportName);
        },
        async commit(onCommitBegin: () => void) {
            checkOpen();
            if (fileOpen || tokens.length === 0) {
                throw new Error('Export has no completed files.');
            }
            const commitTokens = reportPairs.commitOrder(tokens);
            onCommitBegin();
            await commitExportFiles(commitTokens);
            closed = true;
        },
        abort,
    };
}
