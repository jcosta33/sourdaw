export type AudioBufferDurabilityRequest = {
    ids: readonly string[];
};

export type AudioBufferDurabilityResponse =
    { status: 'complete'; revisions: (string | null)[] } | { status: 'unavailable' } | { status: 'failed' };
