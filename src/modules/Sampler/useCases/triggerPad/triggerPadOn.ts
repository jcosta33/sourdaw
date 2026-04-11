import * as bridge from '../../repositories/samplerBridge';
import { samplerStore } from '../../stores/samplerStore';
import { padStore } from '../../stores/padStore';

export async function triggerPadOn(padIndex: number, velocity: number = 100): Promise<void> {
    const state = samplerStore.value;
    const pads = padStore.value;
    if (!state?.instanceId || !pads) return;

    const pad = pads.pads[padIndex];
    if (!pad) return;

    try {
        await bridge.samplerNoteOn(state.instanceId, pad.midiNote, velocity);
    } catch (err) {
        console.error('Note trigger failed:', err);
    }
}