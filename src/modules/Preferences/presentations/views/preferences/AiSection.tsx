import { type ReactElement, useState } from 'react';

import { Sparkles } from 'lucide-react';

import { DawStatusDot } from '#/components/daw/DawStatusDot';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Separator } from '#/components/ui/separator';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';
import { useStore } from '#/infra/store/useStore';
import { aiBackendPreferenceStore, hostedLlmProviderStatusStore, llmStatusStore } from '#/modules/AiRuntime/stores';
import {
    configureCloudProvider,
    removeCloudProvider,
    resolveBackend,
    setAiBackendPreference,
} from '#/modules/AiRuntime/useCases';
import { CapabilityReportPanel, ModelManagerPanel } from '#/modules/BrowserAi/presentations/views';
import { getPlatformCapabilities } from '#/utils/platformCapabilities';
import { cn } from '#/utils/Styles/cn';

import { SectionTitle, FieldGroup } from '../preferencesShared';

type HostedProviderSelection = 'anthropic' | 'openai' | 'openai-compatible';
type BackendSelection = 'auto' | 'webllm' | 'cloud';

type HostedModelOption = {
    label: string;
    value: string;
};

type SelectedBackendInput = {
    backend: 'webllm' | 'cloud' | 'none';
    preference: 'auto' | BackendSelection;
};

const HOSTED_MODEL_OPTIONS: Record<Exclude<HostedProviderSelection, 'openai-compatible'>, HostedModelOption[]> = {
    anthropic: [
        { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 — Recommended' },
        { value: 'claude-fable-5', label: 'Claude Fable 5 — Highest quality' },
        { value: 'claude-opus-5', label: 'Claude Opus 5 — Agentic and enterprise' },
        { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — Faster, lower cost' },
    ],
    openai: [
        { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra — Recommended' },
        { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol — Highest quality' },
        { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna — Faster, lower cost' },
    ],
};

const CUSTOM_MODEL_VALUE = 'custom';

const DEFAULT_MODELS: Record<HostedProviderSelection, string> = {
    anthropic: HOSTED_MODEL_OPTIONS.anthropic[0]!.value,
    openai: HOSTED_MODEL_OPTIONS.openai[0]!.value,
    'openai-compatible': '',
};

function isHostedProviderSelection(value: string): value is HostedProviderSelection {
    return value === 'anthropic' || value === 'openai' || value === 'openai-compatible';
}

function isBackendSelection(value: string): value is BackendSelection {
    return value === 'auto' || value === 'webllm' || value === 'cloud';
}

function getSelectedBackend({ backend, preference }: SelectedBackendInput): BackendSelection {
    if (preference === 'webllm' && !MODEL_RELEASE_ADMISSION.webLlm) {
        return 'auto';
    }
    if (preference !== 'auto') {
        return preference;
    }
    if (backend !== 'none') {
        return backend;
    }
    return MODEL_RELEASE_ADMISSION.webLlm ? 'webllm' : 'auto';
}

function getProviderLabel(provider: HostedProviderSelection): string {
    if (provider === 'anthropic') {
        return 'Anthropic';
    }
    if (provider === 'openai') {
        return 'OpenAI';
    }
    return 'OpenAI-compatible';
}

export const AiSection = (): ReactElement => {
    const backendPreference = useStore(aiBackendPreferenceStore, 'auto');
    const configuredProvider = useStore(hostedLlmProviderStatusStore, null);
    const llmStatus = useStore(llmStatusStore, { state: 'idle' });
    const [provider, setProvider] = useState<HostedProviderSelection>(configuredProvider?.provider ?? 'anthropic');
    const [model, setModel] = useState(
        configuredProvider?.model ?? DEFAULT_MODELS[configuredProvider?.provider ?? 'anthropic']
    );
    const [baseUrl, setBaseUrl] = useState(configuredProvider?.baseUrl ?? '');
    const [configurationError, setConfigurationError] = useState<string | null>(null);
    const [configurationPending, setConfigurationPending] = useState(false);
    const hostedProvidersAvailable = getPlatformCapabilities().isDesktopApp;
    const backend = llmStatus.state === 'ready' ? llmStatus.backend : resolveBackend();
    let selectedBackend: BackendSelection;
    if (hostedProvidersAvailable) {
        selectedBackend = getSelectedBackend({ backend, preference: backendPreference });
    } else {
        selectedBackend = MODEL_RELEASE_ADMISSION.webLlm ? 'webllm' : 'auto';
    }
    const cloudAvailable = configuredProvider !== null;
    const modelOptions = provider === 'openai-compatible' ? [] : HOSTED_MODEL_OPTIONS[provider];
    const customFirstPartyModel =
        provider !== 'openai-compatible' && !modelOptions.some((option) => option.value === model);
    const renderIife_16 = () => {
        if (backend === 'webllm') {
            return 'cyan';
        }
        if (backend === 'cloud') {
            return 'primary';
        }
        return 'muted';
    };
    const renderIife_17 = () => {
        if (backend === 'cloud') {
            if (configuredProvider) {
                return `Cloud (${getProviderLabel(configuredProvider.provider)})`;
            }
            return 'Cloud (Hosted)';
        }
        if (backend === 'webllm') {
            return 'Browser (WebLLM)';
        }
        return 'None';
    };
    const saveHostedProvider = async (): Promise<void> => {
        setConfigurationPending(true);
        try {
            await configureCloudProvider({
                provider,
                model,
                baseUrl: provider === 'openai-compatible' ? baseUrl : undefined,
            });
            setConfigurationError(null);
        } catch (error) {
            setConfigurationError(error instanceof Error ? error.message : 'Hosted provider configuration failed');
        } finally {
            setConfigurationPending(false);
        }
    };
    const removeHostedProvider = async (): Promise<void> => {
        setConfigurationPending(true);
        try {
            await removeCloudProvider();
            setConfigurationError(null);
        } catch (error) {
            setConfigurationError(error instanceof Error ? error.message : 'Hosted provider removal failed');
        } finally {
            setConfigurationPending(false);
        }
    };

    return (
        <>
            <SectionTitle icon={<Sparkles className="size-4" />} title="AI" />
            <FieldGroup label="AI execution backend">
                <select
                    value={selectedBackend}
                    onChange={(event) => {
                        const selection = event.target.value;
                        if (isBackendSelection(selection)) {
                            setAiBackendPreference(selection);
                        }
                    }}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    aria-label="AI execution backend"
                >
                    <option value="auto">Automatic</option>
                    {MODEL_RELEASE_ADMISSION.webLlm ? <option value="webllm">Browser WebLLM</option> : null}
                    {hostedProvidersAvailable ? <option value="cloud">Hosted provider</option> : null}
                </select>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    {MODEL_RELEASE_ADMISSION.webLlm
                        ? 'Automatic uses WebLLM in this browser only. Select a hosted provider explicitly to send prompts remotely.'
                        : 'No local language model is admitted in this release. Hosted providers remain desktop-only.'}
                </p>
            </FieldGroup>
            <FieldGroup label="Active Backend">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium',
                            backend === 'webllm' && 'bg-[var(--color-accent-cyan)]/15 text-[var(--color-accent-cyan)]',
                            backend === 'cloud' &&
                                'bg-[var(--color-accent-lavender)]/15 text-[var(--color-accent-lavender)]',
                            backend === 'none' && 'bg-muted text-muted-foreground'
                        )}
                    >
                        <DawStatusDot tone={renderIife_16()} />
                        {renderIife_17()}
                    </span>
                </div>
            </FieldGroup>
            <Separator />
            {hostedProvidersAvailable ? (
                <FieldGroup label="Hosted AI provider">
                    <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
                        Set the provider credential in the matching SOURDAW_*_API_KEY environment variable before
                        launch. The renderer receives only an opaque session ID.
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                        <select
                            value={provider}
                            onChange={(event) => {
                                const nextProvider = event.target.value;
                                if (!isHostedProviderSelection(nextProvider)) {
                                    return;
                                }
                                setProvider(nextProvider);
                                setModel(DEFAULT_MODELS[nextProvider]);
                                setBaseUrl('');
                                setConfigurationError(null);
                            }}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            aria-label="Hosted AI provider"
                        >
                            <option value="anthropic">Anthropic</option>
                            <option value="openai">OpenAI</option>
                            <option value="openai-compatible">OpenAI-compatible</option>
                        </select>
                        {provider === 'openai-compatible' ? (
                            <div>
                                <Input
                                    value={model}
                                    onChange={(event) => {
                                        setModel(event.target.value);
                                        setConfigurationError(null);
                                    }}
                                    placeholder="Model identifier from your provider"
                                    className="h-8 text-xs font-mono"
                                    aria-label="Hosted AI model"
                                />
                                <p className="mt-1 text-[9px] leading-tight text-muted-foreground">
                                    Custom endpoints define their own model IDs.
                                </p>
                            </div>
                        ) : (
                            <select
                                value={customFirstPartyModel ? CUSTOM_MODEL_VALUE : model}
                                onChange={(event) => {
                                    setModel(event.target.value === CUSTOM_MODEL_VALUE ? '' : event.target.value);
                                    setConfigurationError(null);
                                }}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                aria-label="Hosted AI model"
                            >
                                {HOSTED_MODEL_OPTIONS[provider].map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                                <option value={CUSTOM_MODEL_VALUE}>Custom model ID…</option>
                            </select>
                        )}
                    </div>
                    {customFirstPartyModel ? (
                        <Input
                            value={model}
                            onChange={(event) => {
                                setModel(event.target.value);
                                setConfigurationError(null);
                            }}
                            placeholder="Model ID from your provider account"
                            className="h-8 text-xs font-mono mb-1.5"
                            aria-label={`Custom ${getProviderLabel(provider)} model ID`}
                        />
                    ) : null}
                    {provider === 'openai-compatible' ? (
                        <Input
                            value={baseUrl}
                            onChange={(event) => {
                                setBaseUrl(event.target.value);
                                setConfigurationError(null);
                            }}
                            placeholder="https://provider.example/v1"
                            className="h-8 text-xs font-mono mb-1.5"
                            aria-label="OpenAI-compatible base URL"
                        />
                    ) : null}
                    <div className="flex justify-end">
                        <Button
                            size="sm"
                            className="h-8 text-xs"
                            disabled={
                                configurationPending ||
                                !model.trim() ||
                                (provider === 'openai-compatible' && !baseUrl.trim())
                            }
                            onClick={() => {
                                void saveHostedProvider();
                            }}
                        >
                            Save
                        </Button>
                    </div>
                    {configurationError ? (
                        <p className="mt-1.5 text-[10px] text-destructive" role="alert">
                            {configurationError}
                        </p>
                    ) : null}

                    <div className="flex items-center justify-between mt-2">
                        <span className="text-[10px] text-muted-foreground">
                            Status:{' '}
                            <span
                                className={
                                    cloudAvailable
                                        ? 'text-[var(--color-state-success)]'
                                        : 'text-[var(--color-state-warning)]'
                                }
                            >
                                {configuredProvider
                                    ? `Configured: ${getProviderLabel(configuredProvider.provider)} / ${configuredProvider.model}`
                                    : 'Not configured'}
                            </span>
                        </span>
                        {cloudAvailable ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                className="text-destructive text-[10px]"
                                disabled={configurationPending}
                                onClick={() => {
                                    void removeHostedProvider();
                                }}
                            >
                                Remove
                            </Button>
                        ) : null}
                    </div>
                </FieldGroup>
            ) : (
                <FieldGroup label="Hosted AI provider">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Hosted providers require the desktop app. Web builds never accept provider credentials.
                    </p>
                </FieldGroup>
            )}
            <Separator />
            <FieldGroup label="Browser AI">
                <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                    Kokoro vocal previews run locally in the browser. No server required.
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
