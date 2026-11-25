import { setCrumbsEventBus } from '../stores/crumbsEventBus';

setCrumbsEventBus({ emit: () => Promise.resolve() });
