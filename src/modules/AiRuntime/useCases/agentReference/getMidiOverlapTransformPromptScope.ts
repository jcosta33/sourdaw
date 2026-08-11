import { getNotesForClip, projectShortMidiOverlapRemoval } from '#/modules/MIDI/useCases';
import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import {
    type MidiOverlapTransformCapability,
    type MidiOverlapTransformClip,
} from '../../models/MidiOverlapTransformCapability';
import { type ProjectContext } from '../../models/ProjectContext';

const MAXIMUM_OVERLAP_MS = 30 as const;

type MidiOverlapTransformEntry = MidiOverlapTransformClip & {
    expectedTrackFrozen: boolean;
    expectedClipLocked: boolean;
    expectedNotes: readonly MidiClipNoteSnapshot[];
    shortenedNotes: readonly {
        noteId: string;
        previousDuration: number;
        nextDuration: number;
        overlapMs: number;
    }[];
};

export type MidiOverlapTransformRequestScope = {
    status: 'request';
    tempo: number;
    maximumOverlapMs: 30;
    entries: MidiOverlapTransformEntry[];
    selectedClips: MidiOverlapTransformClip[];
    protectedObjects: Array<{ id: string; name: string }>;
    capability?: MidiOverlapTransformCapability;
};

type MidiOverlapTransformPromptScope =
    { status: 'none' } | { status: 'invalid'; reason: string } | MidiOverlapTransformRequestScope;

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

export function getMidiOverlapTransformPromptScope(
    prompt: string,
    context: ProjectContext,
    projectRevision?: string
): MidiOverlapTransformPromptScope {
    if (
        normalizeText(prompt) !==
        'on every selected midi clip shorten only overlaps strictly below 30 ms and leave overlaps exactly at or above 30 ms unchanged'
    ) {
        return { status: 'none' };
    }
    if (!Number.isFinite(context.tempo) || context.tempo <= 0) {
        return { status: 'invalid', reason: 'EX-04 requires one finite positive project tempo' };
    }
    if (context.selectedClipIds.length === 0) {
        return { status: 'invalid', reason: 'EX-04 requires at least one selected MIDI clip' };
    }
    if (new Set(context.selectedClipIds).size !== context.selectedClipIds.length) {
        return { status: 'invalid', reason: 'EX-04 selected MIDI clip IDs must be unique' };
    }

    const selectedIdSet = new Set(context.selectedClipIds);
    const allClips = context.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })));
    const entries: MidiOverlapTransformEntry[] = [];
    const selectedClips: MidiOverlapTransformClip[] = [];
    const protectedObjects: Array<{ id: string; name: string }> = allClips
        .filter(({ clip }) => !selectedIdSet.has(clip.id))
        .map(({ clip }) => ({ id: clip.id, name: `${clip.name} (unselected)` }));

    for (const clipId of context.selectedClipIds) {
        const matches = allClips.filter(({ clip }) => clip.id === clipId);
        if (matches.length !== 1) {
            return { status: 'invalid', reason: `EX-04 selected clip identity is missing or ambiguous: ${clipId}` };
        }
        const { clip, track } = matches[0]!;
        if (track.kind !== 'midi' || clip.type !== 'midi') {
            protectedObjects.push({ id: clipId, name: `${clip.name} (selected non-MIDI clip)` });
            continue;
        }
        if (track.frozen === true || clip.locked === true) {
            return { status: 'invalid', reason: `EX-04 selected clip is unavailable or protected: ${clipId}` };
        }
        const expectedNotes = getNotesForClip(clipId).map((note) => ({ ...note }));
        const projected = projectShortMidiOverlapRemoval({
            notes: expectedNotes,
            tempo: context.tempo,
            maximumOverlapMs: MAXIMUM_OVERLAP_MS,
        });
        if (!projected) {
            return {
                status: 'invalid',
                reason: `EX-04 selected clip note topology is invalid or ambiguous: ${clipId}`,
            };
        }
        const clipSummary: MidiOverlapTransformClip = {
            trackId: track.id,
            trackName: track.name,
            clipId,
            clipName: clip.name,
            noteCount: expectedNotes.length,
            shortOverlapCount: projected.shortenedNotes.length,
        };
        selectedClips.push(clipSummary);
        protectedObjects.push({
            id: `${clipId}:non-duration`,
            name: `${clip.name} note starts, pitches, velocities, channels, expression, and articulations`,
        });
        protectedObjects.push({
            id: `${clipId}:overlap-at-or-above-${String(MAXIMUM_OVERLAP_MS)}ms`,
            name: `${clip.name} overlaps exactly at or above ${String(MAXIMUM_OVERLAP_MS)} ms`,
        });
        if (projected.shortenedNotes.length === 0) {
            protectedObjects.push({ id: clipId, name: `${clip.name} (no overlap strictly below 30 ms)` });
            continue;
        }
        entries.push({
            ...clipSummary,
            expectedTrackFrozen: track.frozen ?? false,
            expectedClipLocked: clip.locked ?? false,
            expectedNotes,
            shortenedNotes: projected.shortenedNotes,
        });
    }
    if (selectedClips.length === 0) {
        return { status: 'invalid', reason: 'EX-04 requires at least one selected MIDI clip' };
    }
    if (entries.length === 0) {
        return { status: 'invalid', reason: 'EX-04 found no selected MIDI overlaps strictly below 30 ms' };
    }

    const capability: MidiOverlapTransformCapability | undefined = projectRevision
        ? {
              schemaVersion: 1,
              baseRevision: projectRevision,
              actionType: 'removeShortMidiOverlaps',
              tempo: context.tempo,
              maximumOverlapMs: MAXIMUM_OVERLAP_MS,
              selectedClips,
              protectedClipIds: protectedObjects.map(({ id }) => id),
              allowedAction: {
                  type: 'removeShortMidiOverlaps',
                  exactClipIds: entries.map(({ clipId }) => clipId),
                  maximumOverlapMs: MAXIMUM_OVERLAP_MS,
                  requiredPayloadKeys: ['clipId', 'maximumOverlapMs'],
                  forbiddenPayloadKeys: ['notes', 'noteIds', 'durations', 'tempo', 'expectedNotes'],
              },
              constraints: {
                  requireCompleteExactClipSet: true,
                  requireFreshConfirmation: true,
                  overlapGrouping: 'same-pitch-and-channel',
                  thresholdComparison: 'strictly-less-than',
                  preserveStartsPitchesVelocitiesChannelsExpressionAndArticulation: true,
              },
          }
        : undefined;
    return {
        status: 'request',
        tempo: context.tempo,
        maximumOverlapMs: MAXIMUM_OVERLAP_MS,
        entries,
        selectedClips,
        protectedObjects,
        capability,
    };
}
