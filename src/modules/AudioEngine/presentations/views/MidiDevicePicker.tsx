import { type ReactElement, useState, useEffect } from 'react';

import { KeyboardMusic, RefreshCw } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import { webMidiStore } from '../../useCases/webMidiInput/helpers';
import { initWebMidi } from '../../useCases/webMidiInput/initWebMidi';
import { selectMidiInput } from '../../useCases/webMidiInput/selectMidiInput';

const defaultWebMidiState = {
    isSupported: false,
    inputs: [],
    selectedInputId: null,
};

export const MidiDevicePicker = (): ReactElement => {
    const state = useStore(webMidiStore, defaultWebMidiState);
    const [initialised, setInitialised] = useState(false);

    useEffect(() => {
        if (!state.isSupported) {
            return;
        }
        initWebMidi().then(() => {
            setInitialised(true);
        });
    }, [state.isSupported]);

    if (!state.isSupported) {
        return (
            <DawEmptyState
                compact
                icon={<KeyboardMusic className="size-4" />}
                title="MIDI not supported in this browser"
            />
        );
    }

    const handleRefresh = () => {
        initWebMidi();
    };

    const handleChange = (deviceId: string) => {
        if (deviceId) {
            selectMidiInput(deviceId);
        }
    };

    return (
        <div className="space-y-2">
            <div className="space-y-1.5">
                <DawEyebrowLabel size="sm" className="block">
                    MIDI Input
                </DawEyebrowLabel>
                <div className="flex items-center gap-2">
                    <DawCompactSelect
                        value={state.selectedInputId ?? ''}
                        onChange={(e) => handleChange(e.target.value)}
                        tone="inset"
                        size="sm"
                        className="flex-1"
                        aria-label="MIDI input device"
                        disabled={state.inputs.length === 0}
                    >
                        {state.inputs.length === 0 ? (
                            <option value="">{initialised ? 'No MIDI devices found' : 'Detecting devices...'}</option>
                        ) : (
                            <>
                                <option value="">Select a device...</option>
                                {state.inputs.map((input) => (
                                    <option key={input.id} value={input.id}>
                                        {input.name}
                                        {input.manufacturer !== 'Unknown' ? ` (${input.manufacturer})` : ''}
                                    </option>
                                ))}
                            </>
                        )}
                    </DawCompactSelect>
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
            </div>
            {!initialised && state.inputs.length === 0 ? (
                <DawInlineHint className="justify-start px-0 py-0 text-[10px] text-muted-foreground/70">
                    Detecting MIDI devices...
                </DawInlineHint>
            ) : null}
            {state.selectedInputId && state.inputs.length > 0 ? (
                <DawMicroBadge tone="success" className="w-fit">
                    Connected: {state.inputs.find((i) => i.id === state.selectedInputId)?.name ?? 'Unknown'}
                </DawMicroBadge>
            ) : null}
        </div>
    );
};
