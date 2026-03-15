import { trackStore } from "#/modules/Track/stores/trackStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import type { ProjectContext } from "../models/ProjectContext";

export const getProjectContext = (): ProjectContext => {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;

    return {
        tempo: transportState?.tempo ?? 120,
        timeSignature: [
            transportState?.timeSignatureNumerator ?? 4,
            transportState?.timeSignatureDenominator ?? 4,
        ],
        tracks: (trackState?.tracks ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            muted: t.muted,
            soloed: t.soloed,
        })),
        selectedTrackId: trackState?.selectedTrackId ?? null,
        selectedClipId: null,
        activeView: workspaceState?.mode ?? "arrange",
        playheadPosition: transportState?.playheadPosition ?? 0,
    };
};
