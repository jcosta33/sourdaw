import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Cpu, Download, HardDrive, Loader2, Power, Sparkles, Zap } from 'lucide-react';

import { isLlmAvailable, resolveBackend, unloadEngine } from '#/modules/AiRuntime/useCases/llmOrchestration';
import { NATIVE_MODEL_INFO, WEBLLM_MODEL_INFO, CLOUD_MODEL_INFO } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { type LlmEngineStatus } from '#/modules/AiRuntime/stores/llmStatusStore';
import { Button } from '#/components/ui/button';

type LlmStatusBadgeProps = {
    status: LlmEngineStatus;
    onLoad: () => void;
};

/** Tier badge color */
const TIER_COLORS = {
    native: 'bg-primary/20 text-primary border-primary/30',
    cloud: 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)] border-[var(--color-accent-cyan)]/30',
    webllm: 'bg-primary/20 text-primary border-primary/30',
} as const;

/** Small dropdown panel that appears below the badge. */
const DropdownPanel = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }): ReactElement => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    return (
        <div
            ref={ref}
            className="absolute top-full right-0 mt-2 z-50 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden"
            style={{ width: '230px' }}
        >
            {children}
        </div>
    );
};

export const LlmStatusBadge = ({ status, onLoad }: LlmStatusBadgeProps): ReactElement | null => {
    const [showPanel, setShowPanel] = useState(false);
    const backend = resolveBackend();
    const modelInfo =
        backend === 'native' ? NATIVE_MODEL_INFO : backend === 'cloud' ? CLOUD_MODEL_INFO : WEBLLM_MODEL_INFO;
    const backendLabel = backend === 'native' ? 'Native' : backend === 'cloud' ? 'Cloud' : 'Browser';
    const tierKey = backend === 'native' ? 'native' : backend === 'cloud' ? 'cloud' : 'webllm';

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

    // ── Idle: styled pill + info popup ──────────────────────────────────────
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
                        {/* Header */}
                        <div className="px-3 pt-3 pb-2 border-b border-border/50 bg-surface-raised/50">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                    {backend === 'native' ? (
                                        <Zap className="size-3 text-primary" aria-hidden="true" />
                                    ) : (
                                        <Sparkles className="size-3 text-primary" aria-hidden="true" />
                                    )}
                                    <span className="text-xs font-semibold text-foreground truncate">
                                        {modelInfo.displayName}
                                    </span>
                                </div>
                                <span
                                    className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${TIER_COLORS[tierKey]} shrink-0`}
                                >
                                    {backendLabel}
                                </span>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="px-3 py-2.5 space-y-2.5">
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{modelInfo.description}</p>

                            <div className="flex gap-3 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                    <Download className="size-3 opacity-60" aria-hidden="true" />
                                    {modelInfo.downloadSize}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <Cpu className="size-3 opacity-60" aria-hidden="true" />
                                    {modelInfo.ramUsage} RAM
                                </span>
                            </div>

                            <Button
                                size="sm"
                                className="w-full text-xs h-7 bg-primary hover:brightness-110 text-primary-foreground border-0"
                                onClick={() => {
                                    setShowPanel(false);
                                    onLoad();
                                }}
                            >
                                <HardDrive className="size-3 mr-1.5" aria-hidden="true" />
                                {backend === 'native'
                                    ? 'Start Native Engine'
                                    : backend === 'cloud'
                                      ? 'Connect Cloud AI'
                                      : 'Load Browser Model'}
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
                        {/* Header */}
                        <div className="px-3 pt-3 pb-2 border-b border-border/50 bg-surface-raised/50">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-foreground truncate">
                                    {modelInfo.displayName}
                                </span>
                                <span
                                    className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${TIER_COLORS[tierKey]} shrink-0`}
                                >
                                    {backendLabel}
                                </span>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="px-3 py-2.5 space-y-2.5">
                            <div className="flex items-center gap-1.5 text-[10px] text-primary">
                                <div className="size-1.5 rounded-full bg-primary animate-pulse" />
                                <span>Active · Using {modelInfo.ramUsage} RAM</span>
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

    // ── Error: retry ────────────────────────────────────────────────────────
    if (status.state === 'error') {
        return (
            <Button
                variant="outline"
                size="xs"
                type="button"
                onClick={onLoad}
                className="h-6 gap-1 px-2 text-[10px] font-medium border-destructive/30 text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                title={status.message}
            >
                AI Error — retry
            </Button>
        );
    }

    return null;
};
