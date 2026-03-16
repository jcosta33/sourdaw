import { type ReactElement, useSyncExternalStore, useState, useEffect } from "react";
import { Button } from "#/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
    subscribe,
    getSnapshot,
    initWebMidi,
    selectMidiInput,
} from "../../useCases/webMidiInput";

export const MidiDevicePicker = (): ReactElement => {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [initialised, setInitialised] = useState(false);

    useEffect(() => {
        if (!state.isSupported) {
            return;
        }
        void initWebMidi().then(() => {
            setInitialised(true);
        });
    }, [state.isSupported]);

    if (!state.isSupported) {
        return (
            <p className="text-xs text-muted-foreground/70">
                MIDI not supported in this browser.
            </p>
        );
    }

    const handleRefresh = () => {
        void initWebMidi();
    };

    const handleChange = (deviceId: string) => {
        if (deviceId) {
            selectMidiInput(deviceId);
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <select
                    value={state.selectedInputId ?? ""}
                    onChange={(e) => handleChange(e.target.value)}
                    className="flex-1 h-8 rounded-md border border-border bg-surface-overlay px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    aria-label="MIDI input device"
                    disabled={state.inputs.length === 0}
                >
                    {state.inputs.length === 0 ? (
                        <option value="">
                            {initialised ? "No MIDI devices found" : "Detecting devices..."}
                        </option>
                    ) : (
                        <>
                            <option value="">Select a device...</option>
                            {state.inputs.map((input) => (
                                <option key={input.id} value={input.id}>
                                    {input.name}
                                    {input.manufacturer !== "Unknown" ? ` (${input.manufacturer})` : ""}
                                </option>
                            ))}
                        </>
                    )}
                </select>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleRefresh}
                    aria-label="Refresh MIDI devices"
                    title="Re-enumerate MIDI devices"
                >
                    <RefreshCw className="size-3.5" />
                </Button>
            </div>
            {state.selectedInputId && state.inputs.length > 0 && (
                <p className="text-[10px] text-emerald-400/70">
                    Connected: {state.inputs.find((i) => i.id === state.selectedInputId)?.name ?? "Unknown"}
                </p>
            )}
        </div>
    );
};
