import {
    createBufferSource,
    ensureTrackStrip,
    getAudioContext,
    getCachedAudioBuffer,
    getCompensationDelay,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';

import { secondsBetweenBeats } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { type SourceWithFade } from '../playheadScheduler/schedulerSession';

export function scheduleFrozenTrack(
    track: {
        id: string;
        freezeState: { status: string; frozenBufferId?: string; compensationSeconds?: number };
        clips: { startBeat: number }[];
    },
    accumulatedPosition: number,
    activeAudioSources: AudioBufferSourceNode[],
    /**
     * Tempo the map falls back to, read only when the project has no tempo
     * changes at all. Callers inside the scheduler may pass either the
     * transport's base tempo or the tempo resolved at the playhead: with an
     * empty map those are the same number, and with a non-empty one the map
     * supplies every value and this is never consulted.
     */
    defaultTempo: number,
    /**
     * The scheduling window's first beat on an emission whose window opens at
     * a boundary the playhead stands at or behind — a loop wrap's handover or
     * a landing — or `null` on a steady-state emission, where a late join must
     * start immediately with due content. On a floored emission the buffer
     * holds until that beat's content is due (#4784): the fence spares the
     * dying pass's tail past the seam, and an unfloored mid-buffer join would
     * layer the incoming pass's pre-window content underneath it.
     */
    windowStartBeat: number | null
): boolean {
    if (track.freezeState.status !== 'frozen' || !track.freezeState.frozenBufferId) {
        return false;
    }

    const buffer = getCachedAudioBuffer({ bufferId: track.freezeState.frozenBufferId });
    if (!buffer) {
        return false;
    }

    // The frozen buffer was rendered starting at the track's earliest clip
    // startBeat (see renderTrackOffline), not at beat 0. Offset playback by that
    // start beat so frozen tracks line up with the playhead instead of firing at
    // the project origin.
    const trackStartBeat = track.clips.length > 0 ? Math.min(...track.clips.map((clip) => clip.startBeat)) : 0;

    // FX-4 — the frozen buffer bypasses the device chain (it feeds preFaderTap
    // directly) but its content already carries that chain's latency, and the
    // track's downstream buses still add theirs; `getTrackLatency` sums exactly
    // those two, so the track's own compensation is the right shift here. Every
    // other live source path applies it (scheduleAudioClips, scheduleMidiNotes,
    // applyAutomation) — without it a frozen track is the one thing in the
    // session playing on the uncompensated clock.
    //
    // FX-4 residual — the buffer bakes the chain as it stood at freeze time, so
    // the freeze-time snapshot is the value that matches its content. Resolving
    // the *current* chain instead drifts the moment a plugin's reported latency
    // changes, and nothing marks the track stale to force a re-render, so the
    // drift is permanent. Tracks frozen before the snapshot existed fall back
    // to the live lookup — the pre-existing behaviour, not a worse one.
    const changes = tempoMapStore.value?.changes ?? [];
    const compensation = track.freezeState.compensationSeconds ?? getCompensationDelay(track.id);
    // Same beat → time contract as the live clip and MIDI paths: integrate the
    // tempo map across the offset. A flat rate here would leave a frozen track
    // drifting against the un-frozen tracks around it the moment a tempo change
    // sat between the playhead and the track's first clip.
    const startTime =
        getCurrentTime() +
        secondsBetweenBeats(changes, accumulatedPosition, trackStartBeat, defaultTempo) +
        compensation;
    const now = getCurrentTime();
    const elapsed = now - startTime;

    // The live clip path's window floor (#4784): on an emission whose window
    // opens at a boundary the playhead stands at or behind, content from before
    // that beat must not sound — the earliest content is the window's first
    // beat, held until its due instant. A floor at or before the buffer's own
    // start changes nothing.
    let floorSeconds = startTime;
    if (windowStartBeat !== null && windowStartBeat > trackStartBeat) {
        floorSeconds =
            now + secondsBetweenBeats(changes, accumulatedPosition, windowStartBeat, defaultTempo) + compensation;
    }
    const audibleStartSeconds = Math.max(startTime, floorSeconds);
    const skipSeconds = audibleStartSeconds - startTime;

    // Resolve the timing before building anything. The buffer can already have
    // played out in full by the time this tick fires, and there is then nothing
    // to start — creating the source and its fade gain first left a GainNode
    // wired into the track strip on every such call, with no source to end and
    // release it. A window floor that skips past the rendered content is the
    // same outcome. The track still counts as scheduled: `true` is what stops
    // the caller from retrying it every grain.
    if ((startTime < now && elapsed >= buffer.duration) || skipSeconds >= buffer.duration) {
        return true;
    }

    const strip = ensureTrackStrip(track.id);
    const source = createBufferSource();
    source.buffer = buffer;
    // The whole-arrangement buffer is the source a loop seam most needs to
    // fence sample-accurately, and its own shift is the compensation above —
    // the same figure the seam fence spares its tail by (#4784).
    (source as SourceWithFade).compensationSeconds = compensation;

    const fadeGain = getAudioContext().createGain();
    (source as SourceWithFade).fadeGainNode = fadeGain;
    fadeGain.connect(strip.preFaderTap);
    source.connect(fadeGain);

    if (skipSeconds > 0 && audibleStartSeconds >= now) {
        // Held to the window's first beat: the sound begins at that beat's due
        // instant, with the skipped content wound past.
        source.start(audibleStartSeconds, skipSeconds);
    } else if (startTime >= now) {
        source.start(startTime);
    } else {
        source.start(now, elapsed);
    }

    activeAudioSources.push(source);
    source.onended = () => {
        const idx = activeAudioSources.indexOf(source);
        if (idx >= 0) {
            activeAudioSources.splice(idx, 1);
        }
    };

    return true;
}
