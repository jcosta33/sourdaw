import { readProviderRequestId } from './readProviderRequestId';

// A rejected batch names the offending call so a provider-side record can be found
// for it; the arguments themselves stay out of the message.
export function rejectedBatchMessage(id: unknown): string {
    const callId = readProviderRequestId(id);
    return callId === null
        ? 'Hosted AI returned an invalid tool-call batch'
        : `Hosted AI returned an invalid tool-call batch for call ${callId}`;
}
