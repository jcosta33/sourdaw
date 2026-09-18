import { describe, expect, it, vi } from 'vitest';

import { createPowerSaveController, POWER_SAVE_BLOCKER_TYPE, type PowerSaveBlockerLike } from '../powerSave.js';
import { registerCommandRouter, type CommandStream, type IpcMainLike, type SenderFrameCarrier } from '../router.js';
import { runBeforeQuitCascade } from '../shutdown.js';

import type { NativeHost } from '../native.js';

/** A `powerSaveBlocker` stand-in that records what the shell asked of it. */
const recordingBlocker = (): { readonly blocker: PowerSaveBlockerLike; readonly calls: string[] } => {
    let nextId = 0;
    const started = new Set<number>();
    const calls: string[] = [];
    return {
        blocker: {
            start: (type) => {
                calls.push(`start:${type}`);
                nextId += 1;
                started.add(nextId);
                return nextId;
            },
            stop: (id) => {
                calls.push(`stop:${id}`);
                started.delete(id);
            },
            isStarted: (id) => started.has(id),
        },
        calls,
    };
};

describe('the power-save blocker owner', () => {
    it('acquires exactly one blocker of the audio type when activity begins', () => {
        const { blocker, calls } = recordingBlocker();

        const powerSave = createPowerSaveController({ blocker });
        powerSave.audioActivityStarted();

        expect(calls).toEqual([`start:${POWER_SAVE_BLOCKER_TYPE}`]);
    });

    it('pins the blocker type to prevent-app-suspension', () => {
        // Audio, not video: the machine must stay awake while the screen is
        // free to sleep, which is Electron's documented pairing for playing
        // audio. Drifting to `prevent-display-sleep` changes what the user's
        // machine does during playback and must be a decision, not a typo.
        expect(POWER_SAVE_BLOCKER_TYPE).toBe('prevent-app-suspension');
    });

    it('holds one blocker across repeated activity, not one per report', () => {
        const { blocker, calls } = recordingBlocker();

        const powerSave = createPowerSaveController({ blocker });
        powerSave.audioActivityStarted();
        powerSave.audioActivityStarted();
        powerSave.audioActivityStarted();

        expect(calls).toEqual([`start:${POWER_SAVE_BLOCKER_TYPE}`]);
        expect(powerSave.heldBlockerId()).toBe(1);
    });

    it('releases the held blocker once when activity fully ends', () => {
        const { blocker, calls } = recordingBlocker();

        const powerSave = createPowerSaveController({ blocker });
        powerSave.audioActivityStarted();
        powerSave.audioActivityEnded();
        powerSave.audioActivityEnded();

        expect(calls).toEqual([`start:${POWER_SAVE_BLOCKER_TYPE}`, 'stop:1']);
        expect(powerSave.heldBlockerId()).toBeUndefined();
    });

    it('ends activity it never began without touching the blocker', () => {
        const { blocker, calls } = recordingBlocker();

        createPowerSaveController({ blocker }).audioActivityEnded();

        expect(calls).toEqual([]);
    });

    it('acquires a fresh blocker for the activity that follows a release', () => {
        const { blocker, calls } = recordingBlocker();

        const powerSave = createPowerSaveController({ blocker });
        powerSave.audioActivityStarted();
        powerSave.audioActivityEnded();
        powerSave.audioActivityStarted();

        expect(calls).toEqual([`start:${POWER_SAVE_BLOCKER_TYPE}`, 'stop:1', `start:${POWER_SAVE_BLOCKER_TYPE}`]);
        expect(powerSave.heldBlockerId()).toBe(2);
    });

    it('does not stop an id the blocker no longer reports as started', () => {
        // `stop` is only meaningful for a started id; a release racing some
        // external stop degrades to a no-op rather than an error.
        const stop = vi.fn();
        const powerSave = createPowerSaveController({
            blocker: { start: () => 7, isStarted: () => false, stop },
        });

        powerSave.audioActivityStarted();
        powerSave.audioActivityEnded();

        expect(powerSave.heldBlockerId()).toBeUndefined();
        expect(stop).not.toHaveBeenCalled();
    });
});

/**
 * The composed seam: the same router the shell registers with, the same
 * engine-lifecycle mapping `main.ts` installs, and a controller over a recorded
 * blocker. This is the acquire-on-play / release-on-stop pairing — a renderer
 * cannot ask for power management by name, so the whole policy must live in
 * what the router can see.
 */
describe('power-save over the routed engine lifecycle', () => {
    const APP_FRAME: SenderFrameCarrier = { senderFrame: { url: 'app://sourdaw/index.html' } };
    const FOREIGN_FRAME: SenderFrameCarrier = { senderFrame: { url: 'https://evil.example/' } };

    type Handler = (event: SenderFrameCarrier, ...args: readonly unknown[]) => unknown;

    const nullStream = (): CommandStream => ({
        emit: () => undefined,
        failure: () => undefined,
        close: () => undefined,
    });

    const refuseUnexpected = (name: string) => () => {
        throw new Error(`Unexpected call: ${name}`);
    };

    const hostWith = (methods: Record<string, (...args: readonly unknown[]) => unknown>): NativeHost => ({
        shutdown: () => undefined,
        startDictation: refuseUnexpected('startDictation'),
        stopDictation: refuseUnexpected('stopDictation'),
        cancelDictation: refuseUnexpected('cancelDictation'),
        grantPath: () => {
            throw new Error('Unexpected grant call');
        },
        ...methods,
    });

    /** The engine-lifecycle mapping `main.ts` passes to `registerCommandRouter`. */
    const observeEngineLifecycle =
        (powerSave: ReturnType<typeof createPowerSaveController>) =>
        (command: string, settlement: 'fulfilled' | 'rejected'): void => {
            if (settlement !== 'fulfilled') {
                return;
            }
            if (command === 'apply_graph_commands') {
                powerSave.audioActivityStarted();
            }
            if (command === 'retire_native_engine') {
                powerSave.audioActivityEnded();
            }
        };

    const setup = ({
        host,
        powerSave,
    }: {
        readonly host: NativeHost | undefined;
        readonly powerSave: ReturnType<typeof createPowerSaveController>;
    }): Map<string, Handler> => {
        const handlers = new Map<string, Handler>();
        const ipcMain: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) };
        registerCommandRouter({
            ipcMain,
            native: () => host,
            isTrustedFrameUrl: (url) => url === APP_FRAME.senderFrame?.url,
            createStream: nullStream,
            commands: ['apply_graph_commands', 'retire_native_engine'],
            observeSettlement: observeEngineLifecycle(powerSave),
        });
        return handlers;
    };

    it('acquires the blocker when a graph batch fulfills, and only once across batches', async () => {
        const { blocker, calls } = recordingBlocker();
        const powerSave = createPowerSaveController({ blocker });
        const handlers = setup({ host: hostWith({ applyGraphCommands: () => 'applied' }), powerSave });

        // Play start and a later topology edit are both fulfilled batches; the
        // blocker must be minted by the first and kept by the second.
        await handlers.get('sourdaw:invoke:apply_graph_commands')?.(APP_FRAME, [{ commands: [] }]);
        await handlers.get('sourdaw:invoke:apply_graph_commands')?.(APP_FRAME, [{ commands: [] }]);

        expect(calls).toEqual([`start:${POWER_SAVE_BLOCKER_TYPE}`]);
        expect(powerSave.heldBlockerId()).toBe(1);
    });

    it('releases the blocker when the engine retires, and reacquires on the next batch', async () => {
        const { blocker, calls } = recordingBlocker();
        const powerSave = createPowerSaveController({ blocker });
        const handlers = setup({
            host: hostWith({
                applyGraphCommands: () => 'applied',
                retireNativeEngine: () => ({ outcome: 'retired' }),
            }),
            powerSave,
        });

        await handlers.get('sourdaw:invoke:apply_graph_commands')?.(APP_FRAME, [{ commands: [] }]);
        await handlers.get('sourdaw:invoke:retire_native_engine')?.(APP_FRAME, []);
        await handlers.get('sourdaw:invoke:apply_graph_commands')?.(APP_FRAME, [{ commands: [] }]);

        expect(calls).toEqual([`start:${POWER_SAVE_BLOCKER_TYPE}`, 'stop:1', `start:${POWER_SAVE_BLOCKER_TYPE}`]);
    });

    it('holds no blocker when the engine never takes a batch', async () => {
        const { blocker, calls } = recordingBlocker();
        const powerSave = createPowerSaveController({ blocker });
        const handlers = setup({ host: undefined, powerSave });

        await expect(handlers.get('sourdaw:invoke:apply_graph_commands')?.(APP_FRAME, [])).rejects.toThrow(
            /native host is not available/u
        );

        expect(calls).toEqual([]);
        expect(powerSave.heldBlockerId()).toBeUndefined();
    });

    it('does not acquire from a frame that is not the application', async () => {
        const { blocker, calls } = recordingBlocker();
        const powerSave = createPowerSaveController({ blocker });
        const handlers = setup({ host: hostWith({ applyGraphCommands: () => 'applied' }), powerSave });

        expect(() => handlers.get('sourdaw:invoke:apply_graph_commands')?.(FOREIGN_FRAME, [])).toThrow(
            /not the application/u
        );

        expect(calls).toEqual([]);
    });
});

describe('power-save release on the quit cascade', () => {
    it('releases the blocker before the native cascade runs', async () => {
        // Pins the live before-quit body (`runBeforeQuitCascade`): dropping the
        // release or ordering it after the cascade must fail this check.
        const order: string[] = [];

        await runBeforeQuitCascade({
            refusePluginCommands: () => {
                order.push('refuse');
            },
            releasePowerSave: () => {
                order.push('release-power-save');
            },
            host: {
                shutdown: () => {
                    order.push('shutdown');
                },
            },
            timers: { setTimer: () => ({ cancel: () => undefined }) },
        });

        expect(order).toEqual(['refuse', 'release-power-save', 'shutdown']);
    });

    it('quits without a release step when none is supplied', async () => {
        await expect(
            runBeforeQuitCascade({
                refusePluginCommands: () => undefined,
                host: undefined,
                timers: { setTimer: () => ({ cancel: () => undefined }) },
            })
        ).resolves.toEqual({ status: 'completed', report: undefined });
    });
});
