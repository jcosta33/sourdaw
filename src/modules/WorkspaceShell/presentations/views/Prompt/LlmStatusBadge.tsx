import { type ReactElement, useEffect, useState } from 'react';

import { Cpu, Download, HardDrive, Loader2, Power, Sparkles, Check } from 'lucide-react';

import { DawChooserCard } from '#/components/daw/DawChooserCard';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawStatusDot } from '#/components/daw/DawStatusDot';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';
import { useStore } from '#/infra/store/useStore';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import {
    aiBackendPreferenceStore,
    hostedLlmProviderStatusStore,
    type LlmEngineStatus,
    machineMemoryStore,
} from '#/modules/AiRuntime/stores';
import {
    chooseLocalModel,
    DEFAULT_WEBLLM_MODEL,
    listOfferedLocalModels,
    readMachineMemory,
    resolveBackend,
    unloadEngine,
    WEBLLM_MODELS,
    getActiveModelId,
} from '#/modules/AiRuntime/useCases';
import { capabilityStore } from '#/modules/BrowserAi/stores';

type MachineMemoryReading = Parameters<typeof listOfferedLocalModels>[0];

type LlmStatusBadgeProps = {
    status: LlmEngineStatus;
    onLoad: (modelId?: string) => void;
};

type BadgeModelInfo = {
    id?: string;
    displayName: string;
    description: string;
    downloadSize: string;
    ramUsage: string;
    parameterCount: string;
};

type OfferedModelInfo = BadgeModelInfo & { id: string };

const REFUSAL_LABELS = {
    'shader-f16-unavailable': 'Needs shader-f16',
    'insufficient-storage': 'Not enough storage',
    'gpu-memory': 'Not enough GPU memory',
} as const;

const TIER_COLORS = {
    cloud: 'border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]',
    webllm: 'border-primary/30 bg-primary/20 text-primary',
} as const;

function getHostedProviderLabel(provider: 'anthropic' | 'openai' | 'openai-compatible'): string {
    if (provider === 'anthropic') {
        return 'Anthropic';
    }
    if (provider === 'openai') {
        return 'OpenAI';
    }
    return 'OpenAI-compatible';
}

/** Names the attempt answering now from the status alone, never from the preference or the resolved route. */
function getAnsweringName(status: Extract<LlmEngineStatus, { state: 'generating' }>): string {
    if (status.backend === 'cloud') {
        return `${getHostedProviderLabel(status.provider)} · ${status.modelId}`;
    }
    const model = WEBLLM_MODELS.find((candidate) => candidate.id === status.modelId);
    return `Browser · ${model?.displayName ?? status.modelId}`;
}

export const LlmStatusBadge = ({ status, onLoad }: LlmStatusBadgeProps): ReactElement | null => {
    const [showPanel, setShowPanel] = useState(false);
    const [wantedModelId, setWantedModelId] = useState(getActiveModelId);
    const machineMemory = useStore(machineMemoryStore, { state: 'unread' });
    useEffect(() => {
        void readMachineMemory();
    }, []);
    const offeredModels = listOfferedLocalModels(machineMemory);
    // The picker never offers to download a model this machine cannot run, whatever was selected before.
    const selectedModelId = chooseLocalModel(offeredModels, wantedModelId)?.id ?? wantedModelId;
    const backendPreference = useStore(aiBackendPreferenceStore, 'auto');
    const hostedProviderStatus = useStore(hostedLlmProviderStatusStore, null);
    // Browser-local availability is only known once BrowserAi's adapter/device
    // probe settles, and this badge must re-render when it does.
    const capabilityState = useStore(capabilityStore, { phase: 'idle' });
    const isDetectingBrowserAi = capabilityState?.phase === 'idle' || capabilityState?.phase === 'detecting';
    // `resolveBackend()` reads BrowserAi's capability store, so it is selected
    // from that store rather than called bare in the render body: a bare call
    // exposes no dependency, so it is cached against the props it appears to
    // depend on and keeps answering "none" after detection admits a device.
    // Selecting also re-runs it on every render, which is what keeps the
    // preference and hosted-provider stores honest.
    const resolvedBackend = useStoreSelector(capabilityStore, () => resolveBackend());
    // One resolution decides both whether AI is available and which backend the
    // panel describes. Reading availability through a second predicate lets the
    // two answers disagree — an available badge over a panel that still
    // describes no backend.
    const backend = status.state === 'ready' || status.state === 'generating' ? status.backend : resolvedBackend;
    let backendLabel: string;
    if (backend === 'cloud') {
        backendLabel = hostedProviderStatus ? getHostedProviderLabel(hostedProviderStatus.provider) : 'Cloud';
    } else {
        backendLabel = 'Browser';
    }
    let tierKey: 'cloud' | 'webllm';
    if (backend === 'cloud') {
        tierKey = 'cloud';
    } else {
        tierKey = 'webllm';
    }

    let modelInfo: BadgeModelInfo;
    if (backend === 'cloud') {
        const providerLabel = hostedProviderStatus
            ? getHostedProviderLabel(hostedProviderStatus.provider)
            : 'Hosted AI';
        const model = hostedProviderStatus?.model ?? 'Not configured';
        modelInfo = {
            id: hostedProviderStatus?.model,
            displayName: hostedProviderStatus ? `${providerLabel} · ${model}` : providerLabel,
            description: hostedProviderStatus
                ? `Direct browser connection to ${providerLabel} using ${model}.`
                : 'Configure a hosted provider in Preferences.',
            downloadSize: 'None',
            ramUsage: 'None',
            parameterCount: 'Hosted',
        };
    } else {
        modelInfo = WEBLLM_MODELS.find((message) => message.id === selectedModelId) ?? DEFAULT_WEBLLM_MODEL;
    }

    if (backend === 'none') {
        let unavailableLabel = 'AI unavailable';
        let unavailableTitle = 'No configured AI backend is available';
        if (backendPreference === 'cloud') {
            unavailableLabel = 'Configure hosted AI';
            unavailableTitle = 'Configure a hosted AI provider in Preferences';
        } else if (isDetectingBrowserAi) {
            unavailableLabel = 'Checking AI availability';
            unavailableTitle = 'Detecting this browser’s AI capability';
        } else if (backendPreference === 'webllm') {
            unavailableLabel = MODEL_RELEASE_ADMISSION.webLlm ? 'WebGPU unavailable' : 'Local AI unavailable';
            unavailableTitle = MODEL_RELEASE_ADMISSION.webLlm
                ? 'Browser WebLLM requires WebGPU support'
                : 'No browser language model is admitted in this release';
        }
        return (
            <span className="text-[9px] text-muted-foreground/50 whitespace-nowrap" title={unavailableTitle}>
                {unavailableLabel}
            </span>
        );
    }

    // ── Idle: model selector + load button ─────────────────────────────────
    if (status.state === 'idle') {
        return (
            <Popover open={showPanel} onOpenChange={setShowPanel}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="xs"
                        type="button"
                        className="h-6 gap-1 px-2 text-[10px] font-medium text-primary hover:text-primary hover:bg-primary/10 transition-all"
                        title="Load AI model"
                    >
                        <Sparkles className="size-2.5" aria-hidden="true" />
                        {backend === 'cloud' ? 'Hosted AI' : 'Load AI'}
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    sideOffset={8}
                    aria-label="AI Model Setup"
                    className="daw-floating-surface w-[260px] p-0 overflow-y-auto rounded-xl"
                >
                    <ModelSetupPanel
                        backend={backend}
                        backendLabel={backendLabel}
                        tierKey={tierKey}
                        modelInfo={modelInfo}
                        selectedModelId={selectedModelId}
                        onSelectModel={setWantedModelId}
                        offeredModels={offeredModels}
                        machineMemory={machineMemory}
                        onLoad={(modelId) => {
                            setShowPanel(false);
                            onLoad(modelId);
                        }}
                    />
                </PopoverContent>
            </Popover>
        );
    }

    // ── Loading: progress indicator ─────────────────────────────────────────
    if (status.state === 'loading') {
        return (
            <Row gap={1.5} title={status.text}>
                <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                <span className="text-[10px] text-primary whitespace-nowrap tabular-nums">
                    {Math.round(status.progress * 100)}%
                </span>
            </Row>
        );
    }

    // ── Ready: compact pill + unload panel ──────────────────────────────────
    if (status.state === 'ready') {
        // The panel describes the model that is loaded, not the one the picker would select.
        const loadedModel: BadgeModelInfo =
            backend === 'webllm'
                ? (WEBLLM_MODELS.find((candidate) => candidate.id === status.modelId) ?? {
                      displayName: status.modelId,
                      description: '',
                      downloadSize: 'Unknown',
                      ramUsage: 'unknown',
                      parameterCount: 'Unknown',
                  })
                : modelInfo;
        return (
            <Popover open={showPanel} onOpenChange={setShowPanel}>
                <PopoverTrigger asChild>
                    <Button
                        variant="secondary"
                        size="xs"
                        type="button"
                        className="h-6 gap-1 px-2 text-[10px] font-medium text-primary transition-all"
                        title="AI model loaded — click to manage"
                    >
                        <Sparkles className="size-2.5" aria-hidden="true" />
                        AI Ready
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    sideOffset={8}
                    aria-label="AI Model Status"
                    className="daw-floating-surface w-[260px] p-0 overflow-y-auto rounded-xl"
                >
                    <div className="px-3 pt-3 pb-2 border-b border-border/50 bg-surface-raised/50">
                        <Row justify="between" gap={2}>
                            <span className="text-xs font-semibold text-foreground truncate">
                                {loadedModel.displayName}
                            </span>
                            <DawMicroBadge rounded="full" className={TIER_COLORS[tierKey]}>
                                {backendLabel}
                            </DawMicroBadge>
                        </Row>
                    </div>
                    <Stack gap={2.5} className="px-3 py-2.5">
                        <Row gap={1.5} className="text-[10px] text-primary">
                            <DawStatusDot tone="primary" pulse />
                            <span>Active · {loadedModel.ramUsage} RAM</span>
                        </Row>
                        <Button
                            size="sm"
                            variant="outline"
                            className="w-full text-xs h-7 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                            onClick={() => {
                                setShowPanel(false);
                                void unloadEngine();
                            }}
                        >
                            <Power className="size-3 mr-1.5" aria-hidden="true" />
                            Unload from Memory
                        </Button>
                    </Stack>
                </PopoverContent>
            </Popover>
        );
    }

    // ── Generating ──────────────────────────────────────────────────────────
    if (status.state === 'generating') {
        const answering = `Answering with ${getAnsweringName(status)}`;
        return (
            <Row gap={1.5} role="status" title={answering}>
                <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                <span className="max-w-[220px] truncate text-[10px] text-primary whitespace-nowrap">{answering}</span>
            </Row>
        );
    }

    // ── Refused: this machine cannot run the model ─────────────────────────
    if (status.refusal !== undefined && backend === 'webllm') {
        return (
            <Popover open={showPanel} onOpenChange={setShowPanel}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="xs"
                        type="button"
                        className="h-6 gap-1 px-2 text-[10px] font-medium border-destructive/30 text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                        title={status.message}
                    >
                        {REFUSAL_LABELS[status.refusal.reason]}
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    sideOffset={8}
                    aria-label="AI Model Refused"
                    className="daw-floating-surface w-[260px] p-0 overflow-y-auto rounded-xl"
                >
                    <ModelSetupPanel
                        backend={backend}
                        backendLabel={backendLabel}
                        tierKey={tierKey}
                        modelInfo={modelInfo}
                        selectedModelId={selectedModelId}
                        refusalMessage={status.message}
                        onSelectModel={setWantedModelId}
                        offeredModels={offeredModels}
                        machineMemory={machineMemory}
                        onLoad={(modelId) => {
                            setShowPanel(false);
                            onLoad(modelId);
                        }}
                    />
                </PopoverContent>
            </Popover>
        );
    }

    // ── Error ───────────────────────────────────────────────────────────────
    if (backend === 'webllm' && offeredModels.length === 0) {
        return (
            <span
                className="text-[9px] text-muted-foreground/50 whitespace-nowrap"
                title={describeNoFittingModel(machineMemory)}
            >
                No local model fits
            </span>
        );
    }
    return (
        <Button
            variant="outline"
            size="xs"
            type="button"
            onClick={() => {
                if (backend === 'webllm') {
                    onLoad(selectedModelId);
                } else {
                    onLoad();
                }
            }}
            className="h-6 gap-1 px-2 text-[10px] font-medium border-destructive/30 text-destructive/80 hover:text-destructive hover:bg-destructive/10"
            title={status.message}
        >
            {backend === 'webllm' ? 'Retry Model Download' : 'AI Error — retry'}
        </Button>
    );
};

function describeNoFittingModel(machineMemory: MachineMemoryReading): string {
    if (machineMemory.state !== 'known') {
        return 'No local model fits this machine.';
    }
    return `This machine has ${(machineMemory.totalBytes / 1e9).toFixed(1)} GB of memory, and no local model fits. Use a hosted model.`;
}

// ── Model setup panel ───────────────────────────────────────────────────

type ModelSetupPanelProps = {
    backend: 'cloud' | 'webllm' | 'none';
    backendLabel: string;
    tierKey: 'cloud' | 'webllm';
    modelInfo: BadgeModelInfo;
    selectedModelId: string;
    offeredModels: readonly OfferedModelInfo[];
    machineMemory: MachineMemoryReading;
    /** The sentence saying why the last load was refused, shown above the chooser. */
    refusalMessage?: string;
    onSelectModel: (modelId: string) => void;
    onLoad: (modelId?: string) => void;
};

const ModelSetupPanel = ({
    backend,
    backendLabel,
    tierKey,
    modelInfo,
    selectedModelId,
    offeredModels,
    machineMemory,
    refusalMessage,
    onSelectModel,
    onLoad,
}: ModelSetupPanelProps): ReactElement => {
    const selectedName = offeredModels.find((model) => model.id === selectedModelId)?.displayName ?? 'Model';
    const nothingFits = backend === 'webllm' && offeredModels.length === 0;
    return (
        <>
            <div className="px-3 pt-3 pb-2 border-b border-border/50 bg-surface-raised/50">
                <Row justify="between" gap={2}>
                    <Row gap={1.5}>
                        <Sparkles className="size-3 text-primary" aria-hidden="true" />
                        <span className="text-xs font-semibold text-foreground">AI Model</span>
                    </Row>
                    <DawMicroBadge rounded="full" className={TIER_COLORS[tierKey]}>
                        {backendLabel}
                    </DawMicroBadge>
                </Row>
            </div>

            <Stack gap={1.5} className="px-2 py-2">
                {refusalMessage === undefined ? null : (
                    <p role="alert" className="px-1 text-[10px] text-destructive leading-relaxed">
                        {refusalMessage}
                    </p>
                )}
                {backend === 'webllm' ? (
                    <>
                        {nothingFits ? (
                            <p className="px-1 text-[10px] text-muted-foreground leading-relaxed">
                                {describeNoFittingModel(machineMemory)}
                            </p>
                        ) : null}
                        {offeredModels.map((model) => (
                            <ModelOption
                                key={model.id}
                                model={model}
                                isSelected={model.id === selectedModelId}
                                onSelect={() => onSelectModel(model.id)}
                            />
                        ))}
                    </>
                ) : (
                    <div className="px-1 py-1">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">{modelInfo.description}</p>
                        <Row align="stretch" gap={3} className="mt-1.5 text-[10px] text-muted-foreground">
                            <Row as="span" gap={1} className="inline-flex">
                                <Download className="size-3 opacity-60" aria-hidden="true" />
                                {modelInfo.downloadSize}
                            </Row>
                            <Row as="span" gap={1} className="inline-flex">
                                <Cpu className="size-3 opacity-60" aria-hidden="true" />
                                {modelInfo.ramUsage}
                            </Row>
                        </Row>
                    </div>
                )}

                {backend === 'cloud' ? (
                    <p className="px-1 py-1 text-[10px] text-muted-foreground">
                        Configured credentials are verified on the first request.
                    </p>
                ) : (
                    <>
                        {backend === 'webllm' && !nothingFits ? (
                            <p className="px-1 text-[10px] text-muted-foreground leading-relaxed">
                                Downloads and verifies this model for private use in this browser.
                            </p>
                        ) : null}
                        {nothingFits ? null : (
                            <Button
                                size="sm"
                                className="w-full text-xs h-7 mt-1"
                                onClick={() => onLoad(backend === 'webllm' ? selectedModelId : undefined)}
                            >
                                <HardDrive className="size-3 mr-1.5" aria-hidden="true" />
                                {`Download & Load ${selectedName}`}
                            </Button>
                        )}
                    </>
                )}
            </Stack>
        </>
    );
};

// ── Model option card ───────────────────────────────────────────────────

type ModelOptionProps = {
    model: OfferedModelInfo;
    isSelected: boolean;
    onSelect: () => void;
};

const ModelOption = ({ model, isSelected, onSelect }: ModelOptionProps): ReactElement => (
    <DawChooserCard
        compact
        active={isSelected}
        title={model.displayName}
        description={model.description}
        className={isSelected ? 'border-primary/30 bg-primary/10' : 'hover:bg-muted/30'}
        endSlot={
            <Row gap={1.5}>
                <span className="text-[9px] text-muted-foreground">{model.parameterCount}</span>
                {isSelected ? <Check className="size-3 text-primary" /> : null}
            </Row>
        }
        onClick={onSelect}
    >
        <Row align="stretch" gap={3} className="mt-1 text-[9px] text-muted-foreground/70">
            <Row as="span" gap={0.5} className="inline-flex">
                <Download className="size-2.5" aria-hidden="true" />
                {model.downloadSize}
            </Row>
            <Row as="span" gap={0.5} className="inline-flex">
                <Cpu className="size-2.5" aria-hidden="true" />
                {model.ramUsage}
            </Row>
        </Row>
    </DawChooserCard>
);
