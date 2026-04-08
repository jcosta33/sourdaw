import { type ReactElement } from 'react';
import { useStore } from '#/infra/store/useStore';
import { DawChannelStripShell } from '#/components/daw/DawChannelStripShell';
import { Fader } from '#/components/daw/Fader';
import { cn } from '#/helpers/Styles/cn';
import { setMasterGain, transportStore, defaultTransportState } from '#/modules/Transport';

import { MixerLevelReadout } from './MixerLevelReadout';

type MasterChannelStripProps = {
    widthClass: string;
};

export const MasterChannelStrip = ({ widthClass }: MasterChannelStripProps): ReactElement => {
    const masterGain = useStore(transportStore, defaultTransportState).masterGain;

    return (
        <DawChannelStripShell className={cn('ml-2', widthClass)} aria-label="Master channel">
            <div className="h-1 w-full rounded-full bg-border-active" />
            <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider">Master</span>

            <MixerLevelReadout
                trackId={null}
                clusterClassName="mt-1"
                control={
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
                }
                value={masterGain === 0 ? '-∞' : `${((masterGain / 80 - 1) * 12).toFixed(1)} dB`}
            />
        </DawChannelStripShell>
    );
};
