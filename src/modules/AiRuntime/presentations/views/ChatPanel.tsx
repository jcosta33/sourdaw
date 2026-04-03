import {
    type ReactElement,
    type CSSProperties,
    useState,
    useSyncExternalStore,
    useRef,
    useEffect,
    type KeyboardEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatStore, clearChatMessages, toggleReasoning, setChatMode, stopGenerating } from '#/modules/AiRuntime/stores/chatStore';
import { sendChatMessage } from '#/modules/AiRuntime/useCases/sendChatMessage';
import { toggleChat } from '#/modules/AiRuntime/useCases/aiPanelActions';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Button } from '#/components/ui/button';
import { X, Send, Trash2, Bot, User, ChevronRight, ChevronDown, Zap, Brain, Square } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { isLlmAvailable } from '#/modules/AiRuntime/useCases/llmOrchestration';

/** Collapsible reasoning block — shows model's internal thinking in a subdued, smaller style. */
const ReasoningBlock = ({ reasoning, isStreaming }: { reasoning: string; isStreaming?: boolean }): ReactElement => {
    const [expanded, setExpanded] = useState(isStreaming ?? false);
    const prevStreamingRef = useRef(isStreaming);

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
                <div className="mt-1 px-2 py-1.5 rounded bg-surface-inset/50 border border-border/20 text-[9px] text-muted-foreground/40 leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto w-full">
                    {reasoning}
                    {isStreaming && (
                        <span className="inline-block w-1 h-2.5 bg-muted-foreground/40 ml-1 translate-y-[2px] animate-pulse" />
                    )}
                </div>
            ) : null}
        </button>
    );
};

type ChatPanelProps = {
    style?: CSSProperties;
};

export const ChatPanel = ({ style }: ChatPanelProps): ReactElement => {
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const chatState = useSyncExternalStore(
        (cb) => chatStore.subscribe(cb),
        () => chatStore.value
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
        void sendChatMessage(inputValue.trim());
        setInputValue('');

        // Return focus to input area after sending
        setTimeout(() => {
            textareaRef.current?.focus();
        }, 10);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    if (!chatState) {
        return <></>;
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

            {/* Scrollable message list */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 select-text">
                {chatState.messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-6 opacity-60">
                        <Bot className="size-8 mx-auto mb-3 text-muted-foreground" />
                        <h3 className="text-sm font-medium text-foreground mb-1">The kitchen is quiet</h3>
                        <p className="text-xs text-muted-foreground">
                            Say something to get the dough rising. Ask about music production, navigating this DAW, or
                            analyzing your project.
                        </p>
                    </div>
                ) : (
                    <div className="flex w-full flex-col gap-5">
                        {chatState.messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={cn(
                                    'flex w-full flex-col',
                                    msg.role === 'user' ? 'items-end' : 'items-start'
                                )}
                            >
                                <div className="flex items-center gap-1.5 mb-1 opacity-70">
                                    {msg.isDsoAction ? (
                                        <Zap className="size-3 text-emerald-400" />
                                    ) : msg.role === 'assistant' ? (
                                        <Bot className="size-3 text-[var(--color-accent-lavender)]" />
                                    ) : (
                                        <User className="size-3" />
                                    )}
                                    <span className="text-[10px] font-medium tracking-wide">
                                        {msg.isDsoAction ? 'Action' : msg.role === 'assistant' ? 'Assistant' : 'You'}
                                    </span>
                                </div>
                                {/* Reasoning (collapsible) */}
                                {msg.reasoning ? <ReasoningBlock reasoning={msg.reasoning} isStreaming={msg.isStreaming && !msg.content} /> : null}
                                <div
                                    className={cn(
                                        'text-xs px-3 py-2.5 rounded-lg max-w-[92%] leading-relaxed',
                                        msg.role === 'user'
                                            ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                            : msg.isDsoAction
                                              ? 'bg-emerald-500/10 text-foreground border border-emerald-500/20 rounded-tl-sm w-full'
                                              : 'bg-surface-raised text-foreground border border-border/50 rounded-tl-sm w-full',
                                        msg.error &&
                                            'bg-destructive/10 border-destructive/30 text-destructive-foreground'
                                    )}
                                >
                                    {msg.role === 'assistant' ? (
                                        <div className="prose prose-invert prose-xs max-w-none prose-p:my-1.5 prose-pre:my-2 prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/5 prose-a:text-[var(--color-accent-lavender)] hover:prose-a:text-[var(--color-accent-lavender)] prose-ul:my-1.5 prose-ul:pl-4 prose-li:my-0.5 prose-strong:text-[var(--color-accent-lavender)] prose-code:text-[var(--color-accent-lavender)] prose-code:bg-[var(--color-accent-lavender)]/10 prose-code:px-1 prose-code:rounded-sm">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                            {msg.isStreaming && !!msg.content ? (
                                                <span className="inline-block w-1.5 h-3.5 bg-[var(--color-accent-lavender)] ml-1 translate-y-[2px] animate-pulse" />
                                            ) : null}
                                        </div>
                                    ) : (
                                        <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} className="h-2 w-full shrink-0" />
                    </div>
                )}
            </div>

            {/* Input Footer */}
            <div
                className="p-3 shrink-0"
                style={{
                    background: 'linear-gradient(180deg, #0e0e0e 0%, #080808 100%)',
                    borderTop: '1px solid rgba(40,40,40,0.3)',
                    boxShadow: '0 -1px 0 rgba(255,255,255,0.03)',
                }}
            >
                <div className="flex items-center justify-between mb-2 px-1">
                    <button
                        type="button"
                        onClick={() => setChatMode(chatState.chatMode === 'chat' ? 'prompt' : 'chat')}
                        disabled={chatState.isGenerating}
                        className={cn(
                            "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors border",
                            chatState.chatMode === 'prompt'
                                ? "bg-primary/20 text-primary border-primary/30"
                                : "bg-surface-inset text-muted-foreground border-border/50 hover:bg-white/5"
                        )}
                        title={chatState.chatMode === 'prompt' ? "Switch to open-ended chat" : "Switch to command mode to issue actions"}
                    >
                        <Zap className="size-3" />
                        Command Mode
                    </button>
                    
                    <button
                        type="button"
                        onClick={toggleReasoning}
                        disabled={chatState.isGenerating}
                        className={cn(
                            "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors border",
                            chatState.enableReasoning
                                ? "bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)] border-[var(--color-accent-lavender)]/30"
                                : "bg-surface-inset text-muted-foreground opacity-60 border-border/50 hover:bg-white/5 hover:opacity-100"
                        )}
                        title="Toggle model's thinking process"
                    >
                        <Brain className="size-3" />
                        Think
                    </button>
                </div>

                <div className="relative rounded-lg bg-surface-base border border-border focus-within:ring-1 focus-within:ring-[var(--color-accent-lavender)]/50 focus-within:border-[var(--color-accent-lavender)]/50 transition-all flex shadow-sm">
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={
                            chatState.isGenerating
                                ? 'AI is thinking...'
                                : chatState.chatMode === 'prompt'
                                  ? 'Type a command to execute or generate...'
                                  : 'Send a message... (Shift+Enter for newline)'
                        }
                        className="flex-1 w-full text-xs min-h-[44px] max-h-32 bg-transparent text-foreground placeholder:text-muted-foreground p-3 resize-none focus:outline-none scrollbar-thin scrollbar-thumb-white/10"
                        disabled={chatState.isGenerating || !isLlmAvailable()}
                        rows={1}
                    />
                    <div className="shrink-0 flex items-start justify-end p-2 pb-0 opacity-100">
                        <Button
                            size="icon-sm"
                            disabled={!chatState.isGenerating && (!inputValue.trim() || !isLlmAvailable())}
                            onClick={chatState.isGenerating ? stopGenerating : handleSend}
                            className={cn(
                                'h-7 w-7 transition-all rounded-[6px]',
                                chatState.isGenerating
                                    ? 'bg-destructive/20 text-destructive hover:bg-destructive/30 border border-destructive/30'
                                    : inputValue.trim()
                                        ? 'bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white shadow-md shadow-[var(--color-accent-lavender)]/20'
                                        : 'bg-transparent text-muted-foreground hover:bg-white/5'
                            )}
                            title={chatState.isGenerating ? "Stop Generation" : undefined}
                        >
                            {chatState.isGenerating ? (
                                <Square className="size-3 fill-current" />
                            ) : (
                                <Send className="size-3.5" />
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
