import { type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { MixerStripValue } from '../../components/Mixer/MixerStripValue';
import { LevelMeter } from '../Metering/LevelMeter';

type MixerLevelReadoutProps = {
    trackId: string | null;
    control: ReactNode;
    value: ReactNode;
    clusterClassName?: string;
    valueSize?: 'sm' | 'md';
};

export const MixerLevelReadout = ({
    trackId,
    control,
    value,
    clusterClassName,
    valueSize = 'md',
}: MixerLevelReadoutProps): ReactElement => (
    <>
        <div className={cn('mt-2 flex shrink-0 flex-col items-center gap-1', clusterClassName)}>
            <div className="flex items-end justify-center">
                <LevelMeter trackId={trackId} width="w-1.5" />
            </div>
            {control}
        </div>
        <MixerStripValue size={valueSize}>{value}</MixerStripValue>
    </>
);
