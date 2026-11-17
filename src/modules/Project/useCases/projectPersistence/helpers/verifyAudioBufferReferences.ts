import { trackStore } from '#/modules/Arrangement/stores';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type MissingMediaItem, missingMediaStore } from '../../../stores/missingMediaStore';

import { collectMissingMedia } from './collectMissingMedia';

const TOAST_NAME_LIMIT = 3;

function summarizeLabels(items: readonly MissingMediaItem[]): string {
    const labels = items.map((item) => item.label);
    if (labels.length <= TOAST_NAME_LIMIT) {
        return labels.join(', ');
    }
    const shown = labels.slice(0, TOAST_NAME_LIMIT).join(', ');
    return `${shown} and ${String(labels.length - TOAST_NAME_LIMIT)} more`;
}

/**
 * Scan the loaded project for audio references that resolve to nothing, and
 * publish the result as a durable record.
 *
 * Runs on every project-open path: boot restore (`loadProject`), recent-project
 * open and file import (`replaceProjectData`). The project still opens with
 * whatever media *did* resolve — best-effort open is the unanimous convention,
 * and the save side deliberately does not block either.
 *
 * The toast announces; `missingMediaStore` is what persists. A transient
 * notification is not a record — it cannot be counted, re-read, or acted on
 * once it fades, which is precisely the half that was missing.
 *
 * Publishing is unconditional, including the empty scan: a load that resolves
 * everything must clear the previous project's rows. Skipping the clean write
 * would leave a stale count that no longer describes the open project.
 */
export function verifyAudioBufferReferences(): void {
    const state = trackStore.value;
    // No track state means no project to make a claim about — clear rather than
    // leave the prior project's rows looking current.
    const items = state
        ? collectMissingMedia(state.tracks, (bufferId) => getCachedAudioBuffer({ bufferId }) !== null)
        : [];

    missingMediaStore.set({ items });

    if (items.length === 0) {
        return;
    }

    notifyUser(`Missing audio buffers for: ${summarizeLabels(items)} — re-import the audio files`, 'warning');
}
