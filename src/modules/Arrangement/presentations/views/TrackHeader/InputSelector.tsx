import { type ReactElement, useState, useEffect } from 'react';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
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
                <DawCompactSelect
                    size="micro"
                    className="h-4 max-w-16 truncate px-0.5 text-muted-foreground"
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
                </DawCompactSelect>
            </TooltipTrigger>
            <TooltipContent side="bottom">Audio input source</TooltipContent>
        </Tooltip>
    );
};
