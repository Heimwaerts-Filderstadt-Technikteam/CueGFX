{
  # CueGFX NDI-Addon – benötigt kein NDI SDK, die NDI-Laufzeit wird zur Laufzeit geladen.
  "targets": [
    {
      "target_name": "cuegfx_ndi",
      "sources": ["src/ndi_addon.cc"],
      "defines": ["NAPI_VERSION=8"],
      "cflags_cc": ["-std=c++17", "-O3", "-fexceptions"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "GCC_OPTIMIZATION_LEVEL": "3",
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          }
        }],
        ["OS=='linux'", {
          "libraries": ["-ldl", "-lpthread"],
          "cflags_cc!": ["-fno-exceptions"]
        }],
        ["OS=='win'", {
          "defines": ["WIN32_LEAN_AND_MEAN", "_CRT_SECURE_NO_WARNINGS"],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17", "/utf-8"] }
          }
        }]
      ]
    }
  ]
}
