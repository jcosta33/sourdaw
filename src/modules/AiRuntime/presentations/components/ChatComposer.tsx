import { type KeyboardEvent, type ReactElement, type RefObject } from 'react';

import { Brain, Send, Square, Zap } from 'lucide-react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

import { type AgentExecutionMode } from '../../models/AgentExecutionMode';

type ChatComposerProps = {
    executionMode: AgentExecutionMode;
    executionModes: readonly AgentExecutionMode[];
    enableReasoning: boolean;
    isGenerating: boolean;
    inputValue: string;
    isLlmAvailable: boolean;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    onChange: (value: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    onExecutionModeChange: (mode: AgentExecutionMode) => void;
    onToggleReasoning: () => void;
    onSend: () => void;
    onStop: () => void;
};

export const ChatComposer = ({
    executionMode,
    executionModes,
    enableReasoning,
    isGenerating,
    inputValue,
    isLlmAvailable,
    textareaRef,
    onChange,
    onKeyDown,
    onExecutionModeChange,
    onToggleReasoning,
    onSend,
    onStop,
}: ChatComposerProps): ReactElement => {
    let placeholderText = 'Send a message... (Shift+Enter for newline)';
    if (isGenerating) {
        placeholderText = 'AI is thinking...';
    } else if (executionMode !== 'explain') {
        placeholderText = 'Type a command to execute or generate...';
    }

    let buttonClassName = 'bg-transparent text-muted-foreground hover:bg-white/5';
    if (isGenerating) {
        buttonClassName = 'border border-destructive/30 bg-destructive/20 text-destructive hover:bg-destructive/30';
    } else if (inputValue.trim()) {
        buttonClassName =
            'bg-[var(--color-accent-lavender)] text-white shadow-md shadow-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]';
    }

    return (
        <div
            className="shrink-0 p-3"
            style={{
                background: 'linear-gradient(180deg, #0e0e0e 0%, #080808 100%)',
                borderTop: '1px solid rgba(40,40,40,0.3)',
                boxShadow: '0 -1px 0 rgba(255,255,255,0.03)',
            }}
        >
            <Row justify="between" className="mb-2 px-1">
                <Row
                    as="label"
                    gap={1.5}
                    className="rounded border border-border/50 bg-surface-inset px-2 py-1 text-[10px] font-medium text-muted-foreground"
                >
                    <Zap className="size-3" />
                    <span>Mode</span>
                    <select
                        aria-label="Agent execution mode"
                        value={executionMode}
                        onChange={(event) => onExecutionModeChange(event.target.value as AgentExecutionMode)}
                        disabled={isGenerating}
                        className="bg-transparent text-foreground outline-none"
                    >
                        {executionModes.map((mode) => (
                            <option key={mode} value={mode}>
                                {mode.charAt(0).toUpperCase() + mode.slice(1)}
                            </option>
                        ))}
                    </select>
                </Row>

                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    onClick={onToggleReasoning}
                    disabled={isGenerating}
                    className={cn(
                        'flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-medium transition-colors',
                        enableReasoning
                            ? 'border-[var(--color-accent-lavender)]/30 bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]'
                            : 'border-border/50 bg-surface-inset text-muted-foreground opacity-60 hover:bg-white/5 hover:opacity-100'
                    )}
                    title="Toggle model's thinking process"
                >
                    <Brain className="size-3" />
                    Think
                </Button>
            </Row>

            <Row
                align="stretch"
                className="relative rounded-lg border border-border bg-surface-base shadow-sm transition-all focus-within:border-[var(--color-accent-lavender)]/50 focus-within:ring-1 focus-within:ring-[var(--color-accent-lavender)]/50"
            >
                <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(event) => onChange(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholderText}
                    aria-label="Chat message input"
                    data-testid="chat-composer-input"
                    className="max-h-32 min-h-[44px] w-full flex-1 resize-none bg-transparent p-3 text-xs text-foreground placeholder:text-muted-foreground scrollbar-thin scrollbar-thumb-white/10 focus:outline-none"
                    disabled={isGenerating || !isLlmAvailable}
                    rows={1}
                />
                <Row align="start" justify="end" shrink={false} className="p-2 pb-0">
                    <Button
                        size="icon-sm"
                        disabled={!isGenerating && (!inputValue.trim() || !isLlmAvailable)}
                        onClick={isGenerating ? onStop : onSend}
                        className={cn('h-7 w-7 rounded-[6px] transition-all', buttonClassName)}
                        title={isGenerating ? 'Stop Generation' : undefined}
                    >
                        {isGenerating ? <Square className="size-3 fill-current" /> : <Send className="size-3.5" />}
                    </Button>
                </Row>
            </Row>
        </div>
    );
};
