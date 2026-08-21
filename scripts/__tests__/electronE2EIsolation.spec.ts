import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedElectronUserData } from '../electronE2EIsolation';

type LaunchedFixture = {
    directory: string;
};

describe('Electron E2E user-data isolation', () => {
    it('gives every launch a unique absolute user-data argument and never falls back to the default profile', async () => {
        const launches: string[] = [];

        for (let index = 0; index < 2; index += 1) {
            await withIsolatedElectronUserData<LaunchedFixture, void>({
                launch: ({ argument, directory }) => {
                    expect(argument).toBe(`--user-data-dir=${directory}`);
                    expect(isAbsolute(directory)).toBe(true);
                    expect(existsSync(directory)).toBe(true);
                    launches.push(directory);
                    return Promise.resolve({ directory });
                },
                run: () => Promise.resolve(),
                shutdown: () => Promise.resolve(),
            });
        }

        expect(new Set(launches).size).toBe(2);
        expect(launches.every((directory) => !existsSync(directory))).toBe(true);
    });

    it('confirms shutdown before removing only the exact temporary directory on success', async () => {
        const events: string[] = [];
        let directory = '';
        let sibling = '';

        await withIsolatedElectronUserData<LaunchedFixture, void>({
            launch: (scope) => {
                directory = scope.directory;
                sibling = `${directory}-sibling`;
                mkdirSync(sibling);
                writeFileSync(join(directory, 'profile-state'), 'isolated');
                events.push('launch');
                return Promise.resolve({ directory });
            },
            run: () => {
                events.push('run');
                return Promise.resolve();
            },
            shutdown: () => {
                expect(existsSync(directory)).toBe(true);
                events.push('shutdown-complete');
                return Promise.resolve();
            },
        });

        expect(events).toEqual(['launch', 'run', 'shutdown-complete']);
        expect(existsSync(directory)).toBe(false);
        expect(existsSync(sibling)).toBe(true);
        rmSync(sibling, { recursive: true });
    });

    it.each(['launch failure', 'probe failure', 'probe timeout', 'shutdown failure'])(
        'removes the isolated profile after %s',
        async (failure) => {
            let directory = '';
            const shutdown = vi.fn(() =>
                failure === 'shutdown failure' ? Promise.reject(new Error(failure)) : Promise.resolve()
            );

            await expect(
                withIsolatedElectronUserData<LaunchedFixture, void>({
                    launch: (scope) => {
                        directory = scope.directory;
                        writeFileSync(join(directory, 'profile-state'), 'isolated');
                        if (failure === 'launch failure') {
                            return Promise.reject(new Error(failure));
                        }
                        return Promise.resolve({ directory });
                    },
                    run: () => {
                        if (failure === 'probe failure' || failure === 'probe timeout') {
                            return Promise.reject(new Error(failure));
                        }
                        return Promise.resolve();
                    },
                    shutdown,
                })
            ).rejects.toThrow(failure);

            expect(existsSync(directory)).toBe(false);
            expect(shutdown).toHaveBeenCalledTimes(failure === 'launch failure' ? 0 : 1);
        }
    );
});
