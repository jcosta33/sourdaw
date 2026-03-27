import { type ReactElement, useState } from 'react';
import { Slider } from '#/components/ui/slider';
import { Separator } from '#/components/ui/separator';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { ChevronRight } from 'lucide-react';
import { trimClipStart } from '#/modules/Arrangement/useCases/clipEditing/trimClipStart';
import { trimClipEnd } from '#/modules/Arrangement/useCases/clipEditing/trimClipEnd';
import { setClipFade } from '#/modules/Arrangement/useCases/clipEditing/setClipFade';
import { setClipGain } from '#/modules/Arrangement/useCases/clipEditing/setClipGain';
import { setClipColor } from '#/modules/Arrangement/useCases/clipEditing/setClipColor';
import { renameClip } from '#/modules/Arrangement/useCases/clipEditing/renameClip';
import { setClipFollowAction } from '#/modules/Arrangement/useCases/clipEditing/setClipFollowAction';
import { type Clip } from '#/modules/Arrangement/models/Track';
import { CLIP_COLOR_PRESETS } from '#/helpers/UI/colorPresets';
import { ClipGainEnvelopeSection } from './ClipGainEnvelopeSection';
import { ClipAudioAiSection } from './ClipAudioAiSection';
import { ClipMidiAiSection } from './ClipMidiAiSection';

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

    const commitClipName = (): void => {
        const trimmed = nameValue.trim();
        if (trimmed && trimmed !== clip.name) {
            renameClip(clip.id, trimmed);
        }
        setEditingName(false);
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

            <ClipGainEnvelopeSection clipId={clip.id} duration={duration} />

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
                    {clip.type === 'audio' ? (
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] text-muted-foreground">Audio Source</label>
                            <span className="text-[10px] font-mono text-foreground truncate max-w-24">
                                {clip.audioBufferId ? `${clip.audioBufferId.slice(0, 16)}…` : 'none'}
                            </span>
                        </div>
                    ) : null}
                </div>
            </section>

            {clip.type === 'audio' ? (
                <>
                    <Separator />
                    <ClipAudioAiSection clip={clip} trackId={trackId} />
                </>
            ) : null}

            {clip.type === 'midi' ? (
                <>
                    <Separator />
                    <ClipMidiAiSection clipId={clip.id} />
                </>
            ) : null}
        </div>
    );
};
