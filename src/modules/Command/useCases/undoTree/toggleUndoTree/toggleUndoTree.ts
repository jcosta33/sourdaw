import { undoStore } from '../../../stores/undoStore';
import { undoTreeStore } from '../../../stores/undoTree';
import { buildUndoTreeFromHistory } from '../buildUndoTreeFromHistory';

export function toggleUndoTree(): void {
    const state = undoTreeStore.value;
    if (!state) {
        return;
    }
    const nextEnabled = !state.enabled;
    // Only rebuild on the false→true transition. Disabling leaves the tree intact so it
    // is preserved if re-enabled without intervening edits; re-enabling always re-derives
    // from authoritative past+future rather than trusting a possibly-stale tree.
    const history = undoStore.value ?? { past: [], future: [] };
    const nextTree = nextEnabled ? buildUndoTreeFromHistory(history) : state.tree;
    undoTreeStore.set({ ...state, enabled: nextEnabled, tree: nextTree });
}
