/**
 * The publish that carries the native Tuner's reading from the transport poll
 * into the panel's store (#3124).
 *
 * Two things are under test. The poll's map is keyed for every scoring device
 * the engine holds, carried or not, so the filter here is what keeps a reading
 * nobody is hearing off the needle. And the reading has to arrive projected
 * the way the Web Audio twin's does — the wire carries no note name, and a
 * panel fed a nameless reading would show a pitch with no note against it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAudioDeviceRuntimeSink } from '../../../engine/audioDeviceRuntimeSink';
import {
    stoppedEngineTransportPosition,
    type EngineTransportPosition,
    type NativeTunerReading,
} from '../../../models/EngineTransportPosition';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { publishNativeTunerTelemetry } from '../publishNativeTunerTelemetry';

const updateNativeTunerTelemetry = vi.fn();

/** An A4 two cents flat, as the wire carries it. */
const HEARD: NativeTunerReading = {
    active: true,
    frequency: 439.5,
    cents: -2,
    confidence: 0.9,
    noteIndex: 9,
    octave: 4,
    midiNote: 69,
};

/** A tuner hearing nothing: the flag is false and the numbers are stale. */
const UNHEARD: NativeTunerReading = { ...HEARD, active: false };

function readingCarrying(tunerTelemetry: Record<string, NativeTunerReading>): EngineTransportPosition {
    return { ...stoppedEngineTransportPosition, running: true, tunerTelemetry };
}

function sessionHolds(input: {
    audible: boolean;
    carried: readonly string[];
    chains: Record<string, readonly string[]>;
}): void {
    nativeLiveGraphSession.audibleCarrier = input.audible;
    nativeLiveGraphSession.carriedStripIds = new Set(input.carried);
    nativeLiveGraphSession.nativeChainByStripId = new Map(Object.entries(input.chains));
}

describe('publishNativeTunerTelemetry', () => {
    beforeEach(() => {
        updateNativeTunerTelemetry.mockReset();
        setAudioDeviceRuntimeSink({ updateNativeTunerTelemetry });
        sessionHolds({ audible: true, carried: ['track-1'], chains: { 'track-1': ['d-tuner'] } });
    });

    afterEach(() => {
        setAudioDeviceRuntimeSink({});
        sessionHolds({ audible: false, carried: [], chains: {} });
    });

    it('publishes an active reading with the note name its index falls on', () => {
        publishNativeTunerTelemetry(readingCarrying({ 'd-tuner': HEARD }));

        expect(updateNativeTunerTelemetry).toHaveBeenCalledTimes(1);
        expect(updateNativeTunerTelemetry).toHaveBeenCalledWith('d-tuner', {
            active: true,
            frequency: 439.5,
            cents: -2,
            confidence: 0.9,
            noteIndex: 9,
            octave: 4,
            midiNote: 69,
            noteName: 'A',
            polyStrings: [],
        });
    });

    // The same projection the worklet's reader makes: an inactive reading is
    // the zeroed shape with no name, so the needle falls back rather than
    // holding the last pitch under a stale set of numbers.
    it('publishes an inactive reading as the zeroed shape rather than its stale numbers', () => {
        publishNativeTunerTelemetry(readingCarrying({ 'd-tuner': UNHEARD }));

        expect(updateNativeTunerTelemetry).toHaveBeenCalledWith('d-tuner', {
            active: false,
            frequency: 0,
            cents: 0,
            confidence: 0,
            noteIndex: 0,
            octave: 0,
            midiNote: 0,
            noteName: '',
            polyStrings: [],
        });
    });

    it('publishes nothing for a device no carried chain reports', () => {
        publishNativeTunerTelemetry(readingCarrying({ 'd-elsewhere': HEARD }));

        expect(updateNativeTunerTelemetry).not.toHaveBeenCalled();
    });

    it('publishes nothing while the session is shadowed, because Web Audio is what is heard', () => {
        sessionHolds({ audible: false, carried: ['track-1'], chains: { 'track-1': ['d-tuner'] } });

        publishNativeTunerTelemetry(readingCarrying({ 'd-tuner': HEARD }));

        expect(updateNativeTunerTelemetry).not.toHaveBeenCalled();
    });

    it('publishes only the devices this session owns out of a map holding others', () => {
        publishNativeTunerTelemetry(readingCarrying({ 'd-tuner': HEARD, 'd-elsewhere': HEARD }));

        expect(updateNativeTunerTelemetry.mock.calls.map(([deviceId]) => deviceId)).toEqual(['d-tuner']);
    });
});
