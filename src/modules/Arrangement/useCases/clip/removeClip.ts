import { getAutomationLanes, removeAutomationLane } from '#/modules/Automation/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { clipboardStore } from '../../stores/clipboardStore';
import { clipDragPreviewRef } from '../../stores/clipDragPreviewRef';
import { removeEnvelope } from '../../stores/gainEnvelopeStore';
import { removeWarpState } from '../../stores/warpStates';

export function removeClip(clipId: string): void {
    mapAllTracks((time) => ({ ...time, clips: time.clips.filter((context) => context.id !== clipId) }));

    // Clean up MIDI data keyed by the removed clip to prevent orphaned entries.
    const ms = midiStore.value;
    if (ms) {
        const { [clipId]: _notes, ...restNotes } = ms.notesByClipId;
        const { [clipId]: _cc, ...restCc } = ms.ccByClipId;
        const { [clipId]: _pb, ...restPb } = ms.pitchBendByClipId;
        if (_notes || _cc || _pb) {
            midiStore.set({ ...ms, notesByClipId: restNotes, ccByClipId: restCc, pitchBendByClipId: restPb });
        }
    }

    // Gain envelope keyed by clip id.
    removeEnvelope(clipId);

    // Warp markers keyed by clip id.
    removeWarpState(clipId);

    // Clip-scoped automation lanes (track-level lanes have no clipId and stay).
    for (const lane of getAutomationLanes()) {
        if (lane.clipId === clipId) {
            removeAutomationLane(lane.id);
        }
    }

    // Clipboard: drop any copied entry that points at the removed clip so a
    // later paste can't resurrect a clip whose backing data is gone.
    const clipboard = clipboardStore.value;
    if (clipboard) {
        const filtered = clipboard.clipClipboard.filter((entry) => entry.clip.id !== clipId);
        if (filtered.length !== clipboard.clipClipboard.length) {
            clipboardStore.set({ ...clipboard, clipClipboard: filtered });
        }
    }

    // Ephemeral drag-preview ref: drop any in-progress preview/original keyed
    // to the removed clip.
    const preview = clipDragPreviewRef.current;
    if (preview) {
        preview.positions.delete(clipId);
        preview.originals.delete(clipId);
    }

    // Ephemeral active-recording ref: stop tracking the clip if it was recording.
    if (activeRecordingRef.current.includes(clipId)) {
        activeRecordingRef.current = activeRecordingRef.current.filter((id) => id !== clipId);
    }
}
