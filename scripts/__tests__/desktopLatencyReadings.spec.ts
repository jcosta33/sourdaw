import { describe, expect, it } from 'vitest';

import {
    computeCounterDeltas,
    computeGaugeReadings,
    decideVerdict,
    describeAudibleFloor,
    findAppPageTarget,
    findQuarantineReason,
    hasLivePluginOnTrack,
    parseArgs,
    parseEngineTitle,
    parseLatencyMs,
    parseMasterLevelDb,
} from '../desktopLatencyReadings.ts';

const argv = (...flags: string[]): string[] => ['node', 'scripts/measureDesktopLatency.ts', ...flags];

const APP_URL_PREFIX = 'app://sourdaw/';

describe('parseArgs', () => {
    it('defaults the app path, the leg length and the record path', () => {
        expect(parseArgs(argv())).toEqual({
            appPath: 'release/desktop/mac-arm64/Sourdaw.app',
            seconds: 20,
            jsonPath: null,
        });
    });

    it('reads each flag', () => {
        expect(parseArgs(argv('--app', '/tmp/Other.app', '--seconds', '30', '--json', 'out.json'))).toEqual({
            appPath: '/tmp/Other.app',
            seconds: 30,
            jsonPath: 'out.json',
        });
    });

    it('refuses a leg shorter than the diagnostics poll can populate', () => {
        expect(() => parseArgs(argv('--seconds', '4'))).toThrow('at least 5');
    });

    it('refuses a non-numeric leg length instead of measuring for NaN seconds', () => {
        expect(() => parseArgs(argv('--seconds', 'twenty'))).toThrow('must be a number');
    });

    it('refuses a flag whose value is the next flag', () => {
        expect(() => parseArgs(argv('--json', '--seconds', '10'))).toThrow('--json needs a value');
    });
});

describe('findAppPageTarget', () => {
    it('returns the page target /json/list lists', () => {
        const list = [{ type: 'page', url: 'app://sourdaw/', title: 'Sourdaw' }];

        expect(findAppPageTarget(list, APP_URL_PREFIX)).toEqual({ url: 'app://sourdaw/', title: 'Sourdaw' });
    });

    it('refuses a page target whose document has not parsed yet', () => {
        const list = [{ type: 'page', url: 'app://sourdaw/', title: '' }];

        expect(findAppPageTarget(list, APP_URL_PREFIX)).toBeNull();
    });

    it('refuses a worker whose url happens to match the app, because it is not a page', () => {
        const list = [{ type: 'worker', url: 'app://sourdaw/assets/crdtWorker.js', title: 'crdtWorker.js' }];

        expect(findAppPageTarget(list, APP_URL_PREFIX)).toBeNull();
    });

    it('refuses a list that is not an array, and a list of non-object entries', () => {
        expect(findAppPageTarget('app://sourdaw/', APP_URL_PREFIX)).toBeNull();
        expect(findAppPageTarget([1, 'two', null], APP_URL_PREFIX)).toBeNull();
    });

    it('finds the page target in a mixed list where it is not first', () => {
        const list = [
            { type: 'worker', url: 'app://sourdaw/assets/crdtWorker.js', title: 'crdtWorker.js' },
            { type: 'page', url: 'devtools://devtools/bundled/inspector.html', title: 'DevTools' },
            { type: 'page', url: 'app://sourdaw/', title: 'Sourdaw' },
        ];

        expect(findAppPageTarget(list, APP_URL_PREFIX)).toEqual({ url: 'app://sourdaw/', title: 'Sourdaw' });
    });
});

describe('parseLatencyMs', () => {
    it('reads the status bar reading the product writes', () => {
        expect(parseLatencyMs('12.3ms')).toBe(12.3);
    });

    it('refuses anything that is not a millisecond reading', () => {
        expect(() => parseLatencyMs('12.3 ms')).toThrow('not a "<n>ms" reading');
        expect(() => parseLatencyMs('n/a')).toThrow('not a "<n>ms" reading');
    });
});

describe('parseEngineTitle', () => {
    const running =
        'Engine: running · audio track strips: 1 · bus strips: 0 · missed render deadlines: 4 (12.5 ms)' +
        ' · engine-detected dropouts: 2';

    it('reads the state, the missed deadlines and the detected dropouts', () => {
        expect(parseEngineTitle(running)).toEqual({
            state: 'running',
            missedRenderDeadlines: { count: 4, ms: 12.5 },
            engineDetectedDropouts: 2,
        });
    });

    it('reports unavailable deadlines as absent rather than as zero missed deadlines', () => {
        const unavailable = 'Engine: running · missed render deadlines: unavailable · engine-detected dropouts: 0';

        expect(parseEngineTitle(unavailable).missedRenderDeadlines).toBeNull();
    });

    it('reports an absent diagnostics segment as absent, which the first tick has', () => {
        expect(parseEngineTitle('Engine: suspended')).toEqual({
            state: 'suspended',
            missedRenderDeadlines: null,
            engineDetectedDropouts: null,
        });
    });

    it('refuses a title that is not the engine dot', () => {
        expect(() => parseEngineTitle('Output latency 11.0 ms')).toThrow('does not start with "Engine: "');
    });
});

describe('parseMasterLevelDb', () => {
    it('reads a level', () => {
        expect(parseMasterLevelDb('-12.3 dB')).toBe(-12.3);
    });

    it('reads digital silence as negative infinity', () => {
        expect(parseMasterLevelDb('-∞ dB')).toBe(Number.NEGATIVE_INFINITY);
    });

    it('reads a missing meter tap as no reading at all, not as silence', () => {
        expect(parseMasterLevelDb('n/a')).toBeNull();
    });

    it('refuses text that is neither', () => {
        expect(() => parseMasterLevelDb('-12.3')).toThrow('not a level');
    });
});

describe('hasLivePluginOnTrack', () => {
    const running =
        'Engine: running · audio track strips: 1 · bus strips: 0 · sends: 0 · sidechains: 0' +
        ' · ready device instances: 1 (clap: 1) · pending device instances: 0';

    it('returns true only when both a ready device instance and an audio track strip are exactly one', () => {
        expect(hasLivePluginOnTrack(running)).toBe(true);
    });

    it('returns false when no device instance is ready', () => {
        expect(hasLivePluginOnTrack('Engine: running · audio track strips: 1 · ready device instances: 0')).toBe(false);
    });

    it('does not read ten ready device instances as a match for one', () => {
        expect(hasLivePluginOnTrack('Engine: running · audio track strips: 1 · ready device instances: 10')).toBe(
            false
        );
    });

    it('does not read ten audio track strips as a match for one', () => {
        expect(hasLivePluginOnTrack('Engine: running · audio track strips: 10 · ready device instances: 1')).toBe(
            false
        );
    });

    it('returns false for an empty title', () => {
        expect(hasLivePluginOnTrack('')).toBe(false);
    });
});

const zeroedCounterDeltas = {
    schedulerEventBufferOverflows: 0,
    bridgeOutputBlocksDropped: 0,
    unmatchedBridgeBlocks: 0,
    bridgeBacklogBlocksShed: 0,
    callbackFramesOverBridgeReach: 0,
    bridgeInputBlocksRefused: 0,
};

describe('computeCounterDeltas', () => {
    it('subtracts the first reading from the last for every named monotonic counter', () => {
        expect(
            computeCounterDeltas(
                { bridgeOutputBlocksDropped: 3, unmatchedBridgeBlocks: 1 },
                { bridgeOutputBlocksDropped: 9, unmatchedBridgeBlocks: 1 }
            )
        ).toEqual({ ...zeroedCounterDeltas, bridgeOutputBlocksDropped: 6, unmatchedBridgeBlocks: 0 });
    });

    it('treats a named counter absent from a reading as having started or ended at zero', () => {
        expect(computeCounterDeltas({}, { bridgeBacklogBlocksShed: 5 })).toEqual({
            ...zeroedCounterDeltas,
            bridgeBacklogBlocksShed: 5,
        });
    });

    it('ignores a key outside the named monotonic set, such as the inputLatencyFrames gauge', () => {
        expect(computeCounterDeltas({ inputLatencyFrames: 128 }, { inputLatencyFrames: 256 })).toEqual(
            zeroedCounterDeltas
        );
    });
});

describe('computeGaugeReadings', () => {
    it('records a gauge as its first and last reading rather than a difference', () => {
        expect(computeGaugeReadings({ inputLatencyFrames: 128 }, { inputLatencyFrames: 256 })).toEqual({
            inputLatencyFrames: { first: 128, last: 256 },
        });
    });

    it('treats a gauge absent from a reading as zero at that end', () => {
        expect(computeGaugeReadings({}, { inputLatencyFrames: 64 })).toEqual({
            inputLatencyFrames: { first: 0, last: 64 },
        });
    });
});

describe('describeAudibleFloor', () => {
    it('names the floor decideVerdict judges against', () => {
        expect(describeAudibleFloor()).toBe('-40 dBFS');
    });
});

describe('decideVerdict', () => {
    const leg = (...levels: (number | null)[]) => ({
        samples: levels.map((masterLevelDb) => ({ masterLevelDb })),
    });

    it('measures when the plugin cleared the audible floor in either leg', () => {
        expect(decideVerdict([leg(-80, -70), leg(-80, -12.4)])).toBe('measured');
    });

    it('fails when a level sat exactly on the floor and never above it', () => {
        expect(decideVerdict([leg(-60, -40)])).toBe('failed');
    });

    it('fails when the meter was never tapped, because n/a is not an audible level', () => {
        expect(decideVerdict([leg(null, null), leg(null)])).toBe('failed');
    });

    it('fails on digital silence', () => {
        expect(decideVerdict([leg(Number.NEGATIVE_INFINITY)])).toBe('failed');
    });

    it('fails when no leg carries a sample', () => {
        expect(decideVerdict([])).toBe('failed');
    });
});

describe('findQuarantineReason', () => {
    const harnessPath = '/Users/musician/Library/Audio/Plug-Ins/CLAP/Sourdaw Harness/Sourdaw Harness Tone.clap';

    it('returns the reason for the entry whose path matches', () => {
        const entries = [
            { path: '/other/plugin.clap', reason: 'helper crashed' },
            { path: harnessPath, reason: 'scan timed out' },
        ];

        expect(findQuarantineReason(entries, harnessPath)).toBe('scan timed out');
    });

    it('returns null when no entry matches the target path', () => {
        expect(
            findQuarantineReason([{ path: '/other/plugin.clap', reason: 'helper crashed' }], harnessPath)
        ).toBeNull();
    });

    it('returns null for an empty entry list', () => {
        expect(findQuarantineReason([], harnessPath)).toBeNull();
    });
});
