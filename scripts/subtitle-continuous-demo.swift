import AppKit
import AVFoundation
import AudioToolbox
import CoreText

// This tool keeps one complete recording, all its video samples and timestamps.
// It only appends a subtitle strip below the source image and mixes optional music.
// Compile: xcrun swiftc -parse-as-library -O -module-cache-path .build/swift-modules scripts/subtitle-continuous-demo.swift -o .build/subtitle-continuous-demo
// Run: .build/subtitle-continuous-demo raw.mp4 captions.json output.mp4 [music.wav]
// Captions: [{"start":0,"end":5,"text":"中文字幕"}]

private struct Caption: Codable {
    let start: Double
    let end: Double
    let text: String
}

private struct Failure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private final class RenderState: @unchecked Sendable {
    private let lock = NSLock()
    private var problem: Error?
    private var count = 0
    func fail(_ error: Error) { lock.lock(); if problem == nil { problem = error }; lock.unlock() }
    func increment() -> Int { lock.lock(); defer { lock.unlock() }; count += 1; return count }
    var error: Error? { lock.lock(); defer { lock.unlock() }; return problem }
    var frames: Int { lock.lock(); defer { lock.unlock() }; return count }
}

private func rgb(_ hex: UInt32) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: 1)
}

private func subtitlePixels(_ value: String, width: Int, height: Int) throws -> Data {
    let rowBytes = width * 4
    var pixels = Data(count: rowBytes * height)
    try pixels.withUnsafeMutableBytes { storage in
        let context = CGContext(data: storage.baseAddress, width: width, height: height,
                                bitsPerComponent: 8, bytesPerRow: rowBytes,
                                space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue)!
        context.setFillColor(rgb(0xF4E5BE))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setFillColor(rgb(0xB68B49))
        context.fill(CGRect(x: 24, y: height - 3, width: width - 48, height: 2))
        guard !value.isEmpty else { return }
        let textWidth = CGFloat(width - 48)
        var pointSize = min(56, max(18, CGFloat(width) / 33))
        var attributed: NSAttributedString!
        var framesetter: CTFramesetter!
        var measured = CGSize.zero
        repeat {
            let typeface = CTFontCreateWithName("PingFangSC-Regular" as CFString, pointSize, nil)
            attributed = NSAttributedString(string: value, attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): typeface,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): rgb(0x49301D)
            ])
            framesetter = CTFramesetterCreateWithAttributedString(attributed)
            measured = CTFramesetterSuggestFrameSizeWithConstraints(framesetter, CFRange(location: 0, length: 0), nil,
                                                                     CGSize(width: textWidth, height: 10000), nil)
            if measured.height + 4 <= CGFloat(height - 22) { break }
            pointSize -= 1
        } while pointSize >= 14
        let textHeight = min(CGFloat(height - 22), ceil(measured.height) + 4)
        let rect = CGRect(x: 24, y: max(8, (CGFloat(height) - textHeight) / 2), width: textWidth, height: textHeight)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), CGPath(rect: rect, transform: nil), nil)
        guard CTFrameGetVisibleStringRange(frame).length == attributed.length else {
            throw Failure(message: "A subtitle is too long to display in full: \(value)")
        }
        CTFrameDraw(frame, context)
    }
    return pixels
}

private func srtTime(_ second: Double) -> String {
    let value = Int((second * 1000).rounded())
    return String(format: "%02d:%02d:%02d,%03d", value / 3_600_000, value / 60_000 % 60, value / 1000 % 60, value % 1000)
}

@main
private struct ContinuousDemoSubtitler {
    static func main() async {
        do { try await render() }
        catch { fputs("Continuous export failed: \(error.localizedDescription)\n", stderr); exit(1) }
    }

    static func render() async throws {
        let args = CommandLine.arguments
        guard args.count == 4 || args.count == 5 else {
            throw Failure(message: "Usage: subtitle-continuous-demo <raw.mp4> <captions.json> <output.mp4> [music.wav]")
        }
        let sourceURL = URL(fileURLWithPath: args[1]).standardizedFileURL
        let captionsURL = URL(fileURLWithPath: args[2]).standardizedFileURL
        let outputURL = URL(fileURLWithPath: args[3]).standardizedFileURL
        guard sourceURL != outputURL, !FileManager.default.fileExists(atPath: outputURL.path) else {
            throw Failure(message: "Choose a new output filename; the recording and existing exports are never overwritten.")
        }
        let source = AVURLAsset(url: sourceURL)
        guard let sourceVideo = try await source.loadTracks(withMediaType: .video).first else {
            throw Failure(message: "Source has no video track.")
        }
        let sourceDuration = try await source.load(.duration)
        let sourceSize = try await sourceVideo.load(.naturalSize)
        let sourceTransform = try await sourceVideo.load(.preferredTransform)
        let sourceRate = try await sourceVideo.load(.nominalFrameRate)
        let sourceTimeScale = try await sourceVideo.load(.naturalTimeScale)
        let sourceBitRate = try await sourceVideo.load(.estimatedDataRate)
        guard sourceTransform.isIdentity else {
            throw Failure(message: "This recording has rotated track metadata. Supply a native upright capture to preserve the source image without transforms.")
        }
        let width = Int(sourceSize.width), sourceHeight = Int(sourceSize.height)
        let stripHeight = 120
        let outputHeight = sourceHeight + stripHeight
        guard width > 48, sourceHeight > 0, width % 2 == 0, sourceHeight % 2 == 0,
              sourceDuration.seconds.isFinite, sourceDuration.seconds > 0 else {
            throw Failure(message: "Source dimensions or duration are invalid for an unscaled H.264 export.")
        }
        let captions = try JSONDecoder().decode([Caption].self, from: Data(contentsOf: captionsURL)).sorted { $0.start < $1.start }
        var previousEnd = 0.0
        for caption in captions {
            guard caption.start.isFinite, caption.end.isFinite, caption.start >= previousEnd,
                  caption.end > caption.start, caption.end <= sourceDuration.seconds + 0.025,
                  !caption.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw Failure(message: "Captions need non-overlapping start/end times inside the original recording and nonempty text.")
            }
            previousEnd = caption.end
        }
        let blankStrip = try subtitlePixels("", width: width, height: stripHeight)
        let captionStrips = try captions.map { try subtitlePixels($0.text, width: width, height: stripHeight) }

        let composition = AVMutableComposition()
        guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw Failure(message: "Cannot create video track.")
        }
        try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: sourceDuration), of: sourceVideo, at: .zero)
        var audioTracks: [AVCompositionTrack] = []
        var mixParameters: [AVAudioMixInputParameters] = []
        for originalAudio in try await source.loadTracks(withMediaType: .audio) {
            guard let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                throw Failure(message: "Cannot create original audio track.")
            }
            try audio.insertTimeRange(CMTimeRange(start: .zero, duration: sourceDuration), of: originalAudio, at: .zero)
            let parameters = AVMutableAudioMixInputParameters(track: audio)
            parameters.setVolume(1, at: .zero)
            audioTracks.append(audio)
            mixParameters.append(parameters)
        }
        var musicPath: String?
        if args.count == 5 {
            let musicURL = URL(fileURLWithPath: args[4]).standardizedFileURL
            let musicAsset = AVURLAsset(url: musicURL)
            guard let musicSource = try await musicAsset.loadTracks(withMediaType: .audio).first,
                  let music = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                throw Failure(message: "Music file has no usable audio track.")
            }
            let musicDuration = try await musicAsset.load(.duration)
            guard musicDuration.seconds.isFinite, musicDuration.seconds > 0.1 else { throw Failure(message: "Music duration is invalid.") }
            var cursor = CMTime.zero
            while cursor < sourceDuration {
                let remaining = sourceDuration - cursor
                let length = CMTimeMinimum(remaining, musicDuration)
                try music.insertTimeRange(CMTimeRange(start: .zero, duration: length), of: musicSource, at: cursor)
                cursor = cursor + length
            }
            let parameters = AVMutableAudioMixInputParameters(track: music)
            let volume: Float = 0.15
            let fade = CMTime(seconds: min(3, sourceDuration.seconds / 3), preferredTimescale: 600)
            parameters.setVolume(volume, at: .zero)
            parameters.setVolumeRamp(fromStartVolume: 0, toEndVolume: volume, timeRange: CMTimeRange(start: .zero, duration: fade))
            parameters.setVolumeRamp(fromStartVolume: volume, toEndVolume: 0, timeRange: CMTimeRange(start: sourceDuration - fade, duration: fade))
            audioTracks.append(music)
            mixParameters.append(parameters)
            musicPath = musicURL.path
        }

        let reader = try AVAssetReader(asset: composition)
        let videoOutput = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ])
        videoOutput.alwaysCopiesSampleData = false
        guard reader.canAdd(videoOutput) else { throw Failure(message: "Cannot decode source video.") }
        reader.add(videoOutput)
        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: outputHeight,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: max(5_000_000, Int(sourceBitRate * 1.3)),
                AVVideoExpectedSourceFrameRateKey: max(1, sourceRate),
                AVVideoMaxKeyFrameIntervalKey: max(1, Int(sourceRate * 2)),
                AVVideoAllowFrameReorderingKey: false,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ])
        videoInput.expectsMediaDataInRealTime = false
        videoInput.mediaTimeScale = sourceTimeScale
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: outputHeight,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:]
        ])
        guard writer.canAdd(videoInput) else { throw Failure(message: "Cannot encode output video.") }
        writer.add(videoInput)

        var audioOutput: AVAssetReaderAudioMixOutput?
        var audioInput: AVAssetWriterInput?
        if !audioTracks.isEmpty {
            let output = AVAssetReaderAudioMixOutput(audioTracks: audioTracks, audioSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 2,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false
            ])
            let mix = AVMutableAudioMix()
            mix.inputParameters = mixParameters
            output.audioMix = mix
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 2,
                AVEncoderBitRateKey: 192000
            ])
            input.expectsMediaDataInRealTime = false
            guard reader.canAdd(output), writer.canAdd(input) else { throw Failure(message: "Cannot configure the mixed audio track.") }
            reader.add(output)
            writer.add(input)
            audioOutput = output
            audioInput = input
        }

        guard reader.startReading() else { throw reader.error ?? Failure(message: "Cannot start decoding.") }
        guard writer.startWriting() else { throw writer.error ?? Failure(message: "Cannot start encoding.") }
        writer.startSession(atSourceTime: .zero)
        let state = RenderState()
        let group = DispatchGroup()
        let videoQueue = DispatchQueue(label: "stardew.continuous-video")
        var videoFinished = false
        var captionIndex = 0
        group.enter()
        videoInput.requestMediaDataWhenReady(on: videoQueue) {
            guard !videoFinished else { return }
            while videoInput.isReadyForMoreMediaData {
                if let failure = state.error {
                    state.fail(failure)
                    videoInput.markAsFinished(); videoFinished = true; group.leave(); return
                }
                guard let sample = videoOutput.copyNextSampleBuffer() else {
                    if reader.status == .failed { state.fail(reader.error ?? Failure(message: "Video decode failed.")) }
                    videoInput.markAsFinished(); videoFinished = true; group.leave(); return
                }
                do {
                    try autoreleasepool {
                        guard let sourceBuffer = CMSampleBufferGetImageBuffer(sample), let pool = adaptor.pixelBufferPool else {
                            throw Failure(message: "Video sample has no image buffer.")
                        }
                        var outputBuffer: CVPixelBuffer?
                        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &outputBuffer) == kCVReturnSuccess,
                              let outputBuffer else { throw Failure(message: "Cannot allocate output frame.") }
                        let timestamp = CMSampleBufferGetPresentationTimeStamp(sample)
                        let second = timestamp.seconds
                        while captionIndex < captions.count && captions[captionIndex].end <= second { captionIndex += 1 }
                        let strip = captionIndex < captions.count && captions[captionIndex].start <= second ? captionStrips[captionIndex] : blankStrip
                        CVPixelBufferLockBaseAddress(sourceBuffer, .readOnly)
                        CVPixelBufferLockBaseAddress(outputBuffer, [])
                        guard let sourceBytes = CVPixelBufferGetBaseAddress(sourceBuffer), let destinationBytes = CVPixelBufferGetBaseAddress(outputBuffer) else {
                            CVPixelBufferUnlockBaseAddress(sourceBuffer, .readOnly); CVPixelBufferUnlockBaseAddress(outputBuffer, [])
                            throw Failure(message: "Cannot access video pixels.")
                        }
                        let sourceStride = CVPixelBufferGetBytesPerRow(sourceBuffer)
                        let destinationStride = CVPixelBufferGetBytesPerRow(outputBuffer)
                        for row in 0..<sourceHeight {
                            memcpy(destinationBytes.advanced(by: row * destinationStride), sourceBytes.advanced(by: row * sourceStride), width * 4)
                        }
                        strip.withUnsafeBytes { bytes in
                            for row in 0..<stripHeight {
                                memcpy(destinationBytes.advanced(by: (sourceHeight + row) * destinationStride), bytes.baseAddress!.advanced(by: row * width * 4), width * 4)
                            }
                        }
                        CVPixelBufferUnlockBaseAddress(sourceBuffer, .readOnly)
                        CVPixelBufferUnlockBaseAddress(outputBuffer, [])
                        guard adaptor.append(outputBuffer, withPresentationTime: timestamp) else {
                            throw writer.error ?? Failure(message: "Video frame append failed.")
                        }
                        let count = state.increment()
                        if count % 500 == 0 { print("Rendered \(count) original frames, \(String(format: "%.1f", second)) / \(String(format: "%.1f", sourceDuration.seconds))s") }
                    }
                } catch {
                    state.fail(error)
                    videoInput.markAsFinished(); videoFinished = true; group.leave(); return
                }
            }
        }
        if let audioOutput, let audioInput {
            let audioQueue = DispatchQueue(label: "stardew.continuous-audio")
            var audioFinished = false
            group.enter()
            audioInput.requestMediaDataWhenReady(on: audioQueue) {
                guard !audioFinished else { return }
                while audioInput.isReadyForMoreMediaData {
                    if state.error != nil {
                        audioInput.markAsFinished(); audioFinished = true; group.leave(); return
                    }
                    guard let sample = audioOutput.copyNextSampleBuffer() else {
                        if reader.status == .failed { state.fail(reader.error ?? Failure(message: "Audio decode failed.")) }
                        audioInput.markAsFinished(); audioFinished = true; group.leave(); return
                    }
                    if !audioInput.append(sample) {
                        state.fail(writer.error ?? Failure(message: "Audio sample append failed."))
                        audioInput.markAsFinished(); audioFinished = true; group.leave(); return
                    }
                }
            }
        }
        print("Continuous export: \(width)×\(sourceHeight) source + \(stripHeight)px subtitle strip, duration \(String(format: "%.3f", sourceDuration.seconds))s")
        await withCheckedContinuation { continuation in group.notify(queue: .global()) { continuation.resume() } }
        if let failure = state.error { reader.cancelReading(); writer.cancelWriting(); throw failure }
        writer.endSession(atSourceTime: sourceDuration)
        await withCheckedContinuation { continuation in writer.finishWriting { continuation.resume() } }
        guard writer.status == .completed else { throw writer.error ?? Failure(message: "Output finalization failed.") }

        let sourceSamples = try await sampleTimes(sourceURL)
        let outputSamples = try await sampleTimes(outputURL)
        let result = AVURLAsset(url: outputURL)
        let outputDuration = try await result.load(.duration).seconds
        guard sourceSamples.count == outputSamples.count, sourceSamples.count == state.frames,
              zip(sourceSamples, outputSamples).allSatisfy({ abs($0.0 - $0.1) < 0.002 }),
              abs(outputDuration - sourceDuration.seconds) < 0.025 else {
            throw Failure(message: "Continuity verification failed: source \(sourceSamples.count) frames / \(sourceDuration.seconds)s, output \(outputSamples.count) frames / \(outputDuration)s.")
        }
        let srt = captions.enumerated().map { index, item in
            "\(index + 1)\n\(srtTime(item.start)) --> \(srtTime(item.end))\n\(item.text)\n"
        }.joined(separator: "\n")
        try srt.write(to: outputURL.deletingPathExtension().appendingPathExtension("srt"), atomically: true, encoding: .utf8)
        let report: [String: Any] = [
            "source": sourceURL.path, "output": outputURL.path,
            "sourceWidth": width, "sourceHeight": sourceHeight,
            "outputWidth": width, "outputHeight": outputHeight,
            "sourceDuration": sourceDuration.seconds, "outputDuration": outputDuration,
            "sourceFrames": sourceSamples.count, "outputFrames": outputSamples.count,
            "allVideoTimestampsPreserved": true, "crop": false, "scale": false,
            "cuts": false, "speedChanges": false,
            "music": musicPath ?? NSNull(), "musicVolume": musicPath == nil ? 0 : 0.15,
            "captions": captions.count
        ]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            .write(to: outputURL.deletingPathExtension().appendingPathExtension("verification.json"), options: .atomic)
        print("Verified: all \(sourceSamples.count) original video frames and timestamps retained; \(String(format: "%.3f", outputDuration))s.")
        print("Saved: \(outputURL.path)")
    }

    static func sampleTimes(_ url: URL) async throws -> [Double] {
        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure(message: "Verification source lacks video.") }
        let reader = try AVAssetReader(asset: asset)
        // Decoded samples honor MP4 edit lists and B-frame presentation offsets.
        // Compressed packets also contain non-frame marker buffers and decode-time shifts.
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ])
        output.alwaysCopiesSampleData = false
        reader.add(output)
        guard reader.startReading() else { throw reader.error ?? Failure(message: "Cannot verify frame timestamps.") }
        var timestamps: [Double] = []
        while let sample = output.copyNextSampleBuffer() {
            if CMSampleBufferGetNumSamples(sample) > 0, CMSampleBufferGetImageBuffer(sample) != nil {
                timestamps.append(CMSampleBufferGetPresentationTimeStamp(sample).seconds)
            }
        }
        guard reader.status == .completed else { throw reader.error ?? Failure(message: "Cannot finish frame verification.") }
        return timestamps.sorted()
    }
}
