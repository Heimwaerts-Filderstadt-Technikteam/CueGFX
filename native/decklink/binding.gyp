{
  # CueGFX DeckLink-Addon. scripts/build-decklink.js kopiert die Include-Dateien des
  # Blackmagic Desktop Video SDK nach gen/sdk-include (unter Windows zusätzlich MIDL-Ausgabe nach gen/win).
  "targets": [
    {
      "target_name": "cuegfx_decklink",
      "sources": ["src/addon.cc", "src/dl_engine.cc"],
      "include_dirs": ["gen/sdk-include"],
      "defines": ["NAPI_VERSION=8"],
      "cflags_cc": ["-std=c++17", "-O3", "-fexceptions"],
      "conditions": [
        ["OS=='mac'", {
          "sources": ["gen/sdk-include/DeckLinkAPIDispatch.cpp"],
          "link_settings": { "libraries": ["-framework CoreFoundation"] },
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "GCC_OPTIMIZATION_LEVEL": "3",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CPLUSPLUSFLAGS": ["-Wno-unused-parameter"]
          }
        }],
        ["OS=='linux'", {
          "sources": ["gen/sdk-include/DeckLinkAPIDispatch.cpp"],
          "libraries": ["-ldl", "-lpthread"],
          "cflags_cc!": ["-fno-exceptions"],
          "cflags_cc": ["-Wno-unused-parameter", "-Wno-multichar"]
        }],
        ["OS=='win'", {
          "include_dirs": ["gen/win"],
          "sources": ["gen/win/DeckLinkAPI_i.c"],
          "defines": ["WIN32_LEAN_AND_MEAN", "_CRT_SECURE_NO_WARNINGS"],
          "libraries": ["ole32.lib", "oleaut32.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17", "/utf-8"] }
          }
        }]
      ]
    }
  ]
}
