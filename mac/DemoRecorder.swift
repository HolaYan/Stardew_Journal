// Compiled only by build-demo.sh. ScreenCaptureKit records one fixed desktop
// rectangle containing the real window, wallpaper and menu-bar chicken.
// There is no fabricated background, window frame, editing, or time remapping.
import Cocoa
import AVFoundation
import CoreVideo
import CoreImage
import ScreenCaptureKit

final class DemoRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private weak var window: NSWindow?
    private weak var statusItem: NSStatusItem?
    private let outputURL: URL
    private let statusURL: URL
    private let framesPerSecond = 15.0
    private var width = 0
    private var height = 0
    private var windowID: CGWindowID = 0
    private var displayID: CGDirectDisplayID = 0
    private var captureRect = CGRect.zero
    private var captureGlobalRect = CGRect.zero
    private var statusButtonRect = CGRect.zero
    private var originalWindowSize = NSSize.zero
    private var stream: SCStream?
    private let frameQueue = DispatchQueue(label: "StardewJournal.continuous-window-capture")
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var preparing = false
    private var recording = false
    private var finishing = false
    private var frameCount = 0
    private var startTime = 0.0
    private var stoppedDuration = 0.0
    private var lastStatusAt = 0.0
    private var lastTimestamp = CMTime.invalid
    private var errorMessage: String?
    private var termination: (() -> Void)?
    private var statusTimer: Timer?

    init(window: NSWindow, statusItem: NSStatusItem, outputURL: URL, statusURL: URL) {
        self.window = window
        self.statusItem = statusItem
        self.outputURL = outputURL
        self.statusURL = statusURL
    }

    var isActive: Bool { preparing || recording || finishing }

    func start() {
        guard !isActive, let window = window, window.windowNumber > 0 else { return }
        preparing = true
        errorMessage = nil
        frameCount = 0
        stoppedDuration = 0
        windowID = CGWindowID(window.windowNumber)
        originalWindowSize = window.frame.size
        if let button = statusItem?.button, let owner = button.window {
            statusButtonRect = owner.convertToScreen(button.convert(button.bounds, to: nil))
        } else { statusButtonRect = .zero }
        try? FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let screen = window.screen,
              let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            preparing = false
            errorMessage = "无法确定演示窗口所在的显示器。"
            writeStatus("error")
            return
        }
        displayID = screenNumber.uint32Value
        guard screen.frame.contains(window.frame), !statusButtonRect.isEmpty,
              screen.frame.contains(statusButtonRect) else {
            preparing = false
            errorMessage = "请把演示窗口和顶部小鸡图标放在同一显示器内，再开始录制。"
            writeStatus("error")
            return
        }
        captureGlobalRect = Self.desktopCaptureBounds(window: window.frame, screen: screen.frame, statusButton: statusButtonRect)
        // AppKit screen coordinates point upward; ScreenCaptureKit sourceRect
        // uses points from the selected display's top-left corner.
        captureRect = CGRect(x: captureGlobalRect.minX - screen.frame.minX,
                             y: screen.frame.maxY - captureGlobalRect.maxY,
                             width: captureGlobalRect.width, height: captureGlobalRect.height)
        width = Int(captureRect.width) * 2
        height = Int(captureRect.height) * 2
        // Desktop capture requires the system's screen-recording authorization.
        // This invokes the normal macOS prompt, never modifies TCC or falls back
        // to another capture path when permission is refused.
        if !CGPreflightScreenCaptureAccess() {
            errorMessage = "桌面区域录制需要屏幕录制权限。请在系统设置 → 隐私与安全性 → 屏幕与系统音频录制中允许 Stardew Journal Demo，然后重新打开演示应用。"
            writeStatus("permission-required")
            guard CGRequestScreenCaptureAccess() else {
                preparing = false
                writeStatus("permission-required")
                return
            }
            errorMessage = nil
        }
        writeStatus("preparing")
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard self.preparing else { return }
                guard let display = content.displays.first(where: { $0.displayID == self.displayID }) else {
                    throw self.makeError("无法找到演示窗口所在的可录制显示器，请检查屏幕录制权限。")
                }
                let filter = SCContentFilter(display: display, excludingWindows: [])
                filter.includeMenuBar = true
                let configuration = SCStreamConfiguration()
                configuration.width = self.width
                configuration.height = self.height
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 15)
                configuration.pixelFormat = kCVPixelFormatType_32BGRA
                configuration.queueDepth = 5
                configuration.captureResolution = .best
                configuration.scalesToFit = false
                configuration.preservesAspectRatio = true
                configuration.sourceRect = self.captureRect
                configuration.ignoreShadowsDisplay = false
                configuration.includeChildWindows = true
                configuration.showsCursor = true
                configuration.capturesAudio = false
                // The rectangle is fixed for the entire recording, including
                // pauses and native panels. It never follows or rescales a window.
                let capture = SCStream(filter: filter, configuration: configuration, delegate: self)
                try capture.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.frameQueue)
                try self.prepareWriter()
                self.stream = capture
                self.preparing = false
                self.recording = true
                self.startTime = ProcessInfo.processInfo.systemUptime
                self.lastStatusAt = self.startTime
                self.lastTimestamp = .invalid
                try await capture.startCapture()
                guard self.recording else { return }
                let timer = Timer(timeInterval: 1, target: self, selector: #selector(updateRecordingStatus), userInfo: nil, repeats: true)
                self.statusTimer = timer
                RunLoop.main.add(timer, forMode: .common)
                self.writeStatus("recording")
            } catch {
                self.errorMessage = "系统窗口录制未能启动：\(error.localizedDescription)"
                self.preparing = false
                self.recording = false
                self.finishing = false
                self.stream = nil
                self.writer?.cancelWriting()
                self.writer = nil
                self.input = nil
                self.adaptor = nil
                self.writeStatus("error")
                self.completeTermination()
            }
        }
    }

    static func desktopCaptureBounds(window: CGRect, screen: CGRect, statusButton: CGRect) -> CGRect {
        // A centered 880-point native file panel retains 22 points on each side.
        let minimumWidth = min(screen.width, max(924, window.width + 240))
        let centeredLeft = max(screen.minX, min(window.midX - minimumWidth / 2, screen.maxX - minimumWidth))
        let left = max(screen.minX, floor(min(centeredLeft, statusButton.minX - 24)))
        let right = min(screen.maxX, ceil(max(centeredLeft + minimumWidth, statusButton.maxX + 24)))
        let bottom = max(screen.minY, floor(window.minY - 20))
        return CGRect(x: left, y: bottom, width: right - left, height: screen.maxY - bottom)
    }

    @objc private func updateRecordingStatus() {
        if recording { writeStatus("recording") }
    }

    private func prepareWriter() throws {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            let stamp = "\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(6))"
            let previous = outputURL.deletingPathExtension().appendingPathExtension("previous-\(stamp).mp4")
            try FileManager.default.moveItem(at: outputURL, to: previous)
        }
        let assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 7_000_000,
                AVVideoExpectedSourceFrameRateKey: framesPerSecond,
                AVVideoMaxKeyFrameIntervalKey: 30,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ]
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        videoInput.expectsMediaDataInRealTime = true
        let attributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:]
        ]
        let pixelAdaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: attributes)
        guard assetWriter.canAdd(videoInput) else { throw makeError("无法添加 H.264 视频轨道。") }
        assetWriter.add(videoInput)
        guard assetWriter.startWriting() else { throw assetWriter.error ?? makeError("无法开始视频写入。") }
        assetWriter.startSession(atSourceTime: .zero)
        writer = assetWriter
        input = videoInput
        adaptor = pixelAdaptor
    }

    func stop(completion: (() -> Void)? = nil) {
        if let completion = completion { termination = completion }
        if preparing {
            preparing = false
            writeStatus("cancelled")
            completeTermination()
            return
        }
        guard recording || finishing else { completeTermination(); return }
        if finishing { return }
        recording = false
        finishing = true
        stoppedDuration = max(0, ProcessInfo.processInfo.systemUptime - startTime)
        statusTimer?.invalidate()
        statusTimer = nil
        writeStatus("finishing")
        guard let capture = stream else { finish(); return }
        capture.stopCapture { [weak self] error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let error = error { self.errorMessage = self.errorMessage ?? error.localizedDescription }
                self.stream = nil
                self.finish()
            }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, CMSampleBufferIsValid(sampleBuffer),
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let rawStatus = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: rawStatus) == .complete,
              let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let capturedAt = ProcessInfo.processInfo.systemUptime
        DispatchQueue.main.async { [weak self] in self?.append(buffer, capturedAt: capturedAt) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.recording else { return }
            self.errorMessage = "系统窗口录制中断：\(error.localizedDescription)"
            self.stop()
        }
    }

    private func append(_ buffer: CVPixelBuffer, capturedAt: Double) {
        guard recording, let adaptor = adaptor, input?.isReadyForMoreMediaData == true else { return }
        // Real elapsed time is retained even when the screen is unchanged or a
        // frame arrives late. Waiting is never cut, accelerated, or concatenated.
        var timestamp = frameCount == 0 ? CMTime.zero : CMTime(seconds: max(0, capturedAt - startTime), preferredTimescale: 600)
        if lastTimestamp.isValid && CMTimeCompare(timestamp, lastTimestamp) <= 0 {
            timestamp = CMTimeAdd(lastTimestamp, CMTime(value: 1, timescale: 600))
        }
        if adaptor.append(buffer, withPresentationTime: timestamp) {
            frameCount += 1
            lastTimestamp = timestamp
            if frameCount == 1 {
                let image = CIImage(cvPixelBuffer: buffer)
                if let cgImage = CIContext().createCGImage(image, from: image.extent),
                   let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) {
                    let preview = outputURL.deletingLastPathComponent().appendingPathComponent("Stardew-Journal-continuous-first-frame.png")
                    try? png.write(to: preview, options: .atomic)
                }
            }
            if capturedAt - lastStatusAt >= 1 {
                lastStatusAt = capturedAt
                writeStatus("recording")
            }
        } else {
            errorMessage = writer?.error?.localizedDescription ?? "视频帧写入失败。"
            stop()
        }
    }

    private func finish() {
        guard finishing, let writer = writer, let input = input else { return }
        self.writer = nil
        self.input = nil
        self.adaptor = nil
        if frameCount == 0 || writer.status != .writing {
            errorMessage = errorMessage ?? writer.error?.localizedDescription ?? "没有可保存的视频帧。"
            writer.cancelWriting()
            finishing = false
            writeStatus("error")
            completeTermination()
            return
        }
        let end = max(stoppedDuration, CMTimeGetSeconds(lastTimestamp) + 1 / framesPerSecond)
        writer.endSession(atSourceTime: CMTime(seconds: end, preferredTimescale: 600))
        input.markAsFinished()
        writer.finishWriting { [weak self] in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.finishing = false
                if writer.status != .completed { self.errorMessage = writer.error?.localizedDescription ?? "视频未能完成保存。" }
                self.writeStatus(writer.status == .completed && self.errorMessage == nil ? "finished" : "error")
                self.completeTermination()
            }
        }
    }

    private func completeTermination() {
        let completion = termination
        termination = nil
        completion?()
    }

    private func writeStatus(_ phase: String) {
        let duration = recording ? max(0, ProcessInfo.processInfo.systemUptime - startTime) : stoppedDuration
        let value: [String: Any] = [
            "state": phase, "recording": recording, "frames": frameCount, "duration": duration,
            "error": errorMessage as Any? ?? NSNull(), "path": outputURL.path,
            "width": width, "height": height, "fps": framesPerSecond,
            "capture": "ScreenCaptureKit fixed desktop rectangle with actual menu bar and wallpaper",
            "windowID": windowID, "windowWidthPoints": originalWindowSize.width,
            "windowHeightPoints": originalWindowSize.height, "pixelsPerPoint": 2,
            "displayID": displayID,
            "sourceRectPoints": Self.rectJSON(captureRect),
            "captureGlobalAppKitRect": Self.rectJSON(captureGlobalRect),
            "statusButtonGlobalAppKitRect": Self.rectJSON(statusButtonRect),
            "continuousTimeline": true
        ]
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: statusURL, options: .atomic)
        }
    }

    private static func rectJSON(_ rect: CGRect) -> [String: CGFloat] {
        ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
    }

    private func makeError(_ message: String) -> NSError {
        NSError(domain: "StardewJournalDemoRecorder", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
