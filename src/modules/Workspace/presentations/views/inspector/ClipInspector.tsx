import { type ReactElement, useState } from 'react';
import { Slider } from '#/components/ui/slider';
import { Separator } from '#/components/ui/separator';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { ChevronRight, Sparkles, Volume2, VolumeX, Loader2 } from 'lucide-react';
import {
    trimClipStart,
    trimClipEnd,
    setClipFade,
    setClipGain,
    setClipColor,
    renameClip,
} from '../../../useCases/workspaceViewActions';
import { type Clip } from '../../../useCases/workspaceViewActions';
import { CLIP_COLOR_PRESETS } from './colorPresets';
import { handleAiDenoiseClip, handleStemSeparationPreview } from '#/modules/AiRuntime/useCases/generativeAiActions';
import { audioToMidi } from '#/modules/AiRuntime/useCases/audioToMidi';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';

export type ClipInspectorProps = {
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
                <div className="space-y-2">
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
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Type</label>
                        <span className="text-[10px] font-mono text-foreground capitalize">{clip.type}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Track</label>
                        <span className="text-[10px] font-mono text-foreground">{clip.trackId}</span>
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
                            <Sparkles className="size-3 text-purple-400" />
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
                                    className="w-full h-6 text-[10px] bg-purple-600/20 hover:bg-purple-600/40 text-purple-300"
                                    onClick={handleDenoise}
                                    disabled={isDenoising}
                                >
                                    {isDenoising ? (
                                        <><Loader2 className="size-3 mr-1 animate-spin" /> Denoising…</>
                                    ) : (
                                        <><Sparkles className="size-3 mr-1" /> Apply Denoise</>
                                    )}
                                </Button>
                            </div>

                            {/* Quick AI actions */}
                            <div className="flex gap-1">
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    className="flex-1 h-6 text-[10px] text-purple-400 hover:bg-purple-600/20"
                                    onClick={() => handleStemSeparationPreview(clip.id)}
                                >
                                    Separate Stems
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    className="flex-1 h-6 text-[10px] text-purple-400 hover:bg-purple-600/20"
                                    onClick={() => audioToMidi({ clipId: clip.id, trackId })}
                                >
                                    Audio → MIDI
                                </Button>
                            </div>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
};
