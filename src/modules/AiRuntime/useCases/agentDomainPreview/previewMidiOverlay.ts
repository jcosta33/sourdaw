import { type AppAction } from '#/utils/handlerContract';

import {
    AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION,
    type AgentDomainPreviewInput,
    type AgentDomainPreviewResult,
    type AgentMidiOverlayClip,
} from '../../models/AgentDomainPreview';
import {
    isProjectedRecord,
    readProjectedNumber,
    readProjectedSlot,
    readProjectedString,
} from '../../services/projectedDocumentSlot';

import { resolveAgentPreviewDomains } from './resolveAgentPreviewDomains';

/**
 * The projected notes of the clips a MIDI batch names.
 *
 * Notes are read from the `midi` slot's `notesByClipId` map of the isolated
 * post-state, so the overlay is what the batch would leave behind rather than
 * what it asked for. Only the clips the batch's own payloads name are reported;
 * a batch that names no clip previews an empty overlay.
 */

function affectedClipIds(actions: readonly AppAction[]): readonly string[] {
    const clipIds = actions.flatMap((action) => {
        if (!resolveAgentPreviewDomains([action]).includes('midi-overlay')) {
            return [];
        }
        if (!isProjectedRecord(action.payload)) {
            return [];
        }
        const clipId = readProjectedString(action.payload, 'clipId');
        return clipId === null ? [] : [clipId];
    });
    return [...new Set(clipIds)];
}

function projectedNotes(value: unknown): AgentMidiOverlayClip['notes'] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((note) => {
        if (!isProjectedRecord(note)) {
            return [];
        }
        const id = readProjectedString(note, 'id');
        const pitch = readProjectedNumber(note, 'pitch');
        const startBeat = readProjectedNumber(note, 'startBeat');
        const duration = readProjectedNumber(note, 'duration');
        const velocity = readProjectedNumber(note, 'velocity');
        if (id === null || pitch === null || startBeat === null || duration === null || velocity === null) {
            return [];
        }
        return [{ id, pitch, startBeat, duration, velocity }];
    });
}

export function previewMidiOverlay(input: AgentDomainPreviewInput): AgentDomainPreviewResult {
    const midiSlot = readProjectedSlot(input.projectDocument, 'midi');
    const notesByClipId = midiSlot === null ? null : midiSlot.notesByClipId;
    if (!isProjectedRecord(notesByClipId)) {
        return { status: 'unsupported', domain: 'midi-overlay', reason: 'projection-slot-missing' };
    }
    return {
        status: 'previewed',
        domain: 'midi-overlay',
        schemaVersion: AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION,
        handle: affectedClipIds(input.actions).map((clipId) => ({
            clipId,
            notes: projectedNotes(notesByClipId[clipId]),
        })),
    };
}
