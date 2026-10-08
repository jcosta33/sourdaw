/**
 * The `parameters` page size for one `device.factory-manifest.read` call with `page` set,
 * shared as both the default and the maximum a caller may request.
 *
 * The rule this limit holds: for every released builtin descriptor, a window of this many
 * parameters starting at any offset — carrying the descriptor's non-parameter fields, the page
 * metadata, and a worst-case 256-character call id — fits `maxReceiptBytesPerCall` in
 * `applicationOwnedToolLoop.ts`. A caller may page with any limit from 1 to this one, so windows
 * start at arbitrary offsets, not only multiples of the limit. The largest descriptors (Fermenter
 * first) set the binding constraint, and their guidance text is kept terse to hold it;
 * `deviceManifestPaging.spec.ts` checks every offset rather than recording a measured size here,
 * because the size moves with every guidance edit.
 */
export const DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT = 8;
