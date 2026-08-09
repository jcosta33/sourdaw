import { createFreezeAudioBufferId as createId } from '../models/FreezeAudioBufferId';

type CreateFreezeAudioBufferIdInput = Parameters<typeof createId>[0];

export function createFreezeAudioBufferId(input: CreateFreezeAudioBufferIdInput): string {
    return createId(input);
}
