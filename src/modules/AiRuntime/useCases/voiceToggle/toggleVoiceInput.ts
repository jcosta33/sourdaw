import { eventBus } from '#/app/registerDependencies';

export function toggleVoiceInput(active?: boolean): void {
    eventBus.emit('voice.toggle', { active });
}
