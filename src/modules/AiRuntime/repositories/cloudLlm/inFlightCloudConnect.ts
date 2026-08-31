const SUPERSEDED_CLOUD_CREDENTIAL_REPLACEMENT = 'Cloud credential replacement was superseded';

let connectGeneration = 0;
let inFlightConnectAbort: AbortController | null = null;

function abortInFlightConnect(): void {
    if (inFlightConnectAbort === null) {
        return;
    }
    inFlightConnectAbort.abort(new Error(SUPERSEDED_CLOUD_CREDENTIAL_REPLACEMENT));
    inFlightConnectAbort = null;
}

function begin(): { generation: number; abort: AbortController } {
    abortInFlightConnect();
    const abort = new AbortController();
    inFlightConnectAbort = abort;
    const generation = ++connectGeneration;
    return { generation, abort };
}

function supersede(): void {
    abortInFlightConnect();
    connectGeneration += 1;
}

function isCurrent(generation: number): boolean {
    return generation === connectGeneration;
}

function release(abort: AbortController): void {
    if (inFlightConnectAbort === abort) {
        inFlightConnectAbort = null;
    }
}

export const inFlightCloudConnect = Object.freeze({
    supersededMessage: SUPERSEDED_CLOUD_CREDENTIAL_REPLACEMENT,
    begin,
    supersede,
    isCurrent,
    release,
});
