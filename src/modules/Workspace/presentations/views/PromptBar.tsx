import { type ReactElement } from 'react';
import { Input } from '#/components/ui/input';
import { Button } from '#/components/ui/button';
import {
    Sparkles,
    Check,
    X,
    Brain,
    Zap,
    History,
    Music,
    Disc3,
    AudioLines,
    Play,
    Layers,
    Piano,
    Cable,
    Wand2,
    LayoutDashboard,
    Sliders,
    GitBranch,
    FolderOpen,
    Users,
    AlertTriangle,
} from 'lucide-react';
import { toggleAiHistoryPanel } from '#/modules/AiRuntime/stores/aiActionHistoryStore';
import { type FuzzyResult } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { describeAction } from '#/modules/Command/useCases/actionLabels';
import { type AppAction } from '#/modules/Command/useCases/commandQueries';
import { type PresetCategory } from '#/modules/AiRuntime/models/presetActions/registry';
import { usePromptExecution, type SelectionTag } from '../hooks/usePromptExecution';
import { LlmStatusBadge } from './Prompt/LlmStatusBadge';

// ── Category icons ──────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<PresetCategory, typeof Play> = {
    Transport: Play,
    Track: Layers,
    Clip: Music,
    MIDI: Piano,
    Device: Cable,
    Generate: Wand2,
    Workspace: LayoutDashboard,
    Mix: Sliders,
    Automation: GitBranch,
    File: FolderOpen,
    Collaboration: Users,
};

const TAG_ICONS = {
    track: AudioLines,
    clip: Music,
    clips: Disc3,
} as const;

// ── Sub-components ──────────────────────────────────────────────────────

const SelectionTagChip = ({ tag, onRemove }: { tag: SelectionTag; onRemove: () => void }): ReactElement => {
    const Icon = TAG_ICONS[tag.icon];
    return (
        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent-lavender)]/15 border border-[var(--color-accent-lavender)]/30 px-1.5 py-0.5 text-[10px] text-[var(--color-accent-lavender)] shrink-0">
            <Icon className="size-2.5" aria-hidden="true" />
            <span className="truncate max-w-20">{tag.label}</span>
            <button
                type="button"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove();
                }}
                className="ml-0.5 hover:text-[var(--color-accent-lavender)] transition-colors"
                aria-label={`Remove ${tag.label} from context`}
            >
                <X className="size-2.5" />
            </button>
        </span>
    );
};

const FuzzyResultItem = ({
    result,
    isSelected,
    onExecute,
}: {
    result: FuzzyResult;
    isSelected: boolean;
    onExecute: () => void;
}): ReactElement => {
    const Icon = CATEGORY_ICONS[result.preset.category] ?? Zap;
    return (
        <button
            type="button"
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors ${
                isSelected
                    ? 'bg-white/[0.08] text-foreground'
                    : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'
            }`}
            onMouseDown={(e) => {
                e.preventDefault();
                onExecute();
            }}
            role="option"
            aria-selected={isSelected}
        >
            <Icon className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            <span className="flex-1 text-left truncate">{result.preset.label}</span>
            {result.preset.isDestructive ? (
                <AlertTriangle className="size-3 text-[var(--color-state-warning)] shrink-0" aria-label="Destructive action" />
            ) : null}
            <span className="text-[9px] text-muted-foreground/60 px-1 py-0.5 rounded bg-surface-overlay/50 shrink-0">
                {result.preset.category}
            </span>
        </button>
    );
};

// ── Main component ──────────────────────────────────────────────────────

export const PromptBar = (): ReactElement => {
    const prompt = usePromptExecution();

    // ── Preview mode ────────────────────────────────────────────────────
    if (prompt.preview) {
        return (
            <div className="flex items-center gap-2 max-w-lg">
                <Sparkles className="size-3.5 shrink-0 text-[var(--color-accent-peach)]" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1">
                        {prompt.preview.actions.map((a: AppAction, i: number) => (
                            <span
                                key={i}
                                className="inline-flex items-center rounded bg-accent/50 px-1.5 py-0.5 text-[10px] text-foreground"
                            >
                                {describeAction(a)}
                            </span>
                        ))}
                    </div>
                </div>
                <Button size="icon-xs" variant="ghost" onClick={prompt.confirmPreview} aria-label="Confirm actions">
                    <Check className="size-3 text-[var(--color-state-success)]" />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={prompt.cancelPreview} aria-label="Cancel actions">
                    <X className="size-3 text-destructive-foreground" />
                </Button>
            </div>
        );
    }

    // ── Main render ─────────────────────────────────────────────────────
    return (
        <div className="relative flex-1 max-w-lg">
            <form
                ref={prompt.formRef}
                onSubmit={prompt.handleSubmit}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm"
                style={{
                    background: 'linear-gradient(180deg, #080808 0%, #0d0d0d 100%)',
                    boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.7), inset 0 0 1px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.04)',
                    border: '1px solid rgba(0,0,0,0.5)',
                    borderBottom: '1px solid rgba(40,40,40,0.3)',
                }}
            >
                {prompt.isProcessing ? (
                    <Button
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        aria-label="Cancel AI processing"
                        onClick={prompt.cancelProcessing}
                    >
                        <X className="size-3 text-destructive-foreground" />
                    </Button>
                ) : prompt.willUseLlm ? (
                    <Brain className="size-3.5 shrink-0 text-[var(--color-accent-lavender)]" aria-hidden="true" />
                ) : (
                    <Zap className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                {prompt.selectionTags.map((tag) => (
                    <SelectionTagChip
                        key={tag.id}
                        tag={tag}
                        onRemove={() => prompt.dismissTag(tag.id)}
                    />
                ))}
                <Input
                    ref={prompt.inputRef}
                    type="text"
                    value={prompt.value}
                    onChange={(e) => prompt.setValue(e.target.value)}
                    onKeyDown={prompt.handleKeyDown}
                    onFocus={() => prompt.setIsFocused(true)}
                    onBlur={() => {
                        setTimeout(() => prompt.setIsFocused(false), 200);
                    }}
                    placeholder={
                        prompt.isProcessing
                            ? prompt.llmStatus?.state === 'generating'
                                ? 'AI is thinking...'
                                : 'Processing...'
                            : prompt.selectionTags.length > 0
                              ? 'What do you want to do with this?'
                              : 'Type a command... (⌘K for palette)'
                    }
                    className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
                    aria-label="Prompt command input"
                    aria-autocomplete="list"
                    aria-expanded={prompt.fuzzyResults.length > 0}
                    aria-controls="prompt-results"
                    disabled={prompt.isProcessing}
                />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleAiHistoryPanel}
                    title="AI action history"
                    aria-label="Toggle AI action history"
                    type="button"
                >
                    <History className="size-3.5" />
                </Button>
                <LlmStatusBadge status={prompt.llmStatus ?? { state: 'idle' }} onLoad={prompt.handleLoadModel} />
            </form>

            {prompt.fuzzyResults.length > 0 ? (
                <div
                    id="prompt-results"
                    role="listbox"
                    aria-label="Command suggestions"
                    className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border-soft border-t-[var(--color-light-edge)] bg-surface-overlay shadow-[0_4px_16px_rgba(0,0,0,0.5)] py-1 max-h-80 overflow-y-auto"
                >
                    {prompt.value.trim().length === 0 ? (
                        <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                            Available commands
                        </div>
                    ) : null}
                    {prompt.fuzzyResults.map((result, i) => (
                        <FuzzyResultItem
                            key={result.preset.id}
                            result={result}
                            isSelected={i === prompt.selectedIndex}
                            onExecute={() => void prompt.executePreset(result)}
                        />
                    ))}
                    {prompt.value.trim().length > 0 && prompt.fuzzyResults.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground/60 italic">
                            No matching commands — press Enter to try AI
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
};
