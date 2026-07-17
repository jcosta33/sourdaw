// Re-export preference constants from the model so the useCases contract barrel
// can expose them without importing models directly (arch rule
// `no-models-repos-transformers-in-index`). The single source of truth lives in
// models/Preferences.ts.
export { defaultPreferences, TRACK_HEIGHT_VALUES } from '../models/Preferences';
