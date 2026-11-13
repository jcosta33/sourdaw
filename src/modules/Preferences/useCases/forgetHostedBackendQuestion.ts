import { defaultPreferences } from '../models/Preferences';
import { preferencesStore } from '../stores/preferencesStore';

import { updatePreferences } from './updatePreferences';

/**
 * Forgets that a provider was asked about, after the user selected it. The backend selection lasts
 * one session and starts at Automatic again, so the next save asks again instead of leaving the user
 * on Automatic without a word.
 */
export function forgetHostedBackendQuestion(identity: string): void {
    const asked = (preferencesStore.value ?? defaultPreferences).hostedBackendQuestionAsked;
    if (!asked.includes(identity)) {
        return;
    }
    updatePreferences({ patch: { hostedBackendQuestionAsked: asked.filter((entry) => entry !== identity) } });
}
