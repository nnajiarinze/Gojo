import Foundation
import Vision
import UIKit

@objc(AppleVisionOCR)
class AppleVisionOCR: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc func recognizeText(
    _ imageUri: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // Load image from URI (file:// or content://)
    guard let image = loadImage(from: imageUri) else {
      reject("OCR_INVALID_IMAGE", "Could not load image from URI: \(imageUri)", nil)
      return
    }

    guard let cgImage = image.cgImage else {
      reject("OCR_INVALID_IMAGE", "Could not get CGImage from loaded image", nil)
      return
    }

    // Create Vision request
    let request = VNRecognizeTextRequest { (request, error) in
      if let error = error {
        reject("OCR_FAILED", "Vision OCR failed: \(error.localizedDescription)", error)
        return
      }

      guard let observations = request.results as? [VNRecognizedTextObservation] else {
        resolve([
          "text": "",
          "confidence": 0.0,
          "lines": [] as [Any],
        ])
        return
      }

      var lines: [[String: Any]] = []
      var totalConfidence: Float = 0.0

      for observation in observations {
        guard let topCandidate = observation.topCandidates(1).first else { continue }
        lines.append([
          "text": topCandidate.string,
          "confidence": topCandidate.confidence,
        ])
        totalConfidence += topCandidate.confidence
      }

      let avgConfidence = observations.isEmpty ? 0.0 : Double(totalConfidence) / Double(observations.count)
      let fullText = lines.map { $0["text"] as? String ?? "" }.joined(separator: "\n")

      resolve([
        "text": fullText,
        "confidence": avgConfidence,
        "lines": lines,
      ])
    }

    // Configure for accuracy
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    // Run on background thread
    DispatchQueue.global(qos: .userInitiated).async {
      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      do {
        try handler.perform([request])
      } catch {
        reject("OCR_FAILED", "Vision request handler failed: \(error.localizedDescription)", error)
      }
    }
  }

  // MARK: - Image loading

  private func loadImage(from uri: String) -> UIImage? {
    // Handle file:// URIs
    if uri.hasPrefix("file://") {
      let path = uri.replacingOccurrences(of: "file://", with: "")
      return UIImage(contentsOfFile: path)
    }

    // Handle plain file paths
    if uri.hasPrefix("/") {
      return UIImage(contentsOfFile: uri)
    }

    // Handle data URIs
    if uri.hasPrefix("data:image") {
      guard let commaIndex = uri.firstIndex(of: ",") else { return nil }
      let base64String = String(uri[uri.index(after: commaIndex)...])
      guard let data = Data(base64Encoded: base64String) else { return nil }
      return UIImage(data: data)
    }

    // Try as URL
    guard let url = URL(string: uri),
          let data = try? Data(contentsOf: url) else {
      return nil
    }
    return UIImage(data: data)
  }
}
