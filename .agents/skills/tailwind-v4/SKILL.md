---
name: tailwind-v4
description: >
    Apply when adding styles, building layouts, configuring Tailwind, or theming Shadcn UI components. Covers Tailwind v4 setup with the Vite plugin, CSS-first configuration via @theme, dark-mode-first DAW UI patterns, Shadcn UI CSS variable theming, and v3 → v4 migration pitfalls. Apply even when the user says "style", "layout", "dark mode", "theme", "CSS variable", "utility class", or "Tailwind config".
---

## Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
    ],
});
```

```css
/* src/styles/main.css */
@import "tailwindcss";

@theme {
    /* DAW dark UI color palette */
    --color-surface-base: #0e0e0f;
    --color-surface-raised: #1a1a1d;
    --color-surface-overlay: #242427;
    --color-surface-border: #2e2e33;

    --color-accent-primary: #6c63ff;
    --color-accent-secondary: #3ecfcf;
    --color-accent-danger: #ff4d4f;
    --color-accent-warning: #faad14;

    --color-text-primary: #f0f0f2;
    --color-text-secondary: #a0a0ab;
    --color-text-muted: #5a5a66;

    /* DAW-specific sizing */
    --spacing-track-height: 56px;
    --spacing-transport-height: 48px;
    --spacing-inspector-width: 280px;
    --spacing-sidebar-width: 200px;
}
```

```tsx
// src/main.tsx
import './styles/main.css';
```

Tailwind v4 requires no `tailwind.config.js`. All design tokens are defined in CSS using `@theme {}`. Install with `pnpm add -D tailwindcss @tailwindcss/vite`.

## Core Patterns

### Full-height DAW grid layout

```tsx
// src/modules/Workspace/presentations/views/WorkspaceLayout.tsx
import { type ReactElement } from 'react';

export const WorkspaceLayout = (): ReactElement => {
    return (
        <div className="grid h-screen grid-rows-[var(--spacing-transport-height)_1fr] bg-surface-base text-text-primary overflow-hidden">
            {/* Transport bar */}
            <header className="bg-surface-raised border-b border-surface-border flex items-center px-4 gap-4">
                <TransportControls />
            </header>

            {/* Main workspace */}
            <div className="grid grid-cols-[var(--spacing-sidebar-width)_1fr_var(--spacing-inspector-width)] overflow-hidden">
                <aside className="bg-surface-raised border-r border-surface-border overflow-y-auto">
                    <TrackList />
                </aside>
                <main className="overflow-auto relative">
                    <Timeline />
                </main>
                <aside className="bg-surface-raised border-l border-surface-border overflow-y-auto">
                    <InspectorPanel />
                </aside>
            </div>
        </div>
    );
};
```

### Shadcn UI theming with @theme CSS variables

```css
/* src/styles/main.css */
@import "tailwindcss";

@theme {
    /* Map Shadcn UI CSS variable names into @theme */
    --color-background: hsl(var(--background));
    --color-foreground: hsl(var(--foreground));
    --color-primary: hsl(var(--primary));
    --color-primary-foreground: hsl(var(--primary-foreground));
    --color-secondary: hsl(var(--secondary));
    --color-secondary-foreground: hsl(var(--secondary-foreground));
    --color-muted: hsl(var(--muted));
    --color-muted-foreground: hsl(var(--muted-foreground));
    --color-accent: hsl(var(--accent));
    --color-accent-foreground: hsl(var(--accent-foreground));
    --color-destructive: hsl(var(--destructive));
    --color-border: hsl(var(--border));
    --color-input: hsl(var(--input));
    --color-ring: hsl(var(--ring));
}

/* Dark theme (default for DAW) */
:root {
    --background: 222 14% 6%;
    --foreground: 210 20% 94%;
    --primary: 246 80% 70%;
    --primary-foreground: 0 0% 100%;
    --secondary: 220 13% 18%;
    --secondary-foreground: 210 20% 94%;
    --muted: 220 13% 14%;
    --muted-foreground: 220 9% 55%;
    --accent: 246 80% 70%;
    --accent-foreground: 0 0% 100%;
    --destructive: 0 72% 51%;
    --border: 220 13% 20%;
    --input: 220 13% 18%;
    --ring: 246 80% 70%;
    --radius: 0.375rem;
}
```

Dark mode is the default in the DAW. Shadcn UI components pick up these variables automatically. Apply the `.dark` class on `<html>` if you need to toggle light mode at runtime.

### Dark-mode-first component pattern

```tsx
// src/modules/Track/presentations/components/TrackRow.tsx
import { type ReactElement } from 'react';

type TrackRowProps = {
    name: string;
    isMuted: boolean;
    isSolo: boolean;
    isSelected: boolean;
    onSelect: () => void;
};

export const TrackRow = ({ name, isMuted, isSolo, isSelected, onSelect }: TrackRowProps): ReactElement => {
    return (
        <div
            className={[
                'flex items-center gap-2 px-3 h-[var(--spacing-track-height)] border-b border-surface-border cursor-pointer',
                'hover:bg-surface-overlay transition-colors',
                isSelected ? 'bg-accent-primary/10 border-l-2 border-l-accent-primary' : 'bg-surface-raised',
                isMuted ? 'opacity-50' : '',
            ].join(' ')}
            onClick={onSelect}
        >
            <span className="text-sm text-text-primary truncate flex-1">{name}</span>
            {isSolo && <span className="text-xs text-accent-warning font-semibold">S</span>}
        </div>
    );
};
```

### Arbitrary values and container queries

```tsx
// src/modules/Mixer/presentations/components/ChannelStrip.tsx
import { type ReactElement } from 'react';

export const ChannelStrip = (): ReactElement => {
    return (
        // Container query: adjust layout when strip is narrower than 80px
        <div className="@container flex flex-col bg-surface-raised border-r border-surface-border w-[80px]">
            <div className="@sm:flex-row flex flex-col items-center gap-1 p-2">
                <MuteButton />
                <SoloButton />
            </div>
            {/* Fader with exact pixel height */}
            <div className="flex-1 flex items-center justify-center px-2">
                <input type="range" className="h-[160px] w-2 appearance-none bg-surface-border rounded-full" />
            </div>
            <div className="h-[40px] flex items-center justify-center text-xs text-text-secondary truncate px-1">
                Master
            </div>
        </div>
    );
};
```

### @layer for base and component overrides

```css
/* src/styles/main.css */
@import "tailwindcss";

@layer base {
    * {
        box-sizing: border-box;
    }

    html {
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 14px;
    }

    ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }

    ::-webkit-scrollbar-track {
        background: var(--color-surface-base);
    }

    ::-webkit-scrollbar-thumb {
        background: var(--color-surface-border);
        border-radius: 3px;
    }
}

@layer components {
    .daw-panel {
        @apply bg-surface-raised border border-surface-border rounded-sm overflow-hidden;
    }

    .daw-button-icon {
        @apply size-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors;
    }
}
```

## Common Mistakes

### CRITICAL v3 opacity modifier syntax no longer works

Wrong:

```tsx
// v3 syntax — does not work in v4
<div className="bg-black bg-opacity-50 text-white text-opacity-75 border-gray-500 border-opacity-30" />
```

Correct:

```tsx
// v4 uses slash syntax
<div className="bg-black/50 text-white/75 border-gray-500/30" />
```

In Tailwind v4, `bg-opacity-*`, `text-opacity-*`, and `border-opacity-*` are removed. Use the slash modifier directly on the color utility.

### CRITICAL No tailwind.config.js — use @theme in CSS

Wrong:

```js
// tailwind.config.js — not used in v4
module.exports = {
    theme: {
        extend: {
            colors: {
                surfaceBase: '#0e0e0f',
            },
        },
    },
};
```

Correct:

```css
/* src/styles/main.css */
@theme {
    --color-surface-base: #0e0e0f;
}
```

Tailwind v4 is CSS-first. All design tokens are defined in `@theme {}` inside your CSS file. The `tailwind.config.js` file is not needed and will be ignored.

### HIGH Using @tailwindcss/postcss instead of the Vite plugin

Wrong:

```ts
// vite.config.ts — using PostCSS plugin instead of Vite plugin
import tailwindcss from '@tailwindcss/postcss'; // wrong package for Vite
```

Correct:

```ts
// vite.config.ts
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
});
```

Always use `@tailwindcss/vite` (not `@tailwindcss/postcss`) when the project uses Vite. The Vite plugin is faster and integrates directly without a separate PostCSS config.

### HIGH Forgetting to import tailwindcss in the CSS entry point

Wrong:

```css
/* missing the import — no utilities available */
@theme {
    --color-surface-base: #0e0e0f;
}
```

Correct:

```css
@import "tailwindcss";

@theme {
    --color-surface-base: #0e0e0f;
}
```

The `@import "tailwindcss"` line must come first. Without it, no utility classes are generated.

### HIGH Hardcoding pixel values instead of using @theme tokens

Wrong:

```tsx
<div className="h-[56px] w-[200px] bg-[#1a1a1d]" />
```

Correct:

```tsx
<div className="h-[var(--spacing-track-height)] w-[var(--spacing-sidebar-width)] bg-surface-raised" />
```

Define DAW-specific dimensions and colors as `@theme` tokens. Arbitrary values are acceptable for truly one-off sizes, but repeated magic numbers must be extracted to tokens.
