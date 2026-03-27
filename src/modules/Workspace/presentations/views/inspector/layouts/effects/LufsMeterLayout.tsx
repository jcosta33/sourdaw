import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { LUFSMeter } from '../../../metering/LUFSMeter';

const LufsMeterLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Loudness" />
                <div className="flex justify-center">
                    <LUFSMeter target={pv['lufs-target'] ?? -14} width={48} height={160} />
                </div>
            </div>
            <div>
                <SectionHeader title="Settings" />
                <ParamGrid params={parameters} device={device} trackId={trackId} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-lufs-meter'], LufsMeterLayout);
