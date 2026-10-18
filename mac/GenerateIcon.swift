import AppKit

// Use the installed game's exact chicken pixels at every macOS icon size.
guard CommandLine.arguments.count == 3 else {
    fputs("Usage: generate-icon <output.iconset> <chicken.png>\n", stderr)
    exit(1)
}
let outputURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let chickenURL = URL(fileURLWithPath: CommandLine.arguments[2])
let chickenData = try Data(contentsOf: chickenURL)
guard let chickenBitmap = NSBitmapImageRep(data: chickenData),
      let chicken = chickenBitmap.cgImage else {
    fputs("Could not read the original game chicken PNG.\n", stderr)
    exit(1)
}
try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

func makeIcon(size: Int, filename: String) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                  isPlanar: false, colorSpaceName: .deviceRGB,
                                  bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let graphics = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.current = graphics
    let side = CGFloat(size)
    let inset = max(1, (side * 0.06).rounded())
    let plate = NSBezierPath(roundedRect: NSRect(x: inset, y: inset,
                                                width: side - inset * 2, height: side - inset * 2),
                             xRadius: side * 0.18, yRadius: side * 0.18)
    graphics.shouldAntialias = true
    NSColor(red: 0.96, green: 0.84, blue: 0.64, alpha: 1).setFill()
    plate.fill()

    // Keep original sprite colors and hard pixel edges. Integral scaling where
    // possible makes the same game sprite crisp across all Retina resolutions.
    graphics.shouldAntialias = false
    graphics.imageInterpolation = .none
    graphics.cgContext.interpolationQuality = .none
    let sourceWidth = CGFloat(chicken.width), sourceHeight = CGFloat(chicken.height)
    let longest = max(sourceWidth, sourceHeight)
    let preferredScale = side * 0.78 / longest
    let scale = side >= longest ? max(1, preferredScale.rounded()) : side / longest
    let width = (sourceWidth * scale).rounded(), height = (sourceHeight * scale).rounded()
    let destination = NSRect(x: ((side - width) / 2).rounded(), y: ((side - height) / 2).rounded(),
                             width: width, height: height)
    graphics.cgContext.draw(chicken, in: destination)
    NSGraphicsContext.restoreGraphicsState()
    let data = bitmap.representation(using: .png, properties: [:])!
    try data.write(to: outputURL.appendingPathComponent(filename))
}

for size in [16, 32, 128, 256, 512] {
    try makeIcon(size: size, filename: "icon_\(size)x\(size).png")
    try makeIcon(size: size * 2, filename: "icon_\(size)x\(size)@2x.png")
}

// ICNS stores a big-endian container length followed by typed image chunks.
// Write PNG chunks directly, avoiding an iconutil dependency in local builds.
func uint32(_ value: Int) -> Data {
    var value = UInt32(value).bigEndian
    return withUnsafeBytes(of: &value) { Data($0) }
}
let representations: [(String, String)] = [
    ("icp4", "icon_16x16.png"), ("icp5", "icon_32x32.png"),
    ("icp6", "icon_32x32@2x.png"), ("ic07", "icon_128x128.png"),
    ("ic08", "icon_256x256.png"), ("ic09", "icon_512x512.png"),
    ("ic10", "icon_512x512@2x.png"), ("ic11", "icon_16x16@2x.png"),
    ("ic12", "icon_32x32@2x.png"), ("ic13", "icon_128x128@2x.png"),
    ("ic14", "icon_256x256@2x.png")
]
var payload = Data()
for (kind, filename) in representations {
    let png = try Data(contentsOf: outputURL.appendingPathComponent(filename))
    payload.append(Data(kind.utf8))
    payload.append(uint32(png.count + 8))
    payload.append(png)
}
var icon = Data("icns".utf8)
icon.append(uint32(payload.count + 8))
icon.append(payload)
try icon.write(to: outputURL.deletingLastPathComponent().appendingPathComponent("Meadow.icns"))
