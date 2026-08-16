import {
    createBufferSource,
    ensureTrackStrip,
    getAudioContext,
    getCachedAudioBuffer,
    getCompensationDelay,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';

import { type SourceWithFade } from '../playheadScheduler/schedulerSession';

export function scheduleFrozenTrack(
    track: {
        id: string;
        freezeState: { status: string; frozenBufferId?: string; compensationSeconds?: number };
        clips: { startBeat: number }[];
    },
    accumulatedPosition: number,
    activeAudioSources: AudioBufferSourceNode[],
    currentTempo: number
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
    const beatOffset = trackStartBeat - accumulatedPosition;

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
    const compensation = track.freezeState.compensationSeconds ?? getCompensationDelay(track.id);
    const startTime = getCurrentTime() + beatOffset / (currentTempo / 60) + compensation;
    const now = getCurrentTime();
    const elapsed = now - startTime;

    // Resolve the timing before building anything. The buffer can already have
    // played out in full by the time this tick fires, and there is then nothing
    // to start — creating the source and its fade gain first left a GainNode
    // wired into the track strip on every such call, with no source to end and
    // release it. The track still counts as scheduled: `true` is what stops the
    // caller from retrying it every grain.
    if (startTime < now && elapsed >= buffer.duration) {
        return true;
    }

    const strip = ensureTrackStrip(track.id);
    const source = createBufferSource();
    source.buffer = buffer;

    const fadeGain = getAudioContext().createGain();
    (source as SourceWithFade).fadeGainNode = fadeGain;
    fadeGain.connect(strip.preFaderTap);
    source.connect(fadeGain);

    if (startTime >= now) {
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
