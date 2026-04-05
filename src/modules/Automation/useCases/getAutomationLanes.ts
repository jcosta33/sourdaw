import { automationStore } from '../stores/automationStore';
import { type AutomationLane } from '../models/Automation';

export function getAutomationLanes(): AutomationLane[] {
    return automationStore.value?.lanes ?? [];
}
