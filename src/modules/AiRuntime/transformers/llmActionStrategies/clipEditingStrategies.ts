import { type ProjectContext, type ProjectContextClip } from '../../models/ProjectContext';
import { normalizeSafeProjectName } from '../../validators/normalizeSafeProjectName';

import { findClip, hasExactKeys, isFiniteNumber, isSafeTrackColor, rejection } from './bridgeArgumentGuards';
import { type ClipCallName, type ClipStrategyDefinition } from './clipStrategyTypes';

type ClipEditingCallName = Extract<
    ClipCallName,
    | 'removeClip'
    | 'renameClip'
    | 'trimClipStart'
    | 'trimClipEnd'
    | 'nudgeClip'
    | 'slipClipContent'
    | 'setClipGain'
    | 'muteClip'
    | 'setClipColor'
    | 'setClipFade'
    | 'glueClips'
    | 'crossfadeClips'
    | 'lockClip'
    | 'setClipLoop'
    | 'setClipLoopLength'
>;

type ClipTarget = { clip: ProjectContextClip; track: ProjectContext['tracks'][number] };

/** Same MIDI track, both eligible per the authoritative glue-eligible pair list from the context. */
function isSameEligibleMidiTrackPair(first: ClipTarget, second: ClipTarget, hasAuthoritativeEligibility: boolean) {
    return (
        hasAuthoritativeEligibility &&
        first.track.id === second.track.id &&
        first.track.kind === 'midi' &&
        first.clip.type === 'midi' &&
        second.clip.type === 'midi'
    );
}

/** Unlocked, unmuted, non-looping, and at unity gain — the plain state glue requires. */
function isPlainUnlockedUnmutedMidiClip(clip: ProjectContextClip): boolean {
    return clip.locked !== true && clip.muted !== true && clip.loopEnabled !== true && clip.gain === 1;
}

/** Both clips report a finite well-ordered span, and the first ends exactly where the second starts. */
function hasAdjacentFiniteBounds(first: ClipTarget, second: ClipTarget): boolean {
    return (
        isFiniteNumber(first.clip.startBeat) &&
        isFiniteNumber(first.clip.endBeat) &&
        isFiniteNumber(second.clip.startBeat) &&
        isFiniteNumber(second.clip.endBeat) &&
        first.clip.startBeat < first.clip.endBeat &&
        second.clip.startBeat < second.clip.endBeat &&
        first.clip.endBeat === second.clip.startBeat
    );
}

function isGlueEligiblePair(
    first: ClipTarget,
    second: ClipTarget,
    hasAuthoritativeEligibility: boolean,
    hasClipAutomation: boolean
): boolean {
    return (
        isSameEligibleMidiTrackPair(first, second, hasAuthoritativeEligibility) &&
        isPlainUnlockedUnmutedMidiClip(first.clip) &&
        isPlainUnlockedUnmutedMidiClip(second.clip) &&
        hasAdjacentFiniteBounds(first, second) &&
        !hasClipAutomation
    );
}

/** The distinct, unlocked source/destination pair and duration the crossfade requires. */
function isValidCrossfadeSetup(
    source: ClipTarget,
    destination: ClipTarget,
    durationBeats: unknown
): durationBeats is number {
    return (
        source.clip.id !== destination.clip.id &&
        source.clip.locked !== true &&
        destination.clip.locked !== true &&
        isFiniteNumber(durationBeats) &&
        durationBeats >= 0 &&
        isFiniteNumber(source.clip.endBeat) &&
        isFiniteNumber(destination.clip.startBeat) &&
        // Negated so a non-finite source start still resolves to the base bridge's accepting verdict.
        !(source.clip.startBeat >= destination.clip.startBeat)
    );
}

/** The recomputed crossfade bounds are non-finite, overlap negatively, or restate the existing fades. */
function isRejectedCrossfadeOverlap(
    source: ClipTarget,
    destination: ClipTarget,
    nextSourceEnd: number,
    nextDestinationStart: number,
    overlap: number
): boolean {
    return (
        !Number.isFinite(nextSourceEnd) ||
        !Number.isFinite(nextDestinationStart) ||
        !Number.isFinite(overlap) ||
        overlap < 0 ||
        (source.clip.endBeat === nextSourceEnd &&
            destination.clip.startBeat === nextDestinationStart &&
            (source.clip.fadeOutBeats ?? 0) === overlap &&
            (destination.clip.fadeInBeats ?? 0) === overlap)
    );
}

export const clipEditingStrategyDefinitions = [
    {
        name: 'removeClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (!hasExactKeys(args, ['clipId']) || !source || source.clip.locked === true) {
                return rejection(index, call.name, 'Expected only an available unlocked clipId');
            }
            return { type: 'removeClip', payload: { clipId: source.clip.id } };
        },
    },
    {
        name: 'renameClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            const name = normalizeSafeProjectName(args.name);
            if (!hasExactKeys(args, ['clipId', 'name']) || !source || source.clip.locked === true || !name) {
                return rejection(index, call.name, 'Expected an available unlocked clipId and safe name');
            }
            return { type: 'renameClip', payload: { clipId: source.clip.id, name } };
        },
    },
    {
        name: 'trimClipStart',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'newStartBeat']) ||
                !source ||
                source.clip.locked === true ||
                !isFiniteNumber(args.newStartBeat) ||
                args.newStartBeat < 0 ||
                args.newStartBeat >= source.clip.endBeat
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked clipId and finite newStartBeat before the clip end'
                );
            }
            return { type: 'trimClipStart', payload: { clipId: source.clip.id, newStartBeat: args.newStartBeat } };
        },
    },
    {
        name: 'trimClipEnd',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'newEndBeat']) ||
                !source ||
                source.clip.locked === true ||
                !isFiniteNumber(args.newEndBeat) ||
                args.newEndBeat <= source.clip.startBeat
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked clipId and finite newEndBeat after the clip start'
                );
            }
            return { type: 'trimClipEnd', payload: { clipId: source.clip.id, newEndBeat: args.newEndBeat } };
        },
    },
    {
        name: 'nudgeClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'beats']) ||
                !source ||
                source.clip.locked === true ||
                !isFiniteNumber(args.beats) ||
                args.beats === 0 ||
                source.clip.startBeat + args.beats < 0
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked clipId and finite non-zero nudge that stays on the timeline'
                );
            }
            return { type: 'nudgeClip', payload: { clipId: source.clip.id, beats: args.beats } };
        },
    },
    {
        name: 'slipClipContent',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'clipType', 'offset']) ||
                !source ||
                source.clip.locked === true ||
                (args.clipType !== 'audio' && args.clipType !== 'midi') ||
                args.clipType !== source.clip.type ||
                !isFiniteNumber(args.offset)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked clipId, a clipType matching the clip, and a finite content offset'
                );
            }
            return {
                type: 'slipClipContent',
                payload: { clipId: source.clip.id, clipType: args.clipType, offset: args.offset },
            };
        },
    },
    {
        name: 'setClipGain',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'gain']) ||
                !source ||
                source.clip.locked === true ||
                !isFiniteNumber(args.gain) ||
                args.gain < 0 ||
                args.gain > 2
            ) {
                return rejection(index, call.name, 'Expected an unlocked clipId and finite gain from 0 through 2');
            }
            return { type: 'setClipGain', payload: { clipId: source.clip.id, gain: args.gain } };
        },
    },
    {
        name: 'muteClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'muted']) ||
                !source ||
                source.clip.locked === true ||
                typeof args.muted !== 'boolean' ||
                args.muted === (source.clip.muted ?? false)
            ) {
                return rejection(index, call.name, 'Expected an unlocked clipId and a changed boolean muted value');
            }
            return { type: 'muteClip', payload: { clipId: source.clip.id, muted: args.muted } };
        },
    },
    {
        name: 'setClipColor',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'color']) ||
                !source ||
                source.clip.locked === true ||
                !isSafeTrackColor(args.color)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked clipId and a changed six-digit hexadecimal color'
                );
            }
            const color = args.color.toLowerCase();
            if (color === (source.clip.color ?? '').toLowerCase()) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked clipId and a changed six-digit hexadecimal color'
                );
            }
            return { type: 'setClipColor', payload: { clipId: source.clip.id, color } };
        },
    },
    {
        name: 'setClipFade',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            const clipDuration = source ? source.clip.endBeat - source.clip.startBeat : 0;
            const maximumFadeDuration = clipDuration / 2;
            if (
                !hasExactKeys(args, ['clipId', 'fadeInBeats', 'fadeOutBeats']) ||
                !source ||
                source.clip.locked === true ||
                !isFiniteNumber(args.fadeInBeats) ||
                !isFiniteNumber(args.fadeOutBeats) ||
                args.fadeInBeats < 0 ||
                args.fadeOutBeats < 0 ||
                args.fadeInBeats > maximumFadeDuration ||
                args.fadeOutBeats > maximumFadeDuration ||
                (args.fadeInBeats === (source.clip.fadeInBeats ?? 0) &&
                    args.fadeOutBeats === (source.clip.fadeOutBeats ?? 0))
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected an unlocked clipId and changed finite non-negative fades no longer than half the clip'
                );
            }
            return {
                type: 'setClipFade',
                payload: {
                    clipId: source.clip.id,
                    fadeInBeats: args.fadeInBeats,
                    fadeOutBeats: args.fadeOutBeats,
                },
            };
        },
    },
    {
        name: 'glueClips',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            if (
                !hasExactKeys(args, ['clipIds']) ||
                !Array.isArray(args.clipIds) ||
                args.clipIds.length !== 2 ||
                !args.clipIds.every((clipId): clipId is string => typeof clipId === 'string' && clipId.length > 0) ||
                new Set(args.clipIds).size !== args.clipIds.length
            ) {
                return rejection(index, call.name, 'Expected exactly two distinct existing clip IDs');
            }
            const sources = args.clipIds.map((clipId) => findClip(context, clipId));
            if (sources.some((source) => !source)) {
                return rejection(index, call.name, 'Expected exactly two distinct existing clip IDs');
            }
            const [sourceA, sourceB] = sources;
            if (!sourceA || !sourceB) {
                return rejection(index, call.name, 'Expected exactly two distinct existing clip IDs');
            }
            const sortedSources = [sourceA, sourceB].toSorted(
                (left, right) => left.clip.startBeat - right.clip.startBeat || left.clip.id.localeCompare(right.clip.id)
            );
            const [first, second] = sortedSources;
            const hasAuthoritativeEligibility = (context.glueEligibleClipPairs ?? []).some(
                ([leftId, rightId]) =>
                    (leftId === sourceA.clip.id && rightId === sourceB.clip.id) ||
                    (leftId === sourceB.clip.id && rightId === sourceA.clip.id)
            );
            const hasClipAutomation = (context.automationLanes ?? []).some(
                (lane) => lane.clipId === first?.clip.id || lane.clipId === second?.clip.id
            );
            if (
                !first ||
                !second ||
                !isGlueEligiblePair(first, second, hasAuthoritativeEligibility, hasClipAutomation)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected two adjacent plain unlocked and unmuted MIDI clips on the same MIDI track'
                );
            }
            return { type: 'glueClips', payload: { clipIds: [...args.clipIds] } };
        },
    },
    {
        name: 'crossfadeClips',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const hasDuration = Object.hasOwn(args, 'durationBeats');
            const expectedKeys = hasDuration ? ['clipAId', 'clipBId', 'durationBeats'] : ['clipAId', 'clipBId'];
            const source = findClip(context, args.clipAId);
            const destination = findClip(context, args.clipBId);
            const durationBeats = hasDuration ? args.durationBeats : 0.5;
            if (!hasExactKeys(args, expectedKeys) || !source || !destination) {
                return rejection(
                    index,
                    call.name,
                    'Expected two distinct unlocked clips in timeline order and an optional finite non-negative duration'
                );
            }
            if (!isValidCrossfadeSetup(source, destination, durationBeats)) {
                return rejection(
                    index,
                    call.name,
                    'Expected two distinct unlocked clips in timeline order and an optional finite non-negative duration'
                );
            }
            const halfDuration = durationBeats / 2;
            const nextSourceEnd = source.clip.endBeat + halfDuration;
            const nextDestinationStart = Math.max(0, destination.clip.startBeat - halfDuration);
            const overlap = nextSourceEnd - nextDestinationStart;
            if (isRejectedCrossfadeOverlap(source, destination, nextSourceEnd, nextDestinationStart, overlap)) {
                return rejection(index, call.name, 'Expected a changed crossfade with finite non-negative overlap');
            }
            if (hasDuration) {
                return {
                    type: 'crossfadeClips',
                    payload: { clipAId: source.clip.id, clipBId: destination.clip.id, durationBeats },
                };
            }
            return {
                type: 'crossfadeClips',
                payload: { clipAId: source.clip.id, clipBId: destination.clip.id },
            };
        },
    },
    {
        name: 'lockClip',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'locked']) ||
                !source ||
                typeof args.locked !== 'boolean' ||
                args.locked === (source.clip.locked ?? false)
            ) {
                return rejection(index, call.name, 'Expected an available clipId and a changed boolean locked value');
            }
            return { type: 'lockClip', payload: { clipId: source.clip.id, locked: args.locked } };
        },
    },
    {
        name: 'setClipLoop',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            if (
                !hasExactKeys(args, ['clipId', 'enabled']) ||
                !source ||
                source.clip.locked === true ||
                typeof args.enabled !== 'boolean' ||
                args.enabled === (source.clip.loopEnabled ?? false)
            ) {
                return rejection(index, call.name, 'Expected an unlocked clipId and a changed boolean loop value');
            }
            return { type: 'setClipLoop', payload: { clipId: source.clip.id, enabled: args.enabled } };
        },
    },
    {
        name: 'setClipLoopLength',
        transform: ({ call, context, index }) => {
            const args = call.arguments;
            const source = findClip(context, args.clipId);
            const clipDurationBeats = source ? source.clip.endBeat - source.clip.startBeat : Number.NaN;
            if (
                !hasExactKeys(args, ['clipId', 'loopLength']) ||
                !source ||
                source.clip.locked === true ||
                context.isPlaying ||
                context.isRecording ||
                !isFiniteNumber(args.loopLength) ||
                args.loopLength < (source.clip.minimumLoopLengthBeats ?? 1 / 480) ||
                !Number.isFinite(clipDurationBeats) ||
                clipDurationBeats <= 0
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected one unlocked clip, a stopped transport, and a finite loopLength in beats at least one project tick'
                );
            }
            if (source.clip.loopLength === args.loopLength) {
                return rejection(index, call.name, 'Requested clip loop length already matches project state');
            }
            return { type: 'setClipLoopLength', payload: { clipId: source.clip.id, loopLength: args.loopLength } };
        },
    },
] as const satisfies readonly ClipStrategyDefinition<ClipEditingCallName>[];
