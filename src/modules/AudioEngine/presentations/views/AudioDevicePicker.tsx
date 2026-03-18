import { type ReactElement, useSyncExternalStore, useState, useEffect } from 'react';
import { Button } from '#/components/ui/button';
import { RefreshCw } from 'lucide-react';
import {
    subscribe,
    getSnapshot,
    getAudioDevices,
    setOutputDevice,
    setInputDevice,
    type AudioDeviceInfo,
} from '../../useCases/audioDeviceSelection';

export const AudioDevicePicker = (): ReactElement => {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
                <label className="text-[10px] text-muted-foreground block">Output</label>
                <div className="flex items-center gap-2">
                    <select
                        value={state.selectedOutputId ?? ''}
                        onChange={(e) => handleOutputChange(e.target.value)}
                        className="flex-1 h-8 rounded-md border border-border bg-surface-overlay px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        aria-label="Audio output device"
                        disabled={loading}
                    >
                        <option value="">Default</option>
                        {outputs.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.label}
                            </option>
                        ))}
                    </select>
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
                <label className="text-[10px] text-muted-foreground block">Input</label>
                <select
                    value={state.selectedInputId ?? ''}
                    onChange={(e) => handleInputChange(e.target.value)}
                    className="w-full h-8 rounded-md border border-border bg-surface-overlay px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    aria-label="Audio input device"
                    disabled={loading}
                >
                    <option value="">Default</option>
                    {inputs.map((d) => (
                        <option key={d.id} value={d.id}>
                            {d.label}
                        </option>
                    ))}
                </select>
            </div>

            {loading && <p className="text-[10px] text-muted-foreground/70 animate-pulse">Detecting devices...</p>}
        </div>
    );
};
