import {
    createBufferSource,
    ensureTrackStrip,
    getAudioContext,
    getCachedAudioBuffer,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';

import { type SourceWithFade } from '../playheadScheduler';

export function scheduleFrozenTrack(
    track: { id: string; freezeState: { status: string; frozenBufferId?: string }; clips: { startBeat: number }[] },
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

    const strip = ensureTrackStrip(track.id);
    const source = createBufferSource();
    source.buffer = buffer;

    const fadeGain = getAudioContext().createGain();
    (source as SourceWithFade).fadeGainNode = fadeGain;
    fadeGain.connect(strip.preFaderTap);
    source.connect(fadeGain);

    // The frozen buffer was rendered starting at the track's earliest clip
    // startBeat (see renderTrackOffline), not at beat 0. Offset playback by that
    // start beat so frozen tracks line up with the playhead instead of firing at
    // the project origin.
    const trackStartBeat = track.clips.length > 0 ? Math.min(...track.clips.map((clip) => clip.startBeat)) : 0;
    const beatOffset = trackStartBeat - accumulatedPosition;
    const startTime = getCurrentTime() + beatOffset / (currentTempo / 60);
    const now = getCurrentTime();

    if (startTime >= now) {
        source.start(startTime);
    } else {
        const elapsed = now - startTime;
        if (elapsed < buffer.duration) {
            source.start(now, elapsed);
        } else {
            return true;
        }
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
