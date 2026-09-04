/**
 * The native engine's playhead, in the coordinate the cursor is drawn in
 * (#3067, D3.c.4b).
 *
 * A DAW draws its playhead from the transport that is producing the sound, not
 * from a timer running beside it — which is why this exists at all: once the
 * native engine is what a musician hears, the cursor must show where *it* is,
 * including where a loop wrap put it. `readNativeEnginePlayheadSeconds` answers
 * `null` for every case in which the engine is not that transport, so the
 * scheduler's own integration stays the fallback rather than the exception.
 *
 * The engine reports seconds because seconds are the only coordinate the two
 * sides share; beats are the arrangement's, and converting them is this
 * module's job, through the same tempo map the scheduler advances on.
 */

import { readNativeEnginePlayheadSeconds } from '#/modules/AudioEngine/useCases';

import { samplesToBeat } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';

/**
 * Where the engine stands in beats, or `null` when the cursor must keep
 * following the scheduler's own clock.
 */
export function readNativeEngineCursorBeats(): number | null {
    const seconds = readNativeEnginePlayheadSeconds();
    if (seconds === null || !Number.isFinite(seconds)) {
        return null;
    }

    // `samplesToBeat` inverts the very integration `secondsBetweenBeats`
    // performs, in whatever unit its rate names; one sample per second makes
    // its sample coordinate a seconds coordinate, so the round trip cannot
    // drift against the forward direction.
    return samplesToBeat(tempoMapStore.value?.changes ?? [], seconds, transportStore.value?.tempo ?? 120, 1);
}
