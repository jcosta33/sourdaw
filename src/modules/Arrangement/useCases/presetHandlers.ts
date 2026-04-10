import { saveCurrentAsPreset, getUserPresets } from './preset/presetStorage';
import { loadPresetToTrack, createTrackFromPreset } from './preset/presetLoading';
import { getTrackStoreState } from './getTrackStoreState';
import { type SoundPresetCategory } from '../models/SoundPreset';

type PresetAction =
    | { type: 'loadPreset'; payload: { presetId: string; trackId?: string } }
    | { type: 'savePreset'; payload: { trackId: string; name: string; category: string } };

type PresetHandlerResult = {
    label: string;
};

type PresetHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => PresetHandlerResult;
    undoable: boolean;
};

type PresetHandlers = {
    [ActionType in PresetAction['type']]: PresetHandler<Extract<PresetAction, { type: ActionType }>>;
};

function findPresetById(presetId: string) {
    return getUserPresets().find((p) => p.id === presetId) ?? null;
}

export const presetHandlers: PresetHandlers = {
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
            const label = preset ? `Load preset "${preset.name}"` : `Load preset ${a.payload.presetId}`;
            return { label };
        },
        undoable: true,
    },

    savePreset: {
        execute: (a) => {
            const state = getTrackStoreState();
            const track = state?.tracks.find((t) => t.id === a.payload.trackId);
            if (!track) {
                return;
            }
            saveCurrentAsPreset({
                name: a.payload.name,
                category: a.payload.category as SoundPresetCategory,
                trackKind: track.kind === 'midi' ? 'midi' : 'audio',
                devices: track.devices.map((d) => ({
                    type: d.type,
                    name: d.name,
                    parameterValues: d.parameterValues,
                })),
            });
        },
        describe: (a) => {
            const track = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
            return { label: `Save preset "${a.payload.name}" from ${track?.name ?? 'track'}` };
        },
        undoable: false,
    },
};
