import { type PendingAppActionConfirmation, pendingActionConfirmationStore } from '../pendingActionConfirmationStore';

export function replacePendingActionConfirmationForTest(
    replacement: PendingAppActionConfirmation
): PendingAppActionConfirmation {
    const state = pendingActionConfirmationStore.value;
    if (!state || !state.confirmations.some((confirmation) => confirmation.id === replacement.id)) {
        throw new Error(`Expected stored pending confirmation ${replacement.id}`);
    }

    const storedReplacement = structuredClone(replacement);
    pendingActionConfirmationStore.set({
        confirmations: state.confirmations.map((confirmation) =>
            confirmation.id === replacement.id ? storedReplacement : confirmation
        ),
    });
    return structuredClone(storedReplacement);
}
