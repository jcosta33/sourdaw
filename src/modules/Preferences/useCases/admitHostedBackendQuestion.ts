import {
    defaultPreferences,
    HOSTED_BACKEND_QUESTION_MAX_IDENTITIES,
    HOSTED_BACKEND_QUESTION_MAX_IDENTITY_LENGTH,
} from '../models/Preferences';
import { preferencesStore } from '../stores/preferencesStore';

import { updatePreferences } from './updatePreferences';

/**
 * Whether to ask, now, if a just-saved hosted provider should replace Automatic. A provider is asked
 * about once: its identity is recorded as the question is shown, so dismissing the question or
 * closing Settings counts as no. The oldest identity gives way when the list is full.
 */
export function admitHostedBackendQuestion(identity: string): boolean {
    const asked = (preferencesStore.value ?? defaultPreferences).hostedBackendQuestionAsked;
    if (asked.includes(identity)) {
        return false;
    }
    if (identity.length > HOSTED_BACKEND_QUESTION_MAX_IDENTITY_LENGTH) {
        return true;
    }
    updatePreferences({
        patch: { hostedBackendQuestionAsked: [...asked, identity].slice(-HOSTED_BACKEND_QUESTION_MAX_IDENTITIES) },
    });
    return true;
}
