import type { ExportFormat } from '@beacon/session-export';

/**
 * The typed surface the app uses to put a document in front of the platform
 * share sheet. Narrow on purpose: the app hands over a name, a body and a
 * media type, and learns only whether the person completed the share.
 */
export interface ExportClient {
  /** Writes the document to a private temporary file and returns its path. */
  writeTemporaryFile(fileName: string, contents: string): Promise<string>;
  /**
   * Presents the share sheet. Resolves false only when the platform can prove
   * the person dismissed it, which iOS can and Android cannot; true therefore
   * means "not known to be dismissed" rather than "delivered". See the spec in
   * specs/NativeBeaconExport.ts for why.
   */
  shareFile(path: string, mimeType: string): Promise<boolean>;
  /** Removes every temporary file the module wrote; resolves with the count. */
  clearTemporaryFiles(): Promise<number>;
}

export interface ExportRequest {
  fileName: string;
  contents: string;
  format: ExportFormat;
}
