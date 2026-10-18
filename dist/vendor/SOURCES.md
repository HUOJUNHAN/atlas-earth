# Local hand tracking dependencies

- `vision_bundle.mjs` and all files in `wasm/`: unmodified `@mediapipe/tasks-vision@0.10.35`, downloaded from the CDN documented by Google.
  - https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs
  - https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/
- `hand_landmarker.task`: Google Hand Landmarker float16 model, revision 1.
  - https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- `LICENSE-mediapipe.txt`: upstream MediaPipe Apache 2.0 license.
  - https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

Official API documentation:
https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js

The runtime, WASM and model resolve to local URLs. Version 0.10.35 is pinned to keep inference free of the usage-logging network requests introduced in later releases. The app must be served from localhost or HTTPS for camera access. Camera permission is requested only when the user enables hand control.

Gesture output: `none`, `tracking`, `pinch`, `open-palm`, `fist`, `victory`, `two-hands`. `landmarks` is an array of detected hands, each containing 21 smoothed normalized `{x,y,z}` points in the original camera coordinates. The overlay mirrors those coordinates to align with a selfie video displayed using `transform: scaleX(-1)` and `object-fit: cover`.

`yawDelta` and `pitchDelta` are radians. `zoomDelta` is a logarithmic scale increment; positive values enlarge the globe (`scale *= Math.exp(zoomDelta)`).

# Local world map dependency

- `d3.min.js`: unmodified D3 v7.9.0 UMD bundle. Loaded as a normal script, it exports the `d3` global.
  - https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js
  - Official installation documentation: https://d3js.org/getting-started
- `LICENSE-d3.txt`: upstream ISC license, Copyright 2010-2023 Mike Bostock.
  - https://github.com/d3/d3/blob/v7.9.0/LICENSE

D3 is pinned and served locally so world map rendering does not require a CDN at runtime.
