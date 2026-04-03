import { type ReactElement, useState, useRef, useLayoutEffect } from 'react';
import { Search, Music, Plus, SlidersHorizontal } from 'lucide-react';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { Button } from '#/components/ui/button';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { cn } from '#/helpers/Styles/cn';
import {
    PATTERN_CATEGORIES,
    PATTERN_TEMPLATES,
    ALL_KEYS,
    SCALE_TYPES,
    SCALE_LABELS,
    ALL_GENRES,
    filterTemplates,
    type PatternTemplate,
    type PatternCategory,
    type PatternGenre,
    type PatternNote,
    type KeyName,
    type ScaleType,
    type GenerationParams,
} from '../../models/midiPatternLibrary';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { addMidiNote } from '#/modules/MIDI/useCases/midiNoteCrud';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { selectClip } from '#/modules/Workspace/useCases/togglePanel/panelToggles';

// ── Mini piano-roll preview ──

const PREVIEW_HEIGHT = 32;
const PREVIEW_PADDING = 2;

const MiniPianoRoll = ({ notes, lengthBeats }: { notes: PatternNote[]; lengthBeats: number }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || notes.length === 0) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = PREVIEW_HEIGHT;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const pitches = notes.map((n) => n.pitch);
        const minPitch = Math.min(...pitches) - 1;
        const maxPitch = Math.max(...pitches) + 1;
        const pitchRange = maxPitch - minPitch || 1;
        const pxPerBeat = (width - PREVIEW_PADDING * 2) / lengthBeats;
        const noteHeight = Math.max(2, (height - PREVIEW_PADDING * 2) / pitchRange);

        ctx.fillStyle = 'rgb(168, 155, 196)';
        for (const note of notes) {
            const x = PREVIEW_PADDING + note.startBeat * pxPerBeat;
            const y = PREVIEW_PADDING + (maxPitch - note.pitch) * noteHeight;
            const w = Math.max(1, note.durationBeats * pxPerBeat - 0.5);
            const h = Math.max(1.5, noteHeight - 0.5);
            ctx.globalAlpha = 0.3 + (note.velocity / 127) * 0.7;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, 1);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }, [notes, lengthBeats]);

    return <canvas ref={canvasRef} className="w-full" style={{ height: PREVIEW_HEIGHT }} aria-hidden="true" />;
};

// ── Compact select component ──

const CompactSelect = <T extends string>({
    label,
    value,
    options,
    onChange,
    allLabel = 'All',
}: {
    label: string;
    value: T | undefined;
    options: { id: T; label: string }[];
    onChange: (v: T | undefined) => void;
    allLabel?: string;
}): ReactElement => (
    <div className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-medium">{label}</span>
        <DawCompactSelect
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value ? (e.target.value as T) : undefined)}
            className="border-border/60 bg-surface-base px-1 text-[11px] text-foreground/90 focus-visible:ring-purple-500/50"
            aria-label={label}
        >
            <option value="">{allLabel}</option>
            {options.map((o) => (
                <option key={o.id} value={o.id}>
                    {o.label}
                </option>
            ))}
        </DawCompactSelect>
    </div>
);

// ── Slider control ──

const ParamSlider = ({
    label,
    value,
    onChange,
    min = 1,
    max = 10,
}: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
}): ReactElement => (
    <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-medium">{label}</span>
            <span className="text-[9px] text-muted-foreground/50 tabular-nums">{value}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full h-1 accent-purple-500 cursor-pointer"
            aria-label={label}
        />
    </div>
);

// ── Pattern Card ──

const categoryColors: Record<PatternCategory, string> = {
    chords: 'text-[var(--color-accent-cyan)]',
    bass: 'text-[var(--color-state-danger)]',
    drums: 'text-[var(--color-accent-peach)]',
    melody: 'text-[var(--color-accent-mint)]',
};
const categoryBgColors: Record<PatternCategory, string> = {
    chords: 'bg-[var(--color-accent-cyan)]/10 border-[var(--color-accent-cyan)]/20',
    bass: 'bg-[var(--color-state-danger)]/10 border-[var(--color-state-danger)]/20',
    drums: 'bg-[var(--color-accent-peach)]/10 border-[var(--color-accent-peach)]/20',
    melody: 'bg-[var(--color-accent-mint)]/10 border-[var(--color-accent-mint)]/20',
};

const TemplateCard = ({
    template,
    genParams,
    onInsert,
}: {
    template: PatternTemplate;
    genParams: GenerationParams;
    onInsert: (t: PatternTemplate) => void;
}): ReactElement => {
    const notes = template.generate(genParams);

    return (
        <div className="group relative bg-surface-raised border border-border/40 rounded-lg overflow-hidden hover:border-[var(--color-accent-lavender)]/40 transition-all duration-200">
            <div className="bg-surface-base/80 border-b border-border/20 px-1.5 pt-1.5 pb-1">
                <MiniPianoRoll notes={notes} lengthBeats={template.lengthBeats} />
            </div>
            <div className="p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-foreground/90 leading-none truncate pr-1">
                        {template.name}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--color-accent-lavender)]/20 hover:text-[var(--color-accent-lavender)]"
                        onClick={() => onInsert(template)}
                        title="Insert at playhead"
                        aria-label={`Insert ${template.name} at playhead`}
                    >
                        <Plus className="size-3" />
                    </Button>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                    <DawMicroBadge
                        rounded="full"
                        className={cn(categoryBgColors[template.category], categoryColors[template.category])}
                    >
                        {template.category}
                    </DawMicroBadge>
                    <span className="text-[9px] text-muted-foreground/50">{template.lengthBeats}b</span>
                </div>
                <p className="text-[9px] text-muted-foreground/60 leading-tight line-clamp-1">{template.description}</p>
            </div>
        </div>
    );
};

// ── Pattern Browser ──

export const PatternBrowser = (): ReactElement => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<PatternCategory | undefined>(undefined);
    const [activeGenre, setActiveGenre] = useState<PatternGenre | undefined>(undefined);
    const [showControls, setShowControls] = useState(true);

    // Generation params
    const [key, setKey] = useState<KeyName>('C');
    const [scale, setScale] = useState<ScaleType>('minor');
    const [density, setDensity] = useState(5);
    const [complexity, setComplexity] = useState(5);

    const genParams: GenerationParams = { key, scale, density, complexity };

    const filteredTemplates = filterTemplates({
        query: searchQuery || undefined,
        category: activeCategory,
        genres: activeGenre ? [activeGenre] : undefined,
    });

    const handleInsertTemplate = (template: PatternTemplate): void => {
        const tState = trackStore.value;
        const selectedTrackId = tState?.selectedTrackId;
        let targetTrack = tState?.tracks.find((t) => t.id === selectedTrackId && t.kind === 'midi');
        if (!targetTrack) {
            targetTrack = tState?.tracks.find((t) => t.kind === 'midi');
        }
        if (!targetTrack) {
            return;
        }

        const transport = getTransportState();
        const startBeat = transport ? transport.playheadPosition : 0;
        const notes = template.generate(genParams);
        const endBeat = startBeat + template.lengthBeats;

        const clip = addClip({
            trackId: targetTrack.id,
            startBeat,
            endBeat,
            name: `🎵 ${template.name} (${key})`,
            type: 'midi',
        });

        if (clip) {
            for (const note of notes) {
                addMidiNote(clip.id, note.pitch, note.startBeat, note.durationBeats, note.velocity);
            }
            // Open the new clip in the clip editor
            selectClip(clip.id);
        }
    };

    const keyOptions = ALL_KEYS.map((k) => ({ id: k, label: k }));
    const scaleOptions = SCALE_TYPES.map((s) => ({ id: s, label: SCALE_LABELS[s] }));
    const genreOptions = ALL_GENRES;

    return (
        <div className="space-y-2">
            {/* Search + controls toggle */}
            <div className="flex gap-1">
                <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search patterns..."
                        className="w-full h-7 bg-surface-base border border-border/60 rounded-md pl-7 pr-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                        aria-label="Search MIDI patterns"
                    />
                </div>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn('h-7 w-7 shrink-0', showControls && 'bg-accent text-accent-foreground')}
                    onClick={() => setShowControls(!showControls)}
                    title="Toggle generation controls"
                    aria-label="Toggle generation controls"
                >
                    <SlidersHorizontal className="size-3.5" />
                </Button>
            </div>

            {/* Generation controls */}
            {showControls ? (
                <div className="bg-surface-base/60 border border-border/40 rounded-lg p-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                        <CompactSelect
                            label="Key"
                            value={key}
                            options={keyOptions}
                            onChange={(v) => setKey(v ?? 'C')}
                            allLabel="C"
                        />
                        <CompactSelect
                            label="Scale"
                            value={scale}
                            options={scaleOptions}
                            onChange={(v) => setScale(v ?? 'minor')}
                            allLabel="Minor"
                        />
                        <CompactSelect
                            label="Genre"
                            value={activeGenre}
                            options={genreOptions}
                            onChange={setActiveGenre}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <ParamSlider label="Density" value={density} onChange={setDensity} />
                        <ParamSlider label="Complexity" value={complexity} onChange={setComplexity} />
                    </div>
                </div>
            ) : null}

            {/* Category filter */}
            <div className="flex gap-1 flex-wrap">
                <button
                    type="button"
                    className={cn(
                        'px-2 py-1 text-[10px] rounded-md font-medium transition-colors',
                        !activeCategory
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground'
                    )}
                    onClick={() => setActiveCategory(undefined)}
                >
                    All
                </button>
                {PATTERN_CATEGORIES.map((cat) => (
                    <button
                        key={cat.id}
                        type="button"
                        className={cn(
                            'px-2 py-1 text-[10px] rounded-md font-medium transition-colors',
                            activeCategory === cat.id
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground'
                        )}
                        onClick={() => setActiveCategory(activeCategory === cat.id ? undefined : cat.id)}
                    >
                        {cat.label}
                    </button>
                ))}
                <span className="text-[9px] text-muted-foreground/40 self-center ml-auto">
                    {filteredTemplates.length}/{PATTERN_TEMPLATES.length}
                </span>
            </div>

            {/* Template grid */}
            {filteredTemplates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground opacity-60">
                    <Music className="size-6 mb-2 opacity-50" />
                    <span className="text-[11px]">No patterns match your filters</span>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2">
                    {filteredTemplates.map((template) => (
                        <TemplateCard
                            key={template.id}
                            template={template}
                            genParams={genParams}
                            onInsert={handleInsertTemplate}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
