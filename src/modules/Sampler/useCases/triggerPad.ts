/**
 * Trigger a sampler pad (note on/off) via the Tauri backend.
 */

import * as bridge from '../repositories/samplerBridge';
import { samplerStore } from '../stores/samplerStore';
import { padStore } from '../stores/padStore';

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

export async function triggerPadOff(padIndex: number): Promise<void> {
    const state = samplerStore.value;
    const pads = padStore.value;
    if (!state?.instanceId || !pads) return;

    const pad = pads.pads[padIndex];
    if (!pad) return;

    try {
        await bridge.samplerNoteOff(state.instanceId, pad.midiNote);
    } catch (err) {
        console.error('Note release failed:', err);
    }
}

export async function allSoundOff(): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId) return;

    try {
        await bridge.samplerAllSoundOff(state.instanceId);
    } catch (err) {
        console.error('All sound off failed:', err);
    }
}
