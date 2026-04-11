import { getNextClipId as allocateClipIdFromCounter } from '../repositories/clipIdCounter';

export function getNextClipId(): string {
    return allocateClipIdFromCounter();
}
