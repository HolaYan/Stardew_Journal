import Cocoa
import WebKit
import UniformTypeIdentifiers

/// A small local macOS host for the Meadow task board. It loads bundled pages
/// and exchanges JSON with the renderer through one bridge.
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate,
                         WKScriptMessageHandler, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var pinMenuItem: NSMenuItem!
    private var compactMenuItem: NSMenuItem!
    private let preferences = UserDefaults.standard
    private var pinned = false
    private var compact = false
    private var regularFrame: NSRect?
    private let frameAutosaveName = NSWindow.FrameAutosaveName("MeadowMainWindow")
    private let compactWidthThreshold: CGFloat = 620
    private let minimumWindowSize = NSSize(width: 360, height: 480)
    private var applyingWindowPreset = false
    private var geometrySaveWorkItem: DispatchWorkItem?
    private var webDirectory: URL!
    private var startupError: String?
    private var saveBlocked = false
    private var unreadableData: String?

    private var stateURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Meadow", isDirectory: true)
            .appendingPathComponent("state.json")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let iconURL = Bundle.main.url(forResource: "Meadow", withExtension: "icns"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApplication.shared.applicationIconImage = icon
        }
        pinned = preferences.bool(forKey: "pinned")
        compact = preferences.bool(forKey: "compact")
        buildMainMenu()
        buildStatusMenu()
        buildWindow()
        showWindow(nil)
    }

    private func buildMainMenu() {
        let mainMenu = NSMenu()
        let applicationItem = NSMenuItem()
        mainMenu.addItem(applicationItem)
        let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "关于 Stardew Journal", action: #selector(showAbout), keyEquivalent: "")
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(withTitle: "隐藏 Stardew Journal", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        applicationMenu.addItem(withTitle: "退出 Stardew Journal", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = applicationMenu

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "窗口")
        let show = windowMenu.addItem(withTitle: "打开 Stardew Journal · 待办清单", action: #selector(showWindow(_:)), keyEquivalent: "0")
        show.target = self
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)
        NSApplication.shared.mainMenu = mainMenu
        NSApplication.shared.windowsMenu = windowMenu
    }

    private func buildStatusMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            if let resource = Bundle.main.resourceURL,
               let chicken = NSImage(contentsOf: resource.appendingPathComponent("web/game-assets/ui/chicken.png")) {
                let icon = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
                    NSGraphicsContext.current?.imageInterpolation = .none
                    chicken.draw(in: NSRect(x: 1, y: 1, width: 16, height: 16))
                    return true
                }
                icon.isTemplate = false
                button.image = icon
                button.setAccessibilityLabel("Stardew Journal · 待办清单")
            }
            button.toolTip = "Stardew Journal · 待办清单"
        }
        let menu = NSMenu()
        let show = menu.addItem(withTitle: "打开 Stardew Journal · 待办清单", action: #selector(showWindow(_:)), keyEquivalent: "")
        show.target = self
        menu.addItem(.separator())
        pinMenuItem = menu.addItem(withTitle: "窗口置顶", action: #selector(togglePinned), keyEquivalent: "")
        pinMenuItem.target = self
        compactMenuItem = menu.addItem(withTitle: "小组件模式", action: #selector(toggleCompact), keyEquivalent: "")
        compactMenuItem.target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 Stardew Journal", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
        updateMenuChecks()
    }

    private func buildWindow() {
        let size = compact ? NSSize(width: 480, height: 680) : NSSize(width: 1000, height: 780)
        window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "Stardew Journal · 待办清单"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.91, green: 0.79, blue: 0.56, alpha: 1)
        window.minSize = minimumWindowSize
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.level = pinned ? .floating : .normal
        window.collectionBehavior = [.managed, .fullScreenAuxiliary]
        window.center()
        if let savedRegular = preferences.string(forKey: "regularWindowFrame") {
            let frame = NSRectFromString(savedRegular)
            if validWindowFrame(frame) && frame.width >= compactWidthThreshold {
                regularFrame = visibleWindowFrame(frame)
            }
        }
        // Keep the old compact preference as the first-launch fallback, then
        // restore the exact user-sized frame on subsequent launches.
        _ = window.setFrameUsingName(frameAutosaveName, force: true)
        window.setFrame(visibleWindowFrame(window.frame), display: false)
        _ = window.setFrameAutosaveName(frameAutosaveName)
        compact = window.frame.width < compactWidthThreshold
        preferences.set(compact, forKey: "compact")
        if !compact { regularFrame = window.frame }
        updateMenuChecks()
        window.delegate = self

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.add(self, name: "meadow")
        let savedJSON = loadStateJSON()
        let nativeState = "{pinned:\(pinned),compact:\(compact)}"
        let loadErrorJSON = jsonString(startupError)
        let initialScript = """
        window.__MEADOW_NATIVE__ = true;
        window.__MEADOW_INITIAL_DATA__ = \(savedJSON);
        window.__MEADOW_NATIVE_STATE__ = \(nativeState);
        window.__MEADOW_LOAD_ERROR__ = \(loadErrorJSON);
        window.__MEADOW_SAVE_BLOCKED__ = \(saveBlocked);
        window.__MEADOW_UNREADABLE_DATA__ = \(jsonString(unreadableData));
        """
        configuration.userContentController.addUserScript(WKUserScript(source: initialScript,
                                                                       injectionTime: .atDocumentStart,
                                                                       forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView = webView

        guard let resourceURL = Bundle.main.resourceURL else { return }
        webDirectory = resourceURL.appendingPathComponent("web", isDirectory: true)
        webView.loadFileURL(webDirectory.appendingPathComponent("index.html"), allowingReadAccessTo: webDirectory)
    }

    private func loadStateJSON() -> String {
        guard FileManager.default.fileExists(atPath: stateURL.path) else { return "null" }
        var originalData: Data?
        do {
            let data = try Data(contentsOf: stateURL)
            originalData = data
            let value = try JSONSerialization.jsonObject(with: data)
            guard value is [String: Any] else {
                throw NSError(domain: "Meadow", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid state object"])
            }
            let normalized = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            return String(data: normalized, encoding: .utf8) ?? "null"
        } catch {
            let recovery = stateURL.deletingLastPathComponent()
                .appendingPathComponent("state-recovery-\(Int(Date().timeIntervalSince1970)).json")
            do {
                try FileManager.default.copyItem(at: stateURL, to: recovery)
                startupError = "原待办文件无法读取，已保留恢复副本。可从设置重新导入备份。"
            } catch {
                saveBlocked = true
                if let originalData = originalData { unreadableData = String(data: originalData, encoding: .utf8) }
                startupError = "原待办文件无法读取，且恢复副本未能保存。已暂停写入，请先导出原始内容或检查文件权限，再确认导入备份。"
            }
            return "null"
        }
    }

    private func jsonString(_ value: String?) -> String {
        guard let value = value,
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else { return "null" }
        return json
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.isFileURL == true,
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "save":
            if saveBlocked && body["recover"] as? Bool != true {
                emitError("原数据尚未安全备份，已暂停保存。请先导出原始内容，再确认导入有效备份。", action: "save")
                return
            }
            guard let state = body["data"] as? [String: Any], JSONSerialization.isValidJSONObject(state) else { return }
            do {
                let data = try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys, .prettyPrinted])
                try FileManager.default.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: stateURL, options: .atomic)
                saveBlocked = false
                unreadableData = nil
                var detail: [String: Any] = ["ok": true]
                if let requestID = body["requestId"] { detail["requestId"] = requestID }
                dispatchEvent("meadow:saved", detail: detail)
            } catch {
                emitError("待办暂时无法保存，请检查磁盘空间与文件权限。", action: "save")
                NSLog("Meadow save failed: %@", error.localizedDescription)
            }
        case "export":
            if let text = body["data"] as? String { exportData(text) }
        case "import":
            importData()
        case "pin":
            setPinned(body["value"] as? Bool ?? !pinned)
        case "compact":
            setCompact(body["value"] as? Bool ?? !compact)
        case "minimize":
            window.miniaturize(nil)
        case "close":
            window.orderOut(nil)
        case "drag":
            if let event = NSApplication.shared.currentEvent,
               event.window === window,
               event.type == .leftMouseDown || event.type == .leftMouseDragged {
                window.performDrag(with: event)
            }
        default:
            break
        }
    }

    private func dispatchEvent(_ name: String, detail: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(name)',{detail:\(json)}));", completionHandler: nil)
    }

    private func emitError(_ message: String, action: String) {
        dispatchEvent("meadow:error", detail: ["message": message, "action": action])
    }

    private func exportData(_ text: String) {
        // Keep even malformed original JSON exportable for manual recovery.
        guard let data = text.data(using: .utf8) else {
            emitError("备份内容无法编码，未能导出。", action: "export")
            return
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let panel = NSSavePanel()
        panel.title = "导出 Stardew Journal 备份"
        panel.nameFieldStringValue = "Stardew-Journal-backup-\(formatter.string(from: Date())).json"
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url, options: .atomic)
                self?.dispatchEvent("meadow:exported", detail: ["filename": url.lastPathComponent])
            } catch {
                self?.emitError("备份导出失败，请检查目标文件夹的权限。", action: "export")
            }
        }
    }

    private func importData() {
        let panel = NSOpenPanel()
        panel.title = "导入 Stardew Journal 备份"
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            do {
                let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
                guard let size = attributes[.size] as? NSNumber, size.intValue <= 10_000_000 else {
                    self?.emitError("备份文件过大，请选择小于 10 MB 的 JSON 文件。", action: "import")
                    return
                }
                let text = try String(contentsOf: url, encoding: .utf8)
                self?.dispatchEvent("meadow:import", detail: ["text": text])
            } catch {
                self?.emitError("无法读取备份，请选择 UTF-8 编码的 JSON 文件。", action: "import")
            }
        }
    }

    private func notifyState() {
        guard webView != nil else { return }
        let state = "{pinned:\(pinned),compact:\(compact)}"
        webView.evaluateJavaScript("window.__MEADOW_NATIVE_STATE__=\(state);window.dispatchEvent(new CustomEvent('meadow:native-state',{detail:\(state)}));", completionHandler: nil)
    }

    private func setPinned(_ value: Bool) {
        pinned = value
        preferences.set(value, forKey: "pinned")
        window.level = value ? .floating : .normal
        updateMenuChecks()
        notifyState()
    }

    private func setCompact(_ value: Bool) {
        // Presets remain usable after any manual resize. Derive mode from the
        // actual width instead of relying on a potentially stale button state.
        let current = window.frame
        var targetSize: NSSize
        if value {
            if current.width >= compactWidthThreshold { regularFrame = current }
            let contentSize = NSSize(width: 480, height: 680)
            targetSize = window.frameRect(forContentRect: NSRect(origin: .zero, size: contentSize)).size
        } else if let frame = regularFrame, frame.width >= compactWidthThreshold {
            targetSize = frame.size
        } else {
            targetSize = window.frameRect(forContentRect: NSRect(origin: .zero, size: NSSize(width: 1000, height: 780))).size
        }
        // Preserve the top-left corner after dragging a compact window, so the
        // larger preset grows from its current location rather than jumping.
        let target = NSRect(x: current.minX, y: current.maxY - targetSize.height,
                            width: targetSize.width, height: targetSize.height)
        applyingWindowPreset = true
        window.setFrame(visibleWindowFrame(target), display: true)
        applyingWindowPreset = false
        if !synchronizeWindowMode() { notifyState() }
        persistWindowGeometry()
    }

    private func validWindowFrame(_ frame: NSRect) -> Bool {
        frame.origin.x.isFinite && frame.origin.y.isFinite
            && frame.width.isFinite && frame.height.isFinite
            && frame.width > 0 && frame.height > 0
    }

    private func visibleWindowFrame(_ proposed: NSRect) -> NSRect {
        guard validWindowFrame(proposed) else { return window.frame }
        // Prefer the display that contains most of the saved window. A removed
        // external display falls back to the current main screen.
        let overlapping = NSScreen.screens.max { lhs, rhs in
            let left = proposed.intersection(lhs.visibleFrame)
            let right = proposed.intersection(rhs.visibleFrame)
            return (left.isNull ? 0 : left.width * left.height) < (right.isNull ? 0 : right.width * right.height)
        }
        let screen = overlapping.flatMap { proposed.intersects($0.visibleFrame) ? $0 : nil }
            ?? NSScreen.main ?? NSScreen.screens.first
        guard let visible = screen?.visibleFrame else { return proposed }
        var frame = proposed
        frame.size.width = min(max(frame.width, minimumWindowSize.width), visible.width)
        frame.size.height = min(max(frame.height, minimumWindowSize.height), visible.height)
        frame.origin.x = min(max(frame.minX, visible.minX), visible.maxX - frame.width)
        frame.origin.y = min(max(frame.minY, visible.minY), visible.maxY - frame.height)
        return frame
    }

    @discardableResult
    private func synchronizeWindowMode() -> Bool {
        guard window != nil, !applyingWindowPreset else { return false }
        let nextCompact = window.frame.width < compactWidthThreshold
        // Remember the final regular size, not every intermediate width while
        // dragging through the compact threshold.
        if !nextCompact && !window.inLiveResize && !window.styleMask.contains(.fullScreen) {
            regularFrame = window.frame
        }
        guard nextCompact != compact else { return false }
        compact = nextCompact
        preferences.set(compact, forKey: "compact")
        updateMenuChecks()
        notifyState()
        return true
    }

    private func persistWindowGeometry() {
        geometrySaveWorkItem?.cancel()
        guard window != nil, !window.styleMask.contains(.fullScreen) else { return }
        window.saveFrame(usingName: frameAutosaveName)
        if let frame = regularFrame, validWindowFrame(frame) {
            preferences.set(NSStringFromRect(frame), forKey: "regularWindowFrame")
        }
    }

    private func scheduleGeometrySave() {
        geometrySaveWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.persistWindowGeometry() }
        geometrySaveWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    func windowDidResize(_ notification: Notification) {
        synchronizeWindowMode()
        if !applyingWindowPreset { scheduleGeometrySave() }
    }

    func windowDidMove(_ notification: Notification) {
        guard !applyingWindowPreset else { return }
        if !compact && !window.inLiveResize && !window.styleMask.contains(.fullScreen) {
            regularFrame = window.frame
        }
        scheduleGeometrySave()
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        synchronizeWindowMode()
        if !compact && !window.styleMask.contains(.fullScreen) { regularFrame = window.frame }
        persistWindowGeometry()
    }

    func applicationWillTerminate(_ notification: Notification) {
        persistWindowGeometry()
    }

    private func updateMenuChecks() {
        pinMenuItem?.state = pinned ? .on : .off
        compactMenuItem?.state = compact ? .on : .off
    }

    @objc private func togglePinned() { setPinned(!pinned) }
    @objc private func toggleCompact() { setCompact(!compact) }

    @objc private func showWindow(_ sender: Any?) {
        if window.isMiniaturized { window.deminiaturize(nil) }
        if !window.styleMask.contains(.fullScreen) {
            let frame = visibleWindowFrame(window.frame)
            if frame != window.frame { window.setFrame(frame, display: false) }
        }
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    @objc private func showAbout() {
        NSApplication.shared.orderFrontStandardAboutPanel(options: [
            .applicationName: "Stardew Journal",
            .applicationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "2.0.0",
            .credits: NSAttributedString(string: "星露谷总有下一个春天。\n\n把待办种成作物的桌面待办清单。")
        ])
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        notifyState()
        if let message = startupError {
            emitError(message, action: "load")
            startupError = nil
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL && url.standardizedFileURL.path.hasPrefix(webDirectory.standardizedFileURL.path + "/") {
            decisionHandler(.allow)
        } else {
            if navigationAction.navigationType == .linkActivated,
               ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
