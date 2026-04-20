import { undo } from '#/modules/Command/useCases';

export function undoLastAction(): void {
    undo();
}
