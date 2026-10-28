type ParameterPreview = {
    owner: symbol;
    value: number | undefined;
    isCurrent: () => boolean;
};

type PreviewSlot = {
    preview: ParameterPreview | undefined;
    listeners: Set<() => void>;
};

// Disposable UI state shared by independent controls for one installed target.
const slots = new Map<string, PreviewSlot>();

function getSlot(key: string): PreviewSlot {
    let slot = slots.get(key);
    if (!slot) {
        slot = { preview: undefined, listeners: new Set() };
        slots.set(key, slot);
    }
    return slot;
}

function publish(slot: PreviewSlot, preview: ParameterPreview | undefined): void {
    slot.preview = preview;
    for (const listener of slot.listeners) {
        listener();
    }
}

export function readDeviceParameterPreview(key: string): ParameterPreview | undefined {
    return slots.get(key)?.preview;
}

export function subscribeDeviceParameterPreview(key: string, listener: () => void): () => void {
    const slot = getSlot(key);
    slot.listeners.add(listener);
    return () => {
        slot.listeners.delete(listener);
        if (slot.listeners.size === 0 && !slot.preview) {
            slots.delete(key);
        }
    };
}

export function acquireDeviceParameterPreview(
    key: string,
    owner: symbol,
    isCurrent: () => boolean
): number | undefined {
    const slot = getSlot(key);
    const value = slot.preview?.isCurrent() ? slot.preview.value : undefined;
    publish(slot, { owner, value, isCurrent });
    return value;
}

export function ownsDeviceParameterPreview(key: string, owner: symbol): boolean {
    return slots.get(key)?.preview?.owner === owner;
}

export function updateDeviceParameterPreview(key: string, owner: symbol, value: number): void {
    const slot = slots.get(key);
    if (slot?.preview?.owner === owner) {
        publish(slot, { ...slot.preview, value });
    }
}

export function releaseDeviceParameterPreview(key: string, owner: symbol): void {
    const slot = slots.get(key);
    if (slot?.preview?.owner !== owner) {
        return;
    }
    publish(slot, undefined);
    if (slot.listeners.size === 0) {
        slots.delete(key);
    }
}
