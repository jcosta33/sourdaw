import { isDesktopRuntime } from '#/utils/desktopBridge';

import { voiceInputAvailabilityStore } from '../../stores/voiceInputAvailabilityStore';

export function isNativeVoiceInputAvailable(): boolean {
    return isDesktopRuntime() && voiceInputAvailabilityStore.value?.hasVerifiedLocalModel === true;
}
