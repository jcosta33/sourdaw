import { createChordGenerator } from './createChordGenerator';
import { createScaleFilter } from './createScaleFilter';
import { createCCMap } from './effectFactories/createCCMap';
import { createMidiDelay } from './effectFactories/createMidiDelay';
import { createNoteQuantizer } from './effectFactories/createNoteQuantizer';
import { createTranspose } from './effectFactories/createTranspose';
import { createVelocityCurve } from './effectFactories/createVelocityCurve';

export const MIDI_EFFECT_FACTORIES = [
    { id: 'chord-gen', name: 'Chord Generator', create: () => createChordGenerator() },
    { id: 'scale-filter', name: 'Scale Filter', create: () => createScaleFilter() },
    { id: 'velocity-curve', name: 'Velocity Curve', create: () => createVelocityCurve() },
    { id: 'midi-delay', name: 'MIDI Delay', create: () => createMidiDelay() },
    { id: 'quantizer', name: 'Note Quantizer', create: () => createNoteQuantizer() },
    { id: 'transpose', name: 'Transpose', create: () => createTranspose() },
    { id: 'cc-map', name: 'CC Map', create: () => createCCMap(1, 11) },
] as const;
