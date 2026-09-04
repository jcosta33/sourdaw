// Preferences/useCases — public contract surface for cross-module preference operations.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { updatePreferences } from './updatePreferences';
export { resetPreferences } from './resetPreferences';
export { setTrackHeight } from './setTrackHeight';
export { setTimelineMinimapHeight } from './setTimelineMinimapHeight';
export { gridSnapBeats } from './gridSnapBeats';
export { normalizeUiScale } from './normalizeUiScale';
export { defaultPreferences, TRACK_HEIGHT_VALUES } from './preferencesDefaults';
