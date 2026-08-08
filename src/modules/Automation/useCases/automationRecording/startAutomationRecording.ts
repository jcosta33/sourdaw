import { trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { automationStore } from '../../stores/automationStore';

import { makeKey } from './makeKey';
import { RECORDING_MODES, activeRecording, laneBaselines, pendingPoints, touchActive } from './recordingSessionState';

export function startAutomationRecording(): void {
    activeRecording.clear();
    pendingPoints.clear();
    touchActive.clear();
    // Baselines are per-session: a leftover entry from an abandoned session
    // would make this session's undo restore that one's starting state.
    laneBaselines.clear();

    const tracks = trackStore.value?.tracks ?? [];

    const autoState = automationStore.value;
    if (!autoState) {
        return;
    }

    // Seed each session's start from the current playhead, NOT 0. latch-mode
    // stop clears [startBeat, lastBeat]; anchoring at 0 would wipe every
    // pre-existing point before the record point. The high-frequency
    // `playheadPositionRef` is rAF-only — discrete reads use the store.
    const startBeat = Math.max(0, transportStore.value?.playheadPosition ?? 0);

    for (const track of tracks) {
        if (!RECORDING_MODES.has(track.automationMode)) {
            continue;
        }

        for (const lane of autoState.lanes) {
            if (lane.trackId !== track.id) {
                continue;
            }

            const key = makeKey(track.id, lane.parameterId);
            activeRecording.set(key, {
                parameterId: lane.parameterId,
                trackId: track.id,
                startBeat,
                lastValue: null,
            });
            pendingPoints.set(key, []);
        }
    }
}
