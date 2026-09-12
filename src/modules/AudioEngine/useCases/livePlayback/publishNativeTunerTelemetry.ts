/**
 * Publish the native engine's Tuner readings into the panel's store, for the
 * devices this session is the analyser of.
 *
 * The reading arrives on the transport poll rather than over a port: a native
 * body has no `MessagePort` to post from, and the renderer already reads this
 * payload once per animation frame, which is the rate a needle is painted at.
 * So the poll carries `tunerTelemetry` keyed by device id for every scoring
 * device the engine holds, and this is where that map is filtered down to the
 * devices whose reading the musician is actually hearing
 * ({@link isTunerTelemetryNativelyOwned}).
 *
 * An inactive reading is published like any other. A native strip that has
 * gone quiet reads `active: false`, and the panel has to show that on the
 * frame it happens rather than hold the last pitch it saw.
 */

import { NOTE_NAMES } from '#/utils/noteNames';

import { getAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';

import { isTunerTelemetryNativelyOwned } from './isTunerTelemetryNativelyOwned';

import type { TunerTelemetry } from '../../engine/ScoringNode';
import type { EngineTransportPosition, NativeTunerReading } from '../../models/EngineTransportPosition';

/**
 * The wire reading as the panel's telemetry, spelling the note name the wire
 * does not carry.
 *
 * The same projection the Web Audio twin makes (`projectTunerTelemetry`,
 * `../../engine/ScoringNode.ts`), so one device reads the same on either
 * carrier: an inactive reading is the zeroed shape with no name at all, and an
 * active one names the pitch class its note index falls on.
 */
function projectNativeReading(reading: NativeTunerReading): TunerTelemetry {
    if (!reading.active) {
        return {
            active: false,
            frequency: 0,
            cents: 0,
            confidence: 0,
            noteIndex: 0,
            octave: 0,
            midiNote: 0,
            noteName: '',
            polyStrings: [],
        };
    }
    return {
        active: true,
        frequency: reading.frequency,
        cents: reading.cents,
        confidence: reading.confidence,
        noteIndex: reading.noteIndex,
        octave: reading.octave,
        midiNote: reading.midiNote,
        noteName: NOTE_NAMES[reading.noteIndex % 12] ?? 'C',
        // The native tuner body publishes no polyphonic tracker yet; the Poly
        // display renders its rows as silent, which is truthful here.
        polyStrings: [],
    };
}

export function publishNativeTunerTelemetry(reading: EngineTransportPosition): void {
    const sink = getAudioDeviceRuntimeSink();
    for (const [deviceId, telemetry] of Object.entries(reading.tunerTelemetry)) {
        if (!isTunerTelemetryNativelyOwned(deviceId)) {
            continue;
        }
        sink.updateNativeTunerTelemetry(deviceId, projectNativeReading(telemetry));
    }
}
