/**
 * The shell's power-save blocker owner (#2165).
 *
 * On macOS, App Nap and system idle sleep throttle timers and background work
 * in the main process while a session is playing, recording, or being monitored
 * through a running native engine — a DAW keeps the machine awake while its
 * audio is live, and this module is the whole of that policy: exactly one
 * blocker for the shell, acquired when audio activity begins and released when
 * it fully ends or the app quits.
 *
 * `prevent-app-suspension` rather than `prevent-display-sleep`: the product is
 * audio, and that is Electron's documented pairing for it — the machine stays
 * awake while the screen is free to sleep, which is what every player and DAW
 * does during playback.
 *
 * The blocker is injected like every other moving part in this shell, so the
 * pairing and the exactly-once discipline are testable without Electron.
 */

/** The blocker types Electron defines; the shell starts only the audio one. */
export type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

/** The `electron/powerSaveBlocker` surface this owner reads. */
export type PowerSaveBlockerLike = {
    readonly start: (type: PowerSaveBlockerType) => number;
    readonly stop: (id: number) => void;
    readonly isStarted: (id: number) => boolean;
};

export type PowerSaveController = {
    /** Acquire the one blocker, if it is not already held. Idempotent. */
    readonly audioActivityStarted: () => void;
    /** Release the held blocker, if there is one. Idempotent. */
    readonly audioActivityEnded: () => void;
    /** The held blocker id, or `undefined` while none is held. */
    readonly heldBlockerId: () => number | undefined;
};

export const POWER_SAVE_BLOCKER_TYPE = 'prevent-app-suspension';

export const createPowerSaveController = ({
    blocker,
}: {
    readonly blocker: PowerSaveBlockerLike;
}): PowerSaveController => {
    let held: number | undefined;

    return {
        audioActivityStarted: () => {
            if (held !== undefined) {
                return;
            }
            held = blocker.start(POWER_SAVE_BLOCKER_TYPE);
        },
        audioActivityEnded: () => {
            if (held === undefined) {
                return;
            }
            const id = held;
            held = undefined;
            // `stop` is only meaningful for an id Electron still reports as
            // started; a release racing some external stop degrades to a no-op
            // rather than an error, which matters because one caller is the
            // quit cascade, where an error would be noise on the way out.
            if (blocker.isStarted(id)) {
                blocker.stop(id);
            }
        },
        heldBlockerId: () => held,
    };
};
