import { captureProjectIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type HandlerCommitValidation } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type RelinkTarget, RELINK_AUDIO_SOURCE_KEYS } from '../../models/RelinkAudioSourceTarget';

function findDocumentOwner(tracks: Record<string, unknown>[], target: RelinkTarget): Record<string, unknown> | null {
    const owners = tracks.filter((track) => track.id === target.trackId);
    if (owners.length !== 1) {
        return null;
    }
    const owner = owners[0]!;
    if (
        owner.kind !== target.trackKind ||
        owner.activeAlternativeId !== target.activeAlternativeId ||
        owner.frozen === true ||
        !isRecord(owner.freezeState) ||
        owner.freezeState.status !== 'unfrozen'
    ) {
        return null;
    }
    return owner;
}

function findDocumentClip(
    tracks: Record<string, unknown>[],
    owner: Record<string, unknown>,
    target: RelinkTarget
): Record<string, unknown> | null {
    let clips: unknown = owner.clips;
    if (target.alternativeId !== null) {
        if (target.alternativeId === owner.activeAlternativeId) {
            return null;
        }
        if (!Array.isArray(owner.alternatives)) {
            return null;
        }
        const alternatives = owner.alternatives.filter(isRecord).filter((item) => item.id === target.alternativeId);
        if (alternatives.length !== 1) {
            return null;
        }
        clips = alternatives[0]!.clips;
    } else {
        const liveClips = tracks.flatMap((track): unknown[] => (Array.isArray(track.clips) ? track.clips : []));
        const liveMatches = liveClips.filter(isRecord).filter((clip) => clip.id === target.clipId);
        if (liveMatches.length !== 1) {
            return null;
        }
    }
    if (!Array.isArray(clips)) {
        return null;
    }
    const found = clips.filter(isRecord).filter((clip) => clip.id === target.clipId);
    if (found.length !== 1) {
        return null;
    }
    return found[0] ?? null;
}

function matchesDocumentSource(clip: Record<string, unknown>, target: RelinkTarget, side: 'before' | 'after'): boolean {
    return (
        clip.type === 'audio' &&
        clip.trackId === target.trackId &&
        clip.locked !== true &&
        RELINK_AUDIO_SOURCE_KEYS.every((key) => clip[key] === target[side][key])
    );
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
        const owner = findDocumentOwner(tracks, target);
        if (!owner) {
            return false;
        }
        const clip = findDocumentClip(tracks, owner, target);
        if (!clip || !matchesDocumentSource(clip, target, side)) {
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
