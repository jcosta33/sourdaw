import { automationStore, type AutomationStoreState } from '#/modules/Automation/stores';

import { timelineEditingStore, type TimelineEditingState } from '../stores/timelineEditingStore';

type InlineAutomationSnapshot = {
    editing: TimelineEditingState | null;
    lanes: AutomationStoreState['lanes'] | null;
};

export function readInlineAutomationSnapshot(supplied: InlineAutomationSnapshot | undefined): InlineAutomationSnapshot {
    const editing = supplied ? supplied.editing : timelineEditingStore.value;
    if (editing?.automationVisibility !== 'overlay') {
        return { editing: null, lanes: null };
    }
    if (supplied) {
        return supplied;
    }
    return { editing, lanes: automationStore.value?.lanes ?? null };
}
