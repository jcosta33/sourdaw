import { resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type Clip } from '../models/Track';
import { type Track } from '../stores/trackStore';
import { planClipNudge } from '../useCases/clipEditing/planClipNudge';
import { planStartTrim } from '../useCases/clipEditing/planStartTrim';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

export function findProjectedClip(projected: Track, clipId: string) {
    // A clip payload carries no `trackId`, so match the clip by id across whichever track holds it.
    return projected.clips.find((candidate) => candidate.id === clipId);
}

export function projectClipName(action: ActionOf<'renameClip'>, projected: Track): void {
    const clip = findProjectedClip(projected, action.payload.clipId);
    if (clip) {
        clip.name = action.payload.name;
    }
}

export function projectClipMute(action: ActionOf<'muteClip'>, projected: Track): void {
    const clip = findProjectedClip(projected, action.payload.clipId);
    if (clip) {
        clip.muted = action.payload.muted;
    }
}

export function projectClipLock(action: ActionOf<'lockClip'>, projected: Track): void {
    const clip = findProjectedClip(projected, action.payload.clipId);
    if (clip) {
        clip.locked = action.payload.locked;
    }
}

export function projectClipColor(action: ActionOf<'setClipColor'>, projected: Track): void {
    const clip = findProjectedClip(projected, action.payload.clipId);
    if (clip) {
        clip.color = action.payload.color;
    }
}

export function projectClipFade(action: ActionOf<'setClipFade'>, projected: Track): void {
    const clip = findProjectedClip(projected, action.payload.clipId);
    // The writer refuses a MIDI clip and clamps both fades at zero.
    if (clip && clip.type !== 'midi') {
        clip.fadeInBeats = Math.max(0, action.payload.fadeInBeats);
        clip.fadeOutBeats = Math.max(0, action.payload.fadeOutBeats);
    }
}

export function projectClipEnd(action: ActionOf<'trimClipEnd'>, projected: Track): void {
    const clip = findProjectedClip(projected, action.payload.clipId);
    if (clip && Number.isFinite(action.payload.newEndBeat) && action.payload.newEndBeat > clip.startBeat) {
        clip.endBeat = action.payload.newEndBeat;
    }
}

export function projectClipNudge(action: ActionOf<'nudgeClip'>, projected: Track): void {
    const clip = findProjectedClip(projected, action.payload.clipId);
    if (!clip) {
        return;
    }
    const placement = planClipNudge(clip, action.payload.beats, action.payload.placement);
    clip.startBeat = placement.startBeat;
    clip.endBeat = placement.endBeat;
    if (placement.loopOriginBeat === undefined) {
        delete clip.loopOriginBeat;
    } else {
        clip.loopOriginBeat = placement.loopOriginBeat;
    }
    if (placement.audioLoopPassOriginBeat === undefined) {
        delete clip.audioLoopPassOriginBeat;
    } else {
        clip.audioLoopPassOriginBeat = placement.audioLoopPassOriginBeat;
    }
}

export function projectClipSlip(action: ActionOf<'slipClipContent'>, projected: Track): void {
    const clip = findProjectedClip(projected, action.payload.clipId);
    // An audio slip is captured whole by its own restore action, so only the MIDI offset projects.
    if (!clip || action.payload.clipType !== 'midi' || !Number.isFinite(action.payload.offset)) {
        return;
    }
    clip.midiOffsetBeats = slippedMidiOffset(action.payload, clip);
}

/** The offset a MIDI slip stores: a recorded inverse restores it verbatim; a fresh slip wraps it into the loop. */
export function slippedMidiOffset(payload: ActionOf<'slipClipContent'>['payload'], clip: Clip): number {
    if (payload.rowLiftBeats !== undefined) {
        return payload.offset;
    }
    return resolveLoopedOffsetBeats({
        offsetBeats: payload.offset,
        loopEnabled: clip.loopEnabled ?? false,
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
    });
}

/** The head a trim of the start leaves, from the writer's own law. */
export function trimmedStartBeat(clip: Clip, newStartBeat: number): number {
    if (!Number.isFinite(newStartBeat)) {
        return clip.startBeat;
    }
    const plan = planStartTrim(clip, newStartBeat, undefined, undefined);
    if (plan === null || plan === 'refused') {
        return clip.startBeat;
    }
    return plan.clip.startBeat;
}

export function projectMidiClipStart(action: ActionOf<'trimClipStart'>, projected: Track): void {
    const index = projected.clips.findIndex((candidate) => candidate.id === action.payload.clipId);
    const clip = projected.clips[index];
    // An audio trim re-derives its source window through captured state, so a plan that reads it is unknown.
    if (!clip || clip.type === 'audio' || !Number.isFinite(action.payload.newStartBeat)) {
        return;
    }
    const plan = planStartTrim(
        clip,
        action.payload.newStartBeat,
        action.payload.loopOriginBeat,
        action.payload.midiOffsetBeats
    );
    if (plan !== null && plan !== 'refused') {
        projected.clips[index] = plan.clip;
    }
}
