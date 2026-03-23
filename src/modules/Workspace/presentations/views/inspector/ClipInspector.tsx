import { type ReactElement, useState } from 'react';
import { Slider } from '#/components/ui/slider';
import { Separator } from '#/components/ui/separator';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import {
    ChevronRight,
    Sparkles,
    Volume2,
    VolumeX,
    Loader2,
    Music,
    BarChart3,
    Activity,
    Plus,
    RotateCcw,
} from 'lucide-react';
import {
    getClipGainEnvelope,
    toggleClipGainEnvelope,
    addGainEnvelopePoint,
    removeGainEnvelopePoint,
    resetClipGainEnvelope,
} from '#/modules/Clip/useCases/clipGainEnvelope';
import {
    trimClipStart,
    trimClipEnd,
    setClipFade,
    setClipGain,
    setClipColor,
    renameClip,
    setClipFollowAction,
    polyphonicAudioToMidi,
    detectDominantPitch,
    summarizeFeatures,
} from '../../../useCases/workspaceViewActions';
import { type Clip } from '../../../useCases/workspaceViewActions';
import { CLIP_COLOR_PRESETS } from './colorPresets';
import { handleAiDenoiseClip, handleStemSeparationPreview } from '#/modules/AiGeneration/useCases/generativeAiActions';
import { audioToMidi } from '#/modules/AudioAnalysis/useCases/audioToMidi';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { generateMidiVariations } from '#/modules/AiGeneration/useCases/generateMidiVariations';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { notifyAiChange } from '#/modules/AiRuntime/presentations/views/AiChangeToast';

type ClipInspectorProps = {
    clip: Clip;
    trackId: string;
    onBack: () => void;
};

export const ClipInspector = ({ clip, trackId, onBack }: ClipInspectorProps): ReactElement => {
    const duration = clip.endBeat - clip.startBeat;
    const startBar = Math.floor(clip.startBeat / 4) + 1;
    const endBar = Math.floor(clip.endBeat / 4) + 1;
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(clip.name);
    const [denoiseStrength, setDenoiseStrength] = useState(70);
    const [isDenoising, setIsDenoising] = useState(false);
    const [abMode, setAbMode] = useState<'original' | 'processed'>('original');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isConvertingPoly, setIsConvertingPoly] = useState(false);
    const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<string | null>(null);
    const [pitchResult, setPitchResult] = useState<string | null>(null);
    const [envKey, setEnvKey] = useState(0);
    void envKey; // used to force re-render when envelope mutates

    const hasDenoised = clip.audioBufferId ? audioBufferCache.has(`${clip.audioBufferId}-denoised`) : false;

    const commitClipName = () => {
        const trimmed = nameValue.trim();
        if (trimmed && trimmed !== clip.name) {
            renameClip(clip.id, trimmed);
        }
        setEditingName(false);
    };

    const handleDenoise = async () => {
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

    return (
        <div className="space-y-4 p-3">
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to track">
                    <ChevronRight className="size-3 rotate-180" />
                </Button>
                {editingName ? (
                    <Input
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        onBlur={commitClipName}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                commitClipName();
                            }
                            if (e.key === 'Escape') {
                                setNameValue(clip.name);
                                setEditingName(false);
                            }
                        }}
                        className="h-6 flex-1 text-xs"
                        aria-label={`Rename clip ${clip.name}`}
                        autoFocus
                    />
                ) : (
                    <h3
                        className="text-xs font-medium text-foreground cursor-pointer hover:underline"
                        onDoubleClick={() => {
                            setNameValue(clip.name);
                            setEditingName(true);
                        }}
                        title="Double-click to rename"
                    >
                        {clip.name}
                    </h3>
                )}
            </div>

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Position
                </h3>
                <div className="rounded-md bg-surface-well border border-border-hairline shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Start</label>
                        <span className="text-[10px] font-mono text-foreground">
                            Bar {startBar} (beat {clip.startBeat})
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">End</label>
                        <span className="text-[10px] font-mono text-foreground">
                            Bar {endBar} (beat {clip.endBeat})
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Length</label>
                        <span className="text-[10px] font-mono text-foreground">
                            {duration} beats ({(duration / 4).toFixed(1)} bars)
                        </span>
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Trim</h3>
                <div className="space-y-2">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Trim Start</label>
                        </div>
                        <Slider
                            value={[clip.startBeat]}
                            onValueChange={([v]) => {
                                if (v !== undefined) {
                                    trimClipStart(clip.id, v);
                                }
                            }}
                            max={clip.endBeat - 1}
                            step={0.25}
                            aria-label="Trim clip start"
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Trim End</label>
                        </div>
                        <Slider
                            value={[clip.endBeat]}
                            onValueChange={([v]) => {
                                if (v !== undefined) {
                                    trimClipEnd(clip.id, v);
                                }
                            }}
                            min={clip.startBeat + 1}
                            max={clip.startBeat + 256}
                            step={0.25}
                            aria-label="Trim clip end"
                        />
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Fades</h3>
                <div className="space-y-2">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Fade In</label>
                            <span className="text-[10px] font-mono text-foreground">
                                {clip.fadeInBeats.toFixed(2)} beats
                            </span>
                        </div>
                        <Slider
                            value={[clip.fadeInBeats]}
                            onValueChange={([v]) => {
                                if (v !== undefined) {
                                    setClipFade(clip.id, v, clip.fadeOutBeats);
                                }
                            }}
                            max={duration / 2}
                            step={0.25}
                            aria-label="Fade in duration"
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Fade Out</label>
                            <span className="text-[10px] font-mono text-foreground">
                                {clip.fadeOutBeats.toFixed(2)} beats
                            </span>
                        </div>
                        <Slider
                            value={[clip.fadeOutBeats]}
                            onValueChange={([v]) => {
                                if (v !== undefined) {
                                    setClipFade(clip.id, clip.fadeInBeats, v);
                                }
                            }}
                            max={duration / 2}
                            step={0.25}
                            aria-label="Fade out duration"
                        />
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Gain</h3>
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] text-muted-foreground">Clip Gain</label>
                        <span className="text-[10px] font-mono text-muted-foreground">
                            {(clip.gain * 100).toFixed(0)}%
                        </span>
                    </div>
                    <Slider
                        value={[clip.gain * 100]}
                        onValueChange={([v]) => {
                            if (v !== undefined) {
                                setClipGain(clip.id, v / 100);
                            }
                        }}
                        max={200}
                        step={1}
                        aria-label="Clip gain"
                    />
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="size-3" aria-hidden="true" />
                    Gain Envelope
                </h3>
                {(() => {
                    const envelope = getClipGainEnvelope(clip.id);
                    return (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground">
                                    {envelope.enabled ? 'Enabled' : 'Disabled'} · {envelope.points.length} point
                                    {envelope.points.length !== 1 ? 's' : ''}
                                </span>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={() => {
                                            toggleClipGainEnvelope(clip.id);
                                            setEnvKey((k) => k + 1);
                                        }}
                                        aria-label={envelope.enabled ? 'Disable gain envelope' : 'Enable gain envelope'}
                                        title={envelope.enabled ? 'Disable' : 'Enable'}
                                    >
                                        <Activity
                                            className={`size-3 ${envelope.enabled ? 'text-[var(--color-state-success)]' : 'text-muted-foreground'}`}
                                        />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={() => {
                                            addGainEnvelopePoint(clip.id, duration / 2, 0);
                                            setEnvKey((k) => k + 1);
                                        }}
                                        aria-label="Add breakpoint"
                                        title="Add breakpoint at midpoint"
                                    >
                                        <Plus className="size-3" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={() => {
                                            resetClipGainEnvelope(clip.id);
                                            setEnvKey((k) => k + 1);
                                        }}
                                        aria-label="Reset gain envelope"
                                        title="Reset to flat 0 dB"
                                    >
                                        <RotateCcw className="size-3" />
                                    </Button>
                                </div>
                            </div>
                            {envelope.enabled && envelope.points.length > 0 && (
                                <div className="rounded-md bg-surface-well border border-border-hairline shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] p-2 space-y-1">
                                    {envelope.points.map((pt) => (
                                        <div key={pt.id} className="flex items-center justify-between gap-2">
                                            <span className="text-[9px] font-mono text-muted-foreground w-12 shrink-0">
                                                @{pt.beatOffset.toFixed(1)}
                                            </span>
                                            <span className="text-[9px] font-mono text-foreground flex-1 text-right">
                                                {pt.gainDb > 0 ? '+' : ''}
                                                {pt.gainDb.toFixed(1)} dB
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                className="h-4 w-4"
                                                onClick={() => {
                                                    removeGainEnvelopePoint(clip.id, pt.id);
                                                    setEnvKey((k) => k + 1);
                                                }}
                                                aria-label={`Remove breakpoint at beat ${pt.beatOffset}`}
                                            >
                                                <span className="text-[9px] text-muted-foreground">×</span>
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Color</h3>
                <div className="flex gap-1">
                    {CLIP_COLOR_PRESETS.map((c) => (
                        <button
                            type="button"
                            key={c || 'default'}
                            className="size-4 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                            style={{
                                backgroundColor: c || 'var(--color-muted)',
                                outline: c === clip.color ? '2px solid white' : 'none',
                                outlineOffset: '1px',
                            }}
                            onClick={() => setClipColor(clip.id, c)}
                            aria-label={c || 'Default color'}
                        />
                    ))}
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Properties
                </h3>
                <div className="rounded-md bg-surface-well border border-border-hairline shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Type</label>
                        <span className="text-[10px] font-mono text-foreground capitalize">{clip.type}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Track</label>
                        <span className="text-[10px] font-mono text-foreground">{clip.trackId}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground" htmlFor="follow-action-select">
                            Follow Action
                        </label>
                        <select
                            id="follow-action-select"
                            className="rounded bg-surface-overlay text-[10px] text-foreground text-right outline-none focus:ring-1 focus:ring-ring border border-border-hairline px-1 py-0.5 cursor-pointer hover:bg-surface-raised transition-colors"
                            value={clip.followAction ?? 'none'}
                            onChange={(e) => {
                                const val = e.target.value === 'none' ? undefined : (e.target.value as any);
                                setClipFollowAction(clip.id, val);
                            }}
                        >
                            <option className="bg-bg-overlay" value="none">
                                None
                            </option>
                            <option className="bg-bg-overlay" value="stop">
                                Stop
                            </option>
                            <option className="bg-bg-overlay" value="play_next">
                                Play Next
                            </option>
                            <option className="bg-bg-overlay" value="play_previous">
                                Play Previous
                            </option>
                            <option className="bg-bg-overlay" value="play_first">
                                Play First
                            </option>
                            <option className="bg-bg-overlay" value="play_last">
                                Play Last
                            </option>
                            <option className="bg-bg-overlay" value="play_random">
                                Play Random
                            </option>
                        </select>
                    </div>
                    {clip.type === 'audio' && (
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] text-muted-foreground">Audio Source</label>
                            <span className="text-[10px] font-mono text-foreground truncate max-w-24">
                                {clip.audioBufferId ? `${clip.audioBufferId.slice(0, 16)}…` : 'none'}
                            </span>
                        </div>
                    )}
                </div>
            </section>

            {clip.type === 'audio' && (
                <>
                    <Separator />
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
                                    {hasDenoised && (
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
                                    )}
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
                                    onClick={async () => {
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
                                            notifyUser(
                                                err instanceof Error ? err.message : 'Polyphonic conversion failed',
                                                'error'
                                            );
                                        } finally {
                                            setIsConvertingPoly(false);
                                        }
                                    }}
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
                                    onClick={() => {
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
                                    }}
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
                </>
            )}

            {clip.type === 'midi' && (
                <>
                    <Separator />
                    <section>
                        <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Sparkles className="size-3 text-[var(--color-accent-lavender)]" />
                            AI Actions
                        </h3>
                        <div className="space-y-3">
                            {/* AI Variations */}
                            <div className="bg-surface-raised/50 rounded-md p-2 space-y-1.5 border border-border/30">
                                <div className="flex items-center gap-1.5">
                                    <Music className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />
                                    <span className="text-[10px] font-medium text-foreground/90">AI Variations</span>
                                </div>
                                <p className="text-[9px] text-muted-foreground leading-relaxed">
                                    Generate 3 musical variations (rhythm, passing notes, simplification).
                                </p>
                                <Button
                                    variant="secondary"
                                    size="xs"
                                    className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                                    onClick={async () => {
                                        setIsGeneratingVariations(true);
                                        try {
                                            await generateMidiVariations(clip.id);
                                            notifyAiChange('MIDI variations generated', [
                                                '3 unique musical variations created as alternative clips',
                                            ]);
                                        } catch (err) {
                                            notifyUser(
                                                err instanceof Error ? err.message : 'Variation generation failed',
                                                'error'
                                            );
                                        } finally {
                                            setIsGeneratingVariations(false);
                                        }
                                    }}
                                    disabled={isGeneratingVariations}
                                >
                                    {isGeneratingVariations ? (
                                        <>
                                            <Loader2 className="size-3 mr-1 animate-spin" /> Generating…
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="size-3 mr-1" /> Generate
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
};
