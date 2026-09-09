import type { ExportFormat } from '@beacon/session-export';

/**
 * The typed surface the app uses to put a document in front of the platform
 * share sheet. Narrow on purpose: the app hands over a name, a body and a
 * media type, and learns only whether the person completed the share.
 */
export interface ExportClient {
  /** Writes the document to a private temporary file and returns its path. */
  writeTemporaryFile(fileName: string, contents: string): Promise<string>;
  /** Presents the share sheet; resolves false when the person dismissed it. */
  shareFile(path: string, mimeType: string): Promise<boolean>;
  /** Removes every temporary file the module wrote; resolves with the count. */
  clearTemporaryFiles(): Promise<number>;
}

export interface ExportRequest {
  fileName: string;
  contents: string;
  format: ExportFormat;
}
