#import <BeaconBluetoothSpec/BeaconBluetoothSpec.h>

NS_ASSUME_NONNULL_BEGIN

/// Turbo Native Module for `NativeBeaconExport.ts`.
///
/// Every spec in `codegenConfig.jsSrcsDir` lands in the one `BeaconBluetoothSpec` umbrella
/// header, so this module imports the same header the BLE module does even though it has
/// nothing to do with Bluetooth.
///
/// As thin as `BeaconBluetoothModule`: it conforms to the codegen'd spec and forwards every
/// call to the Swift `ExportManager`, which owns the temporary directory and the share sheet.
/// Registered through `codegenConfig.ios.modulesProvider` in apps/mobile/package.json, so no
/// RCT_EXPORT_MODULE.
@interface BeaconExportModule : NativeBeaconExportSpecBase <NativeBeaconExportSpec>
@end

NS_ASSUME_NONNULL_END
