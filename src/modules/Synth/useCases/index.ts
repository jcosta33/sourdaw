export { scheduleNote, getSynthParamsFromDevices, scheduleNoteOffline } from './builtinSynth';
export { addCvOutput, removeCvOutput, setCvValue, setVoltageStandard, setClockDivision } from './cvGate/cvOutputOperations';
export { scheduleKitNote } from './drumKitSynth';
export { KIT_808_DEF, DRUM_KIT_DEFS, getDrumKitDefByIndex, findVoiceByNote, scheduleDrumKitNote } from './drumSynthEngine/kitDefinitions';
export { scheduleFaustNote, startFaustNote } from './faustInstrumentScheduler';
export { registerProSynthInstruments } from './proSynthInstruments';
