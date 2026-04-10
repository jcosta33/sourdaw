// builtinSynth.ts
export { scheduleNote, getSynthParamsFromDevices, getSynthParamsForTrack, scheduleNoteOffline } from './useCases/builtinSynth';

// cvGate/cvOutputOperations.ts
export { addCvOutput, removeCvOutput, setCvValue, setVoltageStandard, setClockDivision } from './useCases/cvGate/cvOutputOperations';

// drumKitSynth.ts
export { scheduleKitNote } from './useCases/drumKitSynth';

// drumSynthEngine/kitDefinitions.ts
export { KIT_808_DEF, DRUM_KIT_DEFS, getDrumKitDefByIndex, findVoiceByNote, scheduleDrumKitNote } from './useCases/drumSynthEngine/kitDefinitions';

// faustInstrumentScheduler.ts
export { scheduleFaustNote, startFaustNote } from './useCases/faustInstrumentScheduler';

// proSynthInstruments.ts
export { registerProSynthInstruments } from './useCases/proSynthInstruments';
