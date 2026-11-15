// Makes the QR code shown on the Ride tab (the demo's last screen): public/site-qr.svg.
// macOS only (it uses the system's own QR maker, so nothing is downloaded). Run it when the site's address changes:
//
//   swift tools/make-qr.swift "https://the-site.example" public/site-qr.svg
//
// It writes a square SVG (dark squares on white, with the 4-square quiet border scanners need), then reads the
// code back with the system's QR reader and stops with an error if it does not say exactly the address given.
import CoreImage
import Foundation

let args = CommandLine.arguments
guard args.count == 3, let message = args[1].data(using: .utf8) else {
  FileHandle.standardError.write("usage: swift tools/make-qr.swift <address> <out.svg>\n".data(using: .utf8)!)
  exit(2)
}
let filter = CIFilter(name: "CIQRCodeGenerator")!
filter.setValue(message, forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel") // survives about 15% damage: enough for a projector
let image = filter.outputImage!
let context = CIContext()
let n = Int(image.extent.width) // one pixel per square, quiet border not included
let cg = context.createCGImage(image, from: image.extent)!
var pixels = [UInt8](repeating: 0, count: n * n)
let grey = CGContext(data: &pixels, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
grey.draw(cg, in: CGRect(x: 0, y: 0, width: n, height: n))

let quiet = 4
let size = n + 2 * quiet
var path = ""
for row in 0..<n {
  var col = 0
  while col < n {
    if pixels[row * n + col] < 128 {
      var run = 1
      while col + run < n && pixels[row * n + col + run] < 128 { run += 1 }
      path += "M\(col + quiet) \(row + quiet)h\(run)v1h-\(run)z"
      col += run
    } else {
      col += 1
    }
  }
}
let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 \(size) \(size)\" shape-rendering=\"crispEdges\"><rect width=\"\(size)\" height=\"\(size)\" fill=\"#fff\"/><path fill=\"#0b0a09\" d=\"\(path)\"/></svg>\n"
try! svg.write(toFile: args[2], atomically: true, encoding: .utf8)

// Read it back: draw the same squares 10 pixels each, with the border, and ask the system's QR reader.
let scale = 10
let big = CGContext(data: nil, width: size * scale, height: size * scale, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
big.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
big.fill(CGRect(x: 0, y: 0, width: size * scale, height: size * scale))
big.setFillColor(CGColor(red: 0.04, green: 0.04, blue: 0.035, alpha: 1))
for row in 0..<n {
  for col in 0..<n where pixels[row * n + col] < 128 {
    // CoreGraphics counts rows from the bottom; the bitmap's row 0 is the top.
    big.fill(CGRect(x: (col + quiet) * scale, y: (size - 1 - (row + quiet)) * scale, width: scale, height: scale))
  }
}
let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: context, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
let found = detector.features(in: CIImage(cgImage: big.makeImage()!)).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
guard found == [args[1]] else {
  FileHandle.standardError.write("The code does not read back as the address. Read: \(found)\n".data(using: .utf8)!)
  exit(1)
}
print("Wrote \(args[2]): \(n) squares a side, reads back as \(found[0])")
