---
name: frontend-a11y
description: >
    Apply when building or modifying UI components. Enforces WCAG 2.x AA compliance, semantic HTML, ARIA guidelines, and Shadcn UI (Radix UI) component usage. Covers DAW-specific patterns: transport buttons, fader sliders, mute/solo toggles, track lists, canvas surfaces, and live regions for AI/transport status. Apply even when the user says "button", "slider", "mute", "transport", "canvas", "timeline", "keyboard navigation", or "screen reader".
---

## Setup

```tsx
// src/modules/Transport/presentations/components/TransportDialog.tsx
import { type ReactElement } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export const TransportSettingsDialog = (): ReactElement => (
    <Dialog>
        <DialogTrigger asChild>
            <Button variant="outline">Transport Settings</Button>
        </DialogTrigger>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Transport Settings</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
                <div className="grid gap-1.5">
                    <Label htmlFor="tempo">Tempo (BPM)</Label>
                    <Input id="tempo" type="number" min={20} max={300} />
                </div>
            </div>
        </DialogContent>
    </Dialog>
);
```

Shadcn UI components are built on Radix UI primitives and handle focus management, keyboard navigation, and ARIA attributes automatically. Always prefer them over custom-built interactive elements.

## Core Patterns

### Transport play/pause button (aria-pressed)

```tsx
// src/modules/Transport/presentations/components/PlayButton.tsx
import { type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { PlayIcon, PauseIcon } from 'lucide-react';

type PlayButtonProps = {
    isPlaying: boolean;
    onToggle: () => void;
};

export const PlayButton = ({ isPlaying, onToggle }: PlayButtonProps): ReactElement => (
    <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-pressed={isPlaying}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        onClick={onToggle}
    >
        {isPlaying ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
    </Button>
);
```

Toggle buttons must use `aria-pressed`. This tells screen readers whether the button is currently active. Update the `aria-label` to reflect the action that will happen (not the current state).

### Fader slider (role="slider" with value attributes)

```tsx
// src/modules/Mixer/presentations/components/Fader.tsx
import { type ReactElement } from 'react';
import { Slider } from '@/components/ui/slider';

type FaderProps = {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    onChange: (value: number) => void;
};

export const Fader = ({ label, value, min = 0, max = 1, step = 0.01, onChange }: FaderProps): ReactElement => (
    <div className="flex flex-col items-center gap-2">
        <span id={`fader-label-${label}`} className="text-xs text-muted-foreground">
            {label}
        </span>
        <Slider
            aria-labelledby={`fader-label-${label}`}
            aria-valuetext={`${Math.round(value * 100)}%`}
            value={[value]}
            min={min}
            max={max}
            step={step}
            orientation="vertical"
            onValueChange={([v]) => onChange(v)}
            className="h-32"
        />
    </div>
);
```

Shadcn `Slider` uses `role="slider"` and manages `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` internally. Provide `aria-labelledby` or `aria-label` and optionally `aria-valuetext` for human-readable values.

### Mute and solo toggle buttons

```tsx
// src/modules/Arrangement/presentations/components/TrackControls.tsx
import { type ReactElement } from 'react';
import { Button } from '@/components/ui/button';

type TrackControlsProps = {
    trackId: string;
    isMuted: boolean;
    isSolo: boolean;
    onToggleMute: () => void;
    onToggleSolo: () => void;
};

export const TrackControls = ({ trackId, isMuted, isSolo, onToggleMute, onToggleSolo }: TrackControlsProps): ReactElement => (
    <div className="flex gap-1" role="group" aria-label="Track controls">
        <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={isMuted}
            aria-label="Mute track"
            onClick={onToggleMute}
            className={isMuted ? 'text-accent-warning' : ''}
        >
            M
        </Button>
        <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={isSolo}
            aria-label="Solo track"
            onClick={onToggleSolo}
            className={isSolo ? 'text-accent-secondary' : ''}
        >
            S
        </Button>
    </div>
);
```

### Track list (role="list" with keyboard navigation)

```tsx
// src/modules/Arrangement/presentations/components/TrackList.tsx
import { type ReactElement } from 'react';

type Track = { id: string; name: string };

type TrackListProps = {
    tracks: Track[];
    selectedId: string | null;
    onSelect: (id: string) => void;
};

export const TrackList = ({ tracks, selectedId, onSelect }: TrackListProps): ReactElement => (
    <ul role="list" aria-label="Tracks" className="flex flex-col">
        {tracks.map((track) => (
            <li key={track.id} role="listitem">
                <button
                    type="button"
                    aria-selected={track.id === selectedId}
                    aria-current={track.id === selectedId ? 'true' : undefined}
                    onClick={() => onSelect(track.id)}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {track.name}
                </button>
            </li>
        ))}
    </ul>
);
```

### Live regions for transport position and AI status

```tsx
// src/modules/Transport/presentations/components/TransportStatus.tsx
import { type ReactElement } from 'react';

type TransportStatusProps = {
    positionLabel: string; // e.g. "Bar 4, Beat 2"
};

export const TransportStatus = ({ positionLabel }: TransportStatusProps): ReactElement => (
    // aria-live="off" — screen readers announce only on user request (for fast-changing values)
    <output aria-live="off" aria-label="Playback position" className="text-sm tabular-nums text-text-secondary">
        {positionLabel}
    </output>
);

// src/modules/AiRuntime/presentations/components/AiStatusBanner.tsx
type AiStatusProps = {
    message: string;
};

export const AiStatusBanner = ({ message }: AiStatusProps): ReactElement => (
    // aria-live="polite" — announced after current speech completes
    <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-text-secondary">
        {message}
    </div>
);
```

Use `aria-live="polite"` for AI status messages. Use `aria-live="off"` for fast-updating values like playback position that would be too noisy to announce continuously.

### Icon-only buttons with aria-label

```tsx
// src/modules/Common/presentations/components/IconButton.tsx
import { type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2Icon } from 'lucide-react';

export const DeleteTrackButton = ({ onDelete }: { onDelete: () => void }): ReactElement => (
    <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Delete track"
        onClick={onDelete}
    >
        <Trash2Icon className="size-4" aria-hidden="true" />
    </Button>
);
```

### Canvas surface with accessible alternative (WebGPU timeline)

```tsx
// src/modules/Arrangement/presentations/components/TimelineCanvas.tsx
import { type ReactElement, useRef } from 'react';

type TimelineCanvasProps = {
    durationSeconds: number;
    positionSeconds: number;
    onSeek: (seconds: number) => void;
};

export const TimelineCanvas = ({ durationSeconds, positionSeconds, onSeek }: TimelineCanvasProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    return (
        <div className="relative" role="region" aria-label="Timeline">
            <canvas
                ref={canvasRef}
                aria-label="Audio timeline"
                aria-description={`Timeline showing ${Math.round(durationSeconds)} seconds. Current position: ${Math.round(positionSeconds)} seconds.`}
                // Keyboard alternative: left/right arrow to seek
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') onSeek(Math.min(positionSeconds + 1, durationSeconds));
                    if (e.key === 'ArrowLeft') onSeek(Math.max(positionSeconds - 1, 0));
                }}
                className="w-full h-full focus-visible:outline-2 focus-visible:outline-ring"
            />
            {/* Visible keyboard hint shown on focus */}
            <p className="sr-only">
                Use left and right arrow keys to move playback position.
            </p>
        </div>
    );
};
```

Canvas and WebGPU surfaces have no built-in semantics. Provide `aria-label`, `aria-description`, and a keyboard-based alternative interaction. Use `tabIndex={0}` to make the canvas focusable.

## Common Mistakes

### CRITICAL div with onClick instead of a button element

Wrong:

```tsx
export const MuteControl = ({ onMute }: { onMute: () => void }): ReactElement => (
    <div onClick={onMute} className="cursor-pointer px-2 py-1">
        M
    </div>
);
```

Correct:

```tsx
export const MuteControl = ({ onMute }: { onMute: () => void }): ReactElement => (
    <Button type="button" variant="ghost" size="sm" aria-pressed={false} aria-label="Mute track" onClick={onMute}>
        M
    </Button>
);
```

A `<div>` with `onClick` is not reachable by keyboard and is not announced as interactive by screen readers. Always use `<button>` or the Shadcn `Button` component for interactive controls.

### CRITICAL Missing aria-label on icon-only buttons

Wrong:

```tsx
<Button type="button" variant="ghost" size="icon" onClick={onDelete}>
    <Trash2Icon className="size-4" />
</Button>
```

Correct:

```tsx
<Button type="button" variant="ghost" size="icon" aria-label="Delete track" onClick={onDelete}>
    <Trash2Icon className="size-4" aria-hidden="true" />
</Button>
```

Icon-only buttons have no visible text label. Without `aria-label`, screen readers announce only the button role with no description. Mark the icon itself as `aria-hidden="true"` to prevent double-announcing.

### CRITICAL Missing labels on form inputs

Wrong:

```tsx
<Input id="tempo" type="number" placeholder="BPM" />
```

Correct:

```tsx
<div className="grid gap-1.5">
    <Label htmlFor="tempo">Tempo (BPM)</Label>
    <Input id="tempo" type="number" min={20} max={300} />
</div>
```

Placeholder text disappears when typing and is not a substitute for a visible label. Every input must have a `<Label>` bound via `htmlFor` / `id`. In Shadcn forms, use `FormLabel` with `FormControl`.

### CRITICAL Canvas surfaces with no accessible alternative

Wrong:

```tsx
<canvas ref={canvasRef} className="w-full h-full" />
```

Correct:

```tsx
<canvas
    ref={canvasRef}
    aria-label="Audio timeline"
    aria-description="Use arrow keys to seek."
    tabIndex={0}
    onKeyDown={handleKeyDown}
    className="w-full h-full focus-visible:outline-2 focus-visible:outline-ring"
/>
```

A bare `<canvas>` is completely opaque to assistive technology. Always add `aria-label`, a description of keyboard interaction, and `tabIndex={0}`.

### HIGH Missing aria-pressed on toggle buttons

Wrong:

```tsx
<Button type="button" variant="ghost" onClick={onToggleMute} className={isMuted ? 'active' : ''}>
    M
</Button>
```

Correct:

```tsx
<Button type="button" variant="ghost" aria-pressed={isMuted} aria-label="Mute track" onClick={onToggleMute}>
    M
</Button>
```

Visual-only state (CSS class) is invisible to screen readers. Toggle buttons must use `aria-pressed` so screen readers can announce the current on/off state.
