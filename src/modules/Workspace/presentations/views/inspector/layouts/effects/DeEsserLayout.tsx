import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { FilterResponse } from '../../../../components/FilterResponse';

const DeEsserLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Sibilance Band" />
                <div className="flex justify-center">
                    <FilterResponse
                        cutoff={pv['deess-freq'] ?? 6000}
                        resonance={4}
                        filterType={2}
                        width={180}
                        height={60}
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="Detection" />
                <ParamGrid params={filterParams(parameters, ['deess-threshold', 'deess-freq'])} device={device} trackId={trackId} />
            </div>
            <div>
                <SectionHeader title="Reduction" />
                <ParamGrid params={filterParams(parameters, ['deess-range', 'deess-listen'])} device={device} trackId={trackId} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-deesser'], DeEsserLayout);
