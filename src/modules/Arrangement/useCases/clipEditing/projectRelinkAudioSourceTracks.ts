import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';
import { type AppAction } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type Clip, type Track } from '../../models/Track';
import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';
import { sanitizeTrackSnapshot } from '../../stores/trackStore';
import { planRippleDelete } from '../rippleDelete/planRippleDelete';

import { resolveClipRestoreInsertionIndex } from './resolveClipRestoreInsertionIndex';

function restoredTrack(tracks: readonly Track[], action: Extract<AppAction, { type: 'restoreTrack' }>): Track[] | null {
    const snapshot: unknown = action.payload.trackSnapshot;
    if (!isRecord(snapshot) || !Array.isArray(snapshot.clips)) {
        return null;
    }
    const restored = sanitizeTrackSnapshot({ tracks: [snapshot], selectedTrackId: null }).tracks;
    const [track] = restored;
    if (
        !track ||
        restored.length !== 1 ||
        track.id !== action.payload.trackId ||
        track.clips.length !== snapshot.clips.length ||
        tracks.some((item) => item.id === action.payload.trackId)
    ) {
        return null;
    }
    return [...tracks, track];
}

function restoredClip(tracks: readonly Track[], action: Extract<AppAction, { type: 'restoreClip' }>): Track[] | null {
    const { trackId, ripplePlan } = action.payload;
    const track = tracks.find((item) => item.id === trackId);
    const snapshots = ripplePlan?.removedClips ?? [action.payload.clipSnapshot];
    if (!track || !snapshots.every((clip): clip is Clip => isExactClipSnapshot(clip, clip.id, trackId))) {
        return null;
    }
    const liveIds = new Set(tracks.flatMap((item) => item.clips.map((clip) => clip.id)));
    if (snapshots.some((clip) => liveIds.has(clip.id))) {
        return null;
    }
    const index = resolveClipRestoreInsertionIndex(track.clips, action.payload);
    if (index === null) {
        return null;
    }
    const clips = track.clips.map((clip) => {
        const shift = ripplePlan?.shiftedClips.find((item) => item.clipId === clip.id);
        if (!shift) {
            return clip;
        }
        return {
            ...clip,
            startBeat: shift.origStartBeat,
            endBeat: shift.origEndBeat,
            ...shiftLoopOriginEntry(clip, shift.origStartBeat - clip.startBeat),
        };
    });
    clips.splice(index, 0, ...snapshots);
    return tracks.map((item) => (item.id === trackId ? { ...item, clips } : item));
}

function sourceAfterAction(
    clip: Clip,
    trackId: string,
    alternativeId: string | null,
    action: Extract<AppAction, { type: 'relinkClipAudioSources' }>
): Clip {
    const target = action.payload.targets.find(
        (item) => item.trackId === trackId && item.alternativeId === alternativeId && item.clipId === clip.id
    );
    if (!target) {
        return clip;
    }
    if (target.after.audioBufferId !== undefined) {
        return { ...clip, audioBufferId: target.after.audioBufferId };
    }
    const { audioBufferId: _buffer, ...rest } = clip;
    return rest;
}

function sourceTracks(
    tracks: readonly Track[],
    action: Extract<AppAction, { type: 'relinkClipAudioSources' }>
): Track[] {
    return tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => sourceAfterAction(clip, track.id, null, action)),
        alternatives: track.alternatives.map((alternative) => {
            if (alternative.id === track.activeAlternativeId) {
                return alternative;
            }
            return {
                ...alternative,
                clips: alternative.clips.map((clip) => sourceAfterAction(clip, track.id, alternative.id, action)),
            };
        }),
    }));
}

function removeProjectedClip(
    tracks: readonly Track[],
    action: Extract<AppAction, { type: 'removeClip' | 'discardDuplicatedClip' }>
): Track[] | null {
    const track = tracks.find((item) => item.clips.some((clip) => clip.id === action.payload.clipId));
    if (!track) {
        return null;
    }
    const ripple = action.type === 'removeClip' && action.payload.ripple;
    const plan = planRippleDelete({ trackId: track.id, clipIds: [action.payload.clipId], ripple }, { tracks });
    if (!plan) {
        return null;
    }
    return tracks.map((item) => (item.id === track.id ? { ...item, clips: plan.nextClips } : item));
}

function applyRelinkPrefixAction(tracks: Track[], action: AppAction): Track[] | null {
    if (action.type === 'restoreTrack') {
        return restoredTrack(tracks, action);
    }
    if (action.type === 'restoreClip') {
        return restoredClip(tracks, action);
    }
    if (action.type === 'removeTrack') {
        return tracks.filter((track) => track.id !== action.payload.trackId);
    }
    if (action.type === 'removeClip' || action.type === 'discardDuplicatedClip') {
        return removeProjectedClip(tracks, action);
    }
    if (action.type === 'relinkClipAudioSources') {
        return sourceTracks(tracks, action);
    }
    return tracks;
}

/** Only planned source and owner changes needed by guarded relink replay; never authorizes execution. */
export function projectRelinkAudioSourceTracks(
    tracks: readonly Track[],
    actions: readonly AppAction[]
): Track[] | null {
    let projected = [...tracks];
    for (const action of actions) {
        const next = applyRelinkPrefixAction(projected, action);
        if (!next) {
            return null;
        }
        projected = next;
    }
    return projected;
}
