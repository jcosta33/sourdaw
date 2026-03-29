import { type ReactElement, useSyncExternalStore } from 'react';
import { Slider } from '#/components/ui/slider';
import { kneadStore, updateTrackKneadState } from '#/modules/Knead/stores/kneadStore';

export const KneadControls = ({ trackId }: { trackId: string }): ReactElement => {
    const kneadState = useSyncExternalStore(
        (cb) => kneadStore.subscribe(() => cb()),
        () => kneadStore.value?.tracks[trackId],
        () => kneadStore.value?.tracks[trackId]
    );

    if (!kneadState) {
        return (
            <div className="p-4 text-xs text-muted-foreground">
                Knead engine not initialized for track.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 p-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold tracking-tight">Pitch Correction</h3>
            </div>
            
            <div className="space-y-3">
                <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-medium leading-none">Retune Speed</span>
                        <span className="text-[10px] text-muted-foreground">{kneadState.retuneSpeedMs} ms</span>
                    </div>
                    <Slider 
                        value={[kneadState.retuneSpeedMs]} 
                        min={0} max={200} step={1}
                        onValueChange={([val]) => updateTrackKneadState(trackId, s => ({ ...s, retuneSpeedMs: val ?? 25 }))}
                    />
                </div>

                <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-medium leading-none">Humanize</span>
                        <span className="text-[10px] text-muted-foreground">{kneadState.humanizePercent}%</span>
                    </div>
                    <Slider 
                        value={[kneadState.humanizePercent]} 
                        min={0} max={100} step={1}
                        onValueChange={([val]) => updateTrackKneadState(trackId, s => ({ ...s, humanizePercent: val ?? 40 }))}
                    />
                </div>

                <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-medium leading-none">Tolerance</span>
                        <span className="text-[10px] text-muted-foreground">{kneadState.toleranceCents} ct</span>
                    </div>
                    <Slider 
                        value={[kneadState.toleranceCents]} 
                        min={0} max={100} step={1}
                        onValueChange={([val]) => updateTrackKneadState(trackId, s => ({ ...s, toleranceCents: val ?? 25 }))}
                    />
                </div>

                <div className="flex items-center justify-between pt-2">
                    <span className="text-xs font-medium leading-none">Preserve Formants</span>
                    <input 
                        type="checkbox"
                        checked={kneadState.formantPreserve}
                        onChange={(e) => updateTrackKneadState(trackId, s => ({ ...s, formantPreserve: e.target.checked }))}
                        className="cursor-pointer"
                    />
                </div>
            </div>
        </div>
    );
};
