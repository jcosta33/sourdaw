import { type Logger } from '#/infra/logger/types';
import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getToasterDeviceControls } from '#/modules/AudioEngine/useCases';

import { toasterStore } from '../stores/toasterStore';

import { disposeToasterDevice } from './disposeToasterDevice';
import { projectToasterKitToEngineMessages } from './projectToasterKitToEngineMessages';

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

        // "What does this kit send?" is one question with one answer, asked at two
        // different times: here on every device load, and once at construction by
        // the offline render. The projection is that answer, kept pure so the
        // offline path can reuse it without acquiring a subscription or a store
        // handle. Do not re-inline it here — the two copies drifting is what made
        // an export render the engine's built-in kit instead of the project's.
        for (const message of projectToasterKitToEngineMessages({ kit })) {
            if (message.type === 'param') {
                tControls.setParam(message.name, message.value);
                continue;
            }
            tControls.setPadParam(message.pad, message.name, message.value);
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
