import { Container } from '#/infra/di/Container';

import { SetlistEventBus } from './setlistEventBus';
import { startSetlistItemEndObserver } from './startSetlistItemEndObserver';

export function setSetlistEventBus(event_bus: SetlistEventBus): void {
    Container.set(SetlistEventBus, event_bus);
    startSetlistItemEndObserver();
}
