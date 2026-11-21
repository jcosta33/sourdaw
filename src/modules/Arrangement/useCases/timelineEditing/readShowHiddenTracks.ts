import { timelineEditingStore } from '../../stores/timelineEditingStore';

export function readShowHiddenTracks(): boolean {
    return timelineEditingStore.value?.showHiddenTracks ?? false;
}
