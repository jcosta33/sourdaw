export { type DrumVoiceType, type DrumVoiceDef, type DrumKitDef } from '#/modules/Synth/models/DrumSynthTypes';
export { scheduleDrumVoice } from '#/modules/Synth/engine/drumSynthVoices';
export {
    KIT_808_DEF,
    DRUM_KIT_DEFS,
    getDrumKitDefByIndex,
    findVoiceByNote,
    scheduleDrumKitNote,
} from './kitDefinitions';
