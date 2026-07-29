import { type RuntimeActionType } from '../../models/RuntimeAction';

type DeniedPromptIntent = {
    actionType: RuntimeActionType;
    phrases: readonly string[];
};

const DENIED_PROMPT_INTENTS: readonly DeniedPromptIntent[] = [
    {
        actionType: 'saveProject',
        phrases: ['save', 'save project', 'ctrl s'],
    },
    {
        actionType: 'newProject',
        phrases: ['new project', 'new', 'fresh project'],
    },
    {
        actionType: 'exportProject',
        phrases: ['export', 'bounce', 'render', 'mixdown', 'wav', 'mp3', 'export audio'],
    },
    {
        actionType: 'importAudioFile',
        phrases: ['import audio', 'import wav', 'import mp3', 'import file', 'open audio'],
    },
    {
        actionType: 'importMidiFile',
        phrases: ['import midi', 'open midi'],
    },
    {
        actionType: 'leaveCollabSession',
        phrases: ['leave session', 'stop collaboration', 'disconnect'],
    },
];

export function findDeniedPromptIntent(normalized: string): RuntimeActionType | null {
    for (const intent of DENIED_PROMPT_INTENTS) {
        if (intent.phrases.includes(normalized)) {
            return intent.actionType;
        }
    }
    return null;
}
