import { getNotesForClip, projectSyncopatedArpeggio } from '#/modules/MIDI/useCases';
import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { type SyncopatedArpeggioCapability } from '../../models/SyncopatedArpeggioCapability';

export type SyncopatedArpeggioRequestScope = {
    status: 'request';
    trackId: string;
    trackName: string;
    clipId: string;
    clipName: string;
    expectedTrackFrozen: boolean;
    expectedClipLocked: boolean;
    expectedNotes: readonly MidiClipNoteSnapshot[];
    addedNotes: readonly Omit<MidiClipNoteSnapshot, 'id'>[];
    protectedObjects: Array<{ id: string; name: string }>;
    capability?: SyncopatedArpeggioCapability;
};

type SyncopatedArpeggioPromptScope = { status: 'invalid'; reason: string } | SyncopatedArpeggioRequestScope;

export function getSyncopatedArpeggioPromptScope(
    context: ProjectContext,
    projectRevision?: string
): SyncopatedArpeggioPromptScope {
    if (context.selectedClipIds.length !== 1 || context.selectedClipId !== context.selectedClipIds[0]) {
        return { status: 'invalid', reason: 'EX-07 requires exactly one selected MIDI clip' };
    }
    const clipId = context.selectedClipIds[0];
    const matches = context.tracks.flatMap((track) =>
        track.clips.filter((clip) => clip.id === clipId).map((clip) => ({ clip, track }))
    );
    if (matches.length !== 1) {
        return { status: 'invalid', reason: `EX-07 selected clip identity is missing or ambiguous: ${clipId}` };
    }
    const { clip, track } = matches[0]!;
    if (track.kind !== 'midi' || clip.type !== 'midi' || track.frozen === true || clip.locked === true) {
        return { status: 'invalid', reason: `EX-07 selected clip is unavailable or protected: ${clipId}` };
    }
    const expectedNotes = getNotesForClip(clipId).map((note) => ({ ...note }));
    const projection = projectSyncopatedArpeggio({ notes: expectedNotes });
    if (!projection) {
        return {
            status: 'invalid',
            reason: `EX-07 selected clip has no unambiguous contiguous chord voicing: ${clipId}`,
        };
    }
    const protectedObjects = [
        ...context.tracks.flatMap((candidateTrack) =>
            candidateTrack.clips
                .filter((candidateClip) => candidateClip.id !== clipId)
                .map((candidateClip) => ({ id: candidateClip.id, name: `${candidateClip.name} (unselected)` }))
        ),
        {
            id: `${clipId}:source-notes`,
            name: `${clip.name} source voicing, velocities, expression, and harmonic boundaries`,
        },
    ];
    const capability: SyncopatedArpeggioCapability | undefined = projectRevision
        ? {
              schemaVersion: 1,
              baseRevision: projectRevision,
              actionType: 'arpeggiate',
              target: {
                  trackId: track.id,
                  trackName: track.name,
                  clipId,
                  clipName: clip.name,
                  sourceNoteCount: expectedNotes.length,
                  addedNoteCount: projection.addedNotes.length,
                  chordWindows: projection.chordWindows.map((window) => ({
                      ...window,
                      pitches: [...window.pitches],
                  })),
              },
              protectedClipIds: protectedObjects.map(({ id }) => id),
              allowedAction: {
                  type: 'arpeggiate',
                  clipId,
                  pattern: 'up',
                  rate: 8,
                  octaves: 1,
                  gate: 50,
                  requiredPayloadKeys: ['clipId', 'pattern', 'rate', 'octaves', 'gate'],
                  forbiddenPayloadKeys: ['notes', 'noteIds', 'expectedNotes', 'addedNotes', 'mode', 'seed'],
              },
              constraints: {
                  requireFreshConfirmation: true,
                  requireExactSelectedClip: true,
                  addWithoutReplacingSourceNotes: true,
                  preserveAbsoluteVoicing: true,
                  preserveChordBoundaries: true,
                  rhythm: 'offbeat-eighths',
              },
          }
        : undefined;
    return {
        status: 'request',
        trackId: track.id,
        trackName: track.name,
        clipId,
        clipName: clip.name,
        expectedTrackFrozen: track.frozen ?? false,
        expectedClipLocked: clip.locked ?? false,
        expectedNotes,
        addedNotes: projection.addedNotes,
        protectedObjects,
        capability,
    };
}
