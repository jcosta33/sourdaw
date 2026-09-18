/**
 * Entry names inside a `.dawproject` archive. The writer
 * (`buildDawProjectZip.ts`) and every reader (`runDawProjectZipWorkerRequest.ts`
 * via the zip worker, `readDawProjectZip.ts`) must agree on them
 * byte-for-byte: a renamed entry stops matching the other side's path pattern,
 * and an import of an exported archive silently loses its project or metadata.
 */
export const PROJECT_XML_ENTRY_NAME = 'project.xml';
export const METADATA_XML_ENTRY_NAME = 'metadata.xml';

/**
 * Readers match an entry case-insensitively at the archive root only: foreign
 * writers emit the same names with varying case, while a nested copy (for
 * example `backup/project.xml`) is a backup, not the manifest. Derived from the
 * entry names so a pattern cannot drift from the name it pins; `.` is the only
 * regex metacharacter these file names contain, so escaping it is sufficient.
 */
const rootEntryPattern = (entryName: string): RegExp => new RegExp(`^${entryName.replaceAll('.', '\\.')}$`, 'i');

export const PROJECT_XML_ENTRY_PATH = rootEntryPattern(PROJECT_XML_ENTRY_NAME);
export const METADATA_XML_ENTRY_PATH = rootEntryPattern(METADATA_XML_ENTRY_NAME);
