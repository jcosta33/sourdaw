import { type ReactElement } from 'react';

import { Play, Pause, Square, Circle, Repeat, Scissors, ListOrdered, Layers, SlidersHorizontal } from 'lucide-react';

import { DawTransportCluster } from '#/components/daw/DawTransportCluster';
import { LatchButton } from '#/components/daw/LatchButton';
import { LED } from '#/components/daw/LED';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { Slider } from '#/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { executeUserAppAction } from '#/modules/Command/useCases';
import {
    togglePlayback,
    stopPlayback,
    toggleLoop,
    toggleOverdub,
    toggleMetronome,
    setMetronomeVolume,
    toggleRecording,
    toggleCountIn,
    setCountInBars,
} from '#/modules/Transport/useCases';
import { cn } from '#/utils/Styles/cn';

import { TransportValuePill } from '../../components/Transport/TransportValuePill';

type TransportControlsProps = {
    isPlaying: boolean;
    isRecording: boolean;
    isAudioRecording: boolean;
    isLooping: boolean;
    overdubEnabled: boolean;
    showOverdub: boolean;
    anyTrackArmed: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    punchInEnabled: boolean;
    countInEnabled: boolean;
    countInBars: number;
    compact?: boolean;
};

type TransportSettingsContentProps = {
    includeSecondaryActions: boolean;
    overdubEnabled: boolean;
    showOverdub: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    punchInEnabled: boolean;
    countInEnabled: boolean;
    countInBars: number;
    isPlaying: boolean;
    isRecording: boolean;
    onToggleOverdub: () => void;
    onToggleMetronome: () => void;
    onSetMetronomeVolume: (value: number) => void;
    onTogglePunch: () => void;
    onToggleCountIn: () => void;
    onCycleCountInBars: () => void;
};

const TransportSettingsContent = ({
    includeSecondaryActions,
    overdubEnabled,
    showOverdub,
    metronomeEnabled,
    metronomeVolume,
    punchInEnabled,
    countInEnabled,
    countInBars,
    isPlaying,
    isRecording,
    onToggleOverdub,
    onToggleMetronome,
    onSetMetronomeVolume,
    onTogglePunch,
    onToggleCountIn,
    onCycleCountInBars,
}: TransportSettingsContentProps): ReactElement => {
    return (
        <div className="space-y-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                Transport settings
            </p>
            {includeSecondaryActions && showOverdub ? (
                <LatchButton
                    active={overdubEnabled}
                    variant="cyan"
                    size="sm"
                    aria-label="Overdub"
                    aria-pressed={overdubEnabled}
                    onClick={onToggleOverdub}
                    className="w-full justify-start"
                >
                    <Layers className="size-3.5" aria-hidden="true" />
                    Overdub
                </LatchButton>
            ) : null}
            {includeSecondaryActions ? (
                <LatchButton
                    active={metronomeEnabled}
                    variant="cyan"
                    size="sm"
                    aria-label="Metronome"
                    aria-pressed={metronomeEnabled}
                    onClick={onToggleMetronome}
                    className="w-full justify-start"
                >
                    Metronome
                </LatchButton>
            ) : null}
            {metronomeEnabled ? (
                <Row className="gap-2 px-1 py-1">
                    <span className="text-[11px] text-text-secondary">Volume</span>
                    <Slider
                        min={0}
                        max={1}
                        step={0.01}
                        value={[metronomeVolume]}
                        onValueChange={(val) => onSetMetronomeVolume(val[0] ?? 0)}
                        className="w-24 h-3"
                        aria-label={`Metronome volume: ${Math.round(metronomeVolume * 100)}%`}
                    />
                </Row>
            ) : null}
            {includeSecondaryActions ? (
                <LatchButton
                    active={punchInEnabled}
                    variant="amber"
                    size="sm"
                    aria-label="Punch in/out"
                    aria-pressed={punchInEnabled}
                    disabled={isPlaying || isRecording}
                    onClick={onTogglePunch}
                    className="w-full justify-start"
                >
                    <Scissors className="size-3.5" aria-hidden="true" />
                    Punch in/out
                </LatchButton>
            ) : null}
            {includeSecondaryActions ? (
                <LatchButton
                    active={countInEnabled}
                    variant="cyan"
                    size="sm"
                    aria-label="Count-in"
                    aria-pressed={countInEnabled}
                    onClick={onToggleCountIn}
                    className="w-full justify-start"
                >
                    <ListOrdered className="size-3.5" aria-hidden="true" />
                    Count-in
                </LatchButton>
            ) : null}
            {countInEnabled ? (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onCycleCountInBars}
                    aria-label={`Count-in bars: ${countInBars}. Click to cycle.`}
                    className="w-full justify-between"
                >
                    Count-in bars <span>{countInBars}</span>
                </Button>
            ) : null}
        </div>
    );
};

export const TransportControls = ({
    isPlaying,
    isRecording,
    isAudioRecording,
    isLooping,
    overdubEnabled,
    showOverdub,
    anyTrackArmed,
    metronomeEnabled,
    metronomeVolume,
    punchInEnabled,
    countInEnabled,
    countInBars,
    compact = false,
}: TransportControlsProps): ReactElement => {
    const setPunchEnabled = (): void => {
        void executeUserAppAction({
            type: 'setPunchEnabled',
            payload: { enabled: !punchInEnabled },
        }).catch(() => undefined);
    };
    const cycleCountInBars = (): void => {
        let next: number;
        if (countInBars >= 4) {
            next = 1;
        } else if (countInBars >= 2) {
            next = 4;
        } else if (countInBars >= 1) {
            next = 2;
        } else {
            next = 1;
        }
        setCountInBars(next);
    };
    const statusAnnouncement = (): string => {
        if (isRecording) {
            return 'Recording';
        }
        if (isPlaying) {
            return 'Playing';
        }
        return 'Stopped';
    };
    const recordButtonLabel = (): string => {
        if (isRecording) {
            return 'Stop Recording';
        }
        if (anyTrackArmed) {
            return 'Record (tracks armed)';
        }
        return 'Record';
    };
    const renderSettingsContent = (includeSecondaryActions: boolean): ReactElement => (
        <TransportSettingsContent
            includeSecondaryActions={includeSecondaryActions}
            overdubEnabled={overdubEnabled}
            showOverdub={showOverdub}
            metronomeEnabled={metronomeEnabled}
            metronomeVolume={metronomeVolume}
            punchInEnabled={punchInEnabled}
            countInEnabled={countInEnabled}
            countInBars={countInBars}
            isPlaying={isPlaying}
            isRecording={isRecording}
            onToggleOverdub={toggleOverdub}
            onToggleMetronome={toggleMetronome}
            onSetMetronomeVolume={setMetronomeVolume}
            onTogglePunch={setPunchEnabled}
            onToggleCountIn={toggleCountIn}
            onCycleCountInBars={cycleCountInBars}
        />
    );

    return (
        <DawTransportCluster tone="well" role="group" aria-label="Playback controls">
            <span className="sr-only" aria-live="polite" role="status">
                {statusAnnouncement()}
            </span>
            <Tooltip>
                <TooltipTrigger asChild>
                    <LatchButton
                        active={isPlaying}
                        variant="mint"
                        size="icon"
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                        onClick={togglePlayback}
                        data-onboarding="transport-play"
                        data-testid="transport-play"
                    >
                        {isPlaying ? (
                            <Pause className="size-4" aria-hidden="true" />
                        ) : (
                            <Play className="size-4" aria-hidden="true" />
                        )}
                    </LatchButton>
                </TooltipTrigger>
                <TooltipContent>{isPlaying ? 'Pause' : 'Play'} (Space)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="transport"
                        size="icon-sm"
                        aria-label="Stop"
                        onClick={stopPlayback}
                        data-testid="transport-stop"
                    >
                        <Square className="size-3.5 fill-text-secondary" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Stop (Esc)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <LatchButton
                        active={isRecording}
                        variant="red"
                        size="icon"
                        aria-label={isRecording ? 'Stop recording' : 'Record'}
                        aria-pressed={isRecording}
                        onClick={toggleRecording}
                        data-testid="transport-record"
                        className={cn(!isRecording && anyTrackArmed && 'ring-1 ring-state-danger')}
                    >
                        <Circle
                            className={cn('size-3.5', isRecording ? 'fill-state-record' : 'text-text-primary')}
                            aria-hidden="true"
                        />
                    </LatchButton>
                </TooltipTrigger>
                <TooltipContent>{recordButtonLabel()} (R)</TooltipContent>
            </Tooltip>
            <LED on={isAudioRecording} variant="red" size="sm" />

            <Tooltip>
                <TooltipTrigger asChild>
                    <LatchButton
                        active={isLooping}
                        variant="amber"
                        size="icon"
                        aria-label="Loop"
                        aria-pressed={isLooping}
                        onClick={toggleLoop}
                        data-testid="transport-loop"
                    >
                        <Repeat className="size-3.5" aria-hidden="true" />
                    </LatchButton>
                </TooltipTrigger>
                <TooltipContent>Loop (L)</TooltipContent>
            </Tooltip>

            {!compact && showOverdub ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <LatchButton
                            active={overdubEnabled}
                            variant="cyan"
                            size="icon"
                            aria-label="Overdub"
                            aria-pressed={overdubEnabled}
                            onClick={toggleOverdub}
                        >
                            <Layers className="size-3.5" aria-hidden="true" />
                        </LatchButton>
                    </TooltipTrigger>
                    <TooltipContent>MIDI Overdub (+)</TooltipContent>
                </Tooltip>
            ) : null}

            {!compact ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <LatchButton
                            active={metronomeEnabled}
                            variant="cyan"
                            size="icon"
                            aria-label="Metronome"
                            aria-pressed={metronomeEnabled}
                            onClick={toggleMetronome}
                            data-testid="transport-metronome"
                        >
                            <svg
                                className="size-3.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M12 2L6 22h12L12 2z" />
                                <path d="M12 12l4-8" />
                            </svg>
                        </LatchButton>
                    </TooltipTrigger>
                    <TooltipContent>Metronome (M)</TooltipContent>
                </Tooltip>
            ) : null}

            {!compact && metronomeEnabled ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Row className="px-2 py-1">
                            <Slider
                                min={0}
                                max={1}
                                step={0.01}
                                value={[metronomeVolume]}
                                onValueChange={(val) => setMetronomeVolume(val[0] ?? 0)}
                                className="w-16 h-3"
                                aria-label={`Metronome volume: ${Math.round(metronomeVolume * 100)}%`}
                            />
                        </Row>
                    </TooltipTrigger>
                    <TooltipContent>Metronome volume: {Math.round(metronomeVolume * 100)}%</TooltipContent>
                </Tooltip>
            ) : null}

            {!compact ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <LatchButton
                            active={punchInEnabled}
                            variant="amber"
                            size="icon"
                            aria-label="Punch in/out"
                            aria-pressed={punchInEnabled}
                            disabled={isPlaying || isRecording}
                            onClick={setPunchEnabled}
                            data-testid="transport-punch"
                        >
                            <Scissors className="size-3.5" aria-hidden="true" />
                        </LatchButton>
                    </TooltipTrigger>
                    <TooltipContent>Punch In/Out (I)</TooltipContent>
                </Tooltip>
            ) : null}

            {!compact ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <LatchButton
                            active={countInEnabled}
                            variant="cyan"
                            size="icon"
                            aria-label="Count-in"
                            aria-pressed={countInEnabled}
                            onClick={toggleCountIn}
                            data-testid="transport-countin"
                        >
                            <ListOrdered className="size-3.5" aria-hidden="true" />
                        </LatchButton>
                    </TooltipTrigger>
                    <TooltipContent>Count-in</TooltipContent>
                </Tooltip>
            ) : null}

            {!compact && countInEnabled ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <TransportValuePill
                            active
                            onClick={cycleCountInBars}
                            aria-label={`Count-in bars: ${countInBars}. Click to cycle.`}
                        >
                            {countInBars}
                        </TransportValuePill>
                    </TooltipTrigger>
                    <TooltipContent>Count-in bars (click to cycle 1→2→4)</TooltipContent>
                </Tooltip>
            ) : null}
            <Popover key="transport-settings">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Transport settings"
                                data-testid="transport-settings"
                            >
                                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                            </Button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Transport settings</TooltipContent>
                </Tooltip>
                <PopoverContent align="center" aria-label="Transport settings">
                    {renderSettingsContent(true)}
                </PopoverContent>
            </Popover>
        </DawTransportCluster>
    );
};
