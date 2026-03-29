import { type ReactElement, useState, useEffect } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { getAudioDevices, type AudioDeviceInfo } from '../../../useCases/trackViewActions';
import { setTrackInput } from '#/modules/Arrangement/useCases/setTrackInput';

type InputSelectorProps = {
    trackId: string;
    inputId: string | null;
};

export const InputSelector = ({ trackId, inputId }: InputSelectorProps): ReactElement => {
    const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);

    useEffect(() => {
        void getAudioDevices().then((d) => setDevices(d.filter((dev) => dev.kind === 'audioinput')));
    }, []);

    if (devices.length === 0) {
        return <></>;
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <select
                    className="h-4 max-w-16 truncate rounded bg-surface-overlay text-[9px] text-muted-foreground border border-border/50 px-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                    value={inputId ?? ''}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                        e.stopPropagation();
                        setTrackInput(trackId, e.target.value || null);
                    }}
                    aria-label="Audio input device"
                >
                    <option value="">Default</option>
                    {devices.map((d) => (
                        <option key={d.id} value={d.id}>
                            {d.label}
                        </option>
                    ))}
                </select>
            </TooltipTrigger>
            <TooltipContent side="bottom">Audio input source</TooltipContent>
        </Tooltip>
    );
};
