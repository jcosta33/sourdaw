import { inject } from '#/infra/di/inject';
import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { saveCurrentAsPreset, getUserPresets } from '#/modules/Arrangement/useCases/preset/presetStorage';
import { loadPresetToTrack, createTrackFromPreset } from '#/modules/Arrangement/useCases/preset/presetLoading';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { type SoundPresetCategory } from '#/modules/Arrangement/models/SoundPreset';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

function findPresetById(presetId: string) {
    return getUserPresets().find((p) => p.id === presetId) ?? null;
}

export const executeLoadPreset = inject({ getUserPresets, loadPresetToTrack, createTrackFromPreset })(
    ({ getUserPresets, loadPresetToTrack, createTrackFromPreset }) =>
        function executeLoadPreset(a: Extract<AppAction, 'loadPreset'>): void {
            const preset = getUserPresets().find((p) => p.id === a.payload.presetId) ?? null;
            if (!preset) {
                return;
            }

            if (a.payload.trackId) {
                loadPresetToTrack(a.payload.trackId, preset);
            } else {
                createTrackFromPreset(preset);
            }
        }
);

export const executeSavePreset = inject({ getTrackStoreState, saveCurrentAsPreset })(
    ({ getTrackStoreState, saveCurrentAsPreset }) =>
        function executeSavePreset(a: Extract<AppAction, 'savePreset'>): void {
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
        }
);

export const presetHandlers = {
    loadPreset: {
        execute: executeLoadPreset,
        describe: (a) => {
            const preset = findPresetById(a.payload.presetId);
            const label = preset ? `Load preset "${preset.name}"` : `Load preset ${a.payload.presetId}`;
            return { label };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'loadPreset'>>,

    savePreset: {
        execute: executeSavePreset,
        describe: (a) => {
            const track = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
            return { label: `Save preset "${a.payload.name}" from ${track?.name ?? 'track'}` };
        },
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'savePreset'>>,
};
