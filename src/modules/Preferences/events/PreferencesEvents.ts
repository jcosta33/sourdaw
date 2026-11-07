import { type Preferences } from '../models/Preferences';

/** A section of the Preferences dialog that a caller can ask it to open on. */
export type PreferencesSection =
    'general' | 'appearance' | 'layout' | 'audio' | 'midi' | 'performance' | 'ai' | 'shortcuts';

export type SoloModePreferenceAppliedPayload = { readonly soloMode: Preferences['soloMode'] };
