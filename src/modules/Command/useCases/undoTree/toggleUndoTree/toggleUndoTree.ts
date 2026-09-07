import { undoStore } from '../../../stores/undoStore';
import { undoTreeStore } from '../../../stores/undoTree';
import { rebuildTreeFromPast } from '../rebuildTreeFromPast';

export function toggleUndoTree(): void {
    const state = undoTreeStore.value;
    if (!state) {
        return;
    }
    const nextEnabled = !state.enabled;
    // Only rebuild on the false→true transition. Disabling leaves the tree intact so it
    // is preserved if re-enabled without intervening edits; re-enabling always re-derives
    // from the authoritative `past` stack rather than trusting a possibly-stale tree.
    const nextTree = nextEnabled ? rebuildTreeFromPast(undoStore.value?.past ?? []) : state.tree;
    undoTreeStore.set({ ...state, enabled: nextEnabled, tree: nextTree });
}
