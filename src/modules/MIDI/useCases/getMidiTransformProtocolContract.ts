import { getMidiNoteTransformHandlers } from './getMidiNoteTransformHandlers';

export const MIDI_TRANSFORM_SCHEMA_VERSION = 1 as const;

export function getMidiTransformProtocolContract() {
    return {
        id: 'transform' as const,
        owner: 'MIDI' as const,
        schemaVersion: MIDI_TRANSFORM_SCHEMA_VERSION,
        capabilities: ['guarded-note-snapshots', 'atomic-undo-redo', 'articulation-preservation'] as const,
        operations: Object.keys(getMidiNoteTransformHandlers()).map((name) => ({
            name,
            version: '1',
            availability: 'available' as const,
        })),
        availability: 'available' as const,
        compatibility: {
            mode: 'discard-retired' as const,
            behavior: 'Persist transformed note state; reject stale guards and discard retired replay actions.',
            canonicalProjectRequiresCommandReplay: false as const,
        },
    };
}
