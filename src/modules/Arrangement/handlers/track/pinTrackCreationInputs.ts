import { reserveNextTrackColor } from '../../models/Track';

import type { AppAction } from '#/utils/handlerContract';

type AddTrackAction = Extract<AppAction, { type: 'addTrack' }>;

/**
 * Pins the palette color (an advancing counter) and the initial alternative id onto a creation
 * payload once. The creating handler executes with these values and the batch planner reads
 * them, so a planned created track has the identity its creator gives it.
 */
export function pinCreationIdentity(payload: { color?: string; initialAlternativeId?: string }): {
    color: string;
    initialAlternativeId: string;
} {
    payload.color ??= reserveNextTrackColor();
    payload.initialAlternativeId ??= `alt-${crypto.randomUUID()}`;
    return { color: payload.color, initialAlternativeId: payload.initialAlternativeId };
}

export function ensureTrackId(action: AddTrackAction): string {
    if (action.payload.id) {
        return action.payload.id;
    }
    const trackId = `track-ai-${crypto.randomUUID()}`;
    action.payload.id = trackId;
    return trackId;
}

// Every creation input the model would otherwise mint per execute — the
// palette color (an advancing counter), the initial alternative id, and the
// MIDI default-device id — is pinned onto the action once, alongside the id.
// Without this, redo's re-execution produces a track that differs from the
// content the discard guard captured, so the undo after a redo refuses with a
// conflict and wedges the history head (#3696 round-trip).
export function ensureStableCreationInputs(action: AddTrackAction): string {
    const trackId = ensureTrackId(action);
    pinCreationIdentity(action.payload);
    if (
        action.payload.initialDeviceId === undefined &&
        action.payload.kind === 'midi' &&
        action.payload.withoutDefaultDevice !== true
    ) {
        action.payload.initialDeviceId = `dev-synth-${crypto.randomUUID()}`;
    }
    return trackId;
}
