import { type ReactElement, useState } from 'react';

import { Sparkles, Volume2, VolumeX, Loader2, Music, BarChart3 } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { handleAiDenoiseClip } from '#/modules/AiGeneration/useCases';
import { notifyAiChange } from '#/modules/AiRuntime/useCases';
import {
    polyphonicAudioToMidi,
    insertPolyphonicMidiNotes,
    detectDominantPitch,
    summarizeFeatures,
    audioToMidi,
} from '#/modules/AudioAnalysis/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip } from '../../../models/TrackViewTypes';
import { ControlHeader } from '../../components/Inspector/ControlHeader';

type ClipAudioAiSectionProps = {
    clip: Clip;
    trackId: string;
};

export const ClipAudioAiSection = ({ clip, trackId }: ClipAudioAiSectionProps): ReactElement => {
    const [denoiseStrength, setDenoiseStrength] = useState(70);
    const [isDenoising, setIsDenoising] = useState(false);
    const [abMode, setAbMode] = useState<'original' | 'processed'>('original');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isConvertingPoly, setIsConvertingPoly] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<string | null>(null);
    const [pitchResult, setPitchResult] = useState<string | null>(null);

    const hasDenoised = clip.audioBufferId
        ? Boolean(getCachedAudioBuffer({ bufferId: `${clip.audioBufferId}-denoised` }))
        : false;

    const handleDenoise = async (): Promise<void> => {
        // Key the denoise on the clip's audioBufferId: the handler treats its
        // argument as a cache bufferId (source lookup + `${id}-denoised` write),
        // and the `hasDenoised` A/B check above reads `${clip.audioBufferId}-denoised`.
        // Passing clip.id would orphan the result in the cache.
        if (!clip.audioBufferId) {
            notifyUser('Denoise failed', 'error');
            return;
        }
        setIsDenoising(true);
        try {
            await handleAiDenoiseClip(clip.audioBufferId, denoiseStrength / 100);
            setAbMode('processed');
            notifyAiChange('Denoise complete', [
                `Applied ${denoiseStrength}% noise reduction`,
                'Toggle A/B to compare original and processed',
            ]);
        } catch {
            notifyUser('Denoise failed', 'error');
        } finally {
            setIsDenoising(false);
        }
    };

    const handleAnalyze = (): void => {
        setIsAnalyzing(true);
        try {
            const bufferId = clip.audioBufferId ?? clip.id;
            const summary = summarizeFeatures(bufferId);
            const pitch = detectDominantPitch(bufferId);
            if (summary) {
                setAnalysisResult(
                    `RMS: ${summary.avgRms.toFixed(3)} | Brightness: ${summary.avgSpectralCentroid.toFixed(0)} Hz | Tonality: ${(1 - summary.avgSpectralFlatness).toFixed(2)}`
                );
            }
            if (pitch) {
                setPitchResult(
                    `Dominant: ${pitch.noteName} (${pitch.frequency.toFixed(1)} Hz, ${(pitch.clarity * 100).toFixed(0)}% clarity)`
                );
            }
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handlePolyMidi = async (): Promise<void> => {
        setIsConvertingPoly(true);
        try {
            const result = await polyphonicAudioToMidi({ clipId: clip.id });
            if (result) {
                insertPolyphonicMidiNotes(result.notes, result.sourceClip, trackId);
                notifyAiChange('Polyphonic MIDI conversion complete', [
                    `Detected ${result.notes.length} polyphonic notes`,
                    'New MIDI track and clip created',
                ]);
            } else {
                notifyUser('No notes detected in audio', 'warning');
            }
        } catch (error) {
            notifyUser(error instanceof Error ? error.message : 'Polyphonic conversion failed', 'error');
        } finally {
            setIsConvertingPoly(false);
        }
    };

    return (
        <section>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="AI Actions"
                startSlot={<Sparkles className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
            />
            <Stack gap={3}>
                <Stack gap={2} className="bg-surface-raised/50 rounded-md p-2 border border-border/30">
                    <Row justify="between">
                        <span className="text-[10px] font-medium text-foreground/90">Denoise</span>
                        {hasDenoised ? (
                            <Row gap={0.5} className="bg-surface-base rounded-md p-0.5">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant={abMode === 'original' ? 'secondary' : 'ghost'}
                                            size="icon-xs"
                                            className="h-5 w-7 text-[9px]"
                                            onClick={() => setAbMode('original')}
                                            aria-label="Listen to original audio"
                                        >
                                            <Volume2 className="size-3" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Original (A)</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant={abMode === 'processed' ? 'secondary' : 'ghost'}
                                            size="icon-xs"
                                            className="h-5 w-7 text-[9px]"
                                            onClick={() => setAbMode('processed')}
                                            aria-label="Listen to denoised audio"
                                        >
                                            <VolumeX className="size-3" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Denoised (B)</TooltipContent>
                                </Tooltip>
                            </Row>
                        ) : null}
                    </Row>
                    <Stack gap={1}>
                        <ControlHeader label="Strength" value={`${denoiseStrength}%`} valueClassName="font-normal" />
                        <Slider
                            value={[denoiseStrength]}
                            onValueChange={([value]) => setDenoiseStrength(value!)}
                            min={10}
                            max={100}
                            step={5}
                            aria-label="Denoise strength"
                        />
                    </Stack>
                    <Button
                        variant="secondary"
                        size="xs"
                        className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                        onClick={handleDenoise}
                        disabled={isDenoising}
                    >
                        {isDenoising ? (
                            <>
                                <Loader2 className="size-3 mr-1 animate-spin" /> Denoising…
                            </>
                        ) : (
                            <>
                                <Sparkles className="size-3 mr-1" /> Apply Denoise
                            </>
                        )}
                    </Button>
                </Stack>

                <Row align="stretch" gap={1}>
                    <Button
                        variant="ghost"
                        size="xs"
                        className="flex-1 h-6 text-[10px] text-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)]/20"
                        onClick={() => {
                            // audioToMidi silently no-ops (missing clip/buffer, no onsets
                            // detected, or MIDI track resolution failed) instead of throwing —
                            // its boolean return is the only signal a conversion actually
                            // happened, so the success toast must be gated on it or a no-op
                            // click reports success it never delivered.
                            const converted = audioToMidi({ clipId: clip.id, trackId });
                            if (converted) {
                                notifyAiChange('Audio converted to MIDI', [
                                    'New MIDI clip created from detected onsets',
                                ]);
                            } else {
                                notifyUser('Audio to MIDI conversion failed', 'error');
                            }
                        }}
                    >
                        MIDI (Basic)
                    </Button>
                </Row>

                <Stack gap={1.5} className="bg-surface-raised/50 rounded-md p-2 border border-border/30">
                    <Row gap={1.5}>
                        <Music className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-foreground/90">Polyphonic MIDI (AI)</span>
                    </Row>
                    <p className="text-[9px] text-muted-foreground leading-relaxed">
                        Neural network detects chords, melodies, and pitch bends.
                    </p>
                    <Button
                        variant="secondary"
                        size="xs"
                        className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                        onClick={handlePolyMidi}
                        disabled={isConvertingPoly}
                    >
                        {isConvertingPoly ? (
                            <>
                                <Loader2 className="size-3 mr-1 animate-spin" /> Converting…
                            </>
                        ) : (
                            <>
                                <Music className="size-3 mr-1" /> Audio → MIDI (Poly)
                            </>
                        )}
                    </Button>
                </Stack>

                <Stack gap={1.5} className="bg-surface-raised/50 rounded-md p-2 border border-border/30">
                    <Row gap={1.5}>
                        <BarChart3 className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-foreground/90">Audio Analysis</span>
                    </Row>
                    <Button
                        variant="secondary"
                        size="xs"
                        className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                        onClick={handleAnalyze}
                        disabled={isAnalyzing}
                    >
                        {isAnalyzing ? (
                            <>
                                <Loader2 className="size-3 mr-1 animate-spin" /> Analyzing…
                            </>
                        ) : (
                            <>
                                <BarChart3 className="size-3 mr-1" /> Analyze Clip
                            </>
                        )}
                    </Button>
                    {analysisResult ? (
                        <p className="text-[9px] text-muted-foreground font-mono leading-relaxed">{analysisResult}</p>
                    ) : null}
                    {pitchResult ? (
                        <p className="text-[9px] text-[var(--color-state-success)]/80 font-mono">{pitchResult}</p>
                    ) : null}
                </Stack>
            </Stack>
        </section>
    );
};
