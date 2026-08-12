import { getNotesForClip, resolveMidiNoteArticulationId } from '#/modules/MIDI/useCases';

import {
    type ArticulationTransferCapability,
    type ArticulationTransferClipPair,
} from '../../models/ArticulationTransferCapability';
import { type ProjectContext, type ProjectContextSection } from '../../models/ProjectContext';
import { projectMidiArticulationTransfer } from '../../transformers/projectMidiArticulationTransfer';

type ArticulationTransferPromptScope =
    | { status: 'invalid'; reason: string }
    | {
          status: 'request';
          clipPairs: ArticulationTransferClipPair[];
          protectedClipIds: string[];
          capability?: ArticulationTransferCapability;
      };

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function findSection(context: ProjectContext, ordinal: 'one' | 'two'): ProjectContextSection | null {
    const aliases = ordinal === 'one' ? new Set(['chorus one', 'chorus 1']) : new Set(['chorus two', 'chorus 2']);
    const matches = (context.sections ?? []).filter((section) => aliases.has(normalizeText(section.name)));
    return matches.length === 1 ? matches[0]! : null;
}

export function getArticulationTransferPromptScope(
    context: ProjectContext,
    projectRevision?: string
): ArticulationTransferPromptScope {
    const sourceSection = findSection(context, 'one');
    const targetSection = findSection(context, 'two');
    if (!sourceSection || !targetSection || sourceSection.id === targetSection.id) {
        return { status: 'invalid', reason: 'MF-03 requires one unambiguous Chorus One and Chorus Two section' };
    }
    if (sourceSection.endBeat - sourceSection.startBeat !== targetSection.endBeat - targetSection.startBeat) {
        return { status: 'invalid', reason: 'MF-03 chorus sections must have equal duration' };
    }

    const clipPairs: ArticulationTransferClipPair[] = [];
    const protectedClipIds: string[] = [];
    for (const track of context.tracks) {
        const sourceClips = track.clips.filter(
            (clip) => clip.startBeat >= sourceSection.startBeat && clip.endBeat <= sourceSection.endBeat
        );
        const targetClips = track.clips.filter(
            (clip) => clip.startBeat >= targetSection.startBeat && clip.endBeat <= targetSection.endBeat
        );
        if (sourceClips.length === 0 && targetClips.length === 0) {
            protectedClipIds.push(...track.clips.map((clip) => clip.id));
            continue;
        }
        if (track.kind !== 'midi') {
            protectedClipIds.push(...sourceClips.map((clip) => clip.id), ...targetClips.map((clip) => clip.id));
            continue;
        }
        if (sourceClips.length !== 1 || targetClips.length !== 1) {
            return { status: 'invalid', reason: `MF-03 chorus clip pairing is ambiguous on track ${track.id}` };
        }
        const sourceClip = sourceClips[0]!;
        const targetClip = targetClips[0]!;
        if (
            sourceClip.startBeat - sourceSection.startBeat !== targetClip.startBeat - targetSection.startBeat ||
            sourceClip.endBeat - sourceClip.startBeat !== targetClip.endBeat - targetClip.startBeat
        ) {
            return { status: 'invalid', reason: `MF-03 chorus clip timing topology differs on track ${track.id}` };
        }
        if (sourceClip.type !== 'midi' || targetClip.type !== 'midi') {
            return { status: 'invalid', reason: `MF-03 requires MIDI chorus clips on track ${track.id}` };
        }
        if (track.frozen === true || sourceClip.locked === true || targetClip.locked === true) {
            return { status: 'invalid', reason: `MF-03 chorus pair is frozen or locked on track ${track.id}` };
        }
        const articulationDevices = track.devices.filter((device) => !device.bypassed && device.type === 'levain');
        if (track.devices.length !== 1 || articulationDevices.length !== 1) {
            return {
                status: 'invalid',
                reason: `MF-03 per-note articulation is unsupported on track ${track.id}`,
            };
        }
        const articulationDevice = articulationDevices[0]!;
        const notePairs = projectMidiArticulationTransfer({
            sourceNotes: getNotesForClip(sourceClip.id),
            targetNotes: getNotesForClip(targetClip.id),
        });
        if (!notePairs) {
            return { status: 'invalid', reason: `MF-03 note pairing is incomplete or ambiguous on track ${track.id}` };
        }
        if (
            notePairs.some(
                (pair) =>
                    pair.sourceArticulation !== null &&
                    resolveMidiNoteArticulationId({
                        deviceType: articulationDevice.type,
                        articulation: pair.sourceArticulation,
                    }) === null
            )
        ) {
            return {
                status: 'invalid',
                reason: `MF-03 source articulation is unsupported on track ${track.id}`,
            };
        }
        if (notePairs.every((pair) => pair.sourceArticulation === pair.currentTargetArticulation)) {
            continue;
        }
        clipPairs.push({
            trackId: track.id,
            trackName: track.name,
            sourceClipId: sourceClip.id,
            sourceClipName: sourceClip.name,
            targetClipId: targetClip.id,
            targetClipName: targetClip.name,
            notePairs,
        });
    }
    if (clipPairs.length === 0) {
        return { status: 'invalid', reason: 'MF-03 found no chorus articulation differences to transfer' };
    }
    const exactClipPairs = clipPairs.map((pair) => ({
        sourceClipId: pair.sourceClipId,
        targetClipId: pair.targetClipId,
    }));
    const capability: ArticulationTransferCapability | undefined = projectRevision
        ? {
              schemaVersion: 1,
              baseRevision: projectRevision,
              actionType: 'copyMidiArticulations',
              sourceSection,
              targetSection,
              clipPairs,
              protectedClipIds,
              allowedAction: {
                  type: 'copyMidiArticulations',
                  exactClipPairs,
                  requiredPayloadKeys: ['sourceClipId', 'targetClipId'],
                  forbiddenPayloadKeys: ['pitch', 'velocity', 'startBeat', 'duration', 'articulation', 'notePairs'],
              },
              constraints: {
                  requireCompleteExactClipPairSet: true,
                  requireFreshConfirmation: true,
                  preservePitchVelocityTimingAndExpression: true,
              },
          }
        : undefined;
    return { status: 'request', clipPairs, protectedClipIds, capability };
}
