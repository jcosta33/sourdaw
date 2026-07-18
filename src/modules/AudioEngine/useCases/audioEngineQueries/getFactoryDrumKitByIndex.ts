// Thin passthrough exposing the raw factory `DrumKit` model lookup as a public
// use-case surface. Unlike `getDrumKitByIndex` (which maps to the presentation
// `DrumKit` view), this returns the factory model kit consumed by note-input
// scheduling in the MIDI module.
export { getDrumKitByIndex as getFactoryDrumKitByIndex } from '../../models/FactoryDrumKits';
