/**
 * Public use-case surface for the drum synthesis engine.
 *
 * External callers (Transport) use these to schedule drum kit notes.
 * Engine internals (scheduleDrumVoice, DrumVoiceType, etc.) are private to Synth.
 */
export { type DrumKitDef } from '#/modules/Synth/models/DrumSynthTypes';
export { getDrumKitDefByIndex, scheduleDrumKitNote } from './kitDefinitions';
