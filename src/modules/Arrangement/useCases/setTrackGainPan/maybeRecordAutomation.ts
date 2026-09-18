import { type recordAutomationValue } from '#/modules/Automation/useCases';
import { type AutomationRecordingPolicy } from '#/utils/handlerContract';

import { type getTrackById } from '../../repositories/track/getTrackById';
import { type AutomationMode } from '../../stores/trackStore';

import type { transportStore } from '#/modules/Transport/stores';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

type AutomationRecordDeps = {
    getTransportValue: () => (typeof transportStore)['value'];
    /**
     * The beat this gesture happened at, from the authoritative moving playback
     * clock (`captureGestureBeat`). The transport store's `playheadPosition` is
     * written on discrete transitions only, so during playback it holds the beat
     * playback started at — stamping from it collapses a whole ride onto the
     * start beat (#3799).
     */
    getGestureBeat: () => number;
    getTrackById: typeof getTrackById;
    recordAutomationValue: typeof recordAutomationValue;
};

/** Carried by every writer that can reach a gesture recording pass. */
export type AutomationRecordingOptions = {
    automationRecordingPolicy?: AutomationRecordingPolicy;
};

export function maybeRecordAutomation(
    deps: AutomationRecordDeps,
    trackId: string,
    parameterId: string,
    value: number,
    options: AutomationRecordingOptions = {}
): void {
    // The suppression decision belongs at the writer, not at each caller: undo,
    // redo and persisted replay all arrive back here, and each of them would
    // otherwise reopen the pass the original edit refused to start.
    if (options.automationRecordingPolicy === 'suppressed') {
        return;
    }

    const transport = deps.getTransportValue();
    if (!transport?.isPlaying) {
        return;
    }

    const track = deps.getTrackById(trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    // Stamp the sample at the event's own beat: this call runs synchronously on
    // the gesture's path, so the capture answers for the instant the sample was
    // taken — not for whenever deferred work happens to complete.
    deps.recordAutomationValue(trackId, parameterId, value, deps.getGestureBeat());
}
