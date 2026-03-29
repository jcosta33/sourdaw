import { type ReactElement, useSyncExternalStore } from 'react';
import { Label } from '#/components/ui/label';
import { Slider } from '#/components/ui/slider';
import { Switch } from '#/components/ui/switch';
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
                        <Label className="text-xs">Retune Speed</Label>
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
                        <Label className="text-xs">Humanize</Label>
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
                        <Label className="text-xs">Tolerance</Label>
                        <span className="text-[10px] text-muted-foreground">{kneadState.toleranceCents} ct</span>
                    </div>
                    <Slider 
                        value={[kneadState.toleranceCents]} 
                        min={0} max={100} step={1}
                        onValueChange={([val]) => updateTrackKneadState(trackId, s => ({ ...s, toleranceCents: val ?? 25 }))}
                    />
                </div>

                <div className="flex items-center justify-between pt-2">
                    <Label className="text-xs">Preserve Formants</Label>
                    <Switch 
                        checked={kneadState.formantPreserve}
                        onCheckedChange={(val: boolean) => updateTrackKneadState(trackId, s => ({ ...s, formantPreserve: val }))}
                    />
                </div>
            </div>
        </div>
    );
};
