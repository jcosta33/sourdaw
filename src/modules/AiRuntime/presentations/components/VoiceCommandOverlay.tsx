import { type ReactElement, useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "#/helpers/Styles/cn";
import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";

const logger = Container.getInstance().get(Logger);

type SpeechRecognitionType = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
};

type TranscriptionResult = {
    text: string;
    language: string;
    duration_ms: number;
    confidence: number;
};

const getSpeechRecognition = (): SpeechRecognitionType | null => {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
        return null;
    }
    return new (Ctor as new () => SpeechRecognitionType)();
};

const isTauriAvailable = (): boolean => {
    return "__TAURI__" in window;
};

const tauriCorePath = "@tauri-apps/api/core";

const transcribeViaWhisper = async (audioBlob: Blob): Promise<string> => {
    const mod = await import(/* @vite-ignore */ tauriCorePath) as { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    const { invoke } = mod;
    const arrayBuffer = await audioBlob.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));

    const tempPath = `__webdaw_voice_${Date.now()}.webm`;
    await invoke("write_audio_file", { path: tempPath, data: bytes });

    const result = (await invoke("transcribe_audio", {
        audioPath: tempPath,
    })) as TranscriptionResult;
    return result.text;
};

let promptInjectionListeners: Array<(text: string) => void> = [];

export const onPromptInjection = (cb: (text: string) => void): (() => void) => {
    promptInjectionListeners.push(cb);
    return () => {
        promptInjectionListeners = promptInjectionListeners.filter((l) => l !== cb);
    };
};

const injectIntoPrompt = (text: string): void => {
    for (const listener of promptInjectionListeners) {
        listener(text);
    }
};

export const isSpeechRecognitionAvailable = (): boolean => {
    const w = window as unknown as Record<string, unknown>;
    return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
};

type VoiceMode = "browser" | "whisper" | null;

const resolveVoiceMode = (): VoiceMode => {
    if (isSpeechRecognitionAvailable()) {
        return "browser";
    }
    if (isTauriAvailable()) {
        return "whisper";
    }
    return null;
};

export const VoiceCommandOverlay = (): ReactElement | null => {
    const [isListening, setIsListening] = useState(false);
    const [interimText, setInterimText] = useState("");
    const [finalText, setFinalText] = useState("");
    const [transcribing, setTranscribing] = useState(false);
    const recognitionRef = useRef<SpeechRecognitionType | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const modeRef = useRef<VoiceMode>(null);

    const cleanupWhisperRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
        chunksRef.current = [];
    }, []);

    const stopListening = useCallback(() => {
        if (modeRef.current === "browser" && recognitionRef.current) {
            recognitionRef.current.stop();
            recognitionRef.current = null;
        }

        if (modeRef.current === "whisper" && mediaRecorderRef.current) {
            if (mediaRecorderRef.current.state === "recording") {
                mediaRecorderRef.current.stop();
                return;
            }
        }

        setIsListening(false);
    }, []);

    const startWhisperRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
            chunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            recorder.onstop = () => {
                for (const track of stream.getTracks()) {
                    track.stop();
                }

                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                chunksRef.current = [];

                if (blob.size === 0) {
                    setIsListening(false);
                    return;
                }

                setTranscribing(true);
                void transcribeViaWhisper(blob)
                    .then((text) => {
                        const trimmed = text.trim();
                        if (trimmed) {
                            injectIntoPrompt(trimmed);
                        }
                    })
                    .catch((e) => {
                        logger.warn(`Whisper transcription failed: ${e}`);
                    })
                    .finally(() => {
                        setTranscribing(false);
                        setIsListening(false);
                        setFinalText("");
                        setInterimText("");
                    });
            };

            recorder.start();
            mediaRecorderRef.current = recorder;
            modeRef.current = "whisper";
            setIsListening(true);
            setFinalText("");
            setInterimText("");
        } catch (e) {
            logger.warn(`Failed to start microphone recording: ${e}`);
        }
    }, []);

    const startBrowserRecognition = useCallback(() => {
        if (recognitionRef.current) {
            return true;
        }

        const recognition = getSpeechRecognition();
        if (!recognition) {
            return false;
        }

        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        let accumulated = "";

        recognition.onresult = (event) => {
            let final = "";
            let interim = "";
            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                if (!result || result.length === 0 || !result[0]) {
                    continue;
                }
                const transcript = result[0].transcript;
                if (result.isFinal) {
                    final += transcript;
                } else {
                    interim += transcript;
                }
            }
            accumulated = final;
            setFinalText(final);
            setInterimText(interim);
        };

        recognition.onerror = (event) => {
            logger.warn(`Speech recognition error: ${event.error}`);

            if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                recognitionRef.current = null;
                if (isTauriAvailable()) {
                    modeRef.current = "whisper";
                    void startWhisperRecording();
                    return;
                }
            }
        };

        recognition.onend = () => {
            recognitionRef.current = null;
            setIsListening(false);

            const text = accumulated.trim();
            if (text) {
                injectIntoPrompt(text);
            }
            setFinalText("");
            setInterimText("");
        };

        try {
            recognition.start();
            recognitionRef.current = recognition;
            modeRef.current = "browser";
            setIsListening(true);
            setFinalText("");
            setInterimText("");
            return true;
        } catch {
            return false;
        }
    }, [startWhisperRecording]);

    const startListening = useCallback(() => {
        const mode = resolveVoiceMode();

        if (mode === "browser") {
            const started = startBrowserRecognition();
            if (!started && isTauriAvailable()) {
                void startWhisperRecording();
            }
            return;
        }

        if (mode === "whisper") {
            void startWhisperRecording();
            return;
        }
    }, [startBrowserRecognition, startWhisperRecording]);

    const toggleListening = useCallback(() => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    }, [isListening, startListening, stopListening]);

    useEffect(() => {
        const handleToggle = () => {
            toggleListening();
        };

        document.addEventListener("webdaw:toggle-voice-command", handleToggle);
        return () => {
            document.removeEventListener("webdaw:toggle-voice-command", handleToggle);
            if (recognitionRef.current) {
                recognitionRef.current.abort();
            }
            cleanupWhisperRecording();
        };
    }, [toggleListening, cleanupWhisperRecording]);

    if (!isListening && !transcribing) {
        return null;
    }

    const displayText = finalText + (interimText ? ` ${interimText}` : "");

    return (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-surface-overlay/95 border border-red-500/30 px-4 py-2 shadow-xl backdrop-blur-sm">
                <button
                    onClick={stopListening}
                    className={cn(
                        "flex size-8 items-center justify-center rounded-full transition-colors",
                        "bg-red-500/20 hover:bg-red-500/30",
                    )}
                    aria-label="Stop voice input"
                >
                    {isListening ? (
                        <Mic className="size-4 text-red-400 animate-pulse" />
                    ) : (
                        <MicOff className="size-4 text-muted-foreground" />
                    )}
                </button>
                <div className="max-w-sm min-w-32">
                    {transcribing ? (
                        <p className="text-xs text-muted-foreground animate-pulse">Transcribing...</p>
                    ) : displayText ? (
                        <p className="text-xs text-foreground truncate">{displayText}</p>
                    ) : (
                        <p className="text-xs text-muted-foreground animate-pulse">
                            {modeRef.current === "whisper" ? "Recording..." : "Listening..."}
                        </p>
                    )}
                </div>
                <span className="text-[9px] text-muted-foreground/60 whitespace-nowrap">tap mic to stop</span>
            </div>
        </div>
    );
};
