import { captureProjectIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type AppAction, type HandlerCommitValidation } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type Clip, type Track } from '../../models/Track';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

type RelinkTarget = Extract<AppAction, { type: 'relinkClipAudioSources' }>['payload']['targets'][number];
const SOURCE_KEYS = [
    'audioBufferId',
    'fileId',
    'assetHash',
    'audioOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'stretchMode',
    'stretchRatio',
    'loopEnabled',
    'loopLength',
    'loopOriginBeat',
] as const;

function captureSource(clip: Clip): RelinkTarget['before'] {
    const source: RelinkTarget['before'] = {};
    for (const key of SOURCE_KEYS) {
        const value = clip[key];
        if (value !== undefined) {
            Object.assign(source, { [key]: value });
        }
    }
    return source;
}

export function captureRelinkAudioSourceTargets(sourceBufferId: string, replacementBufferId: string): RelinkTarget[] {
    const targets: RelinkTarget[] = [];
    for (const track of trackStore.value?.tracks ?? []) {
        const capture = (clip: Clip, alternativeId: string | null): void => {
            if (clip.type !== 'audio' || (clip.audioBufferId ?? clip.id) !== sourceBufferId) {
                return;
            }
            const before = captureSource(clip);
            targets.push({
                trackId: track.id,
                trackKind: track.kind,
                activeAlternativeId: track.activeAlternativeId,
                alternativeId,
                clipId: clip.id,
                before,
                after: { ...before, audioBufferId: replacementBufferId },
            });
        };
        for (const clip of track.clips) {
            capture(clip, null);
        }
        for (const alternative of track.alternatives) {
            for (const clip of alternative.clips) {
                capture(clip, alternative.id);
            }
        }
    }
    return targets;
}

function matches(track: Track, clip: Clip, target: RelinkTarget): boolean {
    if (
        track.kind !== target.trackKind ||
        track.activeAlternativeId !== target.activeAlternativeId ||
        track.frozen ||
        track.freezeState.status !== 'unfrozen' ||
        clip.locked ||
        clip.trackId !== target.trackId ||
        clip.type !== 'audio'
    ) {
        return false;
    }
    return SOURCE_KEYS.every(
        (key) =>
            clip[key] === target.before[key] && (key === 'audioBufferId' || target.before[key] === target.after[key])
    );
}

export function relinkAudioSourceTargetsMatch(targets: readonly RelinkTarget[]): boolean {
    if (targets.length === 0) {
        return false;
    }
    const keys = new Set<string>();
    for (const target of targets) {
        if (
            target.before.audioBufferId === target.after.audioBufferId ||
            target.before.audioBufferId === '' ||
            target.after.audioBufferId === ''
        ) {
            return false;
        }
        const key = JSON.stringify([target.trackId, target.alternativeId, target.clipId]);
        if (keys.has(key)) {
            return false;
        }
        keys.add(key);
        const owners = trackStore.value?.tracks.filter((track) => track.id === target.trackId) ?? [];
        if (owners.length !== 1) {
            return false;
        }
        const track = owners[0]!;
        const eligible = resolveEligibleClipWriteTarget({ trackId: target.trackId });
        if (eligible.status !== 'eligible' || eligible.trackId !== target.trackId) {
            return false;
        }
        let clips = track.clips;
        if (target.alternativeId !== null) {
            const alternatives = track.alternatives.filter((item) => item.id === target.alternativeId);
            if (alternatives.length !== 1) {
                return false;
            }
            clips = alternatives[0]!.clips;
        } else if (resolveEligibleClipWriteTarget({ clipId: target.clipId }).status !== 'eligible') {
            return false;
        }
        const found = clips.filter((clip) => clip.id === target.clipId);
        if (found.length !== 1 || !matches(track, found[0]!, target)) {
            return false;
        }
    }
    return true;
}

function documentMatches(
    document: Readonly<Record<string, unknown>> | undefined,
    targets: readonly RelinkTarget[],
    side: 'before' | 'after'
): boolean {
    if (!document || !isRecord(document.tracks) || !Array.isArray(document.tracks.tracks)) {
        return false;
    }
    const tracks = document.tracks.tracks.filter(isRecord);
    for (const target of targets) {
        const owners = tracks.filter((track) => track.id === target.trackId);
        if (owners.length !== 1) {
            return false;
        }
        const owner = owners[0]!;
        if (
            owner.kind !== target.trackKind ||
            owner.activeAlternativeId !== target.activeAlternativeId ||
            owner.frozen === true ||
            !isRecord(owner.freezeState) ||
            owner.freezeState.status !== 'unfrozen'
        ) {
            return false;
        }
        let clips: unknown = owner.clips;
        if (target.alternativeId !== null) {
            if (!Array.isArray(owner.alternatives)) {
                return false;
            }
            const alternatives = owner.alternatives.filter(isRecord).filter((item) => item.id === target.alternativeId);
            if (alternatives.length !== 1) {
                return false;
            }
            clips = alternatives[0]!.clips;
        } else {
            const liveClips = tracks.flatMap((track) => (Array.isArray(track.clips) ? track.clips : []));
            const liveMatches = liveClips.filter(isRecord).filter((clip) => clip.id === target.clipId);
            if (liveMatches.length !== 1) {
                return false;
            }
        }
        if (!Array.isArray(clips)) {
            return false;
        }
        const found = clips.filter(isRecord).filter((clip) => clip.id === target.clipId);
        const clip = found[0];
        if (
            found.length !== 1 ||
            !clip ||
            clip.type !== 'audio' ||
            clip.trackId !== target.trackId ||
            clip.locked === true ||
            !SOURCE_KEYS.every((key) => clip[key] === target[side][key])
        ) {
            return false;
        }
    }
    return true;
}

/** Authenticate raw owners again at the Command publication boundary, beyond its handler await. */
export function captureRelinkAudioSourceCommitValidation(targets: readonly RelinkTarget[]): HandlerCommitValidation {
    const identity = captureProjectIdentity();
    const reason = 'Audio source or owning clip changed before relink publication';
    return {
        documentId: 'root',
        beforeCommit: () => {
            if (
                captureProjectIdentity() !== identity ||
                !documentMatches(getCrdtDoc<Record<string, unknown>>('root'), targets, 'before')
            ) {
                return reason;
            }
            return null;
        },
        beforeMutation: (document) => (documentMatches(document, targets, 'before') ? null : reason),
        validateDocument: (document) => (documentMatches(document, targets, 'after') ? null : reason),
        release: () => undefined,
    };
}

export function applyRelinkAudioSourceTargets(targets: readonly RelinkTarget[]): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    function update(trackId: string, alternativeId: string | null, clip: Clip): Clip {
        const target = targets.find(
            (item) => item.trackId === trackId && item.alternativeId === alternativeId && item.clipId === clip.id
        );
        if (!target) {
            return clip;
        }
        const next = { ...clip };
        if (target.after.audioBufferId === undefined) {
            delete next.audioBufferId;
        } else {
            next.audioBufferId = target.after.audioBufferId;
        }
        return next;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => update(track.id, null, clip)),
            alternatives: track.alternatives.map((alternative) => ({
                ...alternative,
                clips: alternative.clips.map((clip) => update(track.id, alternative.id, clip)),
            })),
        })),
    });
}
