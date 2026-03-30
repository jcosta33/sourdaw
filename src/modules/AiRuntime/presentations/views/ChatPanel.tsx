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
import { chatStore, clearChatMessages } from '#/modules/AiRuntime/stores/chatStore';
import { sendChatMessage } from '#/modules/AiRuntime/useCases/sendChatMessage';
import { toggleChat } from '#/modules/AiRuntime/useCases/aiPanelActions';
import { Button } from '#/components/ui/button';
import { X, Send, Trash2, Bot, User, Loader2 } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { isLlmAvailable } from '#/modules/AiRuntime/useCases/llmOrchestration';

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
            <div
                className="flex items-center justify-between px-3 h-10 sticky top-0 shrink-0 z-10"
                style={{
                    background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                    border: '1px solid rgba(0,0,0,0.4)',
                    borderBottom: '1px solid rgba(40,40,40,0.3)',
                }}
            >
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
                        <Bot className="size-3.5 text-[var(--color-accent-lavender)]" />
                        AI Chat
                    </span>
                    {!isLlmAvailable() ? (
                        <span className="text-[9px] text-destructive tracking-normal capitalize ml-2 bg-destructive/10 px-1.5 py-[2px] rounded-sm border border-destructive/20">
                            Local AI Not Available
                        </span>
                    ) : null}
                </div>
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
            </div>

            {/* Scrollable message list */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 select-text">
                {chatState.messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-6 opacity-60">
                        <Bot className="size-8 mx-auto mb-3 text-muted-foreground" />
                        <h3 className="text-sm font-medium text-foreground mb-1">The kitchen is quiet</h3>
                        <p className="text-xs text-muted-foreground">
                            Say something to get the dough rising. Ask about music production, navigating this DAW, or analyzing your project.
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
                                    {msg.role === 'assistant' ? (
                                        <Bot className="size-3 text-[var(--color-accent-lavender)]" />
                                    ) : (
                                        <User className="size-3" />
                                    )}
                                    <span className="text-[10px] font-medium tracking-wide">
                                        {msg.role === 'assistant' ? 'Assistant' : 'You'}
                                    </span>
                                </div>
                                <div
                                    className={cn(
                                        'text-xs px-3 py-2.5 rounded-lg max-w-[92%] leading-relaxed',
                                        msg.role === 'user'
                                            ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                            : 'bg-surface-raised text-foreground border border-border/50 rounded-tl-sm w-full',
                                        msg.error &&
                                            'bg-destructive/10 border-destructive/30 text-destructive-foreground'
                                    )}
                                >
                                    {msg.role === 'assistant' ? (
                                        <div className="prose prose-invert prose-xs max-w-none prose-p:my-1.5 prose-pre:my-2 prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/5 prose-a:text-[var(--color-accent-lavender)] hover:prose-a:text-[var(--color-accent-lavender)] prose-ul:my-1.5 prose-ul:pl-4 prose-li:my-0.5 prose-strong:text-[var(--color-accent-lavender)] prose-code:text-[var(--color-accent-lavender)] prose-code:bg-[var(--color-accent-lavender)]/10 prose-code:px-1 prose-code:rounded-sm">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                            {msg.isStreaming ? (
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
                <div className="relative rounded-lg bg-surface-base border border-border focus-within:ring-1 focus-within:ring-[var(--color-accent-lavender)]/50 focus-within:border-[var(--color-accent-lavender)]/50 transition-all flex shadow-sm">
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={
                            chatState.isGenerating ? 'AI is thinking...' : 'Send a message... (Shift+Enter for newline)'
                        }
                        className="flex-1 w-full text-xs min-h-[44px] max-h-32 bg-transparent text-foreground placeholder:text-muted-foreground p-3 resize-none focus:outline-none scrollbar-thin scrollbar-thumb-white/10"
                        disabled={chatState.isGenerating || !isLlmAvailable()}
                        rows={1}
                    />
                    <div className="shrink-0 flex items-start justify-end p-2 pb-0 opacity-100">
                        <Button
                            size="icon-sm"
                            disabled={!inputValue.trim() || chatState.isGenerating || !isLlmAvailable()}
                            onClick={handleSend}
                            className={cn(
                                'h-7 w-7 transition-all rounded-[6px]',
                                inputValue.trim() && !chatState.isGenerating
                                    ? 'bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white shadow-md shadow-[var(--color-accent-lavender)]/20'
                                    : 'bg-transparent text-muted-foreground hover:bg-white/5'
                            )}
                        >
                            {chatState.isGenerating ? (
                                <Loader2 className="size-3.5 animate-spin text-[var(--color-accent-lavender)]" />
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
