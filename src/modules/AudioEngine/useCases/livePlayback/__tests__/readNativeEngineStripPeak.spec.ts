import { beforeEach, describe, expect, it } from 'vitest';

import { type EngineTransportPosition } from '../../../models/EngineTransportPosition';
import { nativeEnginePlayheadFeed } from '../nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { readNativeEngineStripPeak } from '../readNativeEngineStripPeak';

const readingAt = (stripPeaks: Readonly<Record<string, number>>, playing = true): EngineTransportPosition => ({
    running: true,
    playing,
    positionSeconds: 3.25,
    playheadFrame: 3.25 * 48_000,
    loopWraps: 0,
    batchesApplied: 0,
    tempo: 120,
    timeSigNum: 4,
    timeSigDenom: 4,
    masterPeak: 0,
    stripPeaks,
});

describe('readNativeEngineStripPeak', () => {
    beforeEach(() => {
        nativeEnginePlayheadFeed.running = true;
        nativeEnginePlayheadFeed.reading = readingAt({ 'strip-a': 0.5 });
        nativeLiveGraphSession.audibleCarrier = true;
        nativeLiveGraphSession.carriedStripIds = new Set(['strip-a']);
    });

    it('reports the peak the engine published for a strip this session carries', () => {
        expect(readNativeEngineStripPeak('strip-a')).toBe(0.5);
    });

    it('measures nothing for a strip this session does not carry, however the engine reads it', () => {
        // The registry can carry a peak for a strip Web Audio still owns audio
        // for. Reading it would show a stale or silent native number instead
        // of the level a musician can actually hear.
        nativeEnginePlayheadFeed.reading = readingAt({ 'strip-a': 0.5, 'strip-b': 0.9 });

        expect(readNativeEngineStripPeak('strip-b')).toBeNull();
    });

    it('measures nothing without a feed', () => {
        nativeEnginePlayheadFeed.running = false;

        expect(readNativeEngineStripPeak('strip-a')).toBeNull();
    });

    it('measures nothing while the session is not the audible carrier', () => {
        nativeLiveGraphSession.audibleCarrier = false;

        expect(readNativeEngineStripPeak('strip-a')).toBeNull();
    });

    it('measures nothing before the first reading lands', () => {
        nativeEnginePlayheadFeed.reading = null;

        expect(readNativeEngineStripPeak('strip-a')).toBeNull();
    });

    it('measures nothing when no engine is running behind the reading', () => {
        nativeEnginePlayheadFeed.reading = { ...readingAt({ 'strip-a': 0.5 }), running: false };

        expect(readNativeEngineStripPeak('strip-a')).toBeNull();
    });
});
