import { executeAppActionBatch, generateGroupId } from '#/modules/Command/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { getTempoWriteTarget } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import type { SetlistItem } from '../../stores/setlistStore';

export async function applySetlistItemTransport(item: SetlistItem, isCurrent: () => boolean): Promise<void> {
    const actions: AppAction[] = [];
    if (item.bpm !== null && getTempoWriteTarget()?.writable === true) {
        actions.push({ type: 'setTempo', payload: { bpm: item.bpm } });
    }
    if (item.timeSignature !== null && transportStore.value) {
        actions.push({
            type: 'setTimeSignature' as const,
            payload: {
                numerator: item.timeSignature.numerator,
                denominator: item.timeSignature.denominator,
            },
        });
    }
    if (actions.length === 0) {
        return;
    }

    const group = generateGroupId(`Setlist: ${item.name}`);
    const result = await executeAppActionBatch(actions, {
        ...group,
        shouldExecute: isCurrent,
    });
    if (result.status === 'cancelled' && !isCurrent()) {
        return;
    }
    if (result.status === 'committed' || result.status === 'executed' || result.status === 'no-op') {
        return;
    }
    if (result.status === 'committed-with-warning' || result.status === 'executed-with-warning') {
        throw new Error(`Transport settings for ${item.name} committed with a warning: ${result.warning}`);
    }
    throw new Error(`Could not apply transport settings for ${item.name}: ${result.reason}`);
}
