/**
 * Builds a silent stand-in for {@link AudioContext} from an
 * {@link OfflineAudioContext} (which never produces sound and shares the
 * node-factory surface the fallback path uses). The handful of `AudioContext`
 * members `OfflineAudioContext` lacks are stubbed so the result is a genuine,
 * structurally-checked `AudioContext` — replacing the former
 * `as BaseAudioContext as AudioContext` double-assertion, which silenced the
 * type checker rather than satisfying it.
 */
export function createNoopAudioContext(): AudioContext {
    const offline = new OfflineAudioContext(2, 1, 44100);
    function reject(): never {
        throw new Error('AudioEngine is in fallback mode — no AudioContext is available.');
    }
    const shim: AudioContext = Object.assign(offline, {
        baseLatency: 0,
        outputLatency: 0,
        close: () => Promise.resolve(),
        // `OfflineAudioContext.suspend` requires a `suspendTime` argument, so its
        // signature is wider than `AudioContext.suspend()`. Override both lifecycle
        // methods with the no-op, no-arg forms the fallback path expects.
        resume: () => Promise.resolve(),
        suspend: () => Promise.resolve(),
        createMediaElementSource: reject,
        createMediaStreamSource: reject,
        createMediaStreamDestination: reject,
        getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    });
    return shim;
}
