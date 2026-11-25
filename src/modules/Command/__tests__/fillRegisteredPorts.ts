import { setActionHistoryMetadataPort } from '../useCases/actionHistoryMetadataPort';
import { productionBriefAdmissionPort } from '../useCases/productionBriefAdmissionPort';
import { undoReplayPreparationPort } from '../useCases/undoReplayPreparationPort';

setActionHistoryMetadataPort({
    record: () => [],
    markReverted: () => ({ status: 'unavailable' }),
    clear: () => undefined,
});
productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
productionBriefAdmissionPort.setSubscription(() => () => undefined);
undoReplayPreparationPort.setProvider(() => Promise.resolve(() => undefined));
