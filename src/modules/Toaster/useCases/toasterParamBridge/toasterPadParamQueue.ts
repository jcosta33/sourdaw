type QueuedToasterPadParam = {
    deviceId: string;
    pad: number;
    name: string;
    value: number;
};

type PendingToasterPadParam = {
    deviceId: string;
    rafId: number;
};

export const padPending = new Map<string, PendingToasterPadParam>();
export const padLatest = new Map<string, QueuedToasterPadParam>();
