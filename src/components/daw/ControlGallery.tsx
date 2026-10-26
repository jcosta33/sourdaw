import { useState, type ReactElement } from 'react';

import { DawDisplaySurface } from './DawDisplaySurface';
import { DawMeterBar } from './DawMeterBar';
import { DawPluginToggle } from './DawPluginToggle';
import { Fader } from './Fader';
import { LED } from './LED';
import { RotaryKnob } from './RotaryKnob';
import { FADER_MAX_GAIN, formatGainDb } from '#/utils/audioLevelLaw';
import tokenSource from '#/styles/tokens.css?raw';

type DesignToken = { name: string; value: string };

function readDesignTokens(source: string): DesignToken[] {
    const tokens = new Map<string, string>();
    for (const match of source.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
        const name = match[1];
        const value = match[2];
        if (name !== undefined && value !== undefined) {
            tokens.set(name, value.trim());
        }
    }
    return Array.from(tokens, ([name, value]) => ({ name, value }));
}

const DEFAULT_DESIGN_TOKENS = readDesignTokens(tokenSource);

function GallerySection({ title, children }: { title: string; children: ReactElement | ReactElement[] }): ReactElement {
    const headingId = `control-gallery-${title.toLowerCase().replaceAll(' ', '-')}`;
    return (
        <section aria-labelledby={headingId} className="rounded-md border border-border bg-bg-panel p-4">
            <h2 id={headingId} className="mb-4 text-sm font-semibold text-text-primary">
                {title}
            </h2>
            <div className="flex flex-wrap items-center gap-5">{children}</div>
        </section>
    );
}

export function ControlGallery({ tokenCss = tokenSource }: { tokenCss?: string }): ReactElement {
    const designTokens = tokenCss === tokenSource ? DEFAULT_DESIGN_TOKENS : readDesignTokens(tokenCss);
    const [knobValue, setKnobValue] = useState(0.62);
    const [gain, setGain] = useState(1);
    const [enabled, setEnabled] = useState(true);
    const [meter, setMeter] = useState(68);

    return (
        <main className="min-h-screen bg-bg-app p-6 text-text-primary">
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
                <header>
                    <p className="text-xs uppercase tracking-widest text-text-muted">Development only</p>
                    <h1 className="mt-1 text-2xl font-semibold">Sourdaw control gallery</h1>
                    <p className="mt-2 max-w-3xl text-sm text-text-secondary">
                        Shared controls rendered in supported states. Interactions use local demo state and do not
                        change a project.
                    </p>
                </header>

                <GallerySection title="Knob">
                    <div className="flex items-end gap-6">
                        <div className="flex flex-col items-center gap-2">
                            <RotaryKnob
                                value={knobValue}
                                onChange={setKnobValue}
                                min={0}
                                max={1}
                                step={0.01}
                                label="Width"
                            />
                            <output aria-label="Knob value">{Math.round(knobValue * 100)}%</output>
                        </div>
                        <RotaryKnob value={0.35} onChange={() => {}} min={0} max={1} label="Learning" isLearning />
                        <RotaryKnob value={0.8} onChange={() => {}} min={0} max={1} label="Mapped" isMapped />
                    </div>
                </GallerySection>

                <GallerySection title="Fader">
                    <div className="flex items-end gap-6">
                        <div className="flex flex-col items-center gap-2 px-8 pt-6">
                            <Fader
                                value={gain}
                                onChange={setGain}
                                min={0}
                                max={FADER_MAX_GAIN}
                                valueScale="gain"
                                unityValue={1}
                                step={0.01}
                                fineStep={0.001}
                                height={180}
                                showScale
                                aria-label="Gallery gain fader"
                            />
                            <output aria-label="Fader value">{formatGainDb(gain)} dB</output>
                        </div>
                        <div className="flex flex-col items-start gap-3 text-xs text-text-secondary">
                            <span>
                                Silence: <code>0</code>
                            </span>
                            <span>
                                Unity: <code>1.0</code> at 70% throw
                            </span>
                            <span>
                                Headroom: <code>{FADER_MAX_GAIN.toFixed(3)}</code>
                            </span>
                        </div>
                    </div>
                </GallerySection>

                <GallerySection title="Toggle">
                    <div className="flex items-center gap-3">
                        <DawPluginToggle
                            pressed={enabled}
                            tone="amber"
                            aria-label="Gallery bypass"
                            onClick={() => setEnabled((current) => !current)}
                        />
                        <span aria-live="polite">{enabled ? 'Enabled' : 'Bypassed'}</span>
                    </div>
                </GallerySection>

                <GallerySection title="LED">
                    <div className="flex items-center gap-2">
                        <LED on={false} variant="cyan" />
                        <span>Idle</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <LED on variant="mint" />
                        <span>Signal</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <LED on variant="red" />
                        <span>Clipping</span>
                    </div>
                </GallerySection>

                <GallerySection title="Meter">
                    <div className="flex w-full max-w-md flex-col gap-3">
                        <div
                            role="meter"
                            aria-label="Gallery level meter"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={meter}
                        >
                            <DawMeterBar value={meter} />
                        </div>
                        <div className="flex gap-2">
                            {[22, 68, 100].map((level) => (
                                <button
                                    key={level}
                                    type="button"
                                    className="rounded border border-border px-2 py-1 text-xs"
                                    aria-pressed={meter === level}
                                    onClick={() => setMeter(level)}
                                >
                                    {level === 100 ? 'Peak' : `${level}%`}
                                </button>
                            ))}
                        </div>
                    </div>
                </GallerySection>

                <GallerySection title="Display">
                    <DawDisplaySurface className="min-w-56 justify-start font-mono text-sm">
                        −12.4 dBFS
                    </DawDisplaySurface>
                    <DawDisplaySurface accentTop className="min-w-56 justify-start font-mono text-sm text-state-record">
                        RECORDING · 00:42
                    </DawDisplaySurface>
                </GallerySection>

                <section
                    aria-labelledby="design-tokens-heading"
                    className="rounded-md border border-border bg-bg-panel p-4"
                >
                    <h2 id="design-tokens-heading" className="mb-3 text-sm font-semibold">
                        Design tokens ({designTokens.length})
                    </h2>
                    <p className="mb-3 text-xs text-text-secondary">
                        Names and values are parsed from <code>src/styles/tokens.css</code>.
                    </p>
                    <ul aria-label="Design tokens" className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                        {designTokens.map(({ name, value }) => (
                            <li
                                key={name}
                                data-token-name={name}
                                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded border border-border/50 px-2 py-1 text-xs"
                            >
                                <code className="truncate text-text-primary">{name}</code>
                                <code className="truncate text-text-secondary" title={value}>
                                    {value}
                                </code>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </main>
    );
}
