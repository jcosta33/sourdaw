import { type ActionHandler } from '#/modules/Command/models/ActionHandler';
import { generateDrumFill, generateAllTransitionFills } from '#/modules/Timeline/useCases/fillTransitionGeneration';
import { compareToReference } from '#/modules/Mixer/useCases/referenceMixComparison';
import { toggleMono, toggleDim, switchMonitor } from '#/modules/Mixer/useCases/controlRoomUseCases';
import { generateMentorLessons } from '#/modules/Mixer/useCases/musicMentorUseCases';

export const newFeatureHandlers: Record<string, ActionHandler<any>> = {
    generateFill: {
        execute: async (a: { payload: { atBeat: number; durationBeats?: number; style?: string } }) => {
            const fill = generateDrumFill(
                a.payload.atBeat,
                a.payload.durationBeats ?? 2,
                (a.payload.style ?? 'descending') as 'simple' | 'descending' | 'sixteenth' | 'syncopated'
            );
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: { message: `Generated ${fill.notes.length}-note drum fill`, level: 'success' },
                })
            );
        },
        undoable: true,
        describe: () => ({ label: 'Generate Fill' }),
    },
    generateAllTransitions: {
        execute: async () => {
            const fills = generateAllTransitionFills();
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: {
                        message: fills.length > 0
                            ? `Generated ${fills.length} transition fills across arrangement`
                            : 'No section boundaries found — add sections first',
                        level: fills.length > 0 ? 'success' : 'warning',
                    },
                })
            );
        },
        undoable: true,
        describe: () => ({ label: 'Generate All Transitions' }),
    },
    compareToReference: {
        execute: async () => {
            const result = compareToReference();
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: {
                        message: `Mix comparison: ${result.overallScore}% match — ${result.suggestions.length} suggestions`,
                        level: result.overallScore >= 70 ? 'success' : 'warning',
                    },
                })
            );
        },
        undoable: false,
        describe: () => ({ label: 'Compare to Reference Mix' }),
    },
    toggleControlRoomMono: {
        execute: async () => {
            toggleMono();
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Mono Monitoring' }),
    },
    toggleControlRoomDim: {
        execute: async () => {
            toggleDim();
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Dim Monitoring' }),
    },
    switchMonitor: {
        execute: async (a: { payload: { monitorId: string } }) => {
            switchMonitor(a.payload.monitorId);
        },
        undoable: false,
        describe: () => ({ label: 'Switch Monitor Output' }),
    },
    getMentorTips: {
        execute: async () => {
            const lessons = generateMentorLessons();
            if (lessons.length > 0) {
                const tip = lessons[0]!;
                document.dispatchEvent(
                    new CustomEvent('webdaw:notify', {
                        detail: {
                            message: `🎓 ${tip.title}: ${tip.observation} — ${tip.advice}`,
                            level: 'info',
                        },
                    })
                );
            } else {
                document.dispatchEvent(
                    new CustomEvent('webdaw:notify', {
                        detail: { message: 'No mentor tips at this time — looking good!', level: 'success' },
                    })
                );
            }
        },
        undoable: false,
        describe: () => ({ label: 'Get Mentor Tips' }),
    },
};
