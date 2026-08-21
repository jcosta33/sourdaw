import { type ReactElement } from 'react';

import { DawChannelStripShell } from '#/components/daw/DawChannelStripShell';
import { Fader } from '#/components/daw/Fader';
import { useStore } from '#/infra/store/useStore';
import { transportStore } from '#/modules/Transport/stores';
import { setMasterGain, defaultTransportState } from '#/modules/Transport/useCases';
import { FADER_MAX_GAIN, formatGainDb } from '#/utils/audioLevelLaw';
import { cn } from '#/utils/Styles/cn';

import { MixerLevelReadout } from './MixerLevelReadout';

type MasterChannelStripProps = {
    widthClass: string;
};

export const MasterChannelStrip = ({ widthClass }: MasterChannelStripProps): ReactElement => {
    const masterGain = useStore(transportStore, defaultTransportState).masterGain;

    return (
        <DawChannelStripShell
            className={cn('ml-2', widthClass)}
            aria-label="Master channel"
            data-testid="channel-master"
        >
            <div className="h-1 w-full rounded-full bg-border-active" />
            <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider">Master</span>
            <MixerLevelReadout
                trackId={null}
                clusterClassName="mt-1"
                control={
                    <div className="shrink-0" data-testid="master-gain">
                        <Fader
                            value={masterGain / 100}
                            onChange={(value) => {
                                setMasterGain(value * 100);
                            }}
                            min={0}
                            max={FADER_MAX_GAIN}
                            step={0.01}
                            fineStep={0.001}
                            defaultValue={defaultTransportState.masterGain / 100}
                            height={100}
                            aria-label="Master gain"
                        />
                    </div>
                }
                value={`${formatGainDb(masterGain / 100)} dB`}
            />
        </DawChannelStripShell>
    );
};
