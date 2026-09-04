/**
 * The pure half of `scripts/measureDesktopLatency.ts`: reading the packaged
 * app's own status-bar text back into numbers, and judging the run from them.
 *
 * Separate from the driver because these are the only parts a unit test can
 * reach. The driver launches a packaged Electron app and speaks the Chrome
 * DevTools Protocol to it; importing it into Vitest would drag Playwright in to
 * test string parsing. Everything here is a total function of its argument, so
 * the spec beside it can pin each readout the product actually writes.
 *
 * Every parser refuses text it does not recognise rather than returning a
 * plausible number. A harness that answers `0` for a readout it could not read
 * publishes a measurement of nothing.
 */

/** `electron-builder.yml` output for this machine's only packaged target. */
export const DEFAULT_APP_PATH = 'release/desktop/mac-arm64/Sourdaw.app';
const DEFAULT_SECONDS = 20;

/**
 * Fewer seconds than this cannot show a counter moving at all: the app polls
 * `engine_rt_diagnostics` once a second, so a shorter leg is a single reading
 * with a duration printed next to it.
 */
const MINIMUM_SECONDS = 5;

/**
 * The floor a signal has to clear to count as "the plugin reached the master".
 * A 440 Hz sine at any usable level sits far above it; digital silence and
 * meter noise sit far below. It is a sanity gate on the run rather than a mix
 * judgement, so it is deliberately generous.
 */
const AUDIBLE_FLOOR_DBFS = -40;

export type DesktopLatencyArgs = {
    appPath: string;
    seconds: number;
    jsonPath: string | null;
};

function readFlag(argv: readonly string[], flag: string): string | null {
    const index = argv.indexOf(flag);
    if (index === -1) {
        return null;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} needs a value`);
    }
    return value;
}

export function parseArgs(argv: readonly string[]): DesktopLatencyArgs {
    const seconds = readFlag(argv, '--seconds');
    if (seconds !== null && !/^\d+(?:\.\d+)?$/.test(seconds)) {
        throw new Error(`--seconds must be a number, got ${seconds}`);
    }
    const parsedSeconds = seconds === null ? DEFAULT_SECONDS : Number(seconds);
    if (parsedSeconds < MINIMUM_SECONDS) {
        throw new Error(`--seconds must be at least ${MINIMUM_SECONDS}, got ${parsedSeconds}`);
    }
    return {
        appPath: readFlag(argv, '--app') ?? DEFAULT_APP_PATH,
        seconds: parsedSeconds,
        jsonPath: readFlag(argv, '--json'),
    };
}

export type AppPageTarget = { url: string; title: string };

/**
 * The packaged Chromium's `/json/list` reports every DevTools target — pages,
 * workers, worklets — the instant each one is created, before its document has
 * necessarily parsed. A `page` target still carries `title: ""` until then, so
 * an empty title is not a malformed reading but the app's own signal that the
 * target is not ready yet. A worker or worklet can share the app's url (a
 * capture-context worklet, a scan-store worker) without ever being the page, so
 * `type` is checked first and rules those out before their `url` is read at
 * all.
 */
export function findAppPageTarget(list: unknown, urlPrefix: string): AppPageTarget | null {
    if (!Array.isArray(list)) {
        return null;
    }
    for (const entry of list) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const type: unknown = Reflect.get(entry, 'type');
        const url: unknown = Reflect.get(entry, 'url');
        const title: unknown = Reflect.get(entry, 'title');
        if (
            type === 'page' &&
            typeof url === 'string' &&
            url.startsWith(urlPrefix) &&
            typeof title === 'string' &&
            title.length > 0
        ) {
            return { url, title };
        }
    }
    return null;
}

/** `useStatusBarMetrics.ts:236` writes `${ms.toFixed(1)}ms`. */
export function parseLatencyMs(text: string): number {
    const match = /^(-?\d+(?:\.\d+)?)ms$/.exec(text.trim());
    if (match === null) {
        throw new Error(`the Latency readout said "${text}", which is not a "<n>ms" reading`);
    }
    return Number(match[1]);
}

export type EngineTitleReading = {
    state: string;
    /** Null when the app reports `unavailable` — there was no `playbackStats` to sample. */
    missedRenderDeadlines: { count: number; ms: number } | null;
    /** Null when the segment is absent, as it is on every tick before the app's first one-second diagnostics build. */
    engineDetectedDropouts: number | null;
};

/**
 * `useStatusBarMetrics.ts:59-67,262` composes the engine dot's title.
 *
 * `unavailable` deadlines are absent, never zero: the app prints that word when
 * there is no live `AudioContext.playbackStats` to sample, and reading it as
 * zero would report a clean audio thread nobody looked at.
 */
export function parseEngineTitle(title: string): EngineTitleReading {
    const state = /^Engine: ([^·]+)/.exec(title);
    if (state === null) {
        throw new Error(`the engine dot's title said "${title}", which does not start with "Engine: "`);
    }
    const missed = /· missed render deadlines: (\d+) \((-?\d+(?:\.\d+)?) ms\)/.exec(title);
    const dropouts = /· engine-detected dropouts: (\d+)/.exec(title);
    return {
        state: (state[1] ?? '').trim(),
        missedRenderDeadlines: missed === null ? null : { count: Number(missed[1]), ms: Number(missed[2]) },
        engineDetectedDropouts: dropouts === null ? null : Number(dropouts[1]),
    };
}

/**
 * `useStatusBarMetrics.ts:275,279-283` writes `n/a`, `-∞ dB`, or `<n> dB`.
 *
 * `n/a` is not silence and must not be read as one: it means the engine has no
 * meter tap at all, so there is no level to compare against anything.
 */
export function parseMasterLevelDb(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === 'n/a') {
        return null;
    }
    if (trimmed === '-∞ dB') {
        return Number.NEGATIVE_INFINITY;
    }
    const match = /^(-?\d+(?:\.\d+)?) dB$/.exec(trimmed);
    if (match === null) {
        throw new Error(`the master level readout said "${text}", which is not a level`);
    }
    return Number(match[1]);
}

/**
 * `useStatusBarMetrics.ts:125,129` writes both segments into the same engine
 * dot title the "wait for a running meter" gate already reads. That gate
 * alone cannot tell an empty project from one carrying the loaded plugin — a
 * master meter worklet exists regardless — so this checks the two counts
 * that only move once a device is actually instantiated on a track.
 *
 * Matched with a trailing `(?!\d)` rather than a plain substring: "ready
 * device instances: 1" is itself a substring of "ready device instances: 10",
 * and a plain `includes` would misread ten ready instances as a single live
 * one.
 */
export function hasLivePluginOnTrack(engineTitle: string): boolean {
    return /ready device instances: 1(?!\d)/.test(engineTitle) && /audio track strips: 1(?!\d)/.test(engineTitle);
}

export type EngineCounters = Readonly<Record<string, number>>;

/**
 * Every one of `engine_rt_diagnostics`'s cumulative-since-engine-start
 * counters this harness differences across a leg. Confirmed against
 * `EngineRtDiagnostics` in
 * `crates/sourdaw-native/src/commands/engine_diagnostics.rs` and its TS
 * mirror `src/modules/AudioEngine/models/EngineRtDiagnostics.ts` at this
 * head — every numeric field except `inputLatencyFrames`, which is
 * deliberately excluded: it is a gauge (the capture path's current added
 * latency, or zero while capture is not serving), not a running total, and
 * differencing it would read like a counter increment when it is really two
 * unrelated snapshots. `desktopLatencyReadings.spec.ts`'s
 * `MONOTONIC_COUNTER_NAMES ∪ GAUGE_NAMES` spec asserts this set against
 * `notRunningEngineRtDiagnostics`'s own numeric keys, so a field added to
 * either side later cannot fall through uncovered.
 */
export const MONOTONIC_COUNTER_NAMES = [
    'schedulerEventBufferOverflows',
    'arpeggiatorActiveNoteExhaustions',
    'effectIdCollisions',
    'unsupportedEffectAdditions',
    'unmappedSetParamCalls',
    'bridgeOutputBlocksDropped',
    'unmatchedBridgeBlocks',
    'bridgeBacklogBlocksShed',
    'callbackFramesOverBridgeReach',
    'bridgeInputBlocksRefused',
    'captureConsumerRefusals',
    'captureBlocksDropped',
    'captureInputUnderruns',
] as const;

/** `engine_rt_diagnostics`'s one gauge — see `MONOTONIC_COUNTER_NAMES`. */
export const GAUGE_NAMES = ['inputLatencyFrames'] as const;

/**
 * Only the named monotonic counters are differenced, never every numeric key
 * the payload happens to carry: a counter absent from one reading started or
 * ended at zero and is never dropped from the delta, but a gauge among the
 * payload's other keys must never be read as one.
 */
export function computeCounterDeltas(first: EngineCounters, last: EngineCounters): Record<string, number> {
    const deltas: Record<string, number> = {};
    for (const name of MONOTONIC_COUNTER_NAMES) {
        deltas[name] = (last[name] ?? 0) - (first[name] ?? 0);
    }
    return deltas;
}

/** A gauge's first and last reading, recorded rather than differenced — see `GAUGE_NAMES`. */
export function computeGaugeReadings(
    first: EngineCounters,
    last: EngineCounters
): Record<string, { first: number; last: number }> {
    const readings: Record<string, { first: number; last: number }> = {};
    for (const name of GAUGE_NAMES) {
        readings[name] = { first: first[name] ?? 0, last: last[name] ?? 0 };
    }
    return readings;
}

export type VerdictLeg = {
    samples: readonly { masterLevelDb: number | null }[];
};

export type Verdict = 'measured' | 'failed' | 'not-measured';

/**
 * The one outcome that invalidates the whole run: the plugin never reached the
 * master meter, so every other number in it describes a silent app.
 *
 * A `null` level is `n/a` — no meter tap — and can never count as audible. The
 * comparison is strictly above the floor, so a reading sitting exactly on it is
 * not audible either.
 */
export function decideVerdict(legs: readonly VerdictLeg[]): Verdict {
    const audible = legs.some((leg) =>
        leg.samples.some((sample) => sample.masterLevelDb !== null && sample.masterLevelDb > AUDIBLE_FLOOR_DBFS)
    );
    return audible ? 'measured' : 'failed';
}

/** Stated in the failure reason, so the record says what floor the run was judged against. */
export function describeAudibleFloor(): string {
    return `${String(AUDIBLE_FLOOR_DBFS)} dBFS`;
}

/** One row of the Preferences quarantine block: `path` is its text, `reason` its `title`. */
export type QuarantinedEntry = { path: string; reason: string };

/**
 * The quarantine block keys each entry by the scanner's own candidate path,
 * never a display name, so the harness plugin is matched by the same absolute
 * path `installHarnessPlugin.ts` already computes for the install check.
 */
export function findQuarantineReason(entries: readonly QuarantinedEntry[], targetPath: string): string | null {
    return entries.find((entry) => entry.path === targetPath)?.reason ?? null;
}
