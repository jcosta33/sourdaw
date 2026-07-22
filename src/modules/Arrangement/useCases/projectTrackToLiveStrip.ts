import {
    addDeviceToStrip,
    ensureTrackStrip,
    setTrackGain,
    setTrackMute,
    setTrackOutput,
    setTrackPan,
    updateDeviceBypass,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { setSend, wireSidechainRoutes } from '#/modules/Routing/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { applySoloLogic } from '../services/applySoloLogic';
import { resolveEligibleDeviceWriteTarget } from '../stores/resolveEligibleDeviceWriteTarget';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../stores/trackEligibility';
import { trackStore } from '../stores/trackStore';

import type { Track } from '../stores/trackStore';

type ProjectTrackToLiveStripInput = {
    trackId: string;
    deferSidechainWiring?: boolean;
};

function findUniqueTrack(tracks: readonly Track[], trackId: string): Track | null {
    const matches = tracks.filter((track) => track.id === trackId);
    if (matches.length !== 1) {
        return null;
    }
    return matches[0] ?? null;
}

function acceptsRoutingEndpoint(tracks: readonly Track[], targetId: string): boolean {
    const matches = tracks.filter((track) => track.id === targetId);
    if (matches.length === 0) {
        return true;
    }
    if (matches.length !== 1) {
        return false;
    }
    const target = matches[0];
    return target ? getTrackEligibility(target.kind).acceptsRoutingEndpoint : false;
}

function projectSoloAudibility(tracks: readonly Track[], track: Track): void {
    const liveStripTrackIds = new Set(
        tracks
            .filter(
                (candidate) =>
                    findUniqueTrack(tracks, candidate.id) === candidate && shouldCreateLiveTrackStrip(candidate)
            )
            .map((candidate) => candidate.id)
    );
    const result = applySoloLogic({
        tracks,
        soloMode: workspaceStore.value?.soloMode ?? 'sip',
        savedGains: new Map(),
        liveStripTrackIds,
    });
    let muteProjected = false;
    for (const action of result.actions) {
        if (action.trackId !== track.id) {
            continue;
        }
        if (action.type === 'setGain') {
            setTrackGain(action.trackId, action.gain);
            continue;
        }
        setTrackMute(action.trackId, action.muted);
        muteProjected = true;
    }
    if (!muteProjected) {
        setTrackMute(track.id, track.muted);
    }
}

export function projectTrackToLiveStrip({ trackId, deferSidechainWiring = false }: ProjectTrackToLiveStripInput): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }
    const track = findUniqueTrack(tracks, trackId);
    if (!track || !shouldCreateLiveTrackStrip(track)) {
        return;
    }

    ensureTrackStrip(track.id);
    if (acceptsRoutingEndpoint(tracks, track.outputId)) {
        setTrackOutput(track.id, track.outputId);
    }
    setTrackGain(track.id, track.gain);
    setTrackPan(track.id, track.pan);
    projectSoloAudibility(tracks, track);

    for (const device of track.devices) {
        const target = resolveEligibleDeviceWriteTarget(device.id);
        if (target.status !== 'eligible' || target.trackId !== track.id) {
            continue;
        }
        addDeviceToStrip(target.trackId, target.deviceId, device.type);
        for (const [parameterId, value] of Object.entries(device.parameterValues)) {
            if (typeof value === 'number') {
                updateDeviceParam(target.trackId, target.deviceId, parameterId, value);
            }
        }
        updateDeviceBypass(target.trackId, target.deviceId, device.bypassed);
    }

    for (const send of track.sends) {
        if (acceptsRoutingEndpoint(tracks, send.busId)) {
            setSend(track.id, send.busId, send.level, send.preFader);
        }
    }
    if (!deferSidechainWiring) {
        wireSidechainRoutes();
    }
}
