/**
 * Cross-module automation state accessors.
 *
 * Note: automationStore is a business-layer store (contract folder) —
 * cross-module reads are architecturally valid per architecture.md.
 */

import { automationStore } from '#/modules/Automation/stores/automationStore';
import { type AutomationLane } from '#/modules/Automation/models/Automation';

/** Get all automation lanes. */
export function getAutomationLanes(): AutomationLane[] {
    return automationStore.value?.lanes ?? [];
}

/** Get the full automation store state snapshot. */
export function getAutomationStoreState(): typeof automationStore.value {
    return automationStore.value;
}
