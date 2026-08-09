import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { type AutomationPoint } from '../../models/Automation';

import { commitRecordedPass } from './commitRecordedPass';
import { getAutomationRecordingDependencies } from './getAutomationRecordingDependencies';
import { makeKey } from './makeKey';
import { RECORDING_MODES, activeRecording, pendingPoints, touchActive } from './recordingSessionState';

export function recordAutomationValue(trackId: string, parameterId: string, value: number, beat: number): void {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    const transport = transportStore.value;
    if (!transport) {
        // The transport store has not hydrated yet — its tempo is unknown.
        // Recording now would convert beats with a guessed 120 BPM and land the
        // points at the wrong time silently. Skip and surface why instead.
        logger.warn(
            `recordAutomationValue: transport not hydrated — dropping automation value for ${trackId}/${parameterId} (beat ${beat})`
        );
        return;
    }

    const key = makeKey(trackId, parameterId);
    let session = activeRecording.get(key);

    if (!session) {
        session = {
            parameterId,
            trackId,
            startBeat: beat,
            lastValue: null,
            tempoAtStart: transport.tempo,
        };
        activeRecording.set(key, session);
        pendingPoints.set(key, []);
    }

    // Capture tempo once, at the session's first value. Reusing it for the rest
    // of the session keeps a mid-session tempo change from re-timing beats that
    // were already recorded under the original tempo.
    if (session.tempoAtStart === null || session.tempoAtStart === undefined) {
        session.tempoAtStart = transport.tempo;
    }
    const tempo = session.tempoAtStart;

    const deps = getAutomationRecordingDependencies();
    const ctx = deps.getAudioContext();
    const totalHardwareLatencySec = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    const trackLatencySec = deps.getCompensationDelay(trackId);
    const totalLatencySec = totalHardwareLatencySec + trackLatencySec;
    const offsetBeats = (totalLatencySec * tempo) / 60;

    const compensatedBeat = Math.max(0, beat - offsetBeats);

    // A loop wrap ends the pass. Every pass used to accumulate into one buffer,
    // which made it non-monotonic in beat the moment the playhead jumped back:
    // the RDP then ran over a polyline that doubles back on itself, and the
    // overwrite clear ran once at stop across the union of every pass. Two laps
    // that happened to sample the same beat grid still merged correctly, so the
    // damage looked intermittent — off-grid, lap one's points survived
    // interleaved with lap two's. Live, Logic, Pro Tools and REAPER all replace
    // the previous pass on lap two; committing here does the same.
    const previousRawBeat = session.lastRawBeat;
    if (previousRawBeat !== undefined && previousRawBeat !== null && beat < previousRawBeat) {
        commitRecordedPass(key, track.automationMode === 'write' || track.automationMode === 'latch');
        session.startBeat = compensatedBeat;
    }
    session.lastRawBeat = beat;

    // The session may have been seeded above with the raw `beat`; the
    // latency-compensated beat is the real start, so anchor it on first value.
    if (session.startBeat > compensatedBeat) {
        session.startBeat = compensatedBeat;
    }

    const point: AutomationPoint = { beat: compensatedBeat, value, curve: 'linear', tension: 0 };

    // The session-creation branch above always calls `pendingPoints.set(key, [])`
    // so the entry exists here — push in place rather than allocating a
    // throwaway `[]` and re-setting (§106.2). Buffer only: write-mode lane
    // clearing happens ONCE at flush (stopAutomationRecording), not per value
    // — the old per-value clearPointsInRange ran a full lane re-map at ~100Hz.
    const points = pendingPoints.get(key);
    points?.push(point);
    session.lastValue = value;

    if (track.automationMode === 'touch' || track.automationMode === 'latch') {
        touchActive.add(key);
    }
}
