import { updateRecentCommandIds as updateRecentIds } from '../models/CommandSearch';

export function updateRecentCommandIds(recentIds: readonly string[], executedId: string): string[] {
    return updateRecentIds(recentIds, executedId);
}
