import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Cpu, Download, HardDrive, Loader2, Power, Sparkles, Zap, Check } from 'lucide-react';

import { DawChooserCard } from '#/components/daw/DawChooserCard';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawStatusDot } from '#/components/daw/DawStatusDot';
import { Button } from '#/components/ui/button';
import {
    isLlmAvailable,
    resolveBackend,
    unloadEngine,
    NATIVE_MODEL_INFO,
    CLOUD_MODEL_INFO,
    WEBLLM_MODELS,
    getActiveModelId,
} from '#/modules/AiRuntime/useCases';

type LlmStatusBadgeProps = {
    status: BadgeLlmStatus;
    onLoad: (modelId?: string) => void;
};

type BadgeLlmStatus =
    | { state: 'idle' }
    | { state: 'loading'; progress: number; text: string }
    | { state: 'ready'; modelId: string }
    | { state: 'generating' }
    | { state: 'error'; message: string };

type BadgeModelInfo = {
    id?: string;
    displayName: string;
    description: string;
    downloadSize: string;
    ramUsage: string;
    parameterCount: string;
};

const TIER_COLORS = {
    native: 'border-primary/30 bg-primary/20 text-primary',
    cloud: 'border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]',
    webllm: 'border-primary/30 bg-primary/20 text-primary',
} as const;

const DropdownPanel = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }): ReactElement => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    return (
        <div
            ref={ref}
            className="daw-floating-surface absolute top-full right-0 z-50 mt-2 overflow-hidden rounded-xl"
            style={{ width: '260px' }}
        >
            {children}
        </div>
    );
};

export const LlmStatusBadge = ({ status, onLoad }: LlmStatusBadgeProps): ReactElement | null => {
    const [showPanel, setShowPanel] = useState(false);
    const [selectedModelId, setSelectedModelId] = useState(getActiveModelId);
    const backend = resolveBackend();
    let backendLabel: string;
    if (backend === 'native') {
        backendLabel = 'Native';
    } else if (backend === 'cloud') {
        backendLabel = 'Cloud';
    } else {
        backendLabel = 'Browser';
    }
    let tierKey: 'native' | 'cloud' | 'webllm';
    if (backend === 'native') {
        tierKey = 'native';
    } else if (backend === 'cloud') {
        tierKey = 'cloud';
    } else {
        tierKey = 'webllm';
    }

    let modelInfo: BadgeModelInfo;
    if (backend === 'native') {
        modelInfo = NATIVE_MODEL_INFO;
    } else if (backend === 'cloud') {
        modelInfo = CLOUD_MODEL_INFO;
    } else {
        modelInfo = WEBLLM_MODELS.find((message) => message.id === selectedModelId) ?? WEBLLM_MODELS[1]!;
    }

    if (!isLlmAvailable()) {
        return (
            <span
                className="text-[9px] text-muted-foreground/50 whitespace-nowrap"
                title="WebGPU not available — complex commands disabled"
            >
                No GPU
            </span>
        );
    }

    // ── Idle: model selector + load button ─────────────────────────────────
    if (!status || status.state === 'idle') {
        return (
            <div className="relative">
                <Button
                    variant="ghost"
                    size="xs"
                    type="button"
                    onClick={() => setShowPanel((prev) => !prev)}
                    className="h-6 gap-1 px-2 text-[10px] font-medium text-primary hover:text-primary hover:bg-primary/10 transition-all"
                    title="Load AI model"
                >
                    <Sparkles className="size-2.5" aria-hidden="true" />
                    Load AI
                </Button>
                {showPanel ? (
                    <DropdownPanel onClose={() => setShowPanel(false)}>
                        <div className="px-3 pt-3 pb-2 border-b border-border/50 bg-surface-raised/50">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                    {backend === 'native' ? (
                                        <Zap className="size-3 text-primary" aria-hidden="true" />
                                    ) : (
                                        <Sparkles className="size-3 text-primary" aria-hidden="true" />
                                    )}
                                    <span className="text-xs font-semibold text-foreground">AI Model</span>
                                </div>
                                <DawMicroBadge rounded="full" className={TIER_COLORS[tierKey]}>
                                    {backendLabel}
                                </DawMicroBadge>
                            </div>
                        </div>

                        <div className="px-2 py-2 space-y-1.5">
                            {backend === 'webllm' ? (
                                <>
                                    {WEBLLM_MODELS.map((model) => (
                                        <ModelOption
                                            key={model.id}
                                            model={model}
                                            isSelected={model.id === selectedModelId}
                                            onSelect={() => setSelectedModelId(model.id)}
                                        />
                                    ))}
                                </>
                            ) : (
                                <div className="px-1 py-1">
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                        {modelInfo.description}
                                    </p>
                                    <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground">
                                        <span className="inline-flex items-center gap-1">
                                            <Download className="size-3 opacity-60" aria-hidden="true" />
                                            {modelInfo.downloadSize}
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <Cpu className="size-3 opacity-60" aria-hidden="true" />
                                            {modelInfo.ramUsage}
                                        </span>
                                    </div>
                                </div>
                            )}

                            <Button
                                size="sm"
                                className="w-full text-xs h-7 mt-1"
                                onClick={() => {
                                    setShowPanel(false);
                                    onLoad(backend === 'webllm' ? selectedModelId : undefined);
                                }}
                            >
                                <HardDrive className="size-3 mr-1.5" aria-hidden="true" />
                                {(() => {
                                    if (backend === 'native') {
                                        return 'Start Native Engine';
                                    }
                                    if (backend === 'cloud') {
                                        return 'Connect Cloud AI';
                                    }
                                    return `Load ${WEBLLM_MODELS.find((message) => message.id === selectedModelId)?.displayName ?? 'Model'}`;
                                })()}
                            </Button>
                        </div>
                    </DropdownPanel>
                ) : null}
            </div>
        );
    }

    // ── Loading: progress indicator ─────────────────────────────────────────
    if (status.state === 'loading') {
        return (
            <div className="flex items-center gap-1.5" title={status.text}>
                <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                <span className="text-[10px] text-primary whitespace-nowrap tabular-nums">
                    {Math.round(status.progress * 100)}%
                </span>
            </div>
        );
    }

    // ── Ready: compact pill + unload panel ──────────────────────────────────
    if (status.state === 'ready') {
        return (
            <div className="relative">
                <Button
                    variant="secondary"
                    size="xs"
                    type="button"
                    onClick={() => setShowPanel((prev) => !prev)}
                    className="h-6 gap-1 px-2 text-[10px] font-medium text-primary transition-all"
                    title="AI model loaded — click to manage"
                >
                    {backend === 'native' ? (
                        <Zap className="size-2.5" aria-hidden="true" />
                    ) : (
                        <Sparkles className="size-2.5" aria-hidden="true" />
                    )}
                    AI Ready
                </Button>

                {showPanel ? (
                    <DropdownPanel onClose={() => setShowPanel(false)}>
                        <div className="px-3 pt-3 pb-2 border-b border-border/50 bg-surface-raised/50">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-foreground truncate">
                                    {modelInfo.displayName}
                                </span>
                                <DawMicroBadge rounded="full" className={TIER_COLORS[tierKey]}>
                                    {backendLabel}
                                </DawMicroBadge>
                            </div>
                        </div>
                        <div className="px-3 py-2.5 space-y-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] text-primary">
                                <DawStatusDot tone="primary" pulse />
                                <span>Active · {modelInfo.ramUsage} RAM</span>
                            </div>
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
                        </div>
                    </DropdownPanel>
                ) : null}
            </div>
        );
    }

    // ── Generating ──────────────────────────────────────────────────────────
    if (status.state === 'generating') {
        return (
            <div className="flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                <span className="text-[10px] text-primary whitespace-nowrap">Thinking…</span>
            </div>
        );
    }

    // ── Error ───────────────────────────────────────────────────────────────
    if (status.state === 'error') {
        return (
            <Button
                variant="outline"
                size="xs"
                type="button"
                onClick={() => onLoad()}
                className="h-6 gap-1 px-2 text-[10px] font-medium border-destructive/30 text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                title={status.message}
            >
                AI Error — retry
            </Button>
        );
    }

    return null;
};

// ── Model option card ───────────────────────────────────────────────────

type ModelOptionProps = {
    model: BadgeModelInfo;
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
            <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground">{model.parameterCount}</span>
                {isSelected ? <Check className="size-3 text-primary" /> : null}
            </div>
        }
        onClick={onSelect}
    >
        <div className="flex gap-3 mt-1 text-[9px] text-muted-foreground/70">
            <span className="inline-flex items-center gap-0.5">
                <Download className="size-2.5" aria-hidden="true" />
                {model.downloadSize}
            </span>
            <span className="inline-flex items-center gap-0.5">
                <Cpu className="size-2.5" aria-hidden="true" />
                {model.ramUsage}
            </span>
        </div>
    </DawChooserCard>
);
