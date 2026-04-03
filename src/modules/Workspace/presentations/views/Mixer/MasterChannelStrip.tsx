import { type ReactElement, useSyncExternalStore } from 'react';
import { DawChannelStripShell } from '#/components/daw/DawChannelStripShell';
import { Fader } from '#/components/daw/Fader';
import { cn } from '#/helpers/Styles/cn';
import { setMasterGain } from '#/modules/Transport/useCases/setMasterGain';
import { transportStore } from '#/modules/Transport/stores/transportStore';

import { LevelMeter } from '../Metering/LevelMeter';

type MasterChannelStripProps = {
    widthClass: string;
};

export const MasterChannelStrip = ({ widthClass }: MasterChannelStripProps): ReactElement => {
    const masterGain = useSyncExternalStore(
        (cb) => transportStore.subscribe(cb),
        () => transportStore.value?.masterGain ?? 80
    );

    return (
        <DawChannelStripShell className={cn('ml-2', widthClass)} aria-label="Master channel">
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
        </DawChannelStripShell>
    );
};
