import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { DelayTaps } from '../../../../components/DelayTaps';

const DelayLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Tap Pattern" />
                <div className="flex justify-center">
                    <DelayTaps
                        time={pv['delay-time'] ?? 250}
                        feedback={pv['delay-feedback'] ?? 0.4}
                        mix={pv['delay-mix'] ?? 0.3}
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="Timing" />
                <ParamGrid params={filterParams(parameters, ['delay-time', 'delay-mix'])} device={device} trackId={trackId} />
            </div>
            <div>
                <SectionHeader title="Character" />
                <ParamGrid params={filterParams(parameters, ['delay-feedback', 'delay-lowcut', 'delay-highcut'])} device={device} trackId={trackId} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-delay'], DelayLayout);
