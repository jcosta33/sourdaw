import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { FilterResponse } from '../../../../components/FilterResponse';

const FilterLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Frequency Response" />
                <div className="flex justify-center">
                    <FilterResponse
                        cutoff={pv['filter-cutoff'] ?? 1000}
                        resonance={pv['filter-resonance'] ?? 1}
                        filterType={pv['filter-type'] ?? 0}
                        width={180}
                        height={80}
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="Filter" />
                <ParamGrid params={filterParams(parameters, ['filter-type'])} device={device} trackId={trackId} cols={1} />
            </div>
            <div>
                <SectionHeader title="Shape" />
                <ParamGrid params={filterParams(parameters, ['filter-cutoff', 'filter-resonance'])} device={device} trackId={trackId} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-filter'], FilterLayout);
