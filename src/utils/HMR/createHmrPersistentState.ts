/**
 * Create module-level state that survives Vite's hot-module replacement.
 *
 * ## When to use this
 *
 * **Reach for this only when an external resource — a timer, a Worker, a
 * MediaStream, an AudioWorkletNode, a WebSocket — is alive and holds a
 * reference into the current state object, and losing that reference would
 * silently drop data or leak the resource.**
 *
 * Most module state does **not** need this. A plain `let` binding is fine
 * for caches, per-render scratch buffers, and session state that can be
 * recreated from scratch without consequence. Wrapping non-critical state
 * in a persistent holder adds a new failure mode (stale state surviving a
 * refactor that should have reset it) with no upside.
 *
 * ## The failure mode this prevents
 *
 * The audio recorder is the canonical example: `startAudioRecording` opens
 * a `MediaStream`, creates an `AudioWorkletNode` and a dedicated `Worker`,
 * then stashes them on a module-level `recordingSession` object along with
 * the caller's `onComplete` callback. The worker's `onmessage` handler
 * captures `recordingSession` through closure and posts the finished PCM
 * buffer to `recordingSession.onRecordingComplete`.
 *
 * If Vite HMR evaluates a new copy of the module mid-recording, the
 * `recordingSession` symbol inside the *new* module is a fresh object with
 * every field `null`. The worker's handler — still running, still holding
 * the *old* object — sees `onRecordingComplete === null` when the recording
 * finishes, and the audio is silently discarded.
 *
 * By stashing the session on `import.meta.hot.data`, the new module picks up
 * the *same* object the old module was writing to. The worker's closure
 * stays consistent with whatever `stopAudioRecording` later reads.
 *
 * ## Semantics
 *
 * - In dev (`import.meta.hot` defined), the first call creates the state
 *   via `factory()` and stashes it on `import.meta.hot.data[key]`. Every
 *   subsequent module evaluation returns the existing entry.
 * - In prod (`import.meta.hot` undefined), this collapses to a plain
 *   one-shot `factory()` call — no runtime overhead, no persistence.
 * - The `key` must be unique within the whole app. Prefer a dotted path
 *   that names the module owning the state (`'audioRecorder.session'`,
 *   `'collaboration.peerConnection'`, …).
 * - State shape changes across an HMR reload will *not* automatically
 *   reset — the old object is returned verbatim. Add a structural version
 *   check inside your state object if the shape may evolve during dev.
 *   In practice this is rare and a full page reload is the pragmatic
 *   recovery path.
 */
export function createHmrPersistentState<State>(key: string, factory: () => State): State {
    const hot = import.meta.hot;
    if (!hot) {
        return factory();
    }
    // Vitest's simulated hot context leaves `hot.data` undefined; the Vite
    // dev server initialises it to `{}`. Reassign once so persistence works
    // in both environments and `in`-operator reads have a real target.
    // Vite types `hot.data` as readonly, but it is a live mutable object at
    // runtime and the Vite HMR API explicitly relies on callers writing
    // into it; the cast narrows the type to the actual runtime contract.
    const hotRef = hot as { data: Record<string, unknown> | undefined };
    if (!hotRef.data) {
        hotRef.data = {};
    }
    const data = hotRef.data;
    if (!(key in data)) {
        data[key] = factory();
    }
    return data[key] as State;
}
