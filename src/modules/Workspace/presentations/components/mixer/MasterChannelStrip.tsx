import { type ReactElement, useSyncExternalStore } from 'react';
import { Slider } from '#/components/ui/slider';
import { cn } from '#/helpers/Styles/cn';
import { setMasterGainValue } from '../../../useCases/workspaceViewActions';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { useMeterLevel } from '../../hooks/useMeterLevel';
import { LevelMeter } from '../LevelMeter';

export type MasterChannelStripProps = {
    widthClass: string;
};

export const MasterChannelStrip = ({ widthClass }: MasterChannelStripProps): ReactElement => {
    const masterGain = useSyncExternalStore(
        (cb) => transportStore.subscribe(cb),
        () => transportStore.value?.masterGain ?? 80
    );
    const { peak, rms, peakHold } = useMeterLevel(null);

    const setMasterGain = (v: number) => {
        const state = transportStore.value;
        if (state) {
            transportStore.set({ ...state, masterGain: v });
        }
        setMasterGainValue(v / 100);
    };

    return (
        <div
            className={cn(
                'flex shrink-0 flex-col items-center gap-1.5 rounded-lg bg-surface-overlay px-2 py-2 ml-2 border-l-2 border-foreground/10',
                widthClass
            )}
            role="group"
            aria-label="Master channel"
        >
            <div className="h-1 w-full rounded-full bg-foreground/30" />
            <span className="text-[10px] font-bold text-foreground">Master</span>

            <div className="flex gap-2 h-32 mt-1 mb-1 items-end justify-center w-full">
                <Slider
                    orientation="vertical"
                    value={[masterGain]}
                    onValueChange={([v]) => {
                        if (v !== undefined) {
                            setMasterGain(v);
                        }
                    }}
                    max={100}
                    step={1}
                    className="h-full w-full"
                    aria-label="Master gain"
                    title="Master Gain"
                />
                <LevelMeter peak={peak} rms={rms} peakHold={peakHold} width="w-2" />
            </div>

            <span className="text-[8px] font-mono text-muted-foreground">
                {masterGain === 0 ? '-∞' : `${((masterGain / 80 - 1) * 12).toFixed(1)} dB`}
            </span>
        </div>
    );
};
