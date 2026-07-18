/**
 * Serialize the project into EASE-encoded logical state for the LLM.
 *
 * EASE encoding: stable ID-keyed maps + explicit order arrays.
 * Only the logical state is sent — no MIDI notes, no automation points,
 * no waveforms, no plugin blobs — unless explicitly requested.
 *
 * Selective state injection: only include domains relevant to the request.
 */
import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { transportStore } from '#/modules/Transport/stores';

import {
    type LogicalClip,
    type LogicalDevice,
    type LogicalState,
    type LogicalTrack,
} from '../../models/DsoLogicalState';
import { dsoEditorState } from '../../stores/dsoEditorState';

type SerializeLogicalStateInput = {
    scopeTrackIds?: string[];
    includeNoteCount?: boolean;
};

type SerializeLogicalStateOutput = LogicalState;

/**
 * Serialize the current project as EASE-encoded logical state.
 *
 * Options:
 * - scopeTrackIds: limit to specific tracks (selective injection)
 * - includeNoteCount: include note counts in clips (for MIDI-related edits)
 */
export function serializeLogicalState(options?: SerializeLogicalStateInput): SerializeLogicalStateOutput {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const selectionState = clipSelectionStore.value;
    const midiState = midiStore.value;

    const scopeSet = options?.scopeTrackIds ? new Set(options.scopeTrackIds) : null;

    let revision = 0;
    dsoEditorState.update((currentState) => {
        revision = (currentState?.revision ?? 0) + 1;
        return {
            revision,
            recent_edits: currentState?.recent_edits ?? [],
        };
    });

    const tracks: Record<string, LogicalTrack> = {};
    const trackOrder: string[] = [];
    const clips: Record<string, LogicalClip> = {};
    const devices: Record<string, LogicalDevice> = {};

    for (const track of trackState?.tracks ?? []) {
        if (scopeSet && !scopeSet.has(track.id)) {
            continue;
        }

        const clipIds: string[] = [];
        for (const clip of track.clips) {
            const logicalClip: LogicalClip = {
                name: clip.name,
                type: clip.type ?? 'audio',
                track_id: track.id,
                start_beat: clip.startBeat,
                end_beat: clip.endBeat,
                gain: (clip as Record<string, unknown>).gain as number | undefined,
            };

            if (options?.includeNoteCount && clip.type === 'midi') {
                logicalClip.note_count = midiState?.notesByClipId[clip.id]?.length ?? 0;
            }

            clips[clip.id] = logicalClip;
            clipIds.push(clip.id);
        }

        const deviceIds: string[] = [];
        for (const device of track.devices) {
            devices[device.id] = {
                name: (device as Record<string, unknown>).name as string | undefined,
                type: device.type,
                track_id: track.id,
                bypassed: device.bypassed,
            };
            deviceIds.push(device.id);
        }

        tracks[track.id] = {
            name: track.name,
            kind: track.kind,
            muted: track.muted,
            soloed: track.soloed,
            armed: track.armed,
            gain: track.gain,
            pan: track.pan,
            color: track.color,
            clip_ids: clipIds,
            device_ids: deviceIds,
        };
        trackOrder.push(track.id);
    }

    return {
        project_revision: revision,
        transport: {
            tempo: transportState?.tempo ?? 120,
            time_signature: [
                transportState?.timeSignatureNumerator ?? 4,
                transportState?.timeSignatureDenominator ?? 4,
            ],
            playhead_beat: transportState?.playheadPosition ?? 0,
        },
        tracks,
        track_order: trackOrder,
        clips,
        devices,
        selection: {
            track_ids: trackState?.selectedTrackId ? [trackState.selectedTrackId] : [],
            clip_ids: [...(selectionState?.selectedClipIds ?? [])],
        },
    };
}
