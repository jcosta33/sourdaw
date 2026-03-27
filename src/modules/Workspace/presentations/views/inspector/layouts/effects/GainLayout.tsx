import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';

const GainLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => (
    <div className="space-y-3">
        <div>
            <SectionHeader title="Utility" />
            <ParamGrid params={parameters} device={device} trackId={trackId} cols={1} />
        </div>
    </div>
);

registerDeviceLayout(['builtin-gain'], GainLayout);
