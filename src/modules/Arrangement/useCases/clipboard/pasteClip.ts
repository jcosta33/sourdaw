import { cloneClipAutomationLanes, shiftClipAutomation } from '#/modules/Automation/useCases';
import { restoreMidiClipData, setNotesForClip } from '#/modules/MIDI/useCases';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNoteViewTypes';
import { getTrackState } from '../../repositories/track/getTrackState';
import { clipboardStore } from '../../stores/clipboardStore';
import { setEnvelope } from '../../stores/gainEnvelopeStore';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { setWarpState } from '../../stores/warpStates';
import { addClip } from '../clip/addClip';
import { isClipDropCompatible } from '../clip/isClipDropCompatible';
import { removeClip } from '../clip/removeClip';

export function pasteClip(): boolean {
    const clipClipboard = clipboardStore.value?.clipClipboard ?? [];
    if (clipClipboard.length === 0) {
        return false;
    }

    const transport = transportStore.value;
    const trackState = getTrackState();
    if (!transport || !trackState) {
        return false;
    }

    const playheadBeat = playheadPositionRef.current;
    if (!Number.isFinite(playheadBeat)) {
        return false;
    }

    let minStartBeat = Infinity;
    const sourceClipIds = new Set<string>();
    for (const event of clipClipboard) {
        const eventValue: unknown = event;
        if (typeof eventValue !== 'object' || eventValue === null) {
            return false;
        }
        const sourceClipValue: unknown = Reflect.get(eventValue, 'clip');
        if (typeof sourceClipValue !== 'object' || sourceClipValue === null) {
            return false;
        }

        const sourceClipId: unknown = Reflect.get(sourceClipValue, 'id');
        const clipOwnerId: unknown = Reflect.get(sourceClipValue, 'trackId');
        const sourceTrackId: unknown = Reflect.get(eventValue, 'sourceTrackId');
        if (typeof sourceClipId !== 'string' || sourceClipId.length === 0) {
            return false;
        }
        if (typeof clipOwnerId !== 'string' || clipOwnerId.length === 0) {
            return false;
        }
        if (typeof sourceTrackId !== 'string' || sourceTrackId.length === 0) {
            return false;
        }
        if (clipOwnerId !== sourceTrackId || sourceClipIds.has(sourceClipId)) {
            return false;
        }
        sourceClipIds.add(sourceClipId);

        const sourceClip = event.clip;
        if (
            !Number.isFinite(sourceClip.startBeat) ||
            !Number.isFinite(sourceClip.endBeat) ||
            sourceClip.startBeat < 0 ||
            sourceClip.endBeat <= sourceClip.startBeat
        ) {
            return false;
        }
        if (sourceClip.startBeat < minStartBeat) {
            minStartBeat = sourceClip.startBeat;
        }
    }

    for (const entry of clipClipboard) {
        const sourceTarget = resolveEligibleClipWriteTarget({ trackId: entry.sourceTrackId });
        if (sourceTarget.status !== 'eligible') {
            return false;
        }
    }

    const offset = playheadBeat - minStartBeat;

    const plans: Array<{
        entry: (typeof clipClipboard)[number];
        endBeat: number;
        startBeat: number;
        targetTrackId: string;
    }> = [];
    for (const entry of clipClipboard) {
        const targetTrackId = trackState.selectedTrackId ?? entry.sourceTrackId;
        const targetTrack = trackState.tracks.find((time) => time.id === targetTrackId);
        if (!targetTrack) {
            return false;
        }
        // The selected target must be able to play the clip, not merely accept
        // a write: bus/master/folder pass the eligibility flags but never
        // render clip content (same rule the timeline drop enforces).
        if (!isClipDropCompatible(entry.clip.type, targetTrack.kind)) {
            return false;
        }
        const target = resolveEligibleClipWriteTarget({ trackId: targetTrackId });
        if (target.status !== 'eligible') {
            return false;
        }

        const startBeat = entry.clip.startBeat + offset;
        const endBeat = entry.clip.endBeat + offset;
        if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || startBeat < 0 || endBeat <= startBeat) {
            return false;
        }

        plans.push({ entry, endBeat, startBeat, targetTrackId });
    }

    const addedClipIds: string[] = [];
    let pasteCompleted = true;
    try {
        for (const plan of plans) {
            const { entry, endBeat, startBeat, targetTrackId } = plan;
            // Apart from identity and position a pasted clip equals its
            // source, same carry-over list as `duplicateClipCore`: only the
            // id, target track, span and name differ.
            const newClip = addClip({
                trackId: targetTrackId,
                startBeat,
                endBeat,
                name: `${entry.clip.name} (paste)`,
                type: entry.clip.type,
                audioBufferId: entry.clip.audioBufferId,
                assetHash: entry.clip.assetHash,
                audioOffsetBeats: entry.clip.audioOffsetBeats,
                midiOffsetBeats: entry.clip.midiOffsetBeats,
                fadeInBeats: entry.clip.fadeInBeats,
                fadeOutBeats: entry.clip.fadeOutBeats,
                gain: entry.clip.gain,
                color: entry.clip.color,
                locked: entry.clip.locked,
                muted: entry.clip.muted,
                stretchMode: entry.clip.stretchMode,
                stretchRatio: entry.clip.stretchRatio,
                loopEnabled: entry.clip.loopEnabled,
                loopLength: entry.clip.loopLength,
                followAction: entry.clip.followAction,
            });

            if (!newClip) {
                pasteCompleted = false;
                break;
            }
            addedClipIds.push(newClip.id);

            if (entry.midiNotes && entry.midiNotes.length > 0) {
                const copiedNotes: MidiNote[] = entry.midiNotes.map((node) => ({
                    ...node,
                    id: `note-${crypto.randomUUID().slice(0, 8)}`,
                }));

                setNotesForClip(newClip.id, copiedNotes);
            }

            // The controller streams ride the same copy-time snapshot: re-keyed
            // clones onto the pasted clip id — the arrays land under the pasted
            // id and every event carries a fresh id, the per-stream re-key
            // `duplicateClipCore`'s MIDI clone performs for a duplicate — fed
            // from the capture instead of the live store (the source clip and
            // its streams may be gone by now). A stream the capture holds no
            // rows for stays untouched, exactly as the duplicate clone leaves
            // it. Undo drops the pasted rows with the clip through the restore's
            // dropped-midi-rows sweep, and a mid-paste failure rolls them back
            // with the clip itself through `removeClip` below.
            let controlChanges: MidiCC[] | null = null;
            if (entry.midiCC !== undefined && entry.midiCC.length > 0) {
                controlChanges = entry.midiCC.map((event) => ({
                    ...event,
                    id: `cc-${crypto.randomUUID().slice(0, 8)}`,
                }));
            }
            let pitchBends: MidiPitchBend[] | null = null;
            if (entry.midiPitchBend !== undefined && entry.midiPitchBend.length > 0) {
                pitchBends = entry.midiPitchBend.map((event) => ({
                    ...event,
                    id: `pb-${crypto.randomUUID().slice(0, 8)}`,
                }));
            }
            if (controlChanges !== null || pitchBends !== null) {
                restoreMidiClipData({
                    clipId: newClip.id,
                    notesSnapshot: null,
                    controlChangeSnapshot: controlChanges,
                    pitchBendSnapshot: pitchBends,
                });
            }

            // Re-key the satellites captured at copy time onto the pasted clip.
            // The deep clone gives every paste from one entry its own records —
            // the same freshness `duplicateClipCore`'s clone calls produce for a
            // duplicate, fed from the snapshot instead of the live stores (the
            // source clip may be gone by now). A mid-paste failure rolls these
            // back with the clip itself through `removeClip` below.
            //
            // Take lanes are deliberately not cloned: they are track-scoped
            // comping state whose playback resolution follows the lane of the
            // track a clip sits on, not a per-clip record, and `duplicateClipCore`
            // — the carry-over contract this mirrors — does not clone them.
            const captured = entry.satellites === undefined ? undefined : structuredClone(entry.satellites);
            if (captured?.warpState) {
                setWarpState(newClip.id, captured.warpState);
            }
            if (captured?.gainEnvelope) {
                setEnvelope(newClip.id, { ...captured.gainEnvelope, clipId: newClip.id });
            }

            // Clip-scoped automation lanes ride the same copy-time snapshot:
            // re-keyed clones onto the pasted id, mirroring `duplicateClipCore`'s
            // `duplicateClipAutomation` call, fed from the capture instead of the
            // live store (the source clip and its lanes may be gone by now).
            // Undo drops the clones with the pasted clip: the restore's
            // clip-automation-lane transition removes every lane the post-paste
            // capture holds that the pre-paste capture does not. A mid-paste
            // failure rolls them back with the clip itself through `removeClip`.
            if (entry.automationLanes.length > 0) {
                cloneClipAutomationLanes(entry.automationLanes, newClip.id);
                // Lane points are timeline-absolute, so a paste that relocates
                // the clip must relocate its lane points by the same offset —
                // verbatim points would leave the curve at the source's beats
                // and the pasted clip would play a held constant instead of the
                // source's shape. Paste is the one relocation that cloned lanes
                // instead of moving them, and `moveClip` re-places them through
                // `shiftClipAutomation` on every drag; the same call applies
                // its rule here (clamp at zero, re-sort) and re-keys the lane
                // onto the destination track the way a cross-track drag does.
                shiftClipAutomation(newClip.id, offset, targetTrackId);
            }
        }
    } catch {
        pasteCompleted = false;
    }

    if (pasteCompleted) {
        return true;
    }

    while (addedClipIds.length > 0) {
        const addedClipId = addedClipIds.pop();
        if (addedClipId === undefined) {
            break;
        }
        removeClip(addedClipId);
    }

    return false;
}
