import { beforeEach, describe, expect, it } from 'vitest';

import { type EngineTransportPosition } from '../../../models/EngineTransportPosition';
import { nativeEnginePlayheadFeed } from '../nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { readNativeEngineMasterPeak } from '../readNativeEngineMasterPeak';

const readingAt = (masterPeak: number, playing = true): EngineTransportPosition => ({
    running: true,
    playing,
    positionSeconds: 3.25,
    playheadFrame: 3.25 * 48_000,
    loopWraps: 0,
    batchesApplied: 0,
    tempo: 120,
    timeSigNum: 4,
    timeSigDenom: 4,
    masterPeak,
});

describe('readNativeEngineMasterPeak', () => {
    beforeEach(() => {
        nativeEnginePlayheadFeed.running = true;
        nativeEnginePlayheadFeed.reading = readingAt(0.5);
        nativeLiveGraphSession.audibleCarrier = true;
    });

    it('reports the peak the engine published', () => {
        expect(readNativeEngineMasterPeak()).toBe(0.5);
    });

    it('reports a parked audible session, because silence at the device is a measured zero', () => {
        // The one place this parts from the playhead read: a parked engine
        // still carries the device, so its level is a true statement about the
        // output where its position is not a position the mix is at.
        nativeEnginePlayheadFeed.reading = readingAt(0, false);

        expect(readNativeEngineMasterPeak()).toBe(0);
    });

    it('measures nothing without a feed', () => {
        nativeEnginePlayheadFeed.running = false;

        expect(readNativeEngineMasterPeak()).toBeNull();
    });

    it('measures nothing while the session is not the audible carrier', () => {
        // A shadowed session writes true zeros at the device. Its meter
        // describes an output nobody is hearing, so it is not a level to put
        // beside the one they are.
        nativeLiveGraphSession.audibleCarrier = false;

        expect(readNativeEngineMasterPeak()).toBeNull();
    });

    it('measures nothing before the first reading lands', () => {
        nativeEnginePlayheadFeed.reading = null;

        expect(readNativeEngineMasterPeak()).toBeNull();
    });

    it('measures nothing when no engine is running behind the reading', () => {
        nativeEnginePlayheadFeed.reading = { ...readingAt(0.5), running: false };

        expect(readNativeEngineMasterPeak()).toBeNull();
    });
});
