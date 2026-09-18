export function isExplicitClipLoopLengthPrompt(prompt: string): boolean {
    const beatValue = String.raw`(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?`;
    const directSubjectRequest = new RegExp(
        String.raw`^(?:please\s+)?(?:set|change)\s+(?:the\s+)?(?:selected|.+?)\s+clip\s+loop\s+length\s+to\s+${beatValue}\s+beats?\s*[.!]?$`,
        'iu'
    );
    const trailingSubjectRequest = new RegExp(
        String.raw`^(?:please\s+)?(?:set|change)\s+(?:the\s+)?clip\s+loop\s+length\s+(?:of|for)\s+(?:the\s+)?(?:selected\s+clip|.+?)\s+to\s+${beatValue}\s+beats?\s*[.!]?$`,
        'iu'
    );
    const trimmedPrompt = prompt.trim();
    return directSubjectRequest.test(trimmedPrompt) || trailingSubjectRequest.test(trimmedPrompt);
}
