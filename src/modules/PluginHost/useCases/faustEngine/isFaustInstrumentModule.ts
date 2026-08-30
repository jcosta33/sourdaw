import { faustEngineState } from './faustEngineState';

/**
 * Whether a registered Faust module is an instrument (a sound source) rather
 * than an effect.
 *
 * `registerFaustDSP` records this as a real flag, so consumers must ask
 * rather than infer it from the `faust-` id prefix — every Faust module,
 * effect or instrument, carries that prefix.
 */
export function isFaustInstrumentModule(moduleId: string): boolean {
    return faustEngineState.modules.get(moduleId)?.isInstrument ?? false;
}
