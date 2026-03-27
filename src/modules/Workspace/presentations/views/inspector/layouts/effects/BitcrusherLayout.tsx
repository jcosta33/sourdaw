import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { BitcrusherStaircase } from '../../../../components/BitcrusherStaircase';

const BitcrusherLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Quantization" />
                <div className="flex justify-center">
                    <BitcrusherStaircase
                        bits={pv['crush-bits'] ?? 8}
                        rateReduction={pv['crush-rate'] ?? 1}
                        mix={pv['crush-mix'] ?? 0.5}
                        width={180}
                        height={80}
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="Crush" />
                <ParamGrid params={filterParams(parameters, ['crush-bits', 'crush-rate'])} device={device} trackId={trackId} />
            </div>
            <div>
                <SectionHeader title="Mix" />
                <ParamGrid params={filterParams(parameters, ['crush-mix'])} device={device} trackId={trackId} cols={1} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-bitcrusher'], BitcrusherLayout);
