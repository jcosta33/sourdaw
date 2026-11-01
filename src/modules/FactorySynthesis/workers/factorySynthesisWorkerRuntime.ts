import { type FactorySynthesisWorkerReply, type FactorySynthesisWorkerRequest } from '../models/FactorySynthesisWorker';
import { generateFactorySamples } from '../transformers/generateFactorySamples';

type FactorySynthesisWorkerOutput = {
    reply: FactorySynthesisWorkerReply;
    transfer: ArrayBuffer[];
};

const FAILED: FactorySynthesisWorkerOutput = { reply: { status: 'failed' }, transfer: [] };

function isRenderRequest(message: unknown): message is FactorySynthesisWorkerRequest {
    return typeof message === 'object' && message !== null && 'type' in message && message.type === 'render';
}

/** Renders every factory pack and lists each channel's backing buffer once, so the reply moves without a copy. */
export function renderFactorySynthesisReply(message: unknown): FactorySynthesisWorkerOutput {
    if (!isRenderRequest(message)) {
        return FAILED;
    }
    try {
        const samples = generateFactorySamples();
        const transfer = new Set<ArrayBuffer>();
        for (const sample of samples) {
            for (const channel of sample.channels) {
                if (!(channel.buffer instanceof ArrayBuffer)) {
                    return FAILED;
                }
                transfer.add(channel.buffer);
            }
        }
        return { reply: { status: 'complete', samples }, transfer: [...transfer] };
    } catch {
        return FAILED;
    }
}
