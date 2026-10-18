#!/bin/bash
set -euo pipefail

# A separate application identity and state file keep recordings isolated from
# the installed application, its preferences, and the user's plans.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/.build/demo"
APP="$ROOT/output/video/Stardew Journal Demo.app"
STAGING="$BUILD/bundle"
STATE="$ROOT/output/video/demo-state/continuous-state.json"
mkdir -p "$BUILD/module-cache" "$STAGING/Contents/MacOS" "$STAGING/Contents/Resources" "$ROOT/output/video/demo-state" "$ROOT/output/video/continuous-backups"

python3 - "$ROOT" "$BUILD" "$STATE" <<'PY'
import json
import pathlib
import plistlib
import sys

root, build, state = map(pathlib.Path, sys.argv[1:])
source = (root / 'mac/Meadow.swift').read_text()
original = '''        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Meadow", isDirectory: true)
            .appendingPathComponent("state.json")'''
assert source.count(original) == 1, 'State URL source changed; review the demo isolation.'
source = source.replace(original, '        URL(fileURLWithPath: ' + json.dumps(str(state), ensure_ascii=False) + ')')
source = source.replace('NSWindow.FrameAutosaveName("MeadowMainWindow")', 'NSWindow.FrameAutosaveName("StardewJournalDemoDesktopRegionWindow")')
source = source.replace('"regularWindowFrame"', '"desktopRegionRegularWindowFrame"')
initial_size = '        let size = compact ? NSSize(width: 480, height: 680) : NSSize(width: 1000, height: 780)'
assert source.count(initial_size) == 1, 'Initial window size source changed; review the continuous demo setup.'
source = source.replace(initial_size, '        let size = NSSize(width: 480, height: 1000)')
frame_anchor = '        _ = window.setFrameAutosaveName(frameAutosaveName)'
assert source.count(frame_anchor) == 1, 'Window placement source changed; review the demo framing.'
source = source.replace(frame_anchor, '        placeDemoWindowForDesktopRecording()\n' + frame_anchor)
source = source.replace('configuration.websiteDataStore = .default()', 'configuration.websiteDataStore = .nonPersistent()')
backup_directory = json.dumps(str(root / 'output/video/continuous-backups'), ensure_ascii=False)
for panel_type in ['NSSavePanel', 'NSOpenPanel']:
    panel_line = f'        let panel = {panel_type}()'
    assert source.count(panel_line) == 1, 'Backup panel source changed; review the demo directory isolation.'
    source = source.replace(panel_line, panel_line + '\n        panel.directoryURL = URL(fileURLWithPath: ' + backup_directory + ', isDirectory: true)')
source = source.replace('    private var webView: WKWebView!', '    private var webView: WKWebView!\n    private var demoRecorder: DemoRecorder?')
menu_source = '''        NSApplication.shared.windowsMenu = windowMenu'''
demo_menu = '''        let recordingItem = NSMenuItem()
        let recordingMenu = NSMenu(title: "演示录制")
        let startRecording = recordingMenu.addItem(withTitle: "开始录制本窗口", action: #selector(startDemoRecording), keyEquivalent: "r")
        startRecording.keyEquivalentModifierMask = [.command, .shift]
        startRecording.target = self
        let stopRecording = recordingMenu.addItem(withTitle: "停止并保存视频", action: #selector(stopDemoRecording), keyEquivalent: "s")
        stopRecording.keyEquivalentModifierMask = [.command, .shift]
        stopRecording.target = self
        recordingItem.submenu = recordingMenu
        mainMenu.addItem(recordingItem)
'''
assert source.count(menu_source) == 1
source = source.replace(menu_source, menu_source + '\n' + demo_menu)
output = json.dumps(str(root / 'output/video/Stardew-Journal-continuous-raw.mp4'), ensure_ascii=False)
status = json.dumps(str(root / 'output/video/continuous-recording-status.json'), ensure_ascii=False)
methods = '''    private func placeDemoWindowForDesktopRecording() {
        let iconScreen = statusItem.button.flatMap { button -> NSScreen? in
            guard let owner = button.window else { return nil }
            let bounds = owner.convertToScreen(button.convert(button.bounds, to: nil))
            return NSScreen.screens.first { $0.frame.contains(NSPoint(x: bounds.midX, y: bounds.midY)) }
        }
        guard let screen = iconScreen ?? window.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = NSSize(width: min(480, visible.width), height: min(1000, max(480, visible.height - 24)))
        let captureWidth = min(924, visible.width)
        let x = max(visible.minX, visible.maxX - captureWidth / 2 - size.width / 2)
        let y = max(visible.minY, visible.maxY - size.height - 12)
        window.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: false)
    }

    @objc private func startDemoRecording() {
        if demoRecorder == nil {
            demoRecorder = DemoRecorder(window: window, statusItem: statusItem,
                outputURL: URL(fileURLWithPath: OUTPUT_PATH),
                statusURL: URL(fileURLWithPath: STATUS_PATH))
        }
        demoRecorder?.start()
    }

    @objc private func stopDemoRecording() { demoRecorder?.stop() }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if let recorder = demoRecorder, recorder.isActive {
            recorder.stop { sender.reply(toApplicationShouldTerminate: true) }
            return .terminateLater
        }
        return .terminateNow
    }

'''.replace('OUTPUT_PATH', output).replace('STATUS_PATH', status)
source = source.replace('    private func buildMainMenu() {', methods + '    private func buildMainMenu() {')
(build / 'main.swift').write_text(source)
with (root / 'mac/Info.plist').open('rb') as handle:
    info = plistlib.load(handle)
info['CFBundleIdentifier'] = 'com.meadow.local.demo'
info['CFBundleName'] = 'Stardew Journal Demo'
info['CFBundleDisplayName'] = 'Stardew Journal Demo'
info['LSMinimumSystemVersion'] = '14.4'
with (build / 'Info.plist').open('wb') as handle:
    plistlib.dump(info, handle, fmt=plistlib.FMT_XML, sort_keys=False)
PY

swiftc -swift-version 5 -O \
  -target arm64-apple-macos14.4 \
  -module-cache-path "$BUILD/module-cache" \
  -framework Cocoa -framework WebKit -framework AVFoundation -framework CoreVideo -framework CoreImage -framework ScreenCaptureKit \
  "$BUILD/main.swift" "$ROOT/mac/DemoRecorder.swift" -o "$BUILD/Meadow"
if [ "${1:-}" = "--compile-only" ]; then
  echo "演示录制器已编译：$BUILD/Meadow"
  exit 0
fi
cp "$BUILD/Meadow" "$STAGING/Contents/MacOS/Meadow"
cp "$BUILD/Info.plist" "$STAGING/Contents/Info.plist"
ditto --norsrc --noextattr --noacl "$ROOT/web" "$STAGING/Contents/Resources/web"
rm -f "$STAGING/Contents/Resources/web/game-assets/SOURCE.txt" "$STAGING/Contents/Resources/web/game-assets/GAMEPLAY-SOURCE.txt"
cp "$ROOT/THIRD_PARTY.md" "$STAGING/Contents/Resources/THIRD_PARTY.md"
ditto --norsrc --noextattr --noacl "$ROOT/licenses" "$STAGING/Contents/Resources/licenses"
cp "$ROOT/.build/Meadow.icns" "$STAGING/Contents/Resources/Meadow.icns"
xattr -cr "$STAGING"
codesign --force --deep --sign - "$STAGING"
codesign --verify --deep --strict "$STAGING"
ditto --norsrc --noextattr --noacl "$STAGING" "$APP"
codesign --verify --deep "$APP"
echo "演示应用：$APP"
echo "演示数据：$STATE"
echo "正式应用与用户数据未改动。"
