import { type ReactElement, useState, useEffect } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import { getAudioDevices } from '#/modules/AudioEngine/useCases';

import { setTrackInput } from '../../../useCases/setTrackInput';

// Local field-identical copy of AudioEngine's private getAudioDevices() row shape.
type AudioDeviceInfo = { id: string; label: string; kind: 'audioinput' | 'audiooutput' };
type InputSelectorProps = {
    trackId: string;
    inputId: string | null;
};

export const InputSelector = ({ trackId, inputId }: InputSelectorProps): ReactElement => {
    const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);

    useEffect(() => {
        void getAudioDevices().then((data) => setDevices(data.filter((dev) => dev.kind === 'audioinput')));
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
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                        event.stopPropagation();
                        setTrackInput(trackId, event.target.value || null);
                    }}
                    aria-label="Audio input device"
                >
                    <option value="">Default</option>
                    {devices.map((data) => (
                        <option key={data.id} value={data.id}>
                            {data.label}
                        </option>
                    ))}
                </DawCompactSelect>
            </TooltipTrigger>
            <TooltipContent side="bottom">Audio input source</TooltipContent>
        </Tooltip>
    );
};
