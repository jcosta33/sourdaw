import { timelineEditingStore } from '../../stores/timelineEditingStore';

/** Session view flag: not saved into the project, no undo entry. */
export function setShowHiddenTracks(showHiddenTracks: boolean): void {
    const state = timelineEditingStore.value;
    if (!state || state.showHiddenTracks === showHiddenTracks) {
        return;
    }
    timelineEditingStore.set({ ...state, showHiddenTracks });
}
