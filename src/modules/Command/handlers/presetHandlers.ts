import type { ActionHandler } from "../models/ActionHandler";
import type { AppAction } from "../models/AppAction";
import {
    loadPresetToTrack,
    createTrackFromPreset,
    saveCurrentAsPreset,
    getUserPresets,
} from "#/modules/Track/useCases/presetUseCases";
import { trackStore } from "#/modules/Track/stores/trackStore";
import type { SoundPresetCategory } from "#/modules/Track/models/SoundPreset";

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

const findPresetById = (presetId: string) => {
    return getUserPresets().find((p) => p.id === presetId) ?? null;
};

export const presetHandlers = {
    loadPreset: {
        execute: (a) => {
            const preset = findPresetById(a.payload.presetId);
            if (!preset) {
                return;
            }

            if (a.payload.trackId) {
                loadPresetToTrack(a.payload.trackId, preset);
            } else {
                createTrackFromPreset(preset);
            }
        },
        describe: (a) => {
            const preset = findPresetById(a.payload.presetId);
            const label = preset
                ? `Load preset "${preset.name}"`
                : `Load preset ${a.payload.presetId}`;
            return { label };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "loadPreset">>,

    savePreset: {
        execute: (a) => {
            const state = trackStore.value;
            const track = state?.tracks.find((t) => t.id === a.payload.trackId);
            if (!track) {
                return;
            }
            saveCurrentAsPreset({
                name: a.payload.name,
                category: a.payload.category as SoundPresetCategory,
                trackKind: track.kind === "midi" ? "midi" : "audio",
                devices: track.devices.map((d) => ({
                    type: d.type,
                    name: d.name,
                    parameterValues: d.parameterValues,
                })),
            });
        },
        describe: (a) => {
            const track = trackStore.value?.tracks.find((t) => t.id === a.payload.trackId);
            return { label: `Save preset "${a.payload.name}" from ${track?.name ?? "track"}` };
        },
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "savePreset">>,
};
