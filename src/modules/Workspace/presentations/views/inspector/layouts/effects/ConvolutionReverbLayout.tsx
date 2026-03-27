import { type ReactElement } from 'react';
import {
    Home, Landmark, Church, Disc3, Waves,
    Music, Mic, SlidersHorizontal, Warehouse, ArrowRightLeft,
} from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { setDeviceParameter } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { LatchButton } from '#/components/daw/LatchButton';
import { LED } from '#/components/daw/LED';

type IRType = { label: string; icon: LucideIcon };

const IR_TYPES: IRType[] = [
    { label: 'Small Room', icon: Home },
    { label: 'Large Hall', icon: Landmark },
    { label: 'Cathedral', icon: Church },
    { label: 'Plate', icon: Disc3 },
    { label: 'Spring', icon: Waves },
    { label: 'Chamber', icon: Music },
    { label: 'Studio A', icon: Mic },
    { label: 'Studio B', icon: SlidersHorizontal },
    { label: 'Warehouse', icon: Warehouse },
    { label: 'Tunnel', icon: ArrowRightLeft },
];

const ConvolutionReverbLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="Impulse Response" />
                <div className="grid grid-cols-2 gap-1">
                    {IR_TYPES.map(({ label, icon: Icon }, i) => {
                        const isActive = Math.round(pv['conv-ir'] ?? 6) === i;
                        return (
                            <LatchButton
                                key={label}
                                active={isActive}
                                variant="cyan"
                                size="xs"
                                className="w-full justify-start gap-1.5"
                                onClick={() => setDeviceParameter(device.id, 'conv-ir', i)}
                                aria-pressed={isActive}
                                title={label}
                            >
                                <LED on={isActive} variant="cyan" size="sm" />
                                <Icon className="size-3 shrink-0" aria-hidden="true" />
                                <span className="truncate text-[10px]">{label}</span>
                            </LatchButton>
                        );
                    })}
                </div>
            </div>
            <div>
                <SectionHeader title="Mix" />
                <ParamGrid params={filterParams(parameters, ['conv-mix', 'conv-predelay'])} device={device} trackId={trackId} />
            </div>
            <div>
                <SectionHeader title="Tone" />
                <ParamGrid params={filterParams(parameters, ['conv-lowcut', 'conv-highcut'])} device={device} trackId={trackId} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-convolution-reverb'], ConvolutionReverbLayout);
