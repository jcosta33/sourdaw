import { setlistStore } from '#/modules/Transport/stores/setlistStore';

/**
 * Navigate to a specific setlist item by index.
 *
 * Note: DOM CustomEvent dispatch for MIDI program change is part of the
 * codebase-wide `sourdaw:*` notification system. Deferred to the EventBus
 * migration sprint (see also zoomOperations.ts, scripting.ts).
 */
export function goToItem(index: number): void {
    const state = setlistStore.value;
    if (!state || index < 0 || index >= state.items.length) {
        return;
    }

    setlistStore.set({ ...state, currentIndex: index });

    const item = state.items[index];
    if (!item) {
        return;
    }

    // Dispatch program change if configured
    if (item.programChange) {
        document.dispatchEvent(
            new CustomEvent('sourdaw:midi-out', {
                detail: {
                    type: 'programChange',
                    channel: item.programChange.channel,
                    program: item.programChange.program,
                },
            })
        );
    }
}
