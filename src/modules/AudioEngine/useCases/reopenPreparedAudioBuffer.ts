import { audioBufferCache } from '../stores/audioBufferCache';

import { getAudioContext } from './engineAccess/getAudioContext';

type ReopenPreparedAudioBufferInput = {
    bufferId: string;
    leaseId: string;
};

export async function reopenPreparedAudioBuffer({ bufferId, leaseId }: ReopenPreparedAudioBufferInput) {
    try {
        return await audioBufferCache.reopenPreparedBuffer({ id: bufferId, leaseId, context: getAudioContext() });
    } catch (error) {
        return { status: 'failed' as const, reason: error instanceof Error ? error.message : String(error) };
    }
}
