// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "EditioArchiveExtractorCore",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "EditioArchiveExtractorCore", targets: ["EditioArchiveExtractorCore"])
  ],
  dependencies: [
    .package(url: "https://github.com/weichsel/ZIPFoundation.git", exact: "0.9.20")
  ],
  targets: [
    .target(
      name: "EditioArchiveExtractorCore",
      dependencies: ["ZIPFoundation"],
      path: "ios",
      exclude: [
        "EditioArchiveExtractor.podspec",
        "EditioArchiveExtractorModule.swift",
        "EditioObjectiveCExceptionCatcher.h",
        "EditioObjectiveCExceptionCatcher.m"
      ]
    ),
    .testTarget(
      name: "EditioArchiveExtractorCoreTests",
      dependencies: ["EditioArchiveExtractorCore", "ZIPFoundation"],
      path: "Tests"
    )
  ]
)
