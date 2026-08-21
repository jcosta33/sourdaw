import { type ReactElement } from 'react';

import { Play, Pause, Square, Circle, Repeat, Scissors, ListOrdered, Layers } from 'lucide-react';

import { DawTransportCluster } from '#/components/daw/DawTransportCluster';
import { LatchButton } from '#/components/daw/LatchButton';
import { LED } from '#/components/daw/LED';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { executeAppAction } from '#/modules/Command/useCases';
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
}: TransportControlsProps): ReactElement => {
    const setPunchEnabled = (): void => {
        void executeAppAction({
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
    const renderIife_14 = () => {
        if (isRecording) {
            return 'Recording';
        }
        if (isPlaying) {
            return 'Playing';
        }
        return 'Stopped';
    };
    const renderIife_15 = () => {
        if (isRecording) {
            return 'Stop Recording';
        }
        if (anyTrackArmed) {
            return 'Record (tracks armed)';
        }
        return 'Record';
    };

    return (
        <DawTransportCluster tone="well" role="group" aria-label="Playback controls">
            <span className="sr-only" aria-live="polite" role="status">
                {renderIife_14()}
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
                <TooltipContent>{renderIife_15()} (R)</TooltipContent>
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

            {showOverdub ? (
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

            {metronomeEnabled ? (
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
            {countInEnabled ? (
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
        </DawTransportCluster>
    );
};
