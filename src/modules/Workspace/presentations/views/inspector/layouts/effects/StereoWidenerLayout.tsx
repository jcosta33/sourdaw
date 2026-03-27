import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';

const StereoWidenerLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const widthAmount = pv['width-amount'] ?? 1;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Stereo Image" />
                <div className="flex justify-center">
                    <div className="relative w-[180px] h-[60px] rounded border border-border/30 bg-[var(--color-bg-tray)] overflow-hidden">
                        <div
                            className="absolute top-0 h-full bg-[var(--color-accent-teal)]/10 transition-all duration-200"
                            style={{
                                left: `${50 - Math.min(50, (widthAmount / 3) * 50)}%`,
                                width: `${Math.min(100, (widthAmount / 3) * 100)}%`,
                            }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-full w-px bg-[var(--color-accent-teal)]/30" />
                        </div>
                        <div className="absolute bottom-1 left-1 text-[7px] text-muted-foreground font-mono">L</div>
                        <div className="absolute bottom-1 right-1 text-[7px] text-muted-foreground font-mono">R</div>
                        <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[8px] font-mono text-[var(--color-accent-teal)]">
                            {(widthAmount * 100).toFixed(0)}%
                        </div>
                    </div>
                </div>
            </div>
            <div>
                <SectionHeader title="Width" />
                <ParamGrid params={filterParams(parameters, ['width-amount'])} device={device} trackId={trackId} cols={1} />
            </div>
            <div>
                <SectionHeader title="Mid/Side Balance" />
                <ParamGrid params={filterParams(parameters, ['width-mid', 'width-side'])} device={device} trackId={trackId} />
            </div>
            <div>
                <SectionHeader title="Bass Control" />
                <ParamGrid params={filterParams(parameters, ['width-mono-bass'])} device={device} trackId={trackId} cols={1} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-stereo-widener'], StereoWidenerLayout);
