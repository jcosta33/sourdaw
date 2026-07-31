import { type Logger } from '#/infra/logger/types';
import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getToasterDeviceControls } from '#/modules/AudioEngine/useCases';

import { registerToasterDevice, toasterStore } from '../stores/toasterStore';

import { disposeToasterDevice } from './disposeToasterDevice';
import { hydrateToasterKitFromProject } from './hydrateToasterKitFromProject';
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

        // Device load is the registration seam, and registration is the only
        // thing that creates this device's store record. Without it the store
        // stays empty for the whole session: every mutator refuses an unknown
        // deviceId (so a post-teardown write cannot resurrect a device), so
        // panel edits, step toggles and kit loads all no-op, and the hydration
        // below never has a kit to send. Idempotent — a reload keeps the edits
        // the record already holds.
        // The kit project truth holds for this device, so the record is created
        // carrying it. `registerToasterDevice` ignores it when a record already
        // exists, which is what makes a mid-session device reload keep the edits in
        // memory instead of rolling them back to the last mirrored state.
        registerToasterDevice(deviceId, hydrateToasterKitFromProject(deviceId) ?? undefined);

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

        // One projection, two runtimes. The offline render asks the same question
        // of the same kit at construction time, so what it posts and what this
        // posts are the same list — that equality is the export-matches-session
        // property, and `toasterLiveOfflineParity.spec.ts` asserts it directly.
        // Do not re-inline this loop: the two copies drifting is what let an export
        // render the engine's built-in kit while a session played the project's.
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
