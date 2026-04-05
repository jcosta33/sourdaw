import { automationStore, type AutomationStoreState } from '../stores/automationStore';

export function getAutomationStoreState(): AutomationStoreState | null {
    return automationStore.value;
}
