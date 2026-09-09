/**
 * Codegen spec for the BeaconExport Turbo Native Module.
 *
 * A second, deliberately tiny native module. Writing a file and presenting the
 * platform share sheet has nothing to do with Bluetooth, so it does not belong
 * on BeaconBluetooth; keeping it separate means the BLE module's surface stays
 * about BLE, and this one can be reasoned about on its own.
 *
 * Only three calls cross this boundary, and none of them take user data other
 * than the document itself. The file is written to a scoped temporary
 * directory the app owns, shared by URI, and deleted when the app asks.
 *
 * Milestone scope: M9 added the whole module.
 */
import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  /**
   * Writes `contents` as UTF-8 into a private temporary directory and resolves
   * with the absolute path. `fileName` is the name to give the file; native
   * strips any directory part so a caller cannot escape the directory.
   * Overwrites an existing file with the same name. Rejects with
   * export_write_failed.
   */
  writeTemporaryFile(fileName: string, contents: string): Promise<string>;

  /**
   * Presents the platform share sheet for a file previously returned by
   * writeTemporaryFile. Resolves true when the user completed a share and
   * false when they dismissed it; a dismissal is a normal outcome, not an
   * error. `mimeType` tells the platform what the file is. Rejects with
   * export_share_failed when no sheet can be presented, and with
   * export_file_missing when the path is not one this module wrote.
   */
  shareFile(path: string, mimeType: string): Promise<boolean>;

  /**
   * Deletes everything in the temporary directory. Resolves with how many
   * files were removed. Never rejects for a file that is already gone.
   */
  clearTemporaryFiles(): Promise<number>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('BeaconExport');
