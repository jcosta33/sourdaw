import { automationStore } from '../stores/automationStore';
import { type AutomationLane } from '../stores/automationStore';

export function getAutomationLanes(): AutomationLane[] {
    return automationStore.value?.lanes ?? [];
}
