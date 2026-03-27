import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { DistortionCurve } from '../../../../components/DistortionCurve';

const DistortionLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Transfer Curve" />
                <div className="flex justify-center">
                    <DistortionCurve
                        drive={pv['dist-drive'] ?? 20}
                        tone={pv['dist-tone'] ?? 4000}
                        mix={pv['dist-mix'] ?? 0.5}
                        width={180}
                        height={120}
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="Drive" />
                <ParamGrid params={filterParams(parameters, ['dist-drive', 'dist-tone'])} device={device} trackId={trackId} />
            </div>
            <div>
                <SectionHeader title="Output" />
                <ParamGrid params={filterParams(parameters, ['dist-output', 'dist-mix'])} device={device} trackId={trackId} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-distortion'], DistortionLayout);
