import { type ReactElement, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { Sparkles, Volume2, VolumeX, Loader2, Music, BarChart3 } from 'lucide-react';
import { type Clip } from '#/modules/Arrangement/useCases/trackQueries';
import { handleAiDenoiseClip, handleStemSeparationPreview } from '#/modules/AiGeneration/useCases/actions/audioProcessing';
import { polyphonicAudioToMidi } from '#/modules/AudioAnalysis/useCases/polyphonicAudioToMidi';
import { detectDominantPitch } from '#/modules/AudioAnalysis/useCases/pitchDetection';
import { summarizeFeatures } from '#/modules/AudioAnalysis/useCases/audioFeatures';
import { audioToMidi } from '#/modules/AudioAnalysis/useCases/audioToMidi';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { notifyAiChange } from '#/modules/AiRuntime/useCases/notifyAiChange';

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

    const hasDenoised = clip.audioBufferId ? audioBufferCache.has(`${clip.audioBufferId}-denoised`) : false;

    const handleDenoise = async (): Promise<void> => {
        setIsDenoising(true);
        try {
            await handleAiDenoiseClip(clip.id, denoiseStrength / 100);
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
            const result = await polyphonicAudioToMidi({ clipId: clip.id, trackId });
            if (result) {
                notifyAiChange('Polyphonic MIDI conversion complete', [
                    `Detected ${result.notes.length} polyphonic notes`,
                    'New MIDI track and clip created',
                ]);
            } else {
                notifyUser('No notes detected in audio', 'warning');
            }
        } catch (err) {
            notifyUser(err instanceof Error ? err.message : 'Polyphonic conversion failed', 'error');
        } finally {
            setIsConvertingPoly(false);
        }
    };

    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="size-3 text-[var(--color-accent-lavender)]" />
                AI Actions
            </h3>
            <div className="space-y-3">
                {/* Denoise with A/B */}
                <div className="bg-surface-raised/50 rounded-md p-2 space-y-2 border border-border/30">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-foreground/90">Denoise</span>
                        {hasDenoised ? (
                            <div className="flex items-center gap-0.5 bg-surface-base rounded-md p-0.5">
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
                            </div>
                        ) : null}
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] text-muted-foreground">Strength</label>
                            <span className="text-[10px] text-muted-foreground">{denoiseStrength}%</span>
                        </div>
                        <Slider
                            value={[denoiseStrength]}
                            onValueChange={([v]) => setDenoiseStrength(v!)}
                            min={10}
                            max={100}
                            step={5}
                            aria-label="Denoise strength"
                        />
                    </div>
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
                </div>

                {/* Quick AI actions */}
                <div className="flex gap-1">
                    <Button
                        variant="ghost"
                        size="xs"
                        className="flex-1 h-6 text-[10px] text-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)]/20"
                        onClick={() => {
                            notifyUser('Separating stems… this may take a moment');
                            handleStemSeparationPreview(clip.id);
                        }}
                    >
                        Separate Stems
                    </Button>
                    <Button
                        variant="ghost"
                        size="xs"
                        className="flex-1 h-6 text-[10px] text-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)]/20"
                        onClick={() => {
                            audioToMidi({ clipId: clip.id, trackId });
                            notifyAiChange('Audio converted to MIDI', [
                                'New MIDI clip created from detected onsets',
                            ]);
                        }}
                    >
                        MIDI (Basic)
                    </Button>
                </div>

                {/* Polyphonic Audio → MIDI */}
                <div className="bg-surface-raised/50 rounded-md p-2 space-y-1.5 border border-border/30">
                    <div className="flex items-center gap-1.5">
                        <Music className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-foreground/90">
                            Polyphonic MIDI (AI)
                        </span>
                    </div>
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
                </div>

                {/* Audio Analysis */}
                <div className="bg-surface-raised/50 rounded-md p-2 space-y-1.5 border border-border/30">
                    <div className="flex items-center gap-1.5">
                        <BarChart3 className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-foreground/90">Audio Analysis</span>
                    </div>
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
                        <p className="text-[9px] text-muted-foreground font-mono leading-relaxed">
                            {analysisResult}
                        </p>
                    ) : null}
                    {pitchResult ? (
                        <p className="text-[9px] text-[var(--color-state-success)]/80 font-mono">{pitchResult}</p>
                    ) : null}
                </div>
            </div>
        </section>
    );
};
