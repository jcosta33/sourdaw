import { type MidiEvent } from '../../models/MidiEvent';
import { getYeastRack } from '../../stores/yeastStore';

export function yeastPanic(sampleTime: number): MidiEvent[] {
    const rack = getYeastRack();
    return rack.allNotesOff(sampleTime);
}