import { type ReactElement, useState } from 'react';

import { Sparkles, Eye, EyeOff } from 'lucide-react';

import { DawStatusDot } from '#/components/daw/DawStatusDot';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Separator } from '#/components/ui/separator';
import { configureCloudApi, removeCloudApi, isCloudAvailable, resolveBackend } from '#/modules/AiRuntime/useCases';
import { CapabilityReportPanel, ModelManagerPanel } from '#/modules/BrowserAi/presentations/views';
import { cn } from '#/utils/Styles/cn';

import { SectionTitle, FieldGroup } from '../preferencesShared';

export const AiSection = (): ReactElement => {
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const backend = resolveBackend();

    return (
        <>
            <SectionTitle icon={<Sparkles className="size-4" />} title="AI" />

            <FieldGroup label="Active Backend">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium',
                            backend === 'native' &&
                                'bg-[var(--color-state-success)]/15 text-[var(--color-state-success)]',
                            backend === 'webllm' && 'bg-[var(--color-accent-cyan)]/15 text-[var(--color-accent-cyan)]',
                            backend === 'cloud' &&
                                'bg-[var(--color-accent-lavender)]/15 text-[var(--color-accent-lavender)]',
                            backend === 'none' && 'bg-muted text-muted-foreground'
                        )}
                    >
                        <DawStatusDot
                            tone={
                                backend === 'native'
                                    ? 'success'
                                    : backend === 'webllm'
                                      ? 'cyan'
                                      : backend === 'cloud'
                                        ? 'primary'
                                        : 'muted'
                            }
                        />
                        {backend === 'native'
                            ? 'Native (in-process)'
                            : backend === 'cloud'
                              ? 'Cloud (Claude)'
                              : backend === 'webllm'
                                ? 'Browser (WebLLM)'
                                : 'None'}
                    </span>
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="Cloud AI (Anthropic API)">
                <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
                    Enter your Anthropic API key to enable cloud AI features. Uses Claude Sonnet for the highest quality
                    tool calling. Keys are stored in memory only — not persisted.
                </p>
                <div className="flex gap-1.5">
                    <div className="relative flex-1">
                        <Input
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="sk-ant-api03-..."
                            className="h-8 text-xs font-mono pr-8"
                            aria-label="Anthropic API key"
                        />
                        <button
                            type="button"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowKey((prev) => !prev)}
                            aria-label={showKey ? 'Hide API key' : 'Show API key'}
                        >
                            {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                        </button>
                    </div>
                    <Button
                        size="sm"
                        className="h-8 text-xs"
                        disabled={!apiKey.trim()}
                        onClick={() => {
                            configureCloudApi(apiKey.trim());
                            setApiKey('');
                        }}
                    >
                        Save
                    </Button>
                </div>

                <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-muted-foreground">
                        Status:{' '}
                        <span
                            className={
                                isCloudAvailable()
                                    ? 'text-[var(--color-state-success)]'
                                    : 'text-[var(--color-state-warning)]'
                            }
                        >
                            {isCloudAvailable() ? 'Connected' : 'Not configured'}
                        </span>
                    </span>
                    {isCloudAvailable() ? (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-destructive text-[10px]"
                            onClick={removeCloudApi}
                        >
                            Remove Key
                        </Button>
                    ) : null}
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="Browser AI">
                <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                    Instrument synthesis (DDSP), vocal previews (Kokoro TTS), and singing voice synthesis (DiffSinger) —
                    all running in the browser via WebGPU on Chrome. No server required.
                </p>
                <div className="border border-border/30 rounded overflow-hidden">
                    <CapabilityReportPanel />
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="AI Model Manager">
                <div className="border border-border/30 rounded overflow-hidden max-h-[400px] overflow-y-auto">
                    <ModelManagerPanel />
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="Audio Analysis">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Audio analysis features (pitch detection, spectral analysis, polyphonic audio-to-MIDI) run entirely
                    in the browser. No API key required.
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1.5 text-[10px]">
                    <span className="text-muted-foreground">Polyphonic MIDI</span>
                    <span className="text-right text-foreground">@spotify/basic-pitch</span>
                    <span className="text-muted-foreground">Pitch Detection</span>
                    <span className="text-right text-foreground">pitchy (McLeod)</span>
                    <span className="text-muted-foreground">Feature Extraction</span>
                    <span className="text-right text-foreground">meyda</span>
                </div>
            </FieldGroup>
        </>
    );
};
