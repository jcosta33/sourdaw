import { type ReactElement, useSyncExternalStore } from 'react';
import { Fader } from '#/components/daw/Fader';
import { cn } from '#/helpers/Styles/cn';
import { setMasterGain } from '#/modules/Transport/useCases/setMasterGain';
import { transportStore } from '#/modules/Transport/stores/transportStore';

import { LevelMeter } from '../metering/LevelMeter';

type MasterChannelStripProps = {
    widthClass: string;
};

export const MasterChannelStrip = ({ widthClass }: MasterChannelStripProps): ReactElement => {
    const masterGain = useSyncExternalStore(
        (cb) => transportStore.subscribe(cb),
        () => transportStore.value?.masterGain ?? 80
    );

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

            <div className="flex gap-1 items-end justify-center shrink-0 mt-1">
                <LevelMeter trackId={null} width="w-1.5" />
            </div>

            <div className="shrink-0">
                <Fader
                    value={masterGain / 100}
                    onChange={(v) => {
                        setMasterGain(v * 100);
                    }}
                    height={100}
                    aria-label="Master gain"
                />
            </div>

            <span className="text-[10px] font-mono text-text-secondary mt-1">
                {masterGain === 0 ? '-∞' : `${((masterGain / 80 - 1) * 12).toFixed(1)} dB`}
            </span>
        </div>
    );
};
