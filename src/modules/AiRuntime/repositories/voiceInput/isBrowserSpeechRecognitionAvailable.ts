type SpeechRecognitionGlobal = typeof globalThis & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
};

function hasSpeechRecognitionProperties(input: typeof globalThis): input is SpeechRecognitionGlobal {
    return 'SpeechRecognition' in input || 'webkitSpeechRecognition' in input;
}

export function isBrowserSpeechRecognitionAvailable(): boolean {
    const voiceGlobal = globalThis;

    if (!hasSpeechRecognitionProperties(voiceGlobal)) {
        return false;
    }

    return (
        typeof voiceGlobal.SpeechRecognition === 'function' || typeof voiceGlobal.webkitSpeechRecognition === 'function'
    );
}
