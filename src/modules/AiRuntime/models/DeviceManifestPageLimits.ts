/**
 * The `parameters` page size for one `device.factory-manifest.read` call with `page` set,
 * shared as both the default and the maximum a caller may request.
 *
 * Fermenter (105 parameters, the largest builtin descriptor) sets the binding constraint:
 * at this limit, its largest page — carrying the descriptor's non-parameter fields, the
 * page metadata, and a worst-case 256-character call id — still fits `maxReceiptBytesPerCall`
 * in `applicationOwnedToolLoop.ts` (16,384 bytes), measured at 15,860 bytes. One page higher
 * already overflows that budget (measured at 16,543 bytes).
 */
export const DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT = 8;
