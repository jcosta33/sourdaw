import { type generateToolCalls } from '#/modules/AiRuntime/useCases';

export function notePitchToName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;
    return `${names[pitch % 12]}${String(octave)}`;
}

export function formatNotesForLlm(
    notes: Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>
): string {
    if (notes.length === 0) {
        return '(empty clip — no notes)';
    }
    const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
    return sorted
        .map(
            (n) =>
                `${notePitchToName(n.pitch)}(${String(n.startBeat)}-${String(n.startBeat + n.duration)},v${String(n.velocity)})`
        )
        .join(' ');
}

type ToolCallsFn = typeof generateToolCalls;

export async function llmGenerateNotes(
    runToolCalls: ToolCallsFn,
    instruction: string,
    existingNotes: Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>,
    clipId: string
): Promise<Array<{ pitch: number; startBeat: number; duration: number; velocity?: number }>> {
    const noteContext = formatNotesForLlm(existingNotes);

    const systemPrompt = `You are a MIDI composition assistant. Output ONLY a single tool call using addNotes to write MIDI notes.

Use the addNotes tool:
addNotes(clipId:string, notes:array) - Write MIDI notes to a clip

Notes format: [{pitch:number, startBeat:number, duration:number, velocity:number}]
MIDI pitch: 60=C4, 62=D4, 64=E4, 65=F4, 67=G4, 69=A4, 71=B4
Duration: 0.25=16th, 0.5=8th, 1=quarter, 2=half, 4=whole

For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags.`;

    const userMessage = `${instruction}

Existing notes in clip "${clipId}":
${noteContext}

Generate the MIDI notes now. Output ONLY the tool call.`;

    const results = await runToolCalls(systemPrompt, userMessage);
    const addNotesCall = results.find((r) => r.name === 'addNotes');
    if (addNotesCall && Array.isArray(addNotesCall.arguments.notes)) {
        return addNotesCall.arguments.notes as Array<{
            pitch: number;
            startBeat: number;
            duration: number;
            velocity?: number;
        }>;
    }

    return [];
}
