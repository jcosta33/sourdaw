import { createStore } from '#/infra/store/createStore';

export type VoiceInputAvailability = {
    hasVerifiedLocalModel: boolean;
};

export const voiceInputAvailabilityStore = createStore<VoiceInputAvailability>({
    initialData: { hasVerifiedLocalModel: false },
});
