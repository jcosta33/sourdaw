import { executeAppAction, executeAppActionBatch } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

type PresetLoadPlan = Readonly<{
    actions: readonly AppAction[];
    deviceIds: readonly string[];
    groupLabel: string;
    trackId: string;
}>;

/**
 * Presents one compiled preset selection to Command. A post-commit runtime
 * receipt is never converted into success: callers receive a rejection for a
 * retry/reconciliation outcome while CRDT history remains truthful.
 */
export async function executePresetLoad(plan: PresetLoadPlan): Promise<void> {
    const [singleAction] = plan.actions;
    if (plan.actions.length === 1 && singleAction) {
        await executeAppAction(singleAction);
        return;
    }

    const result = await executeAppActionBatch(plan.actions, {
        groupId: `preset-load-${crypto.randomUUID()}`,
        groupLabel: plan.groupLabel,
    });
    if (result.status === 'committed') {
        return;
    }
    throw new Error(
        result.status === 'committed-with-warning'
            ? `Preset project commit requires runtime retry or repair: ${result.warning}`
            : `Preset load was not applied: ${'reason' in result ? result.reason : result.status}`
    );
}
