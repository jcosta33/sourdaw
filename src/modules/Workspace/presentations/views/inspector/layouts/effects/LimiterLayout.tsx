import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { CompressorCurve } from '../../../../components/CompressorCurve';

const LimiterLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Transfer Curve" />
                <div className="flex justify-center">
                    <CompressorCurve
                        threshold={pv['lim-threshold'] ?? -6}
                        ratio={20}
                        knee={1}
                        makeup={0}
                        width={180}
                        height={120}
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="Limiter" />
                <ParamGrid params={parameters} device={device} trackId={trackId} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-limiter'], LimiterLayout);
