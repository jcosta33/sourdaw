import { type Logger } from '#/infra/logger/types';
import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getToasterDeviceControls } from '#/modules/AudioEngine/useCases';

import { registerToasterDevice, toasterStore } from '../stores/toasterStore';

import { disposeToasterDevice } from './disposeToasterDevice';
import { TOASTER_ENGINE_MAP } from './loadToasterKit';

type AudioDeviceLifecyclePayload = {
    deviceId: string;
    deviceType: string;
};

type ToasterSubscriberEventBus = {
    on(
        event: 'audioDevice.loaded' | 'audioDevice.removed',
        handler: (payload: AudioDeviceLifecyclePayload) => void
    ): () => void;
};

type InitToasterSubscribersInput = {
    eventBus: ToasterSubscriberEventBus;
    logger: Pick<Logger, 'info'>;
};

export function initToasterSubscribers({ eventBus, logger }: InitToasterSubscribersInput): () => void {
    const unsubscribe = eventBus.on('audioDevice.loaded', (payload) => {
        if (payload.deviceType !== 'toaster') {
            return;
        }

        const target = resolveEligibleDeviceWriteTarget(payload.deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        logger.info('Hydrating newly loaded Toaster WASM engine with store state');

        const deviceId = payload.deviceId;

        // Device load is the registration seam, and registration is the only
        // thing that creates this device's store record. Without it the store
        // stays empty for the whole session: every mutator refuses an unknown
        // deviceId (so a post-teardown write cannot resurrect a device), so
        // panel edits, step toggles and kit loads all no-op, and the hydration
        // below never has a kit to send. Idempotent — a reload keeps the edits
        // the record already holds.
        registerToasterDevice(deviceId);

        const state = toasterStore.value?.[deviceId];
        const kit = state?.kit;

        if (!kit) {
            return;
        }

        // AudioEngine owns the strip/device-node traversal; Toaster receives only
        // the narrow control surface for this device through the use-case port.
        const tControls = getToasterDeviceControls(deviceId);

        if (!tControls) {
            return;
        }

        tControls.setParam('master_gain', kit.masterGain);
        tControls.setParam('reverb_mix', kit.reverbMix);
        tControls.setParam('reverb_decay', kit.reverbDecay);
        tControls.setParam('delay_time', kit.delayTime);
        tControls.setParam('delay_feedback', kit.delayFeedback);
        tControls.setParam('delay_mix', kit.delayMix);
        tControls.setParam('lofi_bits', kit.lofiBits);
        tControls.setParam('lofi_rate', kit.lofiRate);
        tControls.setParam('lofi_mix', kit.lofiMix);

        for (let index = 0; index < kit.pads.length; index++) {
            const pad = kit.pads[index]!;
            const engineIdx = TOASTER_ENGINE_MAP[pad.engineType] ?? 0;
            tControls.setPadParam(index, 'engine_type', engineIdx);

            if (pad.engineType === 'hihat-open') {
                tControls.setPadParam(index, 'open', 1);
            }
            if (pad.engineType === 'hihat-closed') {
                tControls.setPadParam(index, 'open', 0);
            }

            tControls.setPadParam(index, 'volume', pad.volume);
            tControls.setPadParam(index, 'pan', pad.pan);
            tControls.setPadParam(index, 'tune', pad.tune);
            tControls.setPadParam(index, 'decay', pad.decay);
            tControls.setPadParam(index, 'tone', pad.tone);
            tControls.setPadParam(index, 'drive', pad.drive);
            tControls.setPadParam(index, 'filter_cutoff', pad.filterCutoff);
            tControls.setPadParam(index, 'filter_resonance', pad.filterResonance);
            tControls.setPadParam(index, 'send_reverb', pad.sendReverb);
            tControls.setPadParam(index, 'send_delay', pad.sendDelay);
        }
    });

    // Device teardown: AudioEngine cannot call into the Toaster useCases barrel
    // directly, so it emits and this app-wired subscriber disposes the module
    // state synchronously during emit().
    const unsubscribeRemoved = eventBus.on('audioDevice.removed', (payload) => {
        if (payload.deviceType !== 'toaster') {
            return;
        }
        disposeToasterDevice(payload.deviceId);
    });

    return () => {
        unsubscribe();
        unsubscribeRemoved();
    };
}
