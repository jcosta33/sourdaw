import { createDefaultKit, type ToasterKit } from '../models/ToasterKit';
import { fromToasterKitState } from '../models/ToasterKitState';
import { toasterStore } from '../stores/toasterStore';

type CaptureOfflineToasterInput = {
    deviceId: string;
    /** Persisted device state is authoritative whenever supplied. */
    deviceState?: unknown;
    /** Omit to read the session kit; null selects the application default. */
    kit?: ToasterKit | null;
};

/** Detach the complete kit before graph construction can yield. */
export function captureOfflineToaster({ deviceId, deviceState, kit }: CaptureOfflineToasterInput) {
    if (deviceState !== undefined) {
        return structuredClone({ kit: fromToasterKitState(deviceState) });
    }
    const sessionKit = kit === undefined ? toasterStore.value?.[deviceId]?.kit : kit;
    return structuredClone({ kit: sessionKit ?? createDefaultKit() });
}
