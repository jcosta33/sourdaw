import { defaultTransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';

import { resolveTempoAtBeat } from './resolveTempoAtBeat';

/**
 * The tempo actually in force at the playhead — the tempo map's value when a
 * map exists, the transport base tempo when it does not.
 *
 * This is what the transport tempo field must read out, and what `setTempo`
 * writes back to: with a non-empty map `transportStore.tempo` is never
 * consulted by the schedulers, so showing it would show a number that governs
 * nothing.
 */
export function getTempoAtPlayhead(): number {
    const transport = transportStore.value;
    const baseTempo = transport?.tempo ?? defaultTransportState.tempo;
    const beat = transport?.playheadPosition ?? 0;
    return resolveTempoAtBeat({ changes: tempoMapStore.value?.changes ?? [], beat, defaultTempo: baseTempo });
}
