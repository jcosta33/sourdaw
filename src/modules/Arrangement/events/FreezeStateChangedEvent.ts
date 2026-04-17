export type FreezeStateChangedPayload = {
    trackId: string;
    status: 'unfrozen' | 'freezing' | 'frozen' | 'stale' | 'error';
};
