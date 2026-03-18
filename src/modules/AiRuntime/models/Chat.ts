export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
    id: string;
    role: ChatRole;
    content: string;
    timestamp: number;
    isStreaming?: boolean;
    error?: string;
};

export type ChatState = {
    messages: ChatMessage[];
    isGenerating: boolean;
};
