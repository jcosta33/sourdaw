export type CrumbsWindow = {
    firstFrame: number;
    frames: number;
    sampleRate: number;
    tone431: number;
    tone619: number;
    sentinel220: number;
    minimumSentinel220: number;
};

export type CrumbsTrial = {
    kind: 'held' | 'release';
    pressFrame: number;
    actionFrame: number;
    baseline: CrumbsWindow;
    positive: CrumbsWindow;
    late: CrumbsWindow;
    trustedDown: boolean;
    trustedUp: boolean;
    nativeRunning: boolean;
    advancing: boolean;
};

export type CrumbsSnapshot = {
    trackId: string;
    deviceId: string;
    filePath: string;
    fileName: string;
    frameCount: number;
    sampleRate: number;
    channels: number;
    sampleId: number;
    mode: string;
    cutoff: number;
    trackDigest: string;
    deviceDigest: string;
};

export type CrumbsSamplerObservations = {
    unavailable: string | null;
    input: string | null;
    output: string | null;
    trackId: string | null;
    deviceId: string | null;
    trustedDrop: boolean;
    control619: CrumbsWindow | null;
    seekBeats: { fresh: number | null; reopened: number | null };
    sampleSha256: string | null;
    savedSnapshot: CrumbsSnapshot | null;
    reopenedSnapshot: CrumbsSnapshot | null;
    savedHeads: string[];
    reopenedHeads: string[];
    savedClean: boolean;
    reopenedTrackId: string | null;
    reopenedDeviceId: string | null;
    trials: { fresh: CrumbsTrial[]; reopened: CrumbsTrial[] };
    quits: { code: number | null; signal: string | null; forced: boolean }[];
};

export function freshCrumbsSamplerObservations(): CrumbsSamplerObservations {
    return {
        unavailable: null,
        input: null,
        output: null,
        trackId: null,
        deviceId: null,
        trustedDrop: false,
        control619: null,
        seekBeats: { fresh: null, reopened: null },
        sampleSha256: null,
        savedSnapshot: null,
        reopenedSnapshot: null,
        savedHeads: [],
        reopenedHeads: [],
        savedClean: false,
        reopenedTrackId: null,
        reopenedDeviceId: null,
        trials: { fresh: [], reopened: [] },
        quits: [],
    };
}

function validWindow(window: CrumbsWindow): boolean {
    return (
        Number.isSafeInteger(window.firstFrame) &&
        window.firstFrame >= 0 &&
        (window.frames === 32768 || window.frames === 98304) &&
        Number.isFinite(window.sampleRate) &&
        window.sampleRate >= 32000 &&
        window.sampleRate <= 192000 &&
        [window.tone431, window.tone619, window.sentinel220, window.minimumSentinel220].every(
            (n) => Number.isFinite(n) && n >= 0 && n <= 2
        )
    );
}

function validClock(trial: CrumbsTrial): boolean {
    const { baseline, positive, late } = trial;
    return (
        validWindow(baseline) &&
        validWindow(positive) &&
        validWindow(late) &&
        baseline.frames === 32768 &&
        positive.frames === 32768 &&
        late.frames === 98304 &&
        baseline.sampleRate === positive.sampleRate &&
        positive.sampleRate === late.sampleRate &&
        Number.isSafeInteger(trial.pressFrame) &&
        trial.pressFrame >= 0 &&
        Number.isSafeInteger(trial.actionFrame) &&
        trial.actionFrame >= 0 &&
        baseline.firstFrame + baseline.frames <= trial.pressFrame &&
        positive.firstFrame === trial.pressFrame + 4096 &&
        late.firstFrame === positive.firstFrame + positive.frames &&
        trial.actionFrame >= late.firstFrame &&
        trial.actionFrame <= late.firstFrame + positive.sampleRate * 0.2
    );
}

function validTrial(trial: CrumbsTrial): boolean {
    const { baseline, positive, late } = trial;
    return (
        validClock(trial) &&
        trial.trustedDown &&
        trial.trustedUp &&
        trial.nativeRunning &&
        trial.advancing &&
        positive.tone431 >= Math.max(0.00001, baseline.tone431 * 10) &&
        baseline.minimumSentinel220 >= 0.00001 &&
        baseline.tone619 < baseline.sentinel220 * 0.1 &&
        positive.sentinel220 >= 0.00001 &&
        late.minimumSentinel220 >= Math.max(0.00001, positive.sentinel220 * 0.1)
    );
}

function validTrials(trials: CrumbsTrial[]): boolean {
    if (trials.length !== 2 || trials[0]?.kind !== 'held' || trials[1]?.kind !== 'release') {
        return false;
    }
    if (!trials.every(validTrial)) {
        return false;
    }
    const held = trials[0];
    const release = trials[1];
    const heldRatio = held.late.tone431 / held.positive.tone431;
    return (
        held.late.tone431 >= 0.00001 &&
        heldRatio >= 0.1 &&
        release.late.tone431 <= release.positive.tone431 * heldRatio * 0.35
    );
}

export function crumbsSamplerFailure(
    observation: CrumbsSamplerObservations
): 'capture-unavailable' | 'crumbs-observations-incomplete' | 'crumbs-control-invalid' | 'crumbs-audio-invalid' | null {
    if (observation.unavailable) {
        return 'capture-unavailable';
    }
    if (!validIdentity(observation)) {
        return 'crumbs-observations-incomplete';
    }
    if (
        observation.control619 === null ||
        !validWindow(observation.control619) ||
        observation.control619.tone619 < 0.00001 ||
        Object.values(observation.seekBeats).some((beat) => beat === null || !Number.isFinite(beat) || beat <= 16)
    ) {
        return 'crumbs-control-invalid';
    }
    if (!validTrials(observation.trials.fresh) || !validTrials(observation.trials.reopened)) {
        return 'crumbs-audio-invalid';
    }
    return null;
}

function validIdentity(observation: CrumbsSamplerObservations): boolean {
    return (
        observation.input === 'BlackHole 2ch' &&
        observation.output === 'BlackHole 2ch' &&
        !!observation.trackId &&
        !!observation.deviceId &&
        observation.trustedDrop &&
        observation.sampleSha256 === '230e1149ce88caad99849d11ddcfb6b823e12ca8deb8e3029b97984e91205477' &&
        observation.savedClean &&
        validHeads(observation.savedHeads) &&
        validHeads(observation.reopenedHeads) &&
        validSnapshot(observation.savedSnapshot, observation.trackId, observation.deviceId) &&
        JSON.stringify(observation.savedSnapshot) === JSON.stringify(observation.reopenedSnapshot) &&
        observation.reopenedTrackId === observation.trackId &&
        observation.reopenedDeviceId === observation.deviceId &&
        observation.quits.length === 2 &&
        observation.quits.every(validQuit)
    );
}

function validHeads(heads: string[]): boolean {
    return heads.length > 0 && heads.every((head) => /^[a-f0-9]{64}$/u.test(head));
}

function validQuit(quit: CrumbsSamplerObservations['quits'][number]): boolean {
    return (
        (quit.code === 0 && quit.signal === null && !quit.forced) ||
        (quit.code === null && quit.signal === 'SIGTERM' && !quit.forced) ||
        (quit.code === null && quit.signal === 'SIGKILL' && quit.forced)
    );
}

function validSnapshot(snapshot: CrumbsSnapshot | null, trackId: string | null, deviceId: string | null): boolean {
    return (
        snapshot !== null &&
        snapshot.trackId === trackId &&
        snapshot.deviceId === deviceId &&
        snapshot.filePath.length > 0 &&
        snapshot.filePath.endsWith(`/${snapshot.fileName}`) &&
        snapshot.fileName === 'c15-isolated-crumbs-431hz.wav' &&
        snapshot.frameCount === 352800 &&
        snapshot.sampleRate === 44100 &&
        snapshot.channels === 1 &&
        Number.isSafeInteger(snapshot.sampleId) &&
        snapshot.sampleId >= 0 &&
        snapshot.mode === 'drum' &&
        snapshot.cutoff === 19990 &&
        /^[a-f0-9]{64}$/u.test(snapshot.trackDigest) &&
        /^[a-f0-9]{64}$/u.test(snapshot.deviceDigest)
    );
}
