import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { getSettledProjectIdentity } from '#/modules/Project/stores';

import { type ToasterKit } from '../../models/ToasterKit';
import { markToasterKitCommitted } from '../../models/ToasterKitCommitMarkers';
import { toToasterKitState } from '../../models/ToasterKitState';
import { captureToasterDeviceLifetime, toasterStore } from '../../stores/toasterStore';

type MorphQueue = { tail: Promise<void>; lastCommittedKit: ToasterKit | null };
const morphQueues = new Map<string, MorphQueue>();

/**
 * Morph gestures write document truth before changing the session projection.
 * A project switch or peer edit refuses the stale operation rather than
 * overwriting its newer kit.
 */
export async function commitToasterMorphKitChange(
    deviceId: string,
    change: (kit: ToasterKit) => ToasterKit | null
): Promise<boolean> {
    const projectId = getSettledProjectIdentity()?.projectId;
    const projectIdentity = captureProjectIdentity();
    const lifetime = captureToasterDeviceLifetime(deviceId);
    const requestedKit = toasterStore.value?.[deviceId]?.kit;
    if (!projectId || !lifetime || !requestedKit) {
        return false;
    }
    const queue = morphQueues.get(deviceId) ?? { tail: Promise.resolve(), lastCommittedKit: null };
    morphQueues.set(deviceId, queue);
    const run = queue.tail.then(() => {
        const currentKit = toasterStore.value?.[deviceId]?.kit;
        if (
            getSettledProjectIdentity()?.projectId !== projectId ||
            captureProjectIdentity() !== projectIdentity ||
            captureToasterDeviceLifetime(deviceId) !== lifetime ||
            (currentKit !== requestedKit && currentKit !== queue.lastCommittedKit)
        ) {
            return false;
        }
        return commitCurrentToasterMorphKitChange(deviceId, change, projectId, projectIdentity, lifetime, queue);
    });
    queue.tail = run.then(
        () => undefined,
        () => undefined
    );
    const tail = queue.tail;
    void tail.then(() => {
        if (morphQueues.get(deviceId) === queue && queue.tail === tail) {
            morphQueues.delete(deviceId);
        }
    });
    return run;
}

async function commitCurrentToasterMorphKitChange(
    deviceId: string,
    change: (kit: ToasterKit) => ToasterKit | null,
    projectId: string,
    projectIdentity: ReturnType<typeof captureProjectIdentity>,
    lifetime: object,
    queue: MorphQueue
): Promise<boolean> {
    const state = toasterStore.value?.[deviceId];
    if (
        !state ||
        getSettledProjectIdentity()?.projectId !== projectId ||
        captureProjectIdentity() !== projectIdentity ||
        captureToasterDeviceLifetime(deviceId) !== lifetime
    ) {
        return false;
    }
    const kit = state.kit;
    const nextKit = change(kit);
    if (!nextKit || nextKit === kit || resolveEligibleDeviceWriteTarget(deviceId).status !== 'eligible') {
        return false;
    }

    const stillCurrent = (): boolean =>
        getSettledProjectIdentity()?.projectId === projectId &&
        captureProjectIdentity() === projectIdentity &&
        captureToasterDeviceLifetime(deviceId) === lifetime &&
        toasterStore.value?.[deviceId]?.kit === kit &&
        resolveEligibleDeviceWriteTarget(deviceId).status === 'eligible';
    let committed = false;
    try {
        await executeAppAction(
            { type: 'setDeviceState', payload: { deviceId, state: toToasterKitState(nextKit) } },
            {
                skipMacroRecording: true,
                shouldExecute: stillCurrent,
                authorizeFirstHandler: () => (stillCurrent() ? null : 'Toaster kit changed before morph commit'),
                onCommitted: () => {
                    committed = true;
                    const current = toasterStore.value?.[deviceId];
                    if (!current || !stillCurrent()) {
                        return;
                    }
                    markToasterKitCommitted(nextKit);
                    toasterStore.set({ ...toasterStore.value, [deviceId]: { ...current, kit: nextKit } });
                    queue.lastCommittedKit = nextKit;
                },
            }
        );
    } catch {
        return committed;
    }
    return committed;
}
