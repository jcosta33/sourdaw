import { useState } from 'react';

import { useStore } from '#/infra/store/useStore';
import { isEngineAudioAvailable } from '#/modules/AudioEngine/useCases';

import { engineFallbackNoticeStore } from '../../stores/engineFallbackNoticeStore';
import { dismissEngineFallbackNotice } from '../../useCases/dismissEngineFallbackNotice';

export type EngineFallbackNoticeState = {
    showNotice: boolean;
    dismissNotice: () => void;
};

/**
 * Whether the shell should show the engine-fallback banner, and how to dismiss it.
 *
 * The engine singleton decides fallback mode once, at module load, and never
 * clears it for the rest of the page (issue #3871), so one read at mount is
 * this session's whole truth — there is nothing to subscribe to.
 */
export function useEngineFallbackNotice(): EngineFallbackNoticeState {
    const [engineAvailable] = useState(isEngineAudioAvailable);
    const dismissed = useStore(engineFallbackNoticeStore);

    return {
        showNotice: !engineAvailable && !dismissed,
        dismissNotice: dismissEngineFallbackNotice,
    };
}
