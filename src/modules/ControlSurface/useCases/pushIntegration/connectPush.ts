import { pushHardwareTransport } from '../../repositories/pushHardwareTransport';
import { pushStore } from '../../stores/push';

import { handlePadPress } from './handlePadPress';
import { handlePadRelease } from './handlePadRelease';
import { setEncoderValue } from './setEncoderValue';

type PushMidiEvent = Parameters<typeof pushHardwareTransport.connect>[0]['onMidiEvent'] extends (
    event: infer Event
) => void
    ? Event
    : never;

function applyPushMidiEvent(event: PushMidiEvent): void {
    if (event.kind === 'pad') {
        const padIndex = event.note - 36;
        if (event.edge === 'pressed') {
            handlePadPress(padIndex, event.velocity);
        } else {
            handlePadRelease(padIndex);
        }
        return;
    }

    const state = pushStore.value;
    if (!state) {
        return;
    }
    if (event.kind === 'poly-pressure') {
        const padIndex = event.note - 36;
        const pads = state.pads.map((pad) => (pad.index === padIndex ? { ...pad, aftertouch: event.pressure } : pad));
        pushStore.set({ ...state, pads });
        return;
    }
    if (event.kind === 'encoder-turn' && event.control >= 71 && event.control <= 78) {
        const encoderIndex = event.control - 71;
        const currentValue = state.encoders[encoderIndex]?.value ?? 0;
        setEncoderValue(encoderIndex, currentValue + event.delta);
        return;
    }
    if (event.kind === 'touch-strip-pitch-bend') {
        pushStore.set({ ...state, touchStripPosition: event.value / 16_383 });
    }
}

export async function connectPush(model: 'push2' | 'push3'): Promise<void> {
    await pushHardwareTransport.connect({
        model,
        onMidiEvent: applyPushMidiEvent,
        onDisconnect() {
            const state = pushStore.value;
            if (state) {
                pushStore.set({ ...state, connected: false, model: null });
            }
        },
    });
    const state = pushStore.value;
    if (!state) {
        await pushHardwareTransport.disconnect();
        throw new Error('Ableton Push session state is unavailable');
    }
    pushStore.set({ ...state, connected: true, model });
}
