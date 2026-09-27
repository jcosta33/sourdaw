import { isClipCompatibleWithTrackKind } from '#/utils/isClipCompatibleWithTrackKind';

import { normalizeSafeProjectName } from '../../validators/normalizeSafeProjectName';

import { findClip, findTrack, hasExactKeys, isFiniteNumber, rejection } from './bridgeArgumentGuards';
import { findEditableAudioClip, findEditableClip, isNormalizationMode } from './clipStrategyGuards';
import { type ClipCallName, type ClipStrategyDefinition } from './clipStrategyTypes';

type ClipPlacementCallName = Extract<
    ClipCallName,
    | 'addClip'
    | 'moveClip'
    | 'duplicateClipAt'
    | 'drawClip'
    | 'moveClips'
    | 'splitClip'
    | 'duplicateClip'
    | 'duplicateClipToNextBar'
    | 'normalizeClip'
    | 'setClipStretchRatio'
    | 'setClipStretchMode'
    | 'fitClipToBeats'
>;

/**
 * Why the destination cannot play the clip, so the model can re-target instead
 * of retrying the same silent placement.
 */
function clipPlacementRejectionReason(clipType: 'audio' | 'midi', kind: string): string {
    if (kind === 'bus' || kind === 'master') {
        return `The destination ${kind} track sums signal rather than playing clips; place the ${clipType} clip on an existing ${clipType} track`;
    }
    if (kind === 'folder') {
        return `The destination folder track renders no timeline content; place the ${clipType} clip on an existing ${clipType} track`;
    }
    if (kind === 'audio' && clipType === 'midi') {
        return 'The destination audio track has no instrument, so the midi clip would stay silent; place the clip on an existing midi track';
    }
    if (kind === 'midi' && clipType === 'audio') {
        return 'The destination midi track cannot play an audio clip; place the clip on an existing audio track';
    }
    return `The destination ${kind} track cannot host clips; place the ${clipType} clip on an existing ${clipType} track`;
}

export const clipPlacementStrategyDefinitions = [
    {
        name: 'addClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const destination = findTrack(context, args.trackId);
            const name = normalizeSafeProjectName(args.name);
            if (
                !hasExactKeys(args, ['trackId', 'startBeat', 'endBeat', 'name']) ||
                !destination ||
                destination.kind !== 'midi' ||
                !isFiniteNumber(args.startBeat) ||
                args.startBeat < 0 ||
                !isFiniteNumber(args.endBeat) ||
                args.endBeat <= args.startBeat ||
                !name
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one existing MIDI track, one safe explicit name, and a finite non-negative beat range'
                );
            }
            return {
                type: 'addClip',
                payload: {
                    trackId: destination.id,
                    startBeat: args.startBeat,
                    endBeat: args.endBeat,
                    name,
                    type: 'midi',
                },
            };
        },
    },
    {
        name: 'moveClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findEditableClip(context, args.clipId);
            const destination = findTrack(context, args.trackId);
            if (
                !hasExactKeys(args, ['clipId', 'trackId', 'startBeat']) ||
                !source ||
                !destination ||
                destination.kind === 'vca' ||
                !isFiniteNumber(args.startBeat) ||
                args.startBeat < 0
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one unlocked clip, one existing clip-host track, and a finite non-negative startBeat'
                );
            }
            // A same-host move changes no placement — the host is whatever
            // the document already holds, so the kind rule has nothing to
            // govern there (the exemption `moveClip` itself applies). Without
            // it a legacy misplaced clip is rejected pre-dispatch from every
            // retime on its own track, with its own host named as an invalid
            // destination. Any other destination still obeys the rule.
            const sameHost = source.track.id === destination.id;
            if (!sameHost && !isClipCompatibleWithTrackKind(source.clip.type, destination.kind)) {
                return rejection(index, call.name, clipPlacementRejectionReason(source.clip.type, destination.kind));
            }
            return {
                type: 'moveClip',
                payload: { clipId: source.clip.id, trackId: destination.id, startBeat: args.startBeat },
            };
        },
    },
    {
        name: 'duplicateClipAt',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findEditableClip(context, args.clipId);
            const destination = findTrack(context, args.destinationTrackId);
            if (
                !hasExactKeys(args, ['clipId', 'destinationTrackId', 'startBeat']) ||
                !source ||
                !destination ||
                destination.kind === 'vca' ||
                !isFiniteNumber(args.startBeat) ||
                args.startBeat < 0
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one unlocked clip, one existing clip-host destination track, and a finite non-negative startBeat'
                );
            }
            // No same-host exemption here, unlike `moveClip`: a duplicate is a
            // NEW placement on the destination — even when that destination is
            // the clip's current host — so the kind rule governs it exactly as
            // it governs every fresh placement (the duplicate core refuses the
            // same target at execution).
            if (!isClipCompatibleWithTrackKind(source.clip.type, destination.kind)) {
                return rejection(index, call.name, clipPlacementRejectionReason(source.clip.type, destination.kind));
            }
            return {
                type: 'duplicateClipAt',
                payload: { clipId: source.clip.id, destinationTrackId: destination.id, startBeat: args.startBeat },
            };
        },
    },
    {
        name: 'drawClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const destination = findTrack(context, args.trackId);
            const name = normalizeSafeProjectName(args.name);
            if (
                !hasExactKeys(args, ['trackId', 'startBeat', 'endBeat', 'name', 'type']) ||
                !destination ||
                (destination.kind !== 'audio' && destination.kind !== 'midi') ||
                (args.type !== 'audio' && args.type !== 'midi') ||
                args.type !== destination.kind ||
                !isFiniteNumber(args.startBeat) ||
                args.startBeat < 0 ||
                !isFiniteNumber(args.endBeat) ||
                args.endBeat <= args.startBeat ||
                !name
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one existing audio or midi track, a clip type matching the track kind, one safe explicit name, and a finite non-negative beat range'
                );
            }
            return {
                type: 'drawClip',
                payload: {
                    trackId: destination.id,
                    startBeat: args.startBeat,
                    endBeat: args.endBeat,
                    name,
                    type: args.type,
                    ripple: false,
                },
            };
        },
    },
    {
        name: 'moveClips',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const moves: unknown = args.moves;
            if (
                !hasExactKeys(args, ['moves']) ||
                !Array.isArray(moves) ||
                moves.length === 0 ||
                !moves.every(
                    (move: unknown) =>
                        typeof move === 'object' &&
                        move !== null &&
                        hasExactKeys(move as Record<string, unknown>, ['clipId', 'trackId', 'startBeat'])
                )
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected a non-empty array of { clipId, trackId, startBeat } placements'
                );
            }
            const placements: { clipId: string; trackId: string; startBeat: number }[] = [];
            for (const move of moves) {
                const candidate = move as { clipId?: unknown; trackId?: unknown; startBeat?: unknown };
                const source = findEditableClip(context, candidate.clipId);
                const destination = findTrack(context, candidate.trackId);
                if (
                    !source ||
                    !destination ||
                    destination.kind === 'vca' ||
                    !isFiniteNumber(candidate.startBeat) ||
                    candidate.startBeat < 0
                ) {
                    return rejection(
                        index,
                        call.name,
                        'Expected every move to name an unlocked clip, an existing clip-host track, and a finite non-negative startBeat'
                    );
                }
                // Mirrors `moveClip`: a same-host move is a retime, not a
                // placement change, so the kind rule does not govern it — the
                // handler routes every move through `moveClip`, which applies
                // the same exemption at execution.
                const sameHost = source.track.id === destination.id;
                if (!sameHost && !isClipCompatibleWithTrackKind(source.clip.type, destination.kind)) {
                    return rejection(
                        index,
                        call.name,
                        clipPlacementRejectionReason(source.clip.type, destination.kind)
                    );
                }
                placements.push({ clipId: source.clip.id, trackId: destination.id, startBeat: candidate.startBeat });
            }
            return { type: 'moveClips', payload: { moves: placements, ripple: false } };
        },
    },
    {
        name: 'splitClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'beat']) ||
                !target ||
                !isFiniteNumber(args.beat) ||
                args.beat <= target.clip.startBeat ||
                args.beat >= target.clip.endBeat
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one unlocked clip and a finite beat strictly inside its current bounds'
                );
            }
            return { type: 'splitClip', payload: { clipId: target.clip.id, beat: args.beat } };
        },
    },
    {
        name: 'duplicateClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (!hasExactKeys(args, ['clipId']) || !source) {
                return rejection(index, call.name, 'Expected only an available clipId');
            }
            // A destinationless duplicate places a NEW clip on the source's
            // own host, and the duplicate core refuses an own-host target the
            // kind rule excludes — silently, for a call that names no
            // destination. Rejecting here gives the model the same actionable
            // reason `duplicateClipAt` gives for an explicit one.
            if (!isClipCompatibleWithTrackKind(source.clip.type, source.track.kind)) {
                return rejection(index, call.name, clipPlacementRejectionReason(source.clip.type, source.track.kind));
            }
            return { type: 'duplicateClip', payload: { clipId: source.clip.id } };
        },
    },
    {
        name: 'duplicateClipToNextBar',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (!hasExactKeys(args, ['clipId']) || !source) {
                return rejection(index, call.name, 'Expected only an available clipId');
            }
            // Same own-host placement as `duplicateClip`: without this check
            // the core's refusal reaches the model as a silent no-write.
            if (!isClipCompatibleWithTrackKind(source.clip.type, source.track.kind)) {
                return rejection(index, call.name, clipPlacementRejectionReason(source.clip.type, source.track.kind));
            }
            return { type: 'duplicateClipToNextBar', payload: { clipId: source.clip.id } };
        },
    },
    {
        name: 'normalizeClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableAudioClip(context, args.clipId);
            const allowedKeys = ['clipId', 'mode', 'targetDb'];
            const hasOnlyAllowedKeys = Object.keys(args).every((key) => allowedKeys.includes(key));
            const hasMode = Object.hasOwn(args, 'mode');
            const mode = hasMode ? args.mode : 'peak';
            const hasTargetDb = Object.hasOwn(args, 'targetDb');
            const targetDb = args.targetDb;
            const invalidArguments = !target || !Object.hasOwn(args, 'clipId') || !hasOnlyAllowedKeys;
            if (invalidArguments || !isNormalizationMode(mode)) {
                return rejection(
                    index,
                    call.name,
                    'Expected one unlocked audio clip, peak/rms/lufs mode, and an optional RMS/LUFS target from -60 through 0 dB'
                );
            }

            let normalizedTargetDb: number | undefined;
            if (hasTargetDb) {
                if (!isFiniteNumber(targetDb) || targetDb < -60 || targetDb > 0) {
                    return rejection(
                        index,
                        call.name,
                        'Expected one unlocked audio clip, peak/rms/lufs mode, and an optional RMS/LUFS target from -60 through 0 dB'
                    );
                }
                normalizedTargetDb = targetDb;
            }

            if (mode === 'peak') {
                if (normalizedTargetDb !== undefined) {
                    return rejection(
                        index,
                        call.name,
                        'Expected one unlocked audio clip, peak/rms/lufs mode, and an optional RMS/LUFS target from -60 through 0 dB'
                    );
                }
                return { type: 'normalizeClip', payload: { clipId: target.clip.id } };
            }
            return {
                type: 'normalizeClip',
                payload: {
                    clipId: target.clip.id,
                    mode,
                    ...(normalizedTargetDb === undefined ? {} : { targetDb: normalizedTargetDb }),
                },
            };
        },
    },
    {
        name: 'setClipStretchRatio',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableAudioClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'ratio']) ||
                !target ||
                !isFiniteNumber(args.ratio) ||
                args.ratio < 0.25 ||
                args.ratio > 4
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one unlocked audio clip and a finite ratio from 0.25 through 4'
                );
            }
            return { type: 'setClipStretchRatio', payload: { clipId: target.clip.id, ratio: args.ratio } };
        },
    },
    {
        name: 'setClipStretchMode',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableAudioClip(context, args.clipId);
            const mode = args.mode;
            if (
                !hasExactKeys(args, ['clipId', 'mode']) ||
                !target ||
                (mode !== 'off' && mode !== 'repitch' && mode !== 'timestretch')
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one unlocked audio clip and off, repitch, or timestretch mode'
                );
            }
            return { type: 'setClipStretchMode', payload: { clipId: target.clip.id, mode } };
        },
    },
    {
        name: 'fitClipToBeats',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const target = findEditableAudioClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'targetBeats']) ||
                !target ||
                !isFiniteNumber(args.targetBeats) ||
                args.targetBeats <= 0
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one unlocked audio clip and a finite targetBeats greater than 0'
                );
            }
            return { type: 'fitClipToBeats', payload: { clipId: target.clip.id, targetBeats: args.targetBeats } };
        },
    },
] as const satisfies readonly ClipStrategyDefinition<ClipPlacementCallName>[];
