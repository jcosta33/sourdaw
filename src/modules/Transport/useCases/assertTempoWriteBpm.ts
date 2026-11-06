import { createInvalidTempoError } from '../errors/InvalidTempoError';
import { MAX_TEMPO_MAP_TEMPO, MIN_TEMPO_MAP_TEMPO } from '../models/TempoMap';
import { MIN_TEMPO, MAX_TEMPO } from '../stores/transportStore';

/** Validate before a compound tempo transaction writes any source facets. */
export function assertTempoWriteBpm(bpm: number, tempoChangeId: string | null): void {
    const minimum = tempoChangeId === null ? MIN_TEMPO : MIN_TEMPO_MAP_TEMPO;
    const maximum = tempoChangeId === null ? MAX_TEMPO : MAX_TEMPO_MAP_TEMPO;
    if (!Number.isFinite(bpm) || bpm < minimum || bpm > maximum) {
        throw createInvalidTempoError(bpm);
    }
}
