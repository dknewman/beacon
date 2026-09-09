import { toExportError } from '@beacon/session-export';
import type { ExportClient } from './ExportClient';
import type { Spec } from './specs/NativeBeaconExport';

/**
 * Wraps the raw export Turbo Module in the typed contract, converting native
 * rejections into ExportError and checking the shape of what comes back. The
 * module returns primitives, so validation here is a type check rather than a
 * schema: anything else means the native side and this spec disagree, which is
 * a bug worth surfacing loudly rather than coercing.
 */
export function createNativeExportClient(spec: Spec): ExportClient {
  return {
    async writeTemporaryFile(fileName: string, contents: string): Promise<string> {
      try {
        const path = await spec.writeTemporaryFile(fileName, contents);
        if (typeof path !== 'string' || path.length === 0) {
          throw new Error('The module returned no path for the written file');
        }
        return path;
      } catch (error: unknown) {
        throw toExportError(error, 'export_write_failed');
      }
    },

    async shareFile(path: string, mimeType: string): Promise<boolean> {
      try {
        const shared = await spec.shareFile(path, mimeType);
        if (typeof shared !== 'boolean') {
          throw new Error('The module did not say whether the share completed');
        }
        return shared;
      } catch (error: unknown) {
        throw toExportError(error, 'export_share_failed');
      }
    },

    async clearTemporaryFiles(): Promise<number> {
      try {
        const removed = await spec.clearTemporaryFiles();
        return typeof removed === 'number' && Number.isFinite(removed) ? removed : 0;
      } catch (error: unknown) {
        throw toExportError(error);
      }
    },
  };
}
