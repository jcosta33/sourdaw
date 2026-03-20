import { type ReactElement, useSyncExternalStore } from 'react';
import { Fader } from '#/components/daw/Fader';
import { cn } from '#/helpers/Styles/cn';
import { setMasterGainValue } from '../../../useCases/workspaceViewActions';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { useMeterLevel } from '../../hooks/useMeterLevel';
import { LevelMeter } from '../../components/LevelMeter';

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
                'flex shrink-0 flex-col items-center gap-1.5 rounded-lg bg-surface-recess px-2 py-2 ml-2 border-l-2 border-border-soft shadow-[0_1px_2px_rgba(0,0,0,0.4)]',
                widthClass
            )}
            role="group"
            aria-label="Master channel"
        >
            <div className="h-1 w-full rounded-full bg-border-active" />
            <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider">Master</span>

            <div className="flex gap-2 h-40 mt-1 mb-1 items-end justify-center w-full">
                <Fader
                    value={masterGain / 100}
                    onChange={(v) => {
                        setMasterGain(v * 100);
                    }}
                    aria-label="Master gain"
                />
                <LevelMeter peak={peak} rms={rms} peakHold={peakHold} width="w-2.5" />
            </div>

            <span className="text-[10px] font-mono text-text-secondary mt-1">
                {masterGain === 0 ? '-∞' : `${((masterGain / 80 - 1) * 12).toFixed(1)} dB`}
            </span>

        </div>
    );
};
