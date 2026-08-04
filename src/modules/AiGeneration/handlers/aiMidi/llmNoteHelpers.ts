import {
    getMidiNoteGenerationToolSchemas,
    requireMidiNoteGenerationToolCall,
    type generateToolCalls,
} from '#/modules/AiRuntime/useCases';

export function notePitchToName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;
    const noteName = names[pitch % 12];
    if (!noteName) {
        throw new Error(`Invalid MIDI pitch: ${String(pitch)}`);
    }
    return `${noteName}${String(octave)}`;
}

export function formatNotesForLlm(
    notes: Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>
): string {
    if (notes.length === 0) {
        return '(empty clip — no notes)';
    }
    const sorted = [...notes].sort((alpha, b) => alpha.startBeat - b.startBeat);
    return sorted
        .map(
            (node) =>
                `${notePitchToName(node.pitch)}(${String(node.startBeat)}-${String(node.startBeat + node.duration)},v${String(node.velocity)})`
        )
        .join(' ');
}

type ToolCallsFn = typeof generateToolCalls;

export async function llmGenerateNotes(
    runToolCalls: ToolCallsFn,
    instruction: string,
    existingNotes: Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>,
    clipId: string,
    options: { allowNegativeStartBeat?: boolean } = {}
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

    const results = await runToolCalls(
        systemPrompt,
        userMessage,
        getMidiNoteGenerationToolSchemas({
            expectedClipId: clipId,
            allowNegativeStartBeat: options.allowNegativeStartBeat,
        })
    );
    return requireMidiNoteGenerationToolCall({
        toolCalls: results,
        expectedClipId: clipId,
        allowNegativeStartBeat: options.allowNegativeStartBeat,
    });
}
