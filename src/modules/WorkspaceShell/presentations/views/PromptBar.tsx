import { type ReactElement } from 'react';

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

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { toggleAiHistoryPanel } from '#/modules/AiRuntime/useCases';

import { usePromptExecution, type PromptFuzzyResult, type SelectionTag } from '../hooks/usePromptExecution';

import { LlmStatusBadge } from './Prompt/LlmStatusBadge';

// ── Category icons ──────────────────────────────────────────────────────

type PromptPresetCategory = PromptFuzzyResult['preset']['category'];

const CATEGORY_ICONS: Record<PromptPresetCategory, typeof Play> = {
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
        <DawMicroBadge tone="primary" className="shrink-0 gap-1 text-[10px]">
            <Icon className="size-2.5" aria-hidden="true" />
            <span className="truncate max-w-20">{tag.label}</span>
            <Button
                variant="bare"
                size="bare"
                type="button"
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemove();
                }}
                className="ml-0.5 hover:text-primary transition-colors"
                aria-label={`Remove ${tag.label} from context`}
            >
                <X className="size-2.5" />
            </Button>
        </DawMicroBadge>
    );
};

const FuzzyResultItem = ({
    result,
    isSelected,
    onExecute,
}: {
    result: PromptFuzzyResult;
    isSelected: boolean;
    onExecute: () => void;
}): ReactElement => {
    const Icon = CATEGORY_ICONS[result.preset.category] ?? Zap;
    return (
        <Button
            variant="bare"
            size="bare"
            type="button"
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors ${
                isSelected
                    ? 'bg-white/[0.08] text-foreground'
                    : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'
            }`}
            onMouseDown={(event) => {
                event.preventDefault();
                onExecute();
            }}
            role="option"
            aria-selected={isSelected}
        >
            <Icon className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            <span className="flex-1 text-left truncate">{result.preset.label}</span>
            {result.preset.isDestructive ? (
                <AlertTriangle
                    className="size-3 text-[var(--color-state-warning)] shrink-0"
                    aria-label="Destructive action"
                />
            ) : null}
            <DawMicroBadge>{result.preset.category}</DawMicroBadge>
        </Button>
    );
};

// ── Main component ──────────────────────────────────────────────────────

export const PromptBar = (): ReactElement => {
    const prompt = usePromptExecution();

    // ── Preview mode ────────────────────────────────────────────────────
    if (prompt.preview) {
        return (
            <Row gap={2} className="max-w-lg">
                <Sparkles className="size-3.5 shrink-0 text-[var(--color-accent-peach)]" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                    <Row align="stretch" wrap gap={1}>
                        {prompt.preview.actionLabels.map((label, index) => (
                            <DawMicroBadge key={index} className="text-[10px] text-foreground">
                                {label}
                            </DawMicroBadge>
                        ))}
                    </Row>
                </div>
                <Button size="icon-xs" variant="ghost" onClick={prompt.confirmPreview} aria-label="Confirm actions">
                    <Check className="size-3 text-[var(--color-state-success)]" />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={prompt.cancelPreview} aria-label="Cancel actions">
                    <X className="size-3 text-destructive-foreground" />
                </Button>
            </Row>
        );
    }

    // ── Main render ─────────────────────────────────────────────────────
    const renderIife_4 = () => {
        if (prompt.isProcessing) {
            return (
                <Button
                    size="icon-xs"
                    variant="ghost"
                    type="button"
                    aria-label="Cancel AI processing"
                    onClick={prompt.cancelProcessing}
                >
                    <X className="size-3 text-destructive-foreground" />
                </Button>
            );
        }
        if (prompt.willUseLlm) {
            return <Brain className="size-3.5 shrink-0 text-primary" aria-hidden="true" />;
        }
        return <Zap className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
    };
    const renderIife_5 = () => {
        if (prompt.isProcessing) {
            return prompt.llmStatus?.state === 'generating' ? 'AI is thinking...' : 'Processing...';
        } else {
            if (prompt.selectionTags.length > 0) {
                return 'What do you want to do with this?';
            } else {
                return 'Type a command... (⌘K for palette)';
            }
        }
    };
    const hasQuery = prompt.value.trim().length > 0;
    const showNoMatchesHint = prompt.isFocused && hasQuery && prompt.fuzzyResults.length === 0;
    const dropdownOpen = prompt.fuzzyResults.length > 0 || showNoMatchesHint;
    const renderIife_6 = () => {
        if (!dropdownOpen) {
            return null;
        }
        return (
            <div
                id="prompt-results"
                role="listbox"
                aria-label="Command suggestions"
                className="daw-floating-surface absolute top-full left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-md py-1"
            >
                {!hasQuery && prompt.fuzzyResults.length > 0 ? (
                    <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                        Available commands
                    </div>
                ) : null}
                {prompt.fuzzyResults.map((result, index) => (
                    <FuzzyResultItem
                        key={result.preset.id}
                        result={result}
                        isSelected={index === prompt.selectedIndex}
                        onExecute={() => void prompt.executePreset(result)}
                    />
                ))}
                {showNoMatchesHint ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground/60 italic">
                        No matching commands — press Enter to try AI
                    </div>
                ) : null}
            </div>
        );
    };

    return (
        <div className="relative flex-1 max-w-lg">
            <Row
                as="form"
                gap={1.5}
                className="daw-readout-well rounded-sm px-2 py-0.5"
                ref={prompt.formRef}
                onSubmit={prompt.handleSubmit}
            >
                {renderIife_4()}
                {prompt.selectionTags.map((tag) => (
                    <SelectionTagChip key={tag.id} tag={tag} onRemove={() => prompt.dismissTag(tag.id)} />
                ))}
                <Input
                    ref={prompt.inputRef}
                    type="text"
                    value={prompt.value}
                    onChange={(event) => prompt.setValue(event.target.value)}
                    onKeyDown={prompt.handleKeyDown}
                    onFocus={() => prompt.setIsFocused(true)}
                    onBlur={() => {
                        setTimeout(() => prompt.setIsFocused(false), 200);
                    }}
                    placeholder={renderIife_5()}
                    className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
                    aria-label="Prompt command input"
                    data-testid="prompt-input"
                    aria-autocomplete="list"
                    aria-expanded={dropdownOpen}
                    aria-controls="prompt-results"
                    disabled={prompt.isProcessing}
                />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                        toggleAiHistoryPanel();
                    }}
                    title="AI action history"
                    aria-label="Toggle AI action history"
                    data-testid="toggle-ai-history"
                    type="button"
                >
                    <History className="size-3.5" />
                </Button>
                <LlmStatusBadge status={prompt.llmStatus ?? { state: 'idle' }} onLoad={prompt.handleLoadModel} />
            </Row>
            {renderIife_6()}
        </div>
    );
};
