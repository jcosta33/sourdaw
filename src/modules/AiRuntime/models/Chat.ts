export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
    id: string;
    role: ChatRole;
    content: string;
    timestamp: number;
    isStreaming?: boolean;
    error?: string;
    /** Hidden reasoning tokens from the model (collapsible in UI) */
    reasoning?: string;
    /** Whether this message came from the DSO editor (not chat) */
    isDsoAction?: boolean;
};

export type ChatState = {
    messages: ChatMessage[];
    isGenerating: boolean;
    enableReasoning: boolean;
    chatMode: 'chat' | 'prompt';
};
