import { setTrackGain, setTrackMute, setTrackSoloGate } from '#/modules/AudioEngine/useCases';
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
        state.tracks
            .filter(
                (track) =>
                    shouldCreateLiveTrackStrip(track) &&
                    state.tracks.filter((candidate) => candidate.id === track.id).length === 1
            )
            .map((track) => track.id)
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

    // FX-8 — the mute actions above cannot carry solo-in-place on their own. They
    // land on `postFaderGain`, which is downstream of the pre-fader send tap, so a
    // track solo had "muted" went on feeding its pre-fader sends into the return
    // buses — a solo that still played the reverb of everything it was isolating.
    // The gate closes the pre-fader tap instead, and is applied to every strip
    // track (not just the gated ones) so releasing a solo reopens the tap.
    if (applyActions) {
        for (const stripTrackId of liveStripTrackIds) {
            if (trackId && stripTrackId !== trackId) {
                continue;
            }
            setTrackSoloGate(stripTrackId, result.soloGatedTrackIds.has(stripTrackId));
        }
    }

    savedGains = new Map(result.savedGains);
}
