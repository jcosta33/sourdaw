import { automationStore, sanitize_automation_store_state } from '../stores/automationStore';

export function restoreAutomationSnapshot(snapshot: unknown): void {
    automationStore.set(sanitize_automation_store_state(snapshot));
}
