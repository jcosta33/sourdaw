import { type ToasterPadOrder } from './readToasterPadOrder';

/** The references a pad order is signed by: each Toaster, its child count, then its children in order. */
export function listToasterPadOrderRefs(orders: readonly ToasterPadOrder[]): unknown[] {
    return orders.flatMap((order) => [order.toasterId, order.childIds.length, ...order.childIds]);
}
