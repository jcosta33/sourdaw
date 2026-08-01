import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip, type Track } from '../../models/Track';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { trackStore } from '../../stores/trackStore';

import { detectSilentBake } from './detectSilentBake';
import { renderTrackOffline } from './renderOffline';

export type BounceOptions = {
    includeInserts: boolean;
    includeSends: boolean;
    includeAutomation: boolean;
    normalization: 'off' | 'protection' | 'full';
    tailHandling: 'auto' | 'manual' | 'off';
    destination: 'new-track' | 'replace';
};

export async function bounceTrack(trackId: string, options: BounceOptions): Promise<boolean> {
    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track || track.clips.length === 0) {
        return false;
    }
    if (!getTrackEligibility(track.kind).acceptsBounce) {
        return false;
    }

    let startBeat = Infinity;
    let endBeat = -Infinity;
    for (const context of track.clips) {
        if (context.startBeat < startBeat) {
            startBeat = context.startBeat;
        }
        if (context.endBeat > endBeat) {
            endBeat = context.endBeat;
        }
    }

    // Add tail if requested
    let finalEndBeat = endBeat;
    if (options.tailHandling === 'manual') {
        const tempo = transportStore.value?.tempo ?? 120;
        finalEndBeat += (5 * tempo) / 60; // 5 seconds fixed tail
    }

    const renderedBuffer = await renderTrackOffline(track, startBeat, finalEndBeat, {
        includeInserts: options.includeInserts,
        includeSends: options.includeSends,
        includeAutomation: options.includeAutomation,
        normalization: options.normalization,
        autoTail: options.tailHandling === 'auto',
    });

    if (!renderedBuffer) {
        return false;
    }

    // `destination: 'replace'` overwrites the track's clips and — when inserts
    // were included — its devices, which is the same unrecoverable write
    // flatten performs. `'new-track'` is recoverable but still writes a silent
    // clip that later enters exports, so both are refused.
    const silentBake = detectSilentBake({
        track,
        buffer: renderedBuffer,
        startBeat,
        endBeat: finalEndBeat,
        // Only an automation-including bounce seeds the strip from the track's
        // fader; without it `projectStripTrack` prints at a fixed neutral level
        // that is never zero.
        bakedFaderGain: options.includeAutomation ? track.gain : 1,
        operation: 'Bounce',
    });
    if (silentBake.silentBake) {
        notifyUser(silentBake.message, 'error');
        return false;
    }

    const audioBufferId = `bounce-${trackId}-${Date.now()}`;
    cacheAudioBuffer({ buffer: renderedBuffer, bufferId: audioBufferId });

    const bouncedClip: Clip = {
        id: `bounced-clip-${crypto.randomUUID()}`,
        trackId: options.destination === 'replace' ? trackId : `track-bounce-${crypto.randomUUID()}`,
        name: `${track.name} (bounced)`,
        startBeat,
        endBeat: finalEndBeat,
        type: 'audio',
        audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    const freshState = trackStore.value;
    if (!freshState) {
        return false;
    }

    // Snapshot for undo
    const tracksBefore = structuredClone(freshState.tracks);

    if (options.destination === 'replace') {
        trackStore.set({
            ...freshState,
            tracks: freshState.tracks.map((time) => {
                if (time.id !== trackId) {
                    return time;
                }
                return {
                    ...time,
                    clips: [bouncedClip],
                    devices: options.includeInserts ? [] : time.devices,
                };
            }),
        });
    } else {
        const altId = `alt-bounce-${crypto.randomUUID().slice(0, 8)}`;
        const newTrack: Track = {
            ...track,
            id: bouncedClip.trackId,
            name: `${track.name} (bounce)`,
            kind: 'audio',
            clips: [bouncedClip],
            devices: options.includeInserts ? [] : track.devices,
            sends: options.includeSends ? [] : track.sends,
            frozen: false,
            freezeState: { status: 'unfrozen' },
            alternatives: [{ id: altId, name: 'Bounced', clips: [bouncedClip] }],
            activeAlternativeId: altId,
        };

        const insertIndex = freshState.tracks.findIndex((time) => time.id === trackId) + 1;
        const tracks = [...freshState.tracks];
        tracks.splice(insertIndex, 0, newTrack);
        trackStore.set({ ...freshState, tracks });
    }

    // Register undo for the bounce operation
    const tracksAfter = structuredClone(trackStore.value?.tracks ?? []);
    pushUndoEntry(
        'Bounce Track',
        () => {
            const state1 = trackStore.value;
            if (state1) {
                trackStore.set({ ...state1, tracks: tracksBefore });
            }
        },
        () => {
            const state1 = trackStore.value;
            if (state1) {
                trackStore.set({ ...state1, tracks: tracksAfter });
            }
        }
    );
    return true;
}
