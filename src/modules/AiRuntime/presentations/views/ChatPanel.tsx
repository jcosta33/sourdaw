import { type ReactElement, type CSSProperties, useState, useRef, useEffect, useId, type KeyboardEvent } from 'react';

import { X, Trash2, Bot, User, ChevronRight, ChevronDown, Zap, Check, RotateCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { cn } from '#/utils/Styles/cn';

import { AGENT_EXECUTION_MODES, type AgentExecutionMode } from '../../models/AgentExecutionMode';
import { type ChatMessage } from '../../models/Chat';
import { chatStore, clearChatMessages, toggleReasoning, setChatMode, stopGenerating } from '../../stores/chatStore';
import { toggleChat } from '../../useCases/aiPanelActions/toggleChat';
import { cancelPendingChatActions } from '../../useCases/cancelPendingChatActions';
import { confirmPendingChatActions } from '../../useCases/confirmPendingChatActions';
import { isLlmAvailable } from '../../useCases/llmOrchestration/backendResolution/isLlmAvailable';
import { sendChatMessage } from '../../useCases/sendChatMessage';
import { ChatComposer } from '../components/ChatComposer';

/**
 * Strict allow-list of markdown-derived HTML elements rendered from streamed,
 * model-produced (and thus untrusted) assistant content. Raw HTML is already
 * off by default (no rehype-raw), but constraining the element set removes the
 * remaining exfiltration vectors: `img` (referer / IP leak on render) and any
 * `svg` / embedded element are absent here, so they are dropped.
 */
export const ALLOWED_MARKDOWN_ELEMENTS: ReadonlyArray<string> = [
    'p',
    'br',
    'strong',
    'em',
    'del',
    'a',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
];

/**
 * URL scheme allow-list for any surviving URL attribute (e.g. link `href`).
 * Blocks `javascript:`, `data:`, and other dangerous schemes regardless of
 * react-markdown's default; only http(s) and mailto links are kept.
 */
const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:'];

export function safeUrlTransform(url: string): string {
    try {
        // Relative URLs (no scheme) resolve against this base and are allowed.
        const parsed = new URL(url, 'https://sourdaw.invalid/');
        return SAFE_URL_SCHEMES.includes(parsed.protocol) ? url : '';
    } catch {
        // Unparseable URL — drop it.
        return '';
    }
}

/** Collapsible reasoning block — shows model's internal thinking in a subdued, smaller style. */
const ReasoningBlock = ({ reasoning, isStreaming }: { reasoning: string; isStreaming?: boolean }): ReactElement => {
    const [expanded, setExpanded] = useState(isStreaming ?? false);
    const prevStreamingRef = useRef(isStreaming);
    const regionId = useId();

    useEffect(() => {
        // Auto-collapse when we finish streaming
        if (prevStreamingRef.current && !isStreaming) {
            setExpanded(false);
        }
        prevStreamingRef.current = isStreaming;
    }, [isStreaming]);

    return (
        <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls={regionId}
            aria-label={expanded ? 'Collapse reasoning' : 'Expand reasoning'}
            className="flex flex-col w-full max-w-[92%] mb-1 text-left"
        >
            <div className="flex items-center gap-1 text-[9px] text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors">
                {expanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
                <span className="font-medium">Reasoning</span>
                {!expanded ? (
                    <span className="truncate max-w-[200px] opacity-50">{reasoning.slice(0, 60)}...</span>
                ) : null}
            </div>
            {expanded ? (
                <div
                    id={regionId}
                    role="region"
                    aria-label="Reasoning content"
                    className="mt-1 px-2 py-1.5 rounded bg-surface-inset/50 border border-border/20 text-[9px] text-muted-foreground/40 leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto w-full"
                >
                    {reasoning}
                    {isStreaming ? (
                        <span className="inline-block w-1 h-2.5 bg-muted-foreground/40 ml-1 translate-y-[2px] animate-pulse" />
                    ) : null}
                </div>
            ) : null}
        </button>
    );
};

type ChatMessageItemProps = {
    msg: ChatMessage;
    onConfirmPendingActions: (confirmationId: string) => void;
    onCancelPendingActions: (confirmationId: string) => void;
};

const ChatMessageItem = ({
    msg,
    onConfirmPendingActions,
    onCancelPendingActions,
}: ChatMessageItemProps): ReactElement => {
    let msgIcon = <User className="size-3" />;
    if (msg.isCommandAction) {
        msgIcon = <Zap className="size-3 text-emerald-400" />;
    } else if (msg.role === 'assistant') {
        msgIcon = <Bot className="size-3 text-[var(--color-accent-lavender)]" />;
    }

    let msgRoleLabel = 'You';
    if (msg.isCommandAction) {
        msgRoleLabel = 'Action';
    } else if (msg.role === 'assistant') {
        msgRoleLabel = 'Assistant';
    }

    let msgBubbleClassName = 'bg-surface-raised text-foreground border border-border/50 rounded-tl-sm w-full';
    if (msg.role === 'user') {
        msgBubbleClassName = 'bg-primary text-primary-foreground rounded-tr-sm';
    } else if (msg.isCommandAction) {
        msgBubbleClassName = 'bg-emerald-500/10 text-foreground border border-emerald-500/20 rounded-tl-sm w-full';
    }

    const pendingConfirmationId =
        msg.pendingActionConfirmationStatus === 'proposed' ? msg.pendingActionConfirmationId : undefined;
    const retryableFollowUpId =
        msg.pendingActionFollowUpStatus === 'retryable' ? msg.pendingActionConfirmationId : undefined;

    return (
        <div className={cn('flex w-full flex-col', msg.role === 'user' ? 'items-end' : 'items-start')}>
            <div className="flex items-center gap-1.5 mb-1 opacity-70">
                {msgIcon}
                <span className="text-[10px] font-medium tracking-wide">{msgRoleLabel}</span>
            </div>
            {/* Reasoning (collapsible) */}
            {msg.reasoning ? (
                <ReasoningBlock reasoning={msg.reasoning} isStreaming={msg.isStreaming && !msg.content} />
            ) : null}
            <div
                className={cn(
                    'text-xs px-3 py-2.5 rounded-lg max-w-[92%] leading-relaxed',
                    msgBubbleClassName,
                    msg.error && 'bg-destructive/10 border-destructive/30 text-destructive-foreground'
                )}
            >
                {msg.role === 'assistant' ? (
                    <div className="prose prose-invert prose-xs max-w-none prose-p:my-1.5 prose-pre:my-2 prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/5 prose-a:text-[var(--color-accent-lavender)] hover:prose-a:text-[var(--color-accent-lavender)] prose-ul:my-1.5 prose-ul:pl-4 prose-li:my-0.5 prose-strong:text-[var(--color-accent-lavender)] prose-code:text-[var(--color-accent-lavender)] prose-code:bg-[var(--color-accent-lavender)]/10 prose-code:px-1 prose-code:rounded-sm">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            allowedElements={ALLOWED_MARKDOWN_ELEMENTS}
                            unwrapDisallowed
                            urlTransform={safeUrlTransform}
                        >
                            {msg.content}
                        </ReactMarkdown>
                        {msg.isStreaming && !!msg.content ? (
                            <span className="inline-block w-1.5 h-3.5 bg-[var(--color-accent-lavender)] ml-1 translate-y-[2px] animate-pulse" />
                        ) : null}
                    </div>
                ) : (
                    <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                )}
                {pendingConfirmationId ? (
                    <div className="mt-3 flex items-center gap-2 border-t border-emerald-500/20 pt-2">
                        <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => onConfirmPendingActions(pendingConfirmationId)}
                            aria-label="Confirm pending actions"
                            className="h-7 gap-1.5 text-[11px]"
                        >
                            <Check className="size-3" />
                            Confirm
                        </Button>
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => onCancelPendingActions(pendingConfirmationId)}
                            aria-label="Cancel pending actions"
                            className="h-7 gap-1.5 text-[11px]"
                        >
                            <X className="size-3" />
                            Cancel
                        </Button>
                    </div>
                ) : null}
                {retryableFollowUpId ? (
                    <div className="mt-3 flex items-center gap-2 border-t border-emerald-500/20 pt-2">
                        <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => onConfirmPendingActions(retryableFollowUpId)}
                            aria-label="Retry missing section renders"
                            className="h-7 gap-1.5 text-[11px]"
                        >
                            <RotateCw className="size-3" />
                            Retry renders
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

type ChatPanelProps = {
    style?: CSSProperties;
};

export const ChatPanel = ({ style }: ChatPanelProps): ReactElement => {
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const chatState = useStore(chatStore, {
        messages: [],
        isGenerating: false,
        chatMode: 'chat',
        enableReasoning: false,
    });
    const [executionMode, setExecutionMode] = useState<AgentExecutionMode>(
        chatState?.chatMode === 'prompt' ? 'apply' : 'explain'
    );

    // Auto scroll bottom when new message streams
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatState?.messages]);

    const handleSend = () => {
        if (!inputValue.trim() || chatState?.isGenerating) {
            return;
        }
        void sendChatMessage(inputValue.trim(), { mode: executionMode });
        setInputValue('');

        // Return focus to input area after sending
        setTimeout(() => {
            textareaRef.current?.focus();
        }, 10);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSend();
        }
    };

    const handleConfirmPendingActions = (confirmationId: string): void => {
        void confirmPendingChatActions({ confirmationId });
    };

    const handleCancelPendingActions = (confirmationId: string): void => {
        void cancelPendingChatActions({ confirmationId });
    };

    if (!chatState) {
        return <></>;
    }

    let chatPanelContent;
    if (chatState.messages.length === 0) {
        chatPanelContent = (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 opacity-60">
                <Bot className="size-8 mx-auto mb-3 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground mb-1">The kitchen is quiet</h3>
                <p className="text-xs text-muted-foreground">
                    Say something to get the dough rising. Ask about music production, navigating this DAW, or analyzing
                    your project.
                </p>
            </div>
        );
    } else {
        chatPanelContent = (
            <div className="flex w-full flex-col gap-5">
                {chatState.messages.map((msg) => (
                    <ChatMessageItem
                        key={msg.id}
                        msg={msg}
                        onConfirmPendingActions={handleConfirmPendingActions}
                        onCancelPendingActions={handleCancelPendingActions}
                    />
                ))}
                <div ref={messagesEndRef} className="h-2 w-full shrink-0" />
            </div>
        );
    }

    return (
        <div
            style={style}
            className="contain-strict flex flex-col bg-surface-raised border-l border-border/50 overflow-hidden shadow-2xl relative select-none"
        >
            {/* Header */}
            <DawHeaderBand
                className="sticky top-0 z-10 h-10 px-3"
                title={
                    <span className="flex items-center gap-1.5">
                        <Bot className="size-3.5 text-[var(--color-accent-lavender)]" />
                        AI Chat
                    </span>
                }
                titleClassName="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                actions={
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={clearChatMessages}
                            className="text-muted-foreground hover:text-foreground hover:bg-muted"
                            title="Clear Chat History"
                            disabled={chatState.isGenerating || chatState.messages.length === 0}
                        >
                            <Trash2 className="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={toggleChat}
                            className="text-muted-foreground hover:text-foreground hover:bg-muted"
                            title="Close Chat Panel"
                        >
                            <X className="size-3.5" />
                        </Button>
                    </div>
                }
            >
                {!isLlmAvailable() ? (
                    <span className="ml-1 rounded-sm border border-destructive/20 bg-destructive/10 px-1.5 py-[2px] text-[9px] capitalize tracking-normal text-destructive">
                        Local AI Not Available
                    </span>
                ) : null}
            </DawHeaderBand>
            {/* Scrollable message list. aria-live announces streamed assistant
                output for screen-reader users during the long (30–90s) planning
                pass; aria-busy signals that generation is in progress. */}
            <div
                className="flex-1 overflow-y-auto overflow-x-hidden p-4 select-text"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-busy={chatState.isGenerating}
                aria-label="Chat conversation"
            >
                {chatPanelContent}
            </div>
            <ChatComposer
                executionMode={executionMode}
                executionModes={AGENT_EXECUTION_MODES}
                enableReasoning={chatState.enableReasoning}
                isGenerating={chatState.isGenerating}
                inputValue={inputValue}
                isLlmAvailable={isLlmAvailable()}
                textareaRef={textareaRef}
                onChange={setInputValue}
                onKeyDown={handleKeyDown}
                onExecutionModeChange={(mode) => {
                    setExecutionMode(mode);
                    setChatMode(mode === 'explain' ? 'chat' : 'prompt');
                }}
                onToggleReasoning={toggleReasoning}
                onSend={handleSend}
                onStop={stopGenerating}
            />
        </div>
    );
};
