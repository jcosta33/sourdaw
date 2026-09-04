// Setlist/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { addSetlistItem } from './setlist/addSetlistItem';
export { getCurrentItem } from './setlist/getCurrentItem';
export { getRemainingDuration } from './setlist/getRemainingDuration';
export { getSetlistProgress } from './setlist/getSetlistProgress';
export { goToItem } from './setlist/goToItem';
export { setSetlistEventBus } from './setlist/setSetlistEventBus';
export { startSetlistItemEndObserver } from './setlist/startSetlistItemEndObserver';
export { nextItem } from './setlist/nextItem';
export { previousItem } from './setlist/previousItem';
export { removeSetlistItem } from './setlist/removeSetlistItem';
export { renameSetlist } from './setlist/renameSetlist';
export { reorderSetlistItems } from './setlist/reorderSetlistItems';
export { setCountIn } from './setlist/setCountIn';
export { toggleAutoAdvance } from './setlist/toggleAutoAdvance';
export { updateSetlistItem } from './setlist/updateSetlistItem';

export { getSetlistHandlers } from './getSetlistHandlers';
