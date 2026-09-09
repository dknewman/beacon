#!/usr/bin/env ruby
# Adds the BeaconBluetooth and BeaconExport native sources and the BeaconBluetoothTests unit
# test target to apps/mobile/ios/Beacon.xcodeproj. Idempotent: re-running does not duplicate
# entries.
#
# Usage: ruby scripts/ios/sync-xcode-project.rb
# Requires: gem install xcodeproj

require 'xcodeproj'

ios_dir = File.expand_path('../../apps/mobile/ios', __dir__)
project_path = File.join(ios_dir, 'Beacon.xcodeproj')
project = Xcodeproj::Project.open(project_path)

app_target = project.targets.find { |t| t.name == 'Beacon' } or abort 'Beacon target not found'

# The app's bundle identifier. Unique per Apple developer team, so signing with a personal
# team works out of the box; the test bundle derives its identifier from it.
APP_BUNDLE_IDENTIFIER = 'dev.dknewman.beacon'
app_target.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = APP_BUNDLE_IDENTIFIER
end

def ensure_group(parent, name, path)
  parent.children.find { |c| c.display_name == name } || parent.new_group(name, path)
end

def ensure_file(group, path)
  group.files.find { |f| f.path == path } || group.new_file(path)
end

def ensure_source(target, file_ref)
  target.source_build_phase.files_references.include?(file_ref) || target.add_file_references([file_ref])
end

# --- BeaconBluetooth sources in the app target ---------------------------------------------
ble_group = ensure_group(project.main_group, 'BeaconBluetooth', 'BeaconBluetooth')
mapping_group = ensure_group(ble_group, 'Mapping', 'Mapping')
errors_group = ensure_group(ble_group, 'Errors', 'Errors')

ensure_file(ble_group, 'BeaconBluetoothModule.h')
[
  [ble_group, 'BeaconBluetoothModule.mm'],
  [ble_group, 'BluetoothManager.swift'],
  [ble_group, 'PeripheralSession.swift'],
  [ble_group, 'GattOperationQueue.swift'],
  [mapping_group, 'BluetoothStateMapper.swift'],
  [mapping_group, 'AuthorizationMapper.swift'],
  [mapping_group, 'AdvertisementMapper.swift'],
  [mapping_group, 'ConnectionStateMapper.swift'],
  [mapping_group, 'GattMapper.swift'],
  [mapping_group, 'ByteArrayMapper.swift'],
  [mapping_group, 'CharacteristicValueMapper.swift'],
  [errors_group, 'BleError.swift'],
].each do |group, file|
  ensure_source(app_target, ensure_file(group, file))
end

# --- BeaconExport sources in the app target ------------------------------------------------
# The export module is a separate directory from BeaconBluetooth on purpose: it shares the
# codegen target but nothing else.
export_group = ensure_group(project.main_group, 'BeaconExport', 'BeaconExport')

ensure_file(export_group, 'BeaconExportModule.h')
[
  [export_group, 'BeaconExportModule.mm'],
  [export_group, 'ExportManager.swift'],
  [export_group, 'ExportFileStore.swift'],
  [export_group, 'ShareSheetPresenter.swift'],
].each do |group, file|
  ensure_source(app_target, ensure_file(group, file))
end

# --- Unit test target ---------------------------------------------------------------------
test_target = project.targets.find { |t| t.name == 'BeaconBluetoothTests' }
unless test_target
  test_target = project.new_target(:unit_test_bundle, 'BeaconBluetoothTests', :ios, '15.1')
  test_target.add_dependency(app_target)
end

# Build settings are (re)applied on every run so the script stays the single source of truth
# for the test target; Xcode's own defaults for unit test bundles are reproduced here.
TEST_TARGET_SETTINGS = {
  'PRODUCT_NAME' => '$(TARGET_NAME)',
  'PRODUCT_BUNDLE_IDENTIFIER' => "#{APP_BUNDLE_IDENTIFIER}.BeaconBluetoothTests",
  'BUNDLE_LOADER' => '$(TEST_HOST)',
  'TEST_HOST' => '$(BUILT_PRODUCTS_DIR)/Beacon.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Beacon',
  'GENERATE_INFOPLIST_FILE' => 'YES',
  'CURRENT_PROJECT_VERSION' => '1',
  'MARKETING_VERSION' => '1.0',
  'SWIFT_VERSION' => '5.0',
  'IPHONEOS_DEPLOYMENT_TARGET' => '15.1',
  'TARGETED_DEVICE_FAMILY' => '1,2',
  'CODE_SIGN_STYLE' => 'Automatic',
  'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks'],
  'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => '$(inherited) DEBUG',
}.freeze

test_target.build_configurations.each do |config|
  TEST_TARGET_SETTINGS.each { |key, value| config.build_settings[key] = value }
  config.build_settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited)' if config.name == 'Release'
  config.build_settings.delete('INFOPLIST_FILE')
end

tests_group = ensure_group(project.main_group, 'BeaconBluetoothTests', 'BeaconBluetoothTests')
%w[
  BluetoothStateMapperTests.swift BleErrorTests.swift AuthorizationMapperTests.swift
  AdvertisementMapperTests.swift ConnectionStateMapperTests.swift GattMapperTests.swift
  GattOperationQueueTests.swift ByteArrayMapperTests.swift CharacteristicValueMapperTests.swift
  ExportFileStoreTests.swift
].each do |file|
  ensure_source(test_target, ensure_file(tests_group, file))
end

project.save

# --- Shared scheme: run the unit tests with `xcodebuild test -scheme Beacon` --------------
scheme_path = Xcodeproj::XCScheme.shared_data_dir(project_path) + 'Beacon.xcscheme'
scheme = Xcodeproj::XCScheme.new(scheme_path)
scheme_dirty = false

# The React Native template scheme references a "BeaconTests" target that the template no
# longer generates; drop any testable whose target is missing from the project.
existing_targets = project.targets.map(&:name)
scheme.test_action.testables.each do |testable|
  missing = testable.buildable_references.any? { |ref| !existing_targets.include?(ref.target_name) }
  next unless missing
  testable.xml_element.parent.delete_element(testable.xml_element)
  scheme_dirty = true
end

already_listed = scheme.test_action.testables.any? do |testable|
  testable.buildable_references.any? { |ref| ref.target_name == 'BeaconBluetoothTests' }
end
unless already_listed
  testable = Xcodeproj::XCScheme::TestAction::TestableReference.new(test_target)
  scheme.test_action.add_testable(testable)
  scheme_dirty = true
end
scheme.save! if scheme_dirty

puts "Synced #{project_path}"
