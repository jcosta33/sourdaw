import { audioBufferCache } from '../stores/audioBufferCache';

type ReleasePreparedAudioBufferInput = {
    bufferId: string;
    disposition: 'discard' | 'project-owned';
    leaseId: string;
};

export async function releasePreparedAudioBuffer({ bufferId, disposition, leaseId }: ReleasePreparedAudioBufferInput) {
    try {
        return await audioBufferCache.releasePreparedBuffer({ id: bufferId, leaseId, disposition });
    } catch (error) {
        return { status: 'failed' as const, reason: error instanceof Error ? error.message : String(error) };
    }
}
