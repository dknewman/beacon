#import <BeaconBluetoothSpec/BeaconBluetoothSpec.h>
#import <React/RCTInvalidating.h>

NS_ASSUME_NONNULL_BEGIN

/// Turbo Native Module for `NativeBeaconBluetooth.ts`.
///
/// This class is intentionally thin: it conforms to the codegen'd spec and forwards every call
/// to the Swift `BluetoothManager`, which owns all CoreBluetooth behaviour. Registered through
/// `codegenConfig.ios.modulesProvider` in apps/mobile/package.json, so no RCT_EXPORT_MODULE.
@interface BeaconBluetoothModule : NativeBeaconBluetoothSpecBase <NativeBeaconBluetoothSpec, RCTInvalidating>
@end

NS_ASSUME_NONNULL_END
