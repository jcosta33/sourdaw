import { beforeEach, describe, expect, it, vi } from 'vitest';

import { streamExport } from '../../../useCases/audioExport/streamExport';

const native = vi.hoisted(() => ({
    begin: vi.fn<(path: string) => Promise<string>>(),
    append: vi.fn<(token: string, bytes: Uint8Array) => Promise<void>>(),
    seal: vi.fn<(token: string) => Promise<void>>(),
    commit: vi.fn<(tokens: readonly string[]) => Promise<void>>(),
    abort: vi.fn<(tokens: readonly string[]) => Promise<void>>(),
}));

vi.mock('#/utils/desktopBridge', () => ({
    beginExportFile: native.begin,
    appendExportFile: native.append,
    sealExportFile: native.seal,
    commitExportFiles: native.commit,
    abortExportFiles: native.abort,
    desktopPathJoin: (directory: string, name: string) => Promise.resolve(`${directory}/${name}`),
}));

beforeEach(() => vi.resetAllMocks());

function controlledNativeOutput() {
    const reservations = new Map<string, string>();
    const staged = new Map<string, { path: string; chunks: Uint8Array[]; sealed: boolean }>();
    const files = new Map<string, Uint8Array>();
    let nextToken = 0;
    const reserve = (path: string) => {
        if (reservations.has(path)) {
            throw new Error('Export target is already staged.');
        }
        const token = `native-token-${++nextToken}`;
        reservations.set(path, token);
        staged.set(token, { path, chunks: [], sealed: false });
        return token;
    };
    const getStage = (token: string) => {
        const stage = staged.get(token);
        if (!stage || reservations.get(stage.path) !== token) {
            throw new Error('Unknown native token.');
        }
        return stage;
    };
    native.begin.mockImplementation(async (path) => reserve(path));
    native.append.mockImplementation(async (token, bytes) => {
        getStage(token).chunks.push(bytes.slice());
    });
    native.seal.mockImplementation(async (token) => {
        getStage(token).sealed = true;
    });
    native.abort.mockImplementation(async (tokens) => {
        for (const token of tokens) {
            const stage = getStage(token);
            reservations.delete(stage.path);
            staged.delete(token);
        }
    });
    native.commit.mockImplementation(async (tokens) => {
        for (const token of tokens) {
            const stage = getStage(token);
            if (!stage.sealed) {
                throw new Error('Native output is not sealed.');
            }
            const bytes = new Uint8Array(stage.chunks.reduce((length, chunk) => length + chunk.length, 0));
            let offset = 0;
            for (const chunk of stage.chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
            }
            files.set(stage.path, bytes);
            reservations.delete(stage.path);
            staged.delete(token);
        }
    });
    return { files, reservations, reserve };
}

function openOutput(path: string, controller = new AbortController()) {
    return streamExport({
        destination: { kind: 'native', selectedFilePath: path },
        formats: ['wav'],
        bitDepth: 16,
        mp3BitRate: 192,
        dither: { mode: 'none' },
        signal: controller.signal,
        checkCancelled: () => {
            if (controller.signal.aborted) {
                throw new Error('Export cancelled');
            }
        },
    });
}

function writeAudio(output: Awaited<ReturnType<typeof streamExport>>) {
    return output.writeAudio({
        source: {
            length: 4,
            sampleRate: 48_000,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array([0, 0.25, -0.25, 0]),
        },
        name: 'mix',
        onProgress: () => {},
        onLimited: () => {},
    });
}

describe('native streaming cancellation through the export caller', () => {
    it('keeps cancellation cleanup pending through a held native begin and token abort, then retries the same path', async () => {
        const { files, reservations, reserve } = controlledNativeOutput();
        const previousFile = new Uint8Array([7, 8, 9]);
        files.set('/picked/mix.wav', previousFile);
        const beginEntered = Promise.withResolvers<string>();
        const releaseBegin = Promise.withResolvers<void>();
        const abortEntered = Promise.withResolvers<void>();
        const releaseAbort = Promise.withResolvers<void>();
        native.begin.mockImplementationOnce(async (path) => {
            const token = reserve(path);
            beginEntered.resolve(token);
            await releaseBegin.promise;
            return token;
        });
        const cleanup = native.abort.getMockImplementation()!;
        native.abort.mockImplementation(async (tokens) => {
            if (tokens.includes('native-token-1')) {
                abortEntered.resolve();
                await releaseAbort.promise;
            }
            await cleanup(tokens);
        });
        const controller = new AbortController();
        const output = await openOutput('/picked/mix.wav', controller);
        const writing = writeAudio(output);
        const token = await beginEntered.promise;
        controller.abort();
        await expect(writing).rejects.toThrow('Export cancelled');
        let cleanupCompleted = false;
        const aborting = output.abort().then(() => {
            cleanupCompleted = true;
        });

        // Completing another real encode gives cleanup a chance to finish while
        // retaining an independent successor's reservation across both windows.
        const successor = await openOutput('/picked/successor.wav');
        await writeAudio(successor);
        expect(cleanupCompleted).toBe(false);
        expect(reservations.get('/picked/mix.wav')).toBe(token);
        expect(reservations.get('/picked/successor.wav')).toBe('native-token-2');

        releaseBegin.resolve();
        await abortEntered.promise;
        expect(cleanupCompleted).toBe(false);
        expect(reservations.get('/picked/mix.wav')).toBe(token);
        expect(native.abort).toHaveBeenCalledWith([token]);
        releaseAbort.resolve();
        await aborting;
        expect(reservations.has('/picked/mix.wav')).toBe(false);
        expect(files.get('/picked/mix.wav')).toEqual(previousFile);
        expect(reservations.get('/picked/successor.wav')).toBe('native-token-2');

        const retry = await openOutput('/picked/mix.wav');
        await writeAudio(retry);
        await retry.commit(() => {});
        const wav = files.get('/picked/mix.wav');
        if (!wav) {
            throw new Error('Expected the same-path retry to commit a WAV file.');
        }
        expect(wav.byteLength).toBe(52);
        expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
        expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE');
        expect(new DataView(wav.buffer).getUint32(40, true)).toBe(8);
        expect(native.commit).toHaveBeenCalledWith(['native-token-3']);
        expect(reservations.get('/picked/successor.wav')).toBe('native-token-2');
        await successor.commit(() => {});
        expect(files.get('/picked/successor.wav')).toEqual(wav);
        expect(reservations.size).toBe(0);
        expect(native.abort).toHaveBeenCalledOnce();
    });
});
