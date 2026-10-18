import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Exact, unscaled crops of the user's local game textures. This avoids canvas
// readback restrictions for file:// resources in the native WKWebView host.
guard CommandLine.arguments.count == 3 else {
    fputs("Usage: extract-ui-sprites <game-assets/img> <game-assets/ui>\n", stderr)
    exit(1)
}
let sourceDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)

func objectRect(_ id: Int) -> CGRect {
    CGRect(x: (id % 24) * 16, y: (id / 24) * 16, width: 16, height: 16)
}

let sprites: [(source: String, name: String, rect: CGRect)] = [
    ("chicken_white.png", "chicken.png", CGRect(x: 0, y: 0, width: 16, height: 16)),
    ("cursors.png", "panel.png", CGRect(x: 244, y: 0, width: 18, height: 18)),
    ("cursors.png", "check.png", CGRect(x: 87, y: 52, width: 9, height: 9)),
    ("cursors.png", "checked.png", CGRect(x: 96, y: 52, width: 9, height: 9)),
    ("orders.png", "note.png", CGRect(x: 13, y: 12, width: 149, height: 173)),
    ("orders.png", "wood.png", CGRect(x: 0, y: 0, width: 338, height: 198)),
    ("springobjects.png", "spring-icon.png", objectRect(24)),
    ("springobjects.png", "month-icon.png", objectRect(190)),
    ("springobjects.png", "season-icon.png", objectRect(276)),
    ("springobjects.png", "harvest.png", objectRect(276)),
    ("crops.png", "seedling.png", CGRect(x: 64, y: 0, width: 16, height: 32))
]

enum ExtractionError: LocalizedError {
    case invalidImage(String)
    case invalidCrop(String)
    case writeFailed(String)
    var errorDescription: String? {
        switch self {
        case .invalidImage(let name): return "无法读取游戏 PNG：\(name)"
        case .invalidCrop(let name): return "素材裁剪范围超出原图：\(name)"
        case .writeFailed(let name): return "无法写入 UI 素材：\(name)"
        }
    }
}

do {
    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    var images: [String: CGImage] = [:]
    for sprite in sprites {
        if images[sprite.source] == nil {
            let url = sourceDirectory.appendingPathComponent(sprite.source)
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
                throw ExtractionError.invalidImage(sprite.source)
            }
            images[sprite.source] = image
        }
        let original = images[sprite.source]!
        let bounds = CGRect(x: 0, y: 0, width: original.width, height: original.height)
        guard bounds.contains(sprite.rect), let crop = original.cropping(to: sprite.rect) else {
            throw ExtractionError.invalidCrop(sprite.name)
        }
        let destinationURL = outputDirectory.appendingPathComponent(sprite.name)
        guard let destination = CGImageDestinationCreateWithURL(destinationURL as CFURL,
                                                                 UTType.png.identifier as CFString,
                                                                 1, nil) else {
            throw ExtractionError.writeFailed(sprite.name)
        }
        CGImageDestinationAddImage(destination, crop, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw ExtractionError.writeFailed(sprite.name)
        }
    }
    print("已生成 \(sprites.count) 个游戏 UI 原像素裁片。")
} catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(1)
}
