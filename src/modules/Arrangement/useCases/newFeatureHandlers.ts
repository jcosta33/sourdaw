import { type ActionHandler } from '#/modules/Command';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import {
    generateDrumFill,
    generateAllTransitionFills,
} from '#/modules/Arrangement/useCases/fillTransitionGeneration/generation';
import { compareToReference } from '#/modules/AudioAnalysis';
import { toggleMono, toggleDim, switchMonitor } from '#/modules/AudioEngine';
import { generateMentorLessons } from '#/modules/AiRuntime';

export const newFeatureHandlers: Record<string, ActionHandler<any>> = {
    generateFill: {
        execute: async (a: { payload: { atBeat: number; durationBeats?: number; style?: string } }) => {
            const fill = generateDrumFill(
                a.payload.atBeat,
                a.payload.durationBeats ?? 2,
                (a.payload.style ?? 'descending') as 'simple' | 'descending' | 'sixteenth' | 'syncopated'
            );
            notifyUser(`Generated ${fill.notes.length}-note drum fill`, 'success');
        },
        undoable: true,
        describe: () => ({ label: 'Generate Fill' }),
    },
    generateAllTransitions: {
        execute: async () => {
            const fills = generateAllTransitionFills();
            notifyUser(
                fills.length > 0
                    ? `Generated ${fills.length} transition fills across arrangement`
                    : 'No section boundaries found — add sections first',
                fills.length > 0 ? 'success' : 'warning'
            );
        },
        undoable: true,
        describe: () => ({ label: 'Generate All Transitions' }),
    },
    compareToReference: {
        execute: async () => {
            const result = compareToReference();
            notifyUser(
                `Mix comparison: ${result.overallScore}% match — ${result.suggestions.length} suggestions`,
                result.overallScore >= 70 ? 'success' : 'warning'
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
                notifyUser(`🎓 ${tip.title}: ${tip.observation} — ${tip.advice}`);
            } else {
                notifyUser('No mentor tips at this time — looking good!', 'success');
            }
        },
        undoable: false,
        describe: () => ({ label: 'Get Mentor Tips' }),
    },
};
