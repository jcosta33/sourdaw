import { type ReactElement, useState, useEffect } from 'react';

import { RefreshCw } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import { getAudioDevices, type AudioDeviceInfo } from '../../useCases/audioDeviceSelection/getAudioDevices';
import { audioDeviceStore } from '../../useCases/audioDeviceSelection/helpers';
import { setInputDevice } from '../../useCases/audioDeviceSelection/setInputDevice';
import { setOutputDevice } from '../../useCases/audioDeviceSelection/setOutputDevice';

const defaultAudioDeviceState = {
    selectedOutputId: null,
    selectedInputId: null,
};

export const AudioDevicePicker = (): ReactElement => {
    const state = useStore(audioDeviceStore, defaultAudioDeviceState);

    const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = () => {
        setLoading(true);
        void getAudioDevices().then((result) => {
            setDevices(result);
            setLoading(false);
            return null;
        });
    };

    useEffect(() => {
        refresh();
    }, []);

    const outputs = devices.filter((data) => data.kind === 'audiooutput');
    const inputs = devices.filter((data) => data.kind === 'audioinput');

    const handleOutputChange = (deviceId: string) => {
        void setOutputDevice(deviceId);
    };

    const handleInputChange = (deviceId: string) => {
        setInputDevice(deviceId);
    };

    return (
        <Stack gap={3}>
            <Stack gap={1.5}>
                <DawEyebrowLabel size="sm" className="block">
                    Output
                </DawEyebrowLabel>
                <Row gap={2}>
                    <DawCompactSelect
                        value={state?.selectedOutputId ?? ''}
                        onChange={(event) => handleOutputChange(event.target.value)}
                        tone="inset"
                        size="sm"
                        className="flex-1"
                        aria-label="Audio output device"
                        disabled={loading}
                    >
                        <option value="">Default</option>
                        {outputs.map((data) => (
                            <option key={data.id} value={data.id}>
                                {data.label}
                            </option>
                        ))}
                    </DawCompactSelect>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={refresh}
                        aria-label="Refresh audio devices"
                        title="Re-enumerate audio devices"
                    >
                        <RefreshCw className="size-3.5" />
                    </Button>
                </Row>
            </Stack>
            <Stack gap={1.5}>
                <DawEyebrowLabel size="sm" className="block">
                    Input
                </DawEyebrowLabel>
                <DawCompactSelect
                    value={state?.selectedInputId ?? ''}
                    onChange={(event) => handleInputChange(event.target.value)}
                    tone="inset"
                    size="sm"
                    className="w-full"
                    aria-label="Audio input device"
                    disabled={loading}
                >
                    <option value="">Default</option>
                    {inputs.map((data) => (
                        <option key={data.id} value={data.id}>
                            {data.label}
                        </option>
                    ))}
                </DawCompactSelect>
            </Stack>
            {loading ? (
                <DawInlineHint className="animate-pulse justify-start px-0 py-0 text-[10px] text-muted-foreground/70">
                    Detecting devices...
                </DawInlineHint>
            ) : null}
        </Stack>
    );
};
