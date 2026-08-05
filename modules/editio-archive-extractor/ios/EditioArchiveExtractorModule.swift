import ExpoModulesCore
import Foundation

public final class EditioArchiveExtractorModule: Module {
  private let extractionQueue = DispatchQueue(
    label: "com.editio.archive.extraction",
    qos: .userInitiated,
    attributes: .concurrent
  )

  public func definition() -> ModuleDefinition {
    Name("EditioArchiveExtractor")

    Events("onArchiveProgress")

    OnCreate {
      self.extractionQueue.async {
        _ = try? NativeZipExtractionService.cleanupAbandoned(staleAfterSeconds: 24 * 60 * 60)
      }
    }

    OnDestroy {
      NativeZipExtractionService.cancelAll()
    }

    AsyncFunction("extractZip") {
      (sourceURL: URL, operationId: String, options: ArchiveExtractionOptionsRecord, promise: Promise) in
      let policy: ArchiveExtractionPolicy
      let operationToken: AnyObject
      do {
        policy = try ArchiveExtractionPolicy(options: options)
        operationToken = try NativeZipExtractionService.reserve(
          operationId: operationId,
          sourceURL: sourceURL
        )
      } catch {
        self.reject(promise, with: error)
        return
      }

      self.extractionQueue.async {
        var files: [NativeExtractedArchiveFile]?
        var swiftError: Error?
        let objectiveCError = EditioExecuteAndCaptureObjectiveCException {
          do {
            files = try NativeZipExtractionService.extractReserved(
              sourceURL: sourceURL,
              operationToken: operationToken,
              policy: policy,
              onProgress: { completedBytes, totalBytes in
                let ratio = totalBytes == 0 ? 0 : min(1, Double(completedBytes) / Double(totalBytes))
                DispatchQueue.main.async { [weak self] in
                  self?.sendEvent("onArchiveProgress", [
                    "completedBytes": Double(completedBytes),
                    "operationId": operationId,
                    "progress": ratio,
                    "totalBytes": Double(totalBytes)
                  ])
                }
              }
            )
          } catch {
            swiftError = error
          }
        }

        DispatchQueue.main.async {
          if objectiveCError != nil {
            NativeZipExtractionService.abandonReserved(operationToken)
            promise.reject(ArchiveExtractionError.nativeException.exception)
          } else if let swiftError {
            self.reject(promise, with: swiftError)
          } else {
            promise.resolve(files?.map(\.dictionary) ?? [])
          }
        }
      }
    }

    AsyncFunction("cancel") { (operationId: String) -> Bool in
      NativeZipExtractionService.cancel(operationId: operationId)
    }

    AsyncFunction("cleanupAbandoned") { (staleAfterSeconds: Double, promise: Promise) in
      self.extractionQueue.async {
        do {
          let removed = try NativeZipExtractionService.cleanupAbandoned(
            staleAfterSeconds: staleAfterSeconds
          )
          DispatchQueue.main.async { promise.resolve(removed) }
        } catch {
          DispatchQueue.main.async { self.reject(promise, with: error) }
        }
      }
    }
  }

  private func reject(_ promise: Promise, with error: Error) {
    if let archiveError = error as? ArchiveExtractionError {
      promise.reject(archiveError.exception)
    } else {
      promise.reject(ArchiveExtractionError.nativeException.exception)
    }
  }
}
