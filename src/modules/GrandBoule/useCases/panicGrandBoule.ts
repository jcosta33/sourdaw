/**
 * Silence every voice on the Grand Boule engine immediately.
 *
 * Invoked from the host UI's panic/stop button and whenever the transport
 * stops. Does not clear pedal state — pedals remain wherever the player
 * last left them.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';

type PanicGrandBouleInput = {
    engine: GrandBouleEngineHandle;
};

export const panicGrandBoule = (input: PanicGrandBouleInput): void => {
    input.engine.allNotesOff();
};
