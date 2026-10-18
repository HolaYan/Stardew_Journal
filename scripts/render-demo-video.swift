import AppKit
import AVFoundation
import CoreMedia
import CoreText
import ImageIO
import QuartzCore

// Compile: xcrun swiftc -parse-as-library -O scripts/render-demo-video.swift -o .build/render-demo-video
// Run: .build/render-demo-video raw.mp4 segments.json output.mp4
// QA: .build/render-demo-video --frames output.mp4 output/video/qa 0,10,30
// Each segment is either {start,end,title,caption} or {image,duration,title,caption}.
// Movie timestamps are seconds in the original recording; image paths are absolute.

private struct Segment: Decodable {
    let start: Double?
    let end: Double?
    let image: String?
    let duration: Double?
    let title: String
    let caption: String
}

private struct RenderError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct TimedSegment {
    let segment: Segment
    let start: Double
    let duration: Double
    let image: CGImage?
}

private let canvas = CGSize(width: 1080, height: 1920)
private let contentBox = CGRect(x: 24, y: 180, width: 1032, height: 1620)
private let timeScale: CMTimeScale = 600

private func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}

private func fitted(_ size: CGSize, in box: CGRect) -> CGRect {
    let scale = min(box.width / size.width, box.height / size.height)
    let result = CGSize(width: size.width * scale, height: size.height * scale)
    return CGRect(x: box.midX - result.width / 2, y: box.midY - result.height / 2,
                  width: result.width, height: result.height)
}

private func font(_ size: CGFloat, bold: Bool = false) -> NSFont {
    let name = bold ? "PingFangSC-Semibold" : "PingFangSC-Regular"
    return NSFont(name: name, size: size) ?? NSFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular)
}

private func text(_ value: String, frame: CGRect, size: CGFloat, bold: Bool = false,
                  foreground: UInt32 = 0x49301D, alignment: CATextLayerAlignmentMode = .left) -> CALayer {
    let layer = CALayer()
    layer.frame = frame
    layer.contentsScale = 2
    // Render CoreText into an image explicitly. CATextLayer may not draw attributed
    // strings in a command-line AVFoundation export without an application run loop.
    let context = CGContext(data: nil, width: Int(frame.width * 2), height: Int(frame.height * 2),
                            bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.scaleBy(x: 2, y: 2)
    let typeface = CTFontCreateWithName(font(size, bold: bold).fontName as CFString, size, nil)
    var paragraphAlignment: CTTextAlignment = alignment == .right ? .right : .left
    let paragraph = withUnsafePointer(to: &paragraphAlignment) { pointer in
        var setting = CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: pointer)
        return CTParagraphStyleCreate(&setting, 1)
    }
    let attributed = NSAttributedString(string: value, attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): typeface,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color(foreground),
        NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraph
    ])
    let framesetter = CTFramesetterCreateWithAttributedString(attributed)
    let path = CGPath(rect: CGRect(origin: .zero, size: frame.size), transform: nil)
    let textFrame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
    CTFrameDraw(textFrame, context)
    layer.contents = context.makeImage()
    return layer
}

private func visible(_ layer: CALayer, start: Double, duration: Double, total: Double) {
    layer.opacity = 0
    let animation = CAKeyframeAnimation(keyPath: "opacity")
    var times: [NSNumber] = [0]
    var values: [NSNumber] = [start <= 0 ? 1 : 0]
    if start > 0 {
        times.append(NSNumber(value: start / total))
        values.append(1)
    }
    if start + duration < total - 0.0001 {
        times.append(NSNumber(value: (start + duration) / total))
        values.append(0)
    }
    times.append(1)
    values.append(values.last!)
    animation.keyTimes = times
    animation.values = values
    animation.calculationMode = .discrete
    animation.beginTime = AVCoreAnimationBeginTimeAtZero
    animation.duration = total
    animation.fillMode = .both
    animation.isRemovedOnCompletion = false
    layer.add(animation, forKey: "segmentVisibility")
}

private func loadImage(_ path: String) throws -> CGImage {
    guard path.hasPrefix("/"),
          let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw RenderError(message: "Cannot read the absolute image path: \(path)")
    }
    return image
}

@main
private struct DemoVideoRenderer {
    static func main() async {
        do {
            if CommandLine.arguments.dropFirst().first == "--frames" {
                try await extractFrames()
            } else {
                try await render()
            }
        } catch {
            fputs("Video export failed: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    static func extractFrames() async throws {
        let args = CommandLine.arguments
        guard args.count == 5 else {
            throw RenderError(message: "Usage: render-demo-video --frames <movie.mp4> <directory> <seconds,seconds,...>")
        }
        let asset = AVURLAsset(url: URL(fileURLWithPath: args[2]))
        let directory = URL(fileURLWithPath: args[3], isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        for token in args[4].split(separator: ",") {
            guard let second = Double(token), second.isFinite, second >= 0 else {
                throw RenderError(message: "Invalid frame timestamp: \(token)")
            }
            let (image, actualTime) = try await generator.image(at: CMTime(seconds: second, preferredTimescale: timeScale))
            let url = directory.appendingPathComponent(String(format: "frame-%08.3f.png", second))
            guard let output = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else {
                throw RenderError(message: "Cannot write frame: \(url.path)")
            }
            CGImageDestinationAddImage(output, image, nil)
            guard CGImageDestinationFinalize(output) else { throw RenderError(message: "Frame write failed.") }
            print("Saved \(url.path), actual time \(actualTime.seconds)s, \(image.width)×\(image.height)")
        }
    }

    static func render() async throws {
        let args = CommandLine.arguments
        guard args.count == 4 else {
            throw RenderError(message: "Usage: render-demo-video <raw.mp4> <segments.json> <output.mp4>")
        }
        let sourceURL = URL(fileURLWithPath: args[1]).standardizedFileURL
        let segmentsURL = URL(fileURLWithPath: args[2]).standardizedFileURL
        let outputURL = URL(fileURLWithPath: args[3]).standardizedFileURL
        guard sourceURL != outputURL else { throw RenderError(message: "The output cannot replace the original recording.") }
        guard !FileManager.default.fileExists(atPath: outputURL.path) else {
            throw RenderError(message: "Output already exists; choose another filename: \(outputURL.path)")
        }
        let segments = try JSONDecoder().decode([Segment].self, from: Data(contentsOf: segmentsURL))
        guard !segments.isEmpty else { throw RenderError(message: "The segment list is empty.") }

        let source = AVURLAsset(url: sourceURL)
        guard let sourceTrack = try await source.loadTracks(withMediaType: .video).first else {
            throw RenderError(message: "The source has no video track.")
        }
        let sourceDuration = try await source.load(.duration).seconds
        let naturalSize = try await sourceTrack.load(.naturalSize)
        let preferredTransform = try await sourceTrack.load(.preferredTransform)
        guard sourceDuration.isFinite && sourceDuration > 0 else { throw RenderError(message: "The source duration is invalid.") }
        let composition = AVMutableComposition()
        guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RenderError(message: "Cannot create the composition video track.")
        }

        var timedSegments: [TimedSegment] = []
        var cursor = CMTime.zero
        for (index, segment) in segments.enumerated() {
            let duration: Double
            let still: CGImage?
            if let path = segment.image {
                guard segment.start == nil && segment.end == nil,
                      let length = segment.duration, length.isFinite, length > 0 else {
                    throw RenderError(message: "Image segment \(index + 1) requires a positive duration and no start/end timestamps.")
                }
                still = try loadImage(path)
                duration = length
                // A covered video track keeps AVFoundation's renderer active during still-image inserts.
                var remaining = CMTime(seconds: duration, preferredTimescale: timeScale)
                var insertion = cursor
                while remaining > .zero {
                    let length = min(remaining, CMTime(seconds: sourceDuration, preferredTimescale: timeScale))
                    try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: length), of: sourceTrack, at: insertion)
                    insertion = insertion + length
                    remaining = remaining - length
                }
            } else {
                guard let start = segment.start, let end = segment.end,
                      start.isFinite, end.isFinite, start >= 0, end > start,
                      end <= sourceDuration + 0.025, segment.duration == nil else {
                    throw RenderError(message: "Video segment \(index + 1) has invalid timestamps; source duration is \(sourceDuration)s.")
                }
                still = nil
                duration = min(end, sourceDuration) - start
                let range = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: timeScale),
                                        duration: CMTime(seconds: duration, preferredTimescale: timeScale))
                try videoTrack.insertTimeRange(range, of: sourceTrack, at: cursor)
            }
            let roundedDuration = CMTime(seconds: duration, preferredTimescale: timeScale)
            timedSegments.append(TimedSegment(segment: segment, start: cursor.seconds,
                                               duration: roundedDuration.seconds, image: still))
            cursor = cursor + roundedDuration
        }

        let oriented = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
        let destination = fitted(oriented.size, in: contentBox)
        let scale = destination.width / oriented.width
        let transform = preferredTransform
            .concatenating(CGAffineTransform(translationX: -oriented.minX, y: -oriented.minY))
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
            .concatenating(CGAffineTransform(translationX: destination.minX,
                                              y: canvas.height - destination.maxY))
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: cursor)
        instruction.backgroundColor = color(0xF4E5BE)
        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
        layerInstruction.setTransform(transform, at: .zero)
        instruction.layerInstructions = [layerInstruction]

        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = canvas
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        videoComposition.instructions = [instruction]

        let parent = CALayer()
        parent.frame = CGRect(origin: .zero, size: canvas)
        parent.backgroundColor = color(0xF4E5BE)
        parent.isGeometryFlipped = false
        let video = CALayer()
        video.frame = parent.bounds
        parent.addSublayer(video)

        let topLine = CALayer()
        topLine.frame = CGRect(x: 48, y: 1896, width: 984, height: 3)
        topLine.backgroundColor = color(0xB68B49)
        parent.addSublayer(topLine)
        let footerLine = CALayer()
        footerLine.frame = CGRect(x: 48, y: 164, width: 984, height: 2)
        footerLine.backgroundColor = color(0xC9A568)
        parent.addSublayer(footerLine)

        for item in timedSegments {
            let group = CALayer()
            group.frame = parent.bounds
            if let still = item.image {
                let plate = CALayer()
                plate.frame = contentBox
                plate.backgroundColor = color(0xF4E5BE)
                group.addSublayer(plate)
                let picture = CALayer()
                picture.frame = fitted(CGSize(width: still.width, height: still.height), in: contentBox)
                picture.contents = still
                picture.contentsGravity = .resizeAspect
                picture.magnificationFilter = .linear
                group.addSublayer(picture)
            }
            group.addSublayer(text(item.segment.title, frame: CGRect(x: 54, y: 1813, width: 972, height: 70), size: 34, bold: true))
            group.addSublayer(text(item.segment.caption, frame: CGRect(x: 54, y: 27, width: 972, height: 116), size: 31))
            visible(group, start: item.start, duration: item.duration, total: cursor.seconds)
            parent.addSublayer(group)
        }
        let progress = CALayer()
        progress.anchorPoint = CGPoint(x: 0, y: 0.5)
        progress.frame = CGRect(x: 48, y: 164, width: 984, height: 2)
        progress.backgroundColor = color(0x79552C)
        let growth = CABasicAnimation(keyPath: "transform.scale.x")
        growth.fromValue = 0
        growth.toValue = 1
        growth.beginTime = AVCoreAnimationBeginTimeAtZero
        growth.duration = cursor.seconds
        growth.fillMode = .both
        growth.isRemovedOnCompletion = false
        progress.add(growth, forKey: "movieProgress")
        parent.addSublayer(progress)
        videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: video, in: parent)

        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            throw RenderError(message: "Cannot create the H.264 export session.")
        }
        exporter.videoComposition = videoComposition
        exporter.shouldOptimizeForNetworkUse = true
        exporter.metadata = [metadataItem(.commonIdentifierTitle, "Stardew Journal · 待办清单完整演示")]
        print("Exporting \(timedSegments.count) segments, \(String(format: "%.2f", cursor.seconds))s, 1080×1920, H.264, silent…")
        if #available(macOS 15.0, *) {
            try await exporter.export(to: outputURL, as: .mp4)
        } else {
            exporter.outputURL = outputURL
            exporter.outputFileType = .mp4
            await withCheckedContinuation { continuation in
                exporter.exportAsynchronously { continuation.resume() }
            }
            guard exporter.status == .completed else {
                throw exporter.error ?? RenderError(message: "Export was cancelled or failed.")
            }
        }
        let result = AVURLAsset(url: outputURL)
        let resultDuration = try await result.load(.duration).seconds
        guard abs(resultDuration - cursor.seconds) < 0.1 else { throw RenderError(message: "Export duration verification failed.") }
        print("Saved: \(outputURL.path) (\(String(format: "%.2f", resultDuration))s)")
    }

    static func metadataItem(_ identifier: AVMetadataIdentifier, _ value: String) -> AVMutableMetadataItem {
        let item = AVMutableMetadataItem()
        item.identifier = identifier
        item.value = value as NSString
        return item
    }
}
