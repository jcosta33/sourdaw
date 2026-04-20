import { type MidiNote } from '../../../models/DemoProjectTypes';

export function note(pitch: number, start: number, duration: number, vel = 100): MidiNote {
    return {
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
        pitch,
        startBeat: start,
        duration: duration,
        velocity: vel,
        probability: 1.0,
        pressure: 0,
        slide: 0,
        pitchBend: 0,
    };
}
