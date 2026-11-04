import { type ReactElement } from 'react';

import { KeyboardMusic } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { webMidiStore } from '#/modules/MIDI/stores';
import { getPlatformCapabilities } from '#/utils/platformCapabilities';

import { openPreferencesDialog } from '../../useCases/dialogs/openPreferencesDialog';

type WebMidiState = NonNullable<typeof webMidiStore.value>;

const defaultWebMidiState: WebMidiState = {
    isSupported: false,
    inputs: [],
    selectedInputId: null,
    enumerationError: null,
};

const DEVICE_NAME_MAX_LENGTH = 15;

const truncateDeviceName = (name: string): string => {
    if (name.length <= DEVICE_NAME_MAX_LENGTH) {
        return name;
    }
    return `${name.slice(0, DEVICE_NAME_MAX_LENGTH - 1)}…`;
};

export const MidiStatusBadge = (): ReactElement | null => {
    const state = useStore(webMidiStore, defaultWebMidiState);
    const midiDegradation = getPlatformCapabilities().degradations[0];
    const selected = state.inputs.find((input) => input.id === state.selectedInputId) ?? null;
    const connected = state.isSupported && state.enumerationError === null && selected !== null;
    let label: string;
    let tooltipText: string;

    if (!state.isSupported) {
        label = 'MIDI unavailable';
        if (state.enumerationError) {
            tooltipText = `MIDI access failed: ${state.enumerationError}`;
        } else {
            tooltipText = midiDegradation?.message ?? 'MIDI access unavailable';
        }
    } else if (state.enumerationError) {
        label = 'MIDI error';
        tooltipText = `MIDI inputs could not be listed: ${state.enumerationError}`;
    } else if (selected) {
        label = truncateDeviceName(selected.name);
        tooltipText = `MIDI: ${selected.name}${selected.manufacturer !== 'Unknown' ? ` (${selected.manufacturer})` : ''}`;
    } else {
        label = 'No MIDI';
        tooltipText = 'No MIDI device connected';
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="xs"
                    className="flex h-5 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={openPreferencesDialog}
                    aria-label={tooltipText}
                >
                    <span
                        className={`inline-block size-1.5 rounded-full ${
                            connected ? 'bg-[var(--color-state-success)]' : 'bg-muted-foreground/40'
                        }`}
                        aria-hidden="true"
                    />
                    <KeyboardMusic className="size-3" aria-hidden="true" />
                    <span className="tabular-nums">{label}</span>
                </Button>
            </TooltipTrigger>
            <TooltipContent>{tooltipText}</TooltipContent>
        </Tooltip>
    );
};
