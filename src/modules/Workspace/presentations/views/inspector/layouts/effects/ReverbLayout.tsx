import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { ReverbDecay } from '../../../../components/ReverbDecay';

const ReverbLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Decay Envelope" />
                <div className="flex justify-center">
                    <ReverbDecay
                        size={pv['rev-size'] ?? 0.5}
                        decay={pv['rev-decay'] ?? 2}
                        damping={pv['rev-damping'] ?? 0.5}
                        predelay={pv['rev-predelay'] ?? 10}
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="Space" />
                <ParamGrid params={filterParams(parameters, ['rev-size', 'rev-decay', 'rev-predelay'])} device={device} trackId={trackId} />
            </div>
            <div>
                <SectionHeader title="Color" />
                <ParamGrid params={filterParams(parameters, ['rev-damping', 'rev-lowcut', 'rev-mix'])} device={device} trackId={trackId} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-reverb'], ReverbLayout);
