/**
 * Transformer: pure validation and sanitisation of raw LLM action payloads.
 * No I/O — only transforms unknown input into typed AppAction.
 *
 * Domain-specific validators live in ./validators/*.ts.
 */
import { type AppAction } from '#/modules/Command/useCases/commandQueries';

import { VALID_TYPES, NO_PAYLOAD_ACTIONS } from './validators/shared';
import { validateTrackAction } from './validators/track';
import { validateClipAction } from './validators/clip';
import {
    validateTransportAction,
    validateDeviceAction,
    validateMidiAction,
    validateWorkspaceAction,
    validateAutomationAction,
} from './validators/other';

export function validateSingleAction(raw: unknown): AppAction | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const obj = raw as Record<string, unknown>;

    const type = obj.type;
    if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
        return null;
    }

    if (NO_PAYLOAD_ACTIONS.has(type)) {
        return { type } as AppAction;
    }

    const payload =
        typeof obj.payload === 'object' && obj.payload !== null ? (obj.payload as Record<string, unknown>) : {};

    // Delegate to domain-specific validators in priority order.
    // `undefined` means "not my domain" (fall through);
    // `null` means "invalid payload for this action".

    const track = validateTrackAction(type, payload);
    if (track !== undefined) {
        return track;
    }

    const clip = validateClipAction(type, payload);
    if (clip !== undefined) {
        return clip;
    }

    const transport = validateTransportAction(type, payload);
    if (transport !== undefined) {
        return transport;
    }

    const device = validateDeviceAction(type, payload);
    if (device !== undefined) {
        return device;
    }

    const midi = validateMidiAction(type, payload);
    if (midi !== undefined) {
        return midi;
    }

    const workspace = validateWorkspaceAction(type, payload);
    if (workspace !== undefined) {
        return workspace;
    }

    const automation = validateAutomationAction(type, payload);
    if (automation !== undefined) {
        return automation;
    }

    // Pass through for recognised types without explicit validation
    return { type, payload } as AppAction;
}
