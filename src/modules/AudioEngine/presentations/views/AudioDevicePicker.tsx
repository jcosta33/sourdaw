import { type ReactElement, useState, useEffect } from 'react';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { Button } from '#/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useStore } from '#/infra/store/useStore';
import {
    audioDeviceStore,
    getAudioDevices,
    setOutputDevice,
    setInputDevice,
    type AudioDeviceInfo,
} from '../../useCases/audioDeviceSelection';

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
        });
    };

    useEffect(() => {
        refresh();
    }, []);

    const outputs = devices.filter((d) => d.kind === 'audiooutput');
    const inputs = devices.filter((d) => d.kind === 'audioinput');

    const handleOutputChange = (deviceId: string) => {
        void setOutputDevice(deviceId);
    };

    const handleInputChange = (deviceId: string) => {
        setInputDevice(deviceId);
    };

    return (
        <div className="space-y-3">
            <div className="space-y-1.5">
                <DawEyebrowLabel size="sm" className="block">
                    Output
                </DawEyebrowLabel>
                <div className="flex items-center gap-2">
                    <DawCompactSelect
                        value={state?.selectedOutputId ?? ''}
                        onChange={(e) => handleOutputChange(e.target.value)}
                        tone="inset"
                        size="sm"
                        className="flex-1"
                        aria-label="Audio output device"
                        disabled={loading}
                    >
                        <option value="">Default</option>
                        {outputs.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.label}
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
                </div>
            </div>

            <div className="space-y-1.5">
                <DawEyebrowLabel size="sm" className="block">
                    Input
                </DawEyebrowLabel>
                <DawCompactSelect
                    value={state?.selectedInputId ?? ''}
                    onChange={(e) => handleInputChange(e.target.value)}
                    tone="inset"
                    size="sm"
                    className="w-full"
                    aria-label="Audio input device"
                    disabled={loading}
                >
                    <option value="">Default</option>
                    {inputs.map((d) => (
                        <option key={d.id} value={d.id}>
                            {d.label}
                        </option>
                    ))}
                </DawCompactSelect>
            </div>

            {loading ? (
                <DawInlineHint className="animate-pulse justify-start px-0 py-0 text-[10px] text-muted-foreground/70">
                    Detecting devices...
                </DawInlineHint>
            ) : null}
        </div>
    );
};
