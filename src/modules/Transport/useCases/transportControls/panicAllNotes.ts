import { stopAllScheduled } from '#/modules/AudioEngine/useCases';
import { panicCrumbs } from '#/modules/Crumbs/useCases';
import { panicLiveNotes } from '#/modules/MIDI/useCases';

import { panicYeastRuntime } from './panicYeastRuntime';

/**
 * MIDI panic — force every held note everywhere to release (audit MD-6).
 *
 * A dropped note-off (cable pull, buffer drop, MPE channel churn) leaves a
 * voice sounding with nothing left that knows about it. Until now the only way
 * out was to switch MIDI devices; a dedicated panic is standard DAW kit.
 *
 * It has to reach four separate places a voice can live, because none of them
 * knows about the others:
 *  1. the live Web MIDI note map, plus a channel-mode broadcast for whatever
 *     hardware downstream is holding a note we cannot see;
 *  2. every device on the audio graph, through the engine's stop sweep — that
 *     covers Fermenter, Toaster, Grand Boule, Levain and Faust instruments as
 *     well as the bare oscillators the scheduler emits for built-in synths;
 *  3. the Yeast rack runtime, whose generated notes are owned by its Worker and
 *     are released by settling them back out as note-offs;
 *  4. Crumbs, whose voices live in the native engine and are unreachable from
 *     the Web Audio graph entirely.
 *
 * Transport owns the ordering because it already owns every other teardown
 * sequence; each module owns its own release.
 */
export async function panicAllNotes(): Promise<void> {
    panicLiveNotes();
    stopAllScheduled();
    await panicYeastRuntime();
    await panicCrumbs();
}
