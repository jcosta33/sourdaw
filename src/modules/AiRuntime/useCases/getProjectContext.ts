import { trackStore } from "#/modules/Track/stores/trackStore";
import { midiStore } from "#/modules/Track/stores/midiStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import type { ProjectContext } from "../models/ProjectContext";

export const getProjectContext = (): ProjectContext => {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;

    const selectedTrackId = trackState?.selectedTrackId ?? null;
    const selectedClipId = workspaceState?.selectedClipId ?? null;
    const selectedClipIds = workspaceState?.selectedClipIds ?? [];

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
            armed: t.armed,
            gain: t.gain,
            pan: t.pan,
            clipCount: t.clips.length,
            deviceCount: t.devices.length,
            clips: t.clips.map((c) => ({
                id: c.id,
                name: c.name,
                type: (c.type ?? "audio") as "audio" | "midi",
                startBeat: c.startBeat,
                endBeat: c.endBeat,
                noteCount: c.type === "midi" ? (midiStore.value?.notesByClipId[c.id]?.length ?? 0) : 0,
            })),
            devices: t.devices.map((d) => ({
                id: d.id,
                type: d.type,
                bypassed: d.bypassed,
            })),
        })),
        selectedTrackId,
        selectedClipId,
        selectedClipIds,
        activeView: workspaceState?.mode ?? "arrange",
        playheadPosition: transportState?.playheadPosition ?? 0,
    };
};
