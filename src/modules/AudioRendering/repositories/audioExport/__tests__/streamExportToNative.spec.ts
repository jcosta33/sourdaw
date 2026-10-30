import { beforeEach, describe, expect, it, vi } from 'vitest';

import { streamExportToNative } from '../streamExportToNative';

const native = vi.hoisted(() => ({
    begin: vi.fn(async (_path: string) => 'opaque-token'),
    append: vi.fn(async () => {}),
    seal: vi.fn(async () => {}),
    commit: vi.fn(async (_tokens: readonly string[]) => {}),
    abort: vi.fn(async (_tokens: readonly string[]) => {}),
    join: vi.fn(async (directory: string, name: string) => `${directory}/${name}`),
}));
vi.mock('#/utils/desktopBridge', () => ({
    beginExportFile: native.begin,
    appendExportFile: native.append,
    sealExportFile: native.seal,
    commitExportFiles: native.commit,
    abortExportFiles: native.abort,
    desktopPathJoin: native.join,
}));
beforeEach(() => {
    vi.resetAllMocks();
    native.begin.mockImplementation(async () => 'opaque-token');
    native.append.mockImplementation(async () => {});
    native.seal.mockImplementation(async () => {});
    native.commit.mockImplementation(async () => {});
    native.abort.mockImplementation(async () => {});
    native.join.mockImplementation(async (directory, name) => `${directory}/${name}`);
});

function controlledNativeReservations() {
    const reservations = new Map<string, string>();
    let nextToken = 0;
    const reserve = (path: string) => {
        if (reservations.has(path)) {
            throw new Error('Destination is already reserved.');
        }
        const token = `native-token-${++nextToken}`;
        reservations.set(path, token);
        return token;
    };
    native.begin.mockImplementation(async (path) => reserve(path));
    native.abort.mockImplementation(async (tokens) => {
        for (const token of tokens) {
            const entry = [...reservations].find(([, ownedToken]) => ownedToken === token);
            if (!entry) {
                throw new Error('Unknown native token.');
            }
            reservations.delete(entry[0]);
        }
    });
    native.commit.mockImplementation(async (tokens) => {
        for (const token of tokens) {
            const entry = [...reservations].find(([, ownedToken]) => ownedToken === token);
            if (!entry) {
                throw new Error('Unknown native token.');
            }
            reservations.delete(entry[0]);
        }
    });
    return { reservations, reserve };
}
describe('native export transaction adapter', () => {
    it('commits each report token before its WAV using only native-issued tokens', async () => {
        let index = 0;
        native.begin.mockImplementation(async () => `issued-${++index}`);
        const batch = await streamExportToNative({
            directoryPath: '/picked',
            requireReportPairs: true,
            checkCancelled: () => {},
        });
        const start = vi.fn();
        for (const name of ['one.wav', 'two.wav']) {
            const audio = await batch.beginFile(name);
            await audio.finish();
            await expect(batch.commit(start)).rejects.toThrow('pairs are incomplete');
            const reportName = `${name}.loudness.json`;
            const report = await batch.beginFile(reportName);
            expect(() => batch.registerReportPair(name, reportName)).toThrow('Invalid WAV report pair');
            await expect(batch.commit(start)).rejects.toThrow('no completed files');
            await report.finish();
            await expect(batch.commit(start)).rejects.toThrow('pairs are incomplete');
            expect(() => batch.registerReportPair(name, `${name}.json`)).toThrow('Invalid WAV report pair');
            batch.registerReportPair(name, reportName);
            expect(() => batch.registerReportPair(name, reportName)).toThrow('Invalid WAV report pair');
        }
        expect(start).not.toHaveBeenCalled();
        await batch.commit(start);
        expect(start).toHaveBeenCalledOnce();
        expect(native.commit).toHaveBeenCalledExactlyOnceWith(['issued-2', 'issued-1', 'issued-4', 'issued-3']);
        expect(native.begin.mock.calls.map(([path]) => path)).toEqual([
            '/picked/one.wav',
            '/picked/one.wav.loudness.json',
            '/picked/two.wav',
            '/picked/two.wav.loudness.json',
        ]);
    });

    it('refuses single-file report mode before any native I/O', async () => {
        await expect(
            streamExportToNative({
                selectedFilePath: '/picked/renamed.wav',
                requireReportPairs: true,
                checkCancelled: () => {},
            })
        ).rejects.toThrow('WAV reports require a native export directory');
        expect(native.join).not.toHaveBeenCalled();
        expect(native.begin).not.toHaveBeenCalled();
        expect(native.commit).not.toHaveBeenCalled();
    });

    it('propagates paired commit failure and keeps every issued token available for cleanup', async () => {
        const { reservations } = controlledNativeReservations();
        native.commit.mockRejectedValueOnce(new Error('report replacement denied'));
        const batch = await streamExportToNative({
            directoryPath: '/picked',
            requireReportPairs: true,
            checkCancelled: () => {},
        });
        for (const name of ['mix.wav', 'mix.wav.loudness.json']) {
            const entry = await batch.beginFile(name);
            await entry.finish();
        }
        batch.registerReportPair('mix.wav', 'mix.wav.loudness.json');
        await expect(batch.commit(() => {})).rejects.toThrow('report replacement denied');
        expect(reservations.size).toBe(2);
        await batch.abort();
        expect(native.abort).toHaveBeenCalledExactlyOnceWith(['native-token-1', 'native-token-2']);
        expect(reservations.size).toBe(0);
    });

    it.each(['append', 'seal'] as const)(
        'refuses a paired file when cancellation overtakes native %s',
        async (operation) => {
            const { reservations } = controlledNativeReservations();
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            native[operation].mockImplementationOnce(() => {
                entered.resolve();
                return release.promise;
            });
            let cancelled = false;
            const batch = await streamExportToNative({
                directoryPath: '/picked',
                requireReportPairs: true,
                checkCancelled: () => {
                    if (cancelled) throw new Error('Export cancelled');
                },
            });
            const audio = await batch.beginFile('mix.wav');
            const pending = operation === 'append' ? audio.writer.write(new Uint8Array([1])) : audio.finish();
            const failed = expect(pending).rejects.toThrow('Export cancelled');
            await entered.promise;
            cancelled = true;
            await batch.abort();
            release.resolve();
            await failed;
            await expect(batch.commit(() => {})).rejects.toThrow('Export cancelled');
            expect(native.commit).not.toHaveBeenCalled();
            expect(reservations.size).toBe(0);
        }
    );

    it('checks cancellation immediately before paired commit', async () => {
        const { reservations } = controlledNativeReservations();
        let cancelled = false;
        const batch = await streamExportToNative({
            directoryPath: '/picked',
            requireReportPairs: true,
            checkCancelled: () => {
                if (cancelled) throw new Error('Export cancelled');
            },
        });
        for (const name of ['mix.wav', 'mix.wav.loudness.json']) {
            const entry = await batch.beginFile(name);
            await entry.finish();
        }
        batch.registerReportPair('mix.wav', 'mix.wav.loudness.json');
        cancelled = true;
        const start = vi.fn();
        await expect(batch.commit(start)).rejects.toThrow('Export cancelled');
        expect(start).not.toHaveBeenCalled();
        expect(native.commit).not.toHaveBeenCalled();
        await batch.abort();
        expect(reservations.size).toBe(0);
    });

    it('does not begin a native file after cancellation overtakes destination resolution', async () => {
        const { reservations } = controlledNativeReservations();
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<string>();
        native.join.mockImplementationOnce(() => {
            entered.resolve();
            return release.promise;
        });
        let cancelled = false;
        const checkCancelled = () => {
            if (cancelled) {
                throw new Error('Export cancelled');
            }
        };
        const batch = await streamExportToNative({
            directoryPath: '/picked',
            requireReportPairs: true,
            checkCancelled,
        });
        const beginning = batch.beginFile('mix.wav');
        await entered.promise;
        cancelled = true;
        await batch.abort();
        release.resolve('/picked/mix.wav');
        await expect(beginning).rejects.toThrow('Export cancelled');
        expect(native.begin).not.toHaveBeenCalled();
        expect(reservations.size).toBe(0);

        const retry = await streamExportToNative({ directoryPath: '/picked', checkCancelled: () => {} });
        const entry = await retry.beginFile('mix.wav');
        await entry.finish();
        await retry.commit(() => {});
        expect(native.commit).toHaveBeenCalledWith(['native-token-1']);
        expect(reservations.size).toBe(0);
    });

    it('aborts the exact late native token after cancellation, then permits a new export at the same path', async () => {
        const { reservations, reserve } = controlledNativeReservations();
        const entered = Promise.withResolvers<string>();
        const release = Promise.withResolvers<void>();
        native.begin.mockImplementationOnce(async (path) => {
            const token = reserve(path);
            entered.resolve(token);
            await release.promise;
            return token;
        });
        let cancelled = false;
        const checkCancelled = () => {
            if (cancelled) {
                throw new Error('Export cancelled');
            }
        };
        const batch = await streamExportToNative({
            directoryPath: '/picked',
            requireReportPairs: true,
            checkCancelled,
        });
        const beginning = batch.beginFile('mix.wav');
        const lateToken = await entered.promise;
        expect(reservations.get('/picked/mix.wav')).toBe(lateToken);
        cancelled = true;
        const aborting = batch.abort();
        expect(native.abort).not.toHaveBeenCalled();
        release.resolve();
        await aborting;
        await expect(beginning).rejects.toThrow('Export cancelled');
        expect(native.abort).toHaveBeenCalledWith([lateToken]);
        expect(reservations.size).toBe(0);
        expect(native.append).not.toHaveBeenCalled();
        expect(native.seal).not.toHaveBeenCalled();
        expect(native.commit).not.toHaveBeenCalled();

        const retry = await streamExportToNative({ selectedFilePath: '/picked/mix.wav', checkCancelled: () => {} });
        const entry = await retry.beginFile('mix.wav');
        await entry.writer.write(new Uint8Array([1]));
        await entry.finish();
        await retry.commit(() => {});
        expect(native.commit).toHaveBeenCalledWith(['native-token-2']);
        expect(reservations.size).toBe(0);
    });

    it('fences a returned begin token while abort is awaiting native cleanup', async () => {
        const { reservations, reserve } = controlledNativeReservations();
        const abortEntered = Promise.withResolvers<void>();
        const finishAbort = Promise.withResolvers<void>();
        const beginEntered = Promise.withResolvers<string>();
        const finishBegin = Promise.withResolvers<void>();
        const firstAbort = native.abort.getMockImplementation()!;
        native.abort.mockImplementation(async (tokens) => {
            if (tokens.includes('native-token-1')) {
                abortEntered.resolve();
                await finishAbort.promise;
            }
            await firstAbort(tokens);
        });
        const firstBegin = native.begin.getMockImplementation()!;
        native.begin.mockImplementation(async (path) => {
            if (path.endsWith('second.wav')) {
                const token = reserve(path);
                beginEntered.resolve(token);
                await finishBegin.promise;
                return token;
            }
            return firstBegin(path);
        });
        let cancelled = false;
        const checkCancelled = () => {
            if (cancelled) {
                throw new Error('Export cancelled');
            }
        };
        const batch = await streamExportToNative({
            directoryPath: '/picked',
            requireReportPairs: true,
            checkCancelled,
        });
        const first = await batch.beginFile('first.wav');
        await first.finish();
        const lateBegin = batch.beginFile('second.wav');
        const lateToken = await beginEntered.promise;
        cancelled = true;
        const aborting = batch.abort();
        await expect(first.writer.write(new Uint8Array([9]))).rejects.toThrow('Export cancelled');
        await expect(first.finish()).rejects.toThrow('Export cancelled');
        expect(native.append).not.toHaveBeenCalled();
        expect(native.seal).toHaveBeenCalledTimes(1);
        finishBegin.resolve();
        await abortEntered.promise;
        expect(native.abort).toHaveBeenCalledWith(['native-token-1', lateToken]);
        finishAbort.resolve();
        await aborting;
        await expect(lateBegin).rejects.toThrow('Export cancelled');
        expect(reservations.size).toBe(0);
        expect(native.commit).not.toHaveBeenCalled();
    });

    it('stages all formats, seals each, then commits the exact batch once', async () => {
        let index = 0;
        native.begin.mockImplementation(async () => `token-${++index}`);
        const batch = await streamExportToNative({ selectedFilePath: '/picked/mix.wav', checkCancelled: () => {} });
        for (const name of ['mix.wav', 'mix.mp3', 'mix.flac']) {
            const entry = await batch.beginFile(name);
            await entry.writer.write(new Uint8Array([1]));
            await entry.finish();
        }
        expect(native.commit).not.toHaveBeenCalled();
        const start = vi.fn();
        await batch.commit(start);
        expect(start).toHaveBeenCalledTimes(1);
        expect(native.begin.mock.calls.map(([path]) => path)).toEqual([
            '/picked/mix.wav',
            '/picked/mix.mp3',
            '/picked/mix.flac',
        ]);
        expect(native.commit).toHaveBeenCalledWith(['token-1', 'token-2', 'token-3']);
        await batch.abort();
        expect(native.abort).not.toHaveBeenCalled();
    });
    it('aborts every admitted token after a late append failure', async () => {
        native.begin.mockResolvedValue('only-owned-token');
        native.append.mockRejectedValueOnce(new Error('disk full'));
        const batch = await streamExportToNative({ directoryPath: '/picked', checkCancelled: () => {} });
        const entry = await batch.beginFile('stem.wav');
        await expect(entry.writer.write(new Uint8Array([1]))).rejects.toThrow('disk full');
        await batch.abort();
        expect(native.abort).toHaveBeenCalledWith(['only-owned-token']);
        expect(native.commit).not.toHaveBeenCalled();
    });

    it('coalesces cleanup failures and retains late tokens for an explicit abort retry', async () => {
        const { reservations, reserve } = controlledNativeReservations();
        const entered = Promise.withResolvers<string>();
        const release = Promise.withResolvers<void>();
        native.begin.mockImplementationOnce(async (path) => {
            const token = reserve(path);
            entered.resolve(token);
            await release.promise;
            return token;
        });
        native.abort.mockRejectedValueOnce(new Error('cleanup denied'));
        const batch = await streamExportToNative({
            directoryPath: '/picked',
            requireReportPairs: true,
            checkCancelled: () => {},
        });
        const beginning = batch.beginFile('mix.wav');
        const token = await entered.promise;
        const aborting = batch.abort();
        const coalesced = batch.abort();
        const failedBegin = expect(beginning).rejects.toThrow('cleanup denied');
        const failedAbort = expect(aborting).rejects.toThrow('cleanup denied');
        const failedCoalesced = expect(coalesced).rejects.toThrow('cleanup denied');
        release.resolve();
        await Promise.all([failedBegin, failedAbort, failedCoalesced]);
        expect(native.abort).toHaveBeenCalledTimes(1);
        expect(native.abort).toHaveBeenLastCalledWith([token]);
        expect(reservations.get('/picked/mix.wav')).toBe(token);
        await expect(batch.beginFile('other.wav')).rejects.toThrow('Export cancelled');

        await batch.abort();

        expect(native.abort).toHaveBeenCalledTimes(2);
        expect(native.abort).toHaveBeenLastCalledWith([token]);
        expect(reservations.size).toBe(0);
    });

    it('settles abort after a pending native begin rejects without inventing a token', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<string>();
        native.begin.mockImplementationOnce(() => {
            entered.resolve();
            return release.promise;
        });
        const batch = await streamExportToNative({
            directoryPath: '/picked',
            requireReportPairs: true,
            checkCancelled: () => {},
        });
        const beginning = batch.beginFile('mix.wav');
        await entered.promise;
        const aborting = batch.abort();
        const failedBegin = expect(beginning).rejects.toThrow('native begin failed');

        release.reject(new Error('native begin failed'));

        await failedBegin;
        await aborting;
        expect(native.abort).toHaveBeenCalledOnce();
        expect(native.abort).toHaveBeenCalledWith([]);
        expect(native.append).not.toHaveBeenCalled();
        expect(native.commit).not.toHaveBeenCalled();
    });
});
