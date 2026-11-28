export type SignalWindow = {
    firstFrame: number;
    endFrame: number;
    sampleRate: number;
    frames: number;
    rms: number;
    sentinel: number;
    preview: number;
    /** Minimum Hann-windowed A3 magnitude over contiguous 8192-frame blocks. */
    minimumSentinel: number;
};
export type AuditionTrial = {
    kind: 'held' | 'release' | 'close';
    pressFrame: number;
    scheduled: SignalWindow;
    positive: SignalWindow;
    late: SignalWindow;
    actionFrame: number;
    nativeCarrier: boolean;
    advancing: boolean;
};
export type AuditionOperationFailure = {
    trial: AuditionTrial['kind'] | null;
    operation:
        | 'stop'
        | 'reset-playhead'
        | 'read-quiet'
        | 'check-quiet'
        | 'recheck-editor'
        | 'track-identity'
        | 'play'
        | 'advance-playhead'
        | 'read-scheduled-a3'
        | 'check-scheduled-a3'
        | 'piano-hit-target'
        | 'pointer-down'
        | 'read-press-frame'
        | 'preview-status'
        | 'read-carrier'
        | 'read-positive'
        | 'read-playhead'
        | 'release-preview'
        | 'close-editor'
        | 'read-action-frame'
        | 'read-late'
        | 'pointer-cleanup'
        | 'final-stop'
        | 'final-card';
    error: 'playwright-timeout' | 'assertion' | 'capture-read' | 'unexpected';
    signal: { measured: number; threshold: number } | null;
};
export type AuditionObservations = {
    input: string | null;
    output: string | null;
    trackId: string | null;
    deviceId: string | null;
    quiet: SignalWindow | null;
    trials: AuditionTrial[];
    operationFailure: AuditionOperationFailure | null;
    unavailable: string | null;
    appQuit: boolean;
};
export function freshAuditionObservations(): AuditionObservations {
    return {
        input: null,
        output: null,
        trackId: null,
        deviceId: null,
        quiet: null,
        trials: [],
        operationFailure: null,
        unavailable: null,
        appQuit: false,
    };
}
export function validWindow(w: SignalWindow): boolean {
    return (
        Number.isSafeInteger(w.firstFrame) &&
        w.firstFrame >= 0 &&
        Number.isSafeInteger(w.endFrame) &&
        w.endFrame - w.firstFrame === w.frames &&
        (w.frames === 32768 || w.frames === 98304) &&
        Number.isFinite(w.sampleRate) &&
        w.sampleRate >= 32000 &&
        w.sampleRate <= 192000 &&
        [w.rms, w.sentinel, w.preview, w.minimumSentinel].every((v) => Number.isFinite(v) && v >= 0 && v <= 2)
    );
}
/**
 * PCM covers packaged output, at 8192-frame signal resolution on the capture clock.
 * The global native carrier does not attribute an individual voice or the product callback edge.
 * Each arm starts 4096 capture frames after pointer-down, then observes the same positive
 * and post-action frame ages. The late preview metric uses the final 32768 post-action frames.
 */
export function auditionFailure(observations: AuditionObservations) {
    if (observations.unavailable) {
        return 'capture-unavailable';
    }
    if (
        observations.input !== 'BlackHole 2ch' ||
        observations.output !== 'BlackHole 2ch' ||
        !observations.trackId ||
        !observations.deviceId ||
        !observations.appQuit
    ) {
        return 'audition-incomplete';
    }
    const q = observations.quiet;
    if (!q || !validWindow(q) || q.rms > 0.0001) {
        return 'quiet-baseline-invalid';
    }
    if (observations.trials.length !== 3 || observations.trials.map((t) => t.kind).join(',') !== 'held,release,close') {
        return 'audition-incomplete';
    }
    const floor = Math.max(0.00001, q.rms * 10, q.sentinel * 10, q.preview * 10);
    for (const t of observations.trials) {
        if (!trialClockValid(t, q.sampleRate)) {
            return 'clock-or-playback-invalid';
        }
        if (!trialSignalValid(t, floor)) {
            return 'positive-or-sentinel-lost';
        }
    }
    const control = observations.trials[0]!;
    const heldRatio = control.late.preview / control.positive.preview;
    if (control.late.preview < floor || heldRatio < 0.1) {
        return 'held-control-decayed';
    }
    for (const t of observations.trials.slice(1)) {
        if (t.late.preview > t.positive.preview * heldRatio * 0.35) {
            return 'preview-did-not-release';
        }
    }
    return null;
}

function trialSignalValid(trial: AuditionTrial, floor: number): boolean {
    return (
        trial.scheduled.sentinel >= floor &&
        trial.positive.preview >= Math.max(floor, trial.scheduled.preview * 10) &&
        trial.positive.sentinel >= floor &&
        trial.late.minimumSentinel >= Math.max(floor, trial.positive.sentinel * 0.1)
    );
}

function trialClockValid(trial: AuditionTrial, sampleRate: number): boolean {
    const { positive, late, scheduled, pressFrame, actionFrame } = trial;
    const windowsValid = [positive, late, scheduled].every(
        (window) => validWindow(window) && window.sampleRate === sampleRate
    );
    const pressValid =
        Number.isSafeInteger(pressFrame) &&
        pressFrame >= 0 &&
        positive.firstFrame === pressFrame + 4096 &&
        scheduled.endFrame <= pressFrame &&
        scheduled.frames === 32768;
    const actionValid =
        Number.isSafeInteger(actionFrame) &&
        actionFrame >= positive.endFrame &&
        actionFrame <= positive.endFrame + sampleRate * 0.2;
    return (
        windowsValid &&
        pressValid &&
        actionValid &&
        late.firstFrame === positive.endFrame &&
        positive.frames === 32768 &&
        late.frames === 98304 &&
        trial.nativeCarrier &&
        trial.advancing
    );
}

export function measureSignalWindow(raw: {
    firstFrame: number;
    endFrame: number;
    sampleRate: number;
    values: number[];
}): SignalWindow {
    const magnitude = (samples: number[], hz: number): number => {
        let strongest = 0;
        for (const shift of [-1, 0, 1]) {
            let real = 0,
                imag = 0,
                weight = 0;
            for (let i = 0; i < samples.length; i++) {
                const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (samples.length - 1));
                const phase = (2 * Math.PI * hz * (1 + shift * 0.005) * i) / raw.sampleRate;
                real += samples[i]! * w * Math.cos(phase);
                imag += samples[i]! * w * Math.sin(phase);
                weight += w;
            }
            strongest = Math.max(strongest, (2 * Math.hypot(real, imag)) / weight);
        }
        return strongest;
    };
    const tail = raw.values.slice(-32768);
    let minimumSentinel = Infinity;
    for (let i = 0; i < raw.values.length; i += 8192) {
        minimumSentinel = Math.min(minimumSentinel, magnitude(raw.values.slice(i, i + 8192), 220));
    }
    return {
        firstFrame: raw.firstFrame,
        endFrame: raw.endFrame,
        sampleRate: raw.sampleRate,
        frames: raw.values.length,
        rms: Math.sqrt(tail.reduce((sum, v) => sum + v * v, 0) / tail.length),
        sentinel: magnitude(tail, 220),
        preview: magnitude(tail, 261.625565),
        minimumSentinel,
    };
}
