import { beforeEach, describe, expect, it, vi } from 'vitest';

type PortModule = typeof import('../undoReplayPreparationPort');

describe('undoReplayPreparationPort', () => {
    let port: PortModule['undoReplayPreparationPort'];
    let runPreparedUndoReplay: PortModule['runPreparedUndoReplay'];

    beforeEach(async () => {
        // A fresh module graph holds an unfilled port; the shared spec fixture only fills the first one.
        vi.resetModules();
        const module = await import('../undoReplayPreparationPort');
        port = module.undoReplayPreparationPort;
        runPreparedUndoReplay = module.runPreparedUndoReplay;
    });

    it('throws naming the port, the fill and its registrar, and runs no replay, while no provider is registered', async () => {
        const replay = vi.fn(() => Promise.resolve('replayed'));

        await expect(runPreparedUndoReplay({}, replay)).rejects.toThrow(
            'runPreparedUndoReplay: no replay preparation provider is registered'
        );
        await expect(runPreparedUndoReplay({}, replay)).rejects.toThrow(
            'undoReplayPreparationPort.setProvider() from initAudioBufferCacheAccess() in src/app/initAudioBufferCacheAccess.ts'
        );
        expect(replay).not.toHaveBeenCalled();
    });

    it('prepares before the replay and releases once it has settled', async () => {
        const order: string[] = [];
        port.setProvider(() => {
            order.push('prepare');
            return Promise.resolve(() => order.push('release'));
        });

        const result = await runPreparedUndoReplay({}, () => {
            order.push('replay');
            return Promise.resolve('done');
        });

        expect(result).toBe('done');
        expect(order).toEqual(['prepare', 'replay', 'release']);
    });

    it('runs the replay at once when the provider has nothing to ready', async () => {
        const provider = vi.fn(() => null);
        port.setProvider(provider);
        const replay = vi.fn(() => Promise.resolve('done'));

        const result = await runPreparedUndoReplay({}, replay);

        expect(provider).toHaveBeenCalledWith([], []);
        expect(replay).toHaveBeenCalledTimes(1);
        expect(result).toBe('done');
    });

    it('releases when the replay fails and rethrows its error', async () => {
        const release = vi.fn();
        port.setProvider(() => Promise.resolve(release));

        await expect(runPreparedUndoReplay({}, () => Promise.reject(new Error('replay failed')))).rejects.toThrow(
            'replay failed'
        );
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('a second fill replaces the first', async () => {
        const first = vi.fn(() => Promise.resolve(() => undefined));
        const second = vi.fn(() => Promise.resolve(() => undefined));
        port.setProvider(first);
        port.setProvider(second);

        await runPreparedUndoReplay({}, () => Promise.resolve());

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith([], []);
    });
});
