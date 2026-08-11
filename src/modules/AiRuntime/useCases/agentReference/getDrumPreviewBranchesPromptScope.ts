import { captureActiveBranchReference } from '#/modules/CrdtDocument/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { type DrumPreviewBranchesCapability } from '../../models/DrumPreviewBranchesCapability';
import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';

import { projectCanonicalTrackRole } from './projectCanonicalTrackRole';

type DrumPreviewRoleEntry = {
    trackId: string;
    trackName: string;
    expectedTrackFrozen: boolean;
    clipId: string;
    clipName: string;
    expectedClipLocked: boolean;
    expectedNotes: readonly MidiClipNoteSnapshot[];
};

export type DrumPreviewBranchesRequestScope = {
    status: 'request';
    sourceBranchId: string;
    sourceHeads: string[];
    expectedDocuments: Array<{ docId: string; heads: string[] }>;
    expectedBranchState: {
        activeBranchId: string;
        branches: Array<{
            branchId: string;
            name: string;
            rootDocId: string;
            sourceBranchId: string | null;
            createdAt: number;
            createdFromHeads: string[];
            note: string;
        }>;
    };
    section: { id: string; name: string; startBeat: number; endBeat: number };
    kick: DrumPreviewRoleEntry;
    snare: DrumPreviewRoleEntry;
    hiHat: DrumPreviewRoleEntry;
    protectedObjects: Array<{ id: string; name: string }>;
    capability?: DrumPreviewBranchesCapability;
};

type DrumPreviewBranchesPromptScope =
    { status: 'none' } | { status: 'invalid'; reason: string } | DrumPreviewBranchesRequestScope;

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function getRoleEntry(
    tracks: readonly ProjectContextTrack[],
    role: 'kick' | 'snare' | 'hi-hat',
    section: { startBeat: number; endBeat: number }
): DrumPreviewRoleEntry | null {
    const matches = tracks.filter((track) => {
        const projected = projectCanonicalTrackRole(track);
        return projected.classification === 'drum' && projected.role === role;
    });
    if (matches.length !== 1) {
        return null;
    }
    const track = matches[0]!;
    const clips = track.clips.filter(
        (clip) => clip.type === 'midi' && clip.startBeat === section.startBeat && clip.endBeat === section.endBeat
    );
    if (track.kind !== 'midi' || track.frozen === true || clips.length !== 1 || clips[0]!.locked === true) {
        return null;
    }
    const clip = clips[0]!;
    const expectedNotes = getNotesForClip(clip.id).map((note) => ({ ...note }));
    if (expectedNotes.length < 2) {
        return null;
    }
    return {
        trackId: track.id,
        trackName: track.name,
        expectedTrackFrozen: track.frozen ?? false,
        clipId: clip.id,
        clipName: clip.name,
        expectedClipLocked: clip.locked ?? false,
        expectedNotes,
    };
}

export function getDrumPreviewBranchesPromptScope(
    prompt: string,
    context: ProjectContext,
    projectRevision?: string
): DrumPreviewBranchesPromptScope {
    if (
        normalizeText(prompt) !==
        'for one eight bar section create three drum arrangement candidates on separate preview branches while preserving the kick pattern and varying only snare and hi hat programming'
    ) {
        return { status: 'none' };
    }
    const [numerator, denominator] = context.timeSignature;
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
        return { status: 'invalid', reason: 'EX-05 requires one valid project time signature' };
    }
    const sectionLength = 8 * numerator * (4 / denominator);
    const sections = (context.sections ?? []).filter(
        (section) =>
            Number.isFinite(section.startBeat) &&
            Number.isFinite(section.endBeat) &&
            section.endBeat - section.startBeat === sectionLength
    );
    if (sections.length !== 1) {
        return { status: 'invalid', reason: 'EX-05 requires exactly one unambiguous eight-bar section' };
    }
    const section = sections[0]!;
    const kick = getRoleEntry(context.tracks, 'kick', section);
    const snare = getRoleEntry(context.tracks, 'snare', section);
    const hiHat = getRoleEntry(context.tracks, 'hi-hat', section);
    if (!kick || !snare || !hiHat) {
        return {
            status: 'invalid',
            reason: 'EX-05 requires one exact editable MIDI Kick, Snare, and Hi-Hat clip spanning the section',
        };
    }
    const activeBranch = captureActiveBranchReference();
    if (!activeBranch) {
        return { status: 'invalid', reason: 'EX-05 requires one active project branch' };
    }
    const changedTrackIds = new Set([snare.trackId, hiHat.trackId]);
    const protectedObjects = context.tracks
        .filter((track) => !changedTrackIds.has(track.id))
        .map((track) => ({ id: track.id, name: `${track.name} (unchanged in every candidate)` }));
    protectedObjects.push({ id: kick.clipId, name: `${kick.clipName} kick pattern (exactly preserved)` });
    protectedObjects.push({
        id: `${snare.trackId}:non-programming`,
        name: `${snare.trackName} routing, devices, automation, and track state`,
    });
    protectedObjects.push({
        id: `${hiHat.trackId}:non-programming`,
        name: `${hiHat.trackName} routing, devices, automation, and track state`,
    });

    const capability: DrumPreviewBranchesCapability | undefined = projectRevision
        ? {
              schemaVersion: 1,
              baseRevision: projectRevision,
              actionType: 'createDrumPreviewBranches',
              sourceBranch: { branchId: activeBranch.activeBranchId, rootHeads: activeBranch.rootHeads },
              section: { ...section, barCount: 8 },
              roles: {
                  kick: { trackId: kick.trackId, clipId: kick.clipId, noteCount: kick.expectedNotes.length },
                  snare: { trackId: snare.trackId, clipId: snare.clipId, noteCount: snare.expectedNotes.length },
                  hiHat: { trackId: hiHat.trackId, clipId: hiHat.clipId, noteCount: hiHat.expectedNotes.length },
              },
              recipes: ['ghost-note-pocket', 'half-time-space', 'syncopated-hats'],
              protectedObjectIds: protectedObjects.map(({ id }) => id),
              allowedAction: {
                  type: 'createDrumPreviewBranches',
                  sectionId: section.id,
                  candidateCount: 3,
                  varyingRoles: ['snare', 'hi-hat'],
                  requiredPayloadKeys: ['sectionId', 'candidateCount', 'varyingRoles'],
                  forbiddenPayloadKeys: ['branchIds', 'rootDocIds', 'noteIds', 'kickNotes', 'snareNotes', 'hiHatNotes'],
              },
              constraints: {
                  requireCompleteExactCandidateSet: true,
                  requireFreshConfirmation: true,
                  applicationAssignsBranchAndNoteIds: true,
                  preserveKickExactly: true,
                  preserveEveryUnrequestedObject: true,
                  varyOnlySnareAndHiHatProgramming: true,
              },
          }
        : undefined;
    return {
        status: 'request',
        sourceBranchId: activeBranch.activeBranchId,
        sourceHeads: activeBranch.rootHeads,
        expectedDocuments: activeBranch.documents,
        expectedBranchState: activeBranch.branchState,
        section,
        kick,
        snare,
        hiHat,
        protectedObjects,
        capability,
    };
}
