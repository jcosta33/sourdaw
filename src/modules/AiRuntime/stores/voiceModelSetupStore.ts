/**
 * voiceModelSetupStore — where the consented Whisper model setup stands, for
 * the enable-voice affordance.
 *
 * Session-only shared runtime state owned by AiRuntime. Written by
 * `initializeVoiceInputAvailability` (a failed startup cache load on the
 * desktop runtime marks the model `missing`, and the failure is retryable
 * through the download flow) and by `downloadWhisperModel` (`downloading`,
 * then `ready` or a retryable `error`). A successful startup cache load
 * leaves this store untouched: readiness is already published through
 * `voiceInputAvailabilityStore`, and this store carries meaning only while
 * that availability is false. Off the desktop runtime nothing writes here
 * and the affordance never renders.
 */

import { createStore } from '#/infra/store/createStore';

export type VoiceModelSetupStatus =
    | { state: 'missing' }
    | { state: 'downloading'; progress: number }
    | { state: 'error'; message: string }
    | { state: 'ready' };

export const voiceModelSetupStore = createStore<VoiceModelSetupStatus>({
    initialData: { state: 'missing' },
});
