import { setTrackGain, setTrackMute } from '#/modules/AudioEngine/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { applySoloLogic as calculateSoloLogic } from '../../services/applySoloLogic';
import { shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { getTrackStoreState } from '../getTrackStoreState';

let savedGains = new Map<string, number>();

type ApplySoloLogicUseCaseInput = {
    applyActions?: boolean;
    resetSavedGains?: boolean;
    trackId?: string;
};

export function applySoloLogic({
    applyActions = true,
    resetSavedGains = false,
    trackId,
}: ApplySoloLogicUseCaseInput = {}): void {
    if (resetSavedGains) {
        savedGains = new Map();
    }
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    const liveStripTrackIds = new Set(
        state.tracks.filter((track) => shouldCreateLiveTrackStrip(track)).map((track) => track.id)
    );
    const result = calculateSoloLogic({
        tracks: state.tracks,
        soloMode: workspaceStore.value?.soloMode ?? 'sip',
        savedGains,
        liveStripTrackIds,
    });

    for (const action of result.actions) {
        if (!applyActions || (trackId && action.trackId !== trackId)) {
            continue;
        }
        if (action.type === 'setGain') {
            setTrackGain(action.trackId, action.gain);
            continue;
        }

        setTrackMute(action.trackId, action.muted);
    }

    savedGains = new Map(result.savedGains);
}
