import { type ExecutableAppActionRisk } from './executableAppActionRegistry';

type ExecutableCommandConfirmation = {
    required: boolean;
    reason: string | null;
};

const confirmationByRisk: Record<ExecutableAppActionRisk, ExecutableCommandConfirmation> = {
    'bounded-reversible': { required: false, reason: null },
    'broad-reversible': {
        required: true,
        reason: 'This action can change a broad section of the project.',
    },
    'destructive-reversible': {
        required: true,
        reason: 'This action removes or replaces project content.',
    },
    'authority-sensitive': {
        required: true,
        reason: 'This action changes project-wide timing, gain, recording, or signal routing.',
    },
    'external-effect': {
        required: true,
        reason: 'This action affects resources or sessions outside the current project.',
    },
};

export function getExecutableCommandConfirmation(risk: ExecutableAppActionRisk): ExecutableCommandConfirmation {
    return confirmationByRisk[risk];
}
