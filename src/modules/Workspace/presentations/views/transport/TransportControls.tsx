import { type ReactElement, useState, useEffect } from 'react';
import { Play, Pause, Square, Circle, Repeat, Scissors, ListOrdered, Link as LinkIcon, Layers } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { LatchButton } from '#/components/daw/LatchButton';
import { LED } from '#/components/daw/LED';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/helpers/Styles/cn';
import {
    togglePlayback,
    stopPlayback,
    toggleLoop,
    toggleOverdub,
    toggleMetronome,
    setMetronomeVolume,
    toggleRecording,
    togglePunchEnabled,
    toggleCountIn,
    togglePreRoll,
} from '../../../useCases/workspaceViewActions';
import { enableLink, disableLink, getLinkStatus } from '#/modules/AudioEngine/useCases/linkBridge';

type TransportControlsProps = {
    isPlaying: boolean;
    isRecording: boolean;
    isAudioRecording: boolean;
    isLooping: boolean;
    overdubEnabled: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    punchInEnabled: boolean;
    countInEnabled: boolean;
    preRollEnabled: boolean;
    anyTrackArmed: boolean;
};

export const TransportControls = ({
    isPlaying,
    isRecording,
    isAudioRecording,
    isLooping,
    overdubEnabled,
    metronomeEnabled,
    metronomeVolume,
    punchInEnabled,
    countInEnabled,
    preRollEnabled,
    anyTrackArmed,
}: TransportControlsProps): ReactElement => {
    const [linkEnabled, setLinkEnabled] = useState(false);

    useEffect(() => {
        getLinkStatus()
            .then((status) => setLinkEnabled(status.enabled))
            .catch(() => {});
    }, []);

    const handleLinkToggle = async () => {
        try {
            if (linkEnabled) {
                await disableLink();
                setLinkEnabled(false);
            } else {
                await enableLink();
                setLinkEnabled(true);
            }
        } catch {
            // Ignore if tauri bridge fails
        }
    };

    return (
        <div
            className="flex items-center gap-1 bg-surface-recess px-1.5 py-1 rounded-sm shadow-[inset_0_1px_3px_rgba(0,0,0,0.6),0_1px_0_rgba(255,255,255,0.03)] border border-black/60"
            role="group"
            aria-label="Playback controls"
        >
            <span className="sr-only" aria-live="polite" role="status">
                {isRecording ? 'Recording' : isPlaying ? 'Playing' : 'Stopped'}
            </span>
            <Tooltip>
                <TooltipTrigger asChild>
                    <LatchButton
                        active={isPlaying}
                        variant="mint"
                        size="icon"
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                        onClick={togglePlayback}
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
                    <Button variant="transport" size="icon-sm" aria-label="Stop" onClick={stopPlayback}>
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
                        className={cn(!isRecording && anyTrackArmed && 'ring-1 ring-state-danger')}
                    >
                        <Circle
                            className={cn('size-3.5', isRecording ? 'fill-state-record' : 'text-text-primary')}
                            aria-hidden="true"
                        />
                    </LatchButton>
                </TooltipTrigger>
                <TooltipContent>
                    {isRecording ? 'Stop Recording' : anyTrackArmed ? 'Record (tracks armed)' : 'Record'} (R)
                </TooltipContent>
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
                    >
                        <Repeat className="size-3.5" aria-hidden="true" />
                    </LatchButton>
                </TooltipTrigger>
                <TooltipContent>Loop (L)</TooltipContent>
            </Tooltip>

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

            <Tooltip>
                <TooltipTrigger asChild>
                    <LatchButton
                        active={linkEnabled}
                        variant="amber"
                        size="icon"
                        aria-label="Ableton Link"
                        aria-pressed={linkEnabled}
                        onClick={handleLinkToggle}
                    >
                        <LinkIcon className="size-3.5" aria-hidden="true" />
                    </LatchButton>
                </TooltipTrigger>
                <TooltipContent>Ableton Link Sync</TooltipContent>
            </Tooltip>
            <LED on={linkEnabled} variant="amber" size="sm" />

            <Tooltip>
                <TooltipTrigger asChild>
                    <LatchButton
                        active={metronomeEnabled}
                        variant="cyan"
                        size="icon"
                        aria-label="Metronome"
                        aria-pressed={metronomeEnabled}
                        onClick={toggleMetronome}
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

            {metronomeEnabled && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center px-1">
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={metronomeVolume}
                                onChange={(e) => setMetronomeVolume(parseFloat(e.target.value))}
                                className="h-2 w-16 cursor-pointer rounded-full appearance-none bg-bg-slot shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-text-secondary [&::-webkit-slider-thumb]:rounded-sm"
                                aria-label={`Metronome volume: ${Math.round(metronomeVolume * 100)}%`}
                            />
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>Metronome volume: {Math.round(metronomeVolume * 100)}%</TooltipContent>
                </Tooltip>
            )}

            <Tooltip>
                <TooltipTrigger asChild>
                    <LatchButton
                        active={punchInEnabled}
                        variant="amber"
                        size="icon"
                        aria-label="Punch in/out"
                        aria-pressed={punchInEnabled}
                        onClick={togglePunchEnabled}
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
                    >
                        <ListOrdered className="size-3.5" aria-hidden="true" />
                    </LatchButton>
                </TooltipTrigger>
                <TooltipContent>Count-in</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <LatchButton
                        active={preRollEnabled}
                        variant="cyan"
                        size="xs"
                        aria-label="Pre-roll"
                        aria-pressed={preRollEnabled}
                        onClick={togglePreRoll}
                    >
                        <span className="text-[10px] uppercase font-semibold">PRE</span>
                    </LatchButton>
                </TooltipTrigger>
                <TooltipContent>Pre-roll (start playback N bars before cursor)</TooltipContent>
            </Tooltip>
        </div>
    );
};
