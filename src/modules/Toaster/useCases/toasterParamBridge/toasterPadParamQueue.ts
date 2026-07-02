type QueuedToasterPadParam = {
    pad: number;
    name: string;
    value: number;
};

export const padPending = new Map<string, number>();
export const padLatest = new Map<string, QueuedToasterPadParam>();
