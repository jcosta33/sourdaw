import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Cpu, Download, HardDrive, Loader2, Power, Zap } from 'lucide-react';

import { isLlmAvailable, resolveBackend, unloadEngine } from '../../../useCases/workspaceViewActions';
import { NATIVE_MODEL_INFO, WEBLLM_MODEL_INFO } from '../../../useCases/workspaceViewActions';
import { type LlmEngineStatus } from '#/modules/AiRuntime/stores/llmStatusStore';
import { Button } from '#/components/ui/button';

export type LlmStatusBadgeProps = {
    status: LlmEngineStatus;
    onLoad: () => void;
};

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
            className="absolute top-full right-0 mt-1.5 z-50 rounded-lg border border-border bg-popover shadow-xl p-3"
        >
            {children}
        </div>
    );
};

export const LlmStatusBadge = ({ status, onLoad }: LlmStatusBadgeProps): ReactElement | null => {
    const [showPanel, setShowPanel] = useState(false);
    const backend = resolveBackend();
    const modelInfo = backend === 'native' ? NATIVE_MODEL_INFO : WEBLLM_MODEL_INFO;

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

    // ── Idle: "Load AI" with model info ──────────────────────────────────
    if (!status || status.state === 'idle') {
        return (
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setShowPanel((prev) => !prev)}
                    className="text-[9px] text-purple-400/70 hover:text-purple-400 whitespace-nowrap transition-colors"
                    title="Load AI model"
                >
                    Load AI
                </button>
                {showPanel ? (
                    <DropdownPanel onClose={() => setShowPanel(false)}>
                        <div className="w-56 space-y-3">
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                    {backend === 'native' ? (
                                        <Zap className="size-3 text-purple-400" aria-hidden="true" />
                                    ) : null}
                                    <span className="text-xs font-medium text-foreground">{modelInfo.displayName}</span>
                                    <span className="text-[9px] text-muted-foreground/60 ml-auto">
                                        {backend === 'native' ? 'Native' : 'Browser'}
                                    </span>
                                </div>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">
                                    {modelInfo.description}
                                </p>
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
                            </div>

                            <Button
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={() => {
                                    setShowPanel(false);
                                    onLoad();
                                }}
                            >
                                <HardDrive className="size-3 mr-1.5" aria-hidden="true" />
                                {backend === 'native' ? 'Start Native Engine' : 'Load Browser Model'}
                            </Button>
                        </div>
                    </DropdownPanel>
                ) : null}
            </div>
        );
    }

    // ── Loading: progress indicator ─────────────────────────────────────
    if (status.state === 'loading') {
        return (
            <div className="flex items-center gap-1" title={status.text}>
                <Loader2 className="size-3 animate-spin text-purple-400" />
                <span className="text-[9px] text-purple-400 whitespace-nowrap">
                    {Math.round(status.progress * 100)}%
                </span>
            </div>
        );
    }

    // ── Ready: badge with unload panel ──────────────────────────────────
    if (status.state === 'ready') {
        return (
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setShowPanel((prev) => !prev)}
                    className="text-[9px] text-emerald-400/70 hover:text-emerald-400 whitespace-nowrap transition-colors flex items-center gap-1"
                    title="AI model loaded — click to manage"
                >
                    {backend === 'native' ? <Zap className="size-2.5" aria-hidden="true" /> : null}
                    AI Ready
                </button>
                {showPanel ? (
                    <DropdownPanel onClose={() => setShowPanel(false)}>
                        <div className="w-52 space-y-2.5">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-medium text-foreground">{modelInfo.displayName}</div>
                                <span className="text-[9px] text-emerald-400 font-medium">
                                    {backend === 'native' ? 'Native' : 'Browser'}
                                </span>
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                    <Cpu className="size-3 opacity-60" aria-hidden="true" />
                                    Using {modelInfo.ramUsage} RAM
                                </span>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                className="w-full text-xs h-7 text-destructive hover:text-destructive"
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

    // ── Generating ──────────────────────────────────────────────────────
    if (status.state === 'generating') {
        return (
            <div className="flex items-center gap-1">
                <Loader2 className="size-3 animate-spin text-purple-400" />
                <span className="text-[9px] text-purple-400 whitespace-nowrap">Thinking</span>
            </div>
        );
    }

    // ── Error: retry ────────────────────────────────────────────────────
    if (status.state === 'error') {
        return (
            <button
                type="button"
                onClick={onLoad}
                className="text-[9px] text-destructive whitespace-nowrap"
                title={status.message}
            >
                AI Error
            </button>
        );
    }

    return null;
};
