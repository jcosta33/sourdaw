import { Container } from '#/infra/di/Container';

import { setYeastRuntimeNotesOffHandler } from '../engine/yeastRuntime';
import { YeastEventBus } from '../stores/yeastEventBus';

export function configureYeastRuntime(): void {
    const eventBus = Container.get(YeastEventBus);
    setYeastRuntimeNotesOffHandler((notes) => {
        if (notes.length > 0) {
            void eventBus.emit('yeast.notesOff', { notes });
        }
    });
}
