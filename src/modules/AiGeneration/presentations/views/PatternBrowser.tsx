import { type ReactElement, useState, useRef, useLayoutEffect } from 'react';

import { Search, Music, Plus, SlidersHorizontal } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawPickerCard } from '#/components/daw/DawPickerCard';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip, addTrack, selectClipWithFocus } from '#/modules/Arrangement/useCases';
import { batchAddMidiNotes } from '#/modules/MIDI/useCases';
import { getTransportState } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { cn } from '#/utils/Styles/cn';

import {
    PATTERN_CATEGORIES,
    ALL_KEYS,
    SCALE_TYPES,
    SCALE_LABELS,
    ALL_GENRES,
    type PatternCategory,
    type PatternGenre,
    type PatternNote,
    type KeyName,
    type ScaleType,
    type GenerationParams,
} from '../../models/MidiPatternType';
import { filterTemplates } from '../../useCases/patternQueries/filterTemplates';
import { PATTERN_TEMPLATES } from '../../useCases/patternQueries/PATTERN_TEMPLATES';

type PatternTemplate = (typeof PATTERN_TEMPLATES)[number];

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

        // §70.3 — Single-pass min/max; patterns can contain thousands of
        // notes and Math.max(...arr) spreads stack-overflow on large inputs.
        let minPitch = notes[0]!.pitch;
        let maxPitch = minPitch;
        for (let index = 1; index < notes.length; index++) {
            const param = notes[index]!.pitch;
            if (param < minPitch) {
                minPitch = param;
            } else if (param > maxPitch) {
                maxPitch = param;
            }
        }
        minPitch -= 1;
        maxPitch += 1;
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

const CompactSelect = <TValue extends string>({
    label,
    value,
    options,
    onChange,
    allLabel = 'All',
}: {
    label: string;
    value: TValue | undefined;
    options: { id: TValue; label: string }[];
    onChange: (v: TValue | undefined) => void;
    allLabel?: string;
}): ReactElement => (
    <Stack gap={0.5}>
        <DawEyebrowLabel>{label}</DawEyebrowLabel>
        <DawCompactSelect
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value ? (event.target.value as TValue) : undefined)}
            className="border-border/60 bg-surface-base px-1 text-[11px] text-foreground/90 focus-visible:ring-purple-500/50"
            aria-label={label}
        >
            <option value="">{allLabel}</option>
            {options.map((output) => (
                <option key={output.id} value={output.id}>
                    {output.label}
                </option>
            ))}
        </DawCompactSelect>
    </Stack>
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
    <Stack gap={0.5}>
        <Row justify="between">
            <DawEyebrowLabel>{label}</DawEyebrowLabel>
            <span className="text-[9px] text-muted-foreground/50 tabular-nums">{value}</span>
        </Row>
        <Slider
            value={[value]}
            min={min}
            max={max}
            step={1}
            className="pt-0.5"
            aria-label={label}
            onValueChange={(values) => {
                const nextValue = values[0];
                if (nextValue !== undefined) {
                    onChange(nextValue);
                }
            }}
        />
    </Stack>
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
    onInsert: (t: PatternTemplate, notes: PatternNote[]) => void;
}): ReactElement => {
    // §14.3.1 — generate once per (template, genParams) combo so the preview
    // and the "Insert" button operate on the same notes. Random templates
    // previously generated twice and inserted a different pattern than the
    // one shown in the mini piano-roll.
    // §14.6 / G6 — honour the template's `scaleOverride` so identity-carrying
    // templates (Blues, Dorian Vamp, etc.) do not run on an incompatible scale.
    const notes = template.generate(genParams);

    return (
        <DawPickerCard
            className="hover:border-[var(--color-accent-lavender)]/30"
            media={
                <div className="px-1.5 pb-1 pt-1.5">
                    <MiniPianoRoll notes={notes} lengthBeats={template.lengthBeats} />
                </div>
            }
            heading={<span className="truncate pr-1">{template.name}</span>}
            action={
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--color-accent-lavender)]/20 hover:text-[var(--color-accent-lavender)]"
                    onClick={() => onInsert(template, notes)}
                    title="Insert at playhead"
                    aria-label={`Insert ${template.name} at playhead`}
                >
                    <Plus className="size-3" />
                </Button>
            }
            meta={
                <Row wrap gap={1}>
                    <DawMicroBadge
                        rounded="full"
                        className={cn(categoryBgColors[template.category], categoryColors[template.category])}
                    >
                        {template.category}
                    </DawMicroBadge>
                    <span className="text-[9px] text-muted-foreground/50">{template.lengthBeats}b</span>
                </Row>
            }
            description={template.description}
        />
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

    const handleInsertTemplate = (template: PatternTemplate, notes: PatternNote[]): void => {
        const tState = trackStore.value;
        const selectedTrackId = tState?.selectedTrackId;
        let targetTrackId: string | undefined = tState?.tracks.find(
            (time) => time.id === selectedTrackId && time.kind === 'midi'
        )?.id;
        if (!targetTrackId) {
            targetTrackId = tState?.tracks.find((time) => time.kind === 'midi')?.id;
        }
        // §14.3 / G4 — the AI generation handler auto-creates a MIDI track
        // when none exists. The pattern browser used to silently return,
        // which made the whole panel feel broken on audio-only sessions.
        if (!targetTrackId) {
            const created = addTrack({ name: `Pattern: ${template.name}`, kind: 'midi' });
            if (!created) {
                notifyUser('Could not insert pattern — no MIDI track available', 'error');
                return;
            }
            targetTrackId = created.id;
        }

        const transport = getTransportState();
        const startBeat = transport ? transport.playheadPosition : 0;
        const endBeat = startBeat + template.lengthBeats;

        const clip = addClip({
            trackId: targetTrackId,
            startBeat,
            endBeat,
            name: `🎵 ${template.name} (${key})`,
            type: 'midi',
        });

        if (!clip) {
            notifyUser('Could not insert pattern — clip creation failed', 'error');
            return;
        }

        // §14.4 — single-shot store write so inserting a 48-beat pattern
        // doesn't flood subscribers with one `midiStore.set` per note.
        batchAddMidiNotes(
            clip.id,
            notes.map((note) => ({
                pitch: note.pitch,
                startBeat: note.startBeat,
                duration: note.durationBeats,
                velocity: note.velocity,
            }))
        );
        // §14.3 / G3 — use `selectClipWithFocus` so selection-aware surfaces
        // (TakesSection, multi-select, shortcut targets) see the new clip as
        // well, not just the single `selectedClipId` scalar.
        selectClipWithFocus(clip.id);
        notifyUser(`Inserted ${template.name} (${notes.length} notes)`, 'success');
    };

    const keyOptions = ALL_KEYS.map((kIndex) => ({ id: kIndex, label: kIndex }));
    const scaleOptions = SCALE_TYPES.map((state) => ({ id: state, label: SCALE_LABELS[state] }));
    const genreOptions = ALL_GENRES;

    return (
        <Stack gap={2}>
            {/* Search + controls toggle */}
            <Row align="stretch" gap={1}>
                <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
                    <DawCompactInput
                        type="text"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search patterns..."
                        size="sm"
                        className="w-full border-border/60 bg-surface-base pl-7 pr-2"
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
            </Row>
            {/* Generation controls */}
            {showControls ? (
                <Stack gap={2} className="bg-surface-base/60 border border-border/40 rounded-lg p-2">
                    <Grid cols={3} gap={2}>
                        <CompactSelect
                            label="Key"
                            value={key}
                            options={keyOptions}
                            onChange={(value) => setKey(value ?? 'C')}
                            allLabel="C"
                        />
                        <CompactSelect
                            label="Scale"
                            value={scale}
                            options={scaleOptions}
                            onChange={(value) => setScale(value ?? 'minor')}
                            allLabel="Minor"
                        />
                        <CompactSelect
                            label="Genre"
                            value={activeGenre}
                            options={genreOptions}
                            onChange={setActiveGenre}
                        />
                    </Grid>
                    <Grid cols={2} gap={3}>
                        <ParamSlider label="Density" value={density} onChange={setDensity} />
                        <ParamSlider label="Complexity" value={complexity} onChange={setComplexity} />
                    </Grid>
                </Stack>
            ) : null}
            {/* Category filter */}
            <Row align="stretch" wrap gap={1}>
                <Button
                    variant="bare"
                    size="bare"
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
                </Button>
                {PATTERN_CATEGORIES.map((cat) => (
                    <Button
                        variant="bare"
                        size="bare"
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
                    </Button>
                ))}
                <span className="text-[9px] text-muted-foreground/40 self-center ml-auto">
                    {filteredTemplates.length}/{PATTERN_TEMPLATES.length}
                </span>
            </Row>
            {/* Template grid */}
            {filteredTemplates.length === 0 ? (
                <Stack align="center" justify="center" className="py-8 text-muted-foreground opacity-60">
                    <Music className="size-6 mb-2 opacity-50" />
                    <span className="text-[11px]">No patterns match your filters</span>
                </Stack>
            ) : (
                <Grid cols={2} gap={2}>
                    {filteredTemplates.map((template) => (
                        <TemplateCard
                            key={template.id}
                            template={template}
                            genParams={genParams}
                            onInsert={handleInsertTemplate}
                        />
                    ))}
                </Grid>
            )}
        </Stack>
    );
};
