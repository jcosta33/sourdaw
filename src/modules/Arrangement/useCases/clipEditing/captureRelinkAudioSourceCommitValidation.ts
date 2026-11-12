import { getHeads } from '@automerge/automerge';

import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import { captureProjectIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type HandlerCommitValidation, type HandlerValidationContext } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type RelinkTarget, RELINK_AUDIO_SOURCE_KEYS } from '../../models/RelinkAudioSourceTarget';
import { trackStore } from '../../stores/trackStore';

import { projectRelinkAudioSourceTracks } from './projectRelinkAudioSourceTracks';

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

function clipSourceOwner(clip: Record<string, unknown>): unknown {
    return {
        id: clip.id,
        trackId: clip.trackId,
        type: clip.type,
        locked: clip.locked,
        source: RELINK_AUDIO_SOURCE_KEYS.map((key) => ({ present: clip[key] !== undefined, value: clip[key] })),
    };
}

/** Presence and multiplicity are part of ownership; unrelated gain and placement are not. */
function readOwnerFingerprints(
    document: Readonly<Record<string, unknown>> | undefined,
    targets: readonly RelinkTarget[]
): string[] | null {
    if (!document || !isRecord(document.tracks) || !Array.isArray(document.tracks.tracks)) {
        return null;
    }
    const tracks = document.tracks.tracks.filter(isRecord);
    return targets.map((target) => {
        const owners = tracks
            .filter((track) => track.id === target.trackId)
            .map((track) => {
                let alternatives: unknown = null;
                let clips: unknown = track.clips;
                if (target.alternativeId !== null) {
                    let matches: Record<string, unknown>[] = [];
                    if (Array.isArray(track.alternatives)) {
                        matches = track.alternatives
                            .filter(isRecord)
                            .filter((item) => item.id === target.alternativeId);
                    }
                    alternatives = matches.map((item) => item.id);
                    clips = matches.flatMap((item): unknown[] => (Array.isArray(item.clips) ? item.clips : []));
                }
                let sourceOwners: unknown[] | null = null;
                if (Array.isArray(clips)) {
                    const matchingClips = clips.filter(isRecord).filter((clip) => clip.id === target.clipId);
                    sourceOwners = matchingClips.map(clipSourceOwner);
                }
                return {
                    kind: track.kind,
                    activeAlternativeId: track.activeAlternativeId,
                    frozen: track.frozen,
                    freezeStatus: isRecord(track.freezeState) ? track.freezeState.status : null,
                    alternatives,
                    clips: sourceOwners,
                };
            });
        const liveOwners = tracks.flatMap((track) => {
            if (target.alternativeId !== null || !Array.isArray(track.clips)) {
                return [];
            }
            const matchingClips = track.clips.filter(isRecord).filter((clip) => clip.id === target.clipId);
            return matchingClips.map((clip) => ({ trackId: track.id, clip: clipSourceOwner(clip) }));
        });
        return JSON.stringify({ owners, liveOwners });
    });
}

/** Authenticate initial raw owners and the final source intent of this entered batch. */
export function captureRelinkAudioSourceCommitValidation(
    targets: readonly RelinkTarget[],
    context?: HandlerValidationContext
): {
    validation: HandlerCommitValidation;
    captureWrittenState: () => boolean;
} {
    const identity = captureProjectIdentity();
    const owner = getCurrentAutomergeStorageMutationOwner();
    const root = getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value> }>('root');
    const rawTracks = root?.tracks?.tracks;
    let planned: ReturnType<typeof projectRelinkAudioSourceTracks> = null;
    if (Array.isArray(rawTracks)) {
        planned = projectRelinkAudioSourceTracks(rawTracks, context?.actions.slice(0, context.actionIndex) ?? []);
    }
    const admitted = planned !== null && documentMatches({ tracks: { tracks: planned } }, targets, 'before');
    const before = readOwnerFingerprints(root, targets);
    const projected = () => ({ tracks: trackStore.value });
    let observed = readOwnerFingerprints(projected(), targets);
    let expected: string[] | null = null;
    let heads = root ? getHeads(root).toSorted() : [];
    let authorityIntervened = false;
    const observe = (): void => {
        const current = getCrdtDoc<Record<string, unknown>>('root');
        if (!current) {
            authorityIntervened = true;
            observed = null;
            return;
        }
        const nextHeads = getHeads(current).toSorted();
        authorityIntervened ||= !valuesEqual(heads, nextHeads);
        const next = readOwnerFingerprints(projected(), targets);
        // Peer hydration may run in an entered scope. Once raw heads change,
        // it can only refresh observation, never the group's intended sources.
        if (
            expected &&
            observed &&
            next &&
            !authorityIntervened &&
            getCurrentAutomergeStorageMutationOwner() === owner
        ) {
            for (const [index, fingerprint] of next.entries()) {
                if (observed[index] !== fingerprint) {
                    expected[index] = fingerprint;
                }
            }
        }
        observed = next;
        heads = nextHeads;
    };
    const release = owner && root ? trackStore.subscribe(observe) : () => undefined;
    const reason = 'Audio source or owning clip changed before relink publication';
    function initialOwnersMatch(document: Readonly<Record<string, unknown>> | undefined): boolean {
        return (
            admitted &&
            owner !== undefined &&
            captureProjectIdentity() === identity &&
            before !== null &&
            valuesEqual(before, readOwnerFingerprints(document, targets))
        );
    }
    return {
        validation: {
            documentId: 'root',
            beforeCommit: () => {
                if (
                    captureProjectIdentity() !== identity ||
                    !initialOwnersMatch(getCrdtDoc<Record<string, unknown>>('root'))
                ) {
                    return reason;
                }
                return null;
            },
            beforeMutation: (document) => (initialOwnersMatch(document) ? null : reason),
            validateDocument: (document) =>
                expected !== null && valuesEqual(expected, readOwnerFingerprints(document, targets)) ? null : reason,
            release,
        },
        captureWrittenState: () => {
            const current = projected();
            if (!owner || !admitted || !documentMatches(current, targets, 'after')) {
                return false;
            }
            expected = readOwnerFingerprints(current, targets);
            return expected !== null;
        },
    };
}
