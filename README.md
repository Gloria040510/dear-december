# Dear December

*Some things are worth keeping.*

An interactive winter installation. Five memories become stars on a tree shaped by movement and sound. The tree is drawn and simulated in the browser. [Open the installation](https://dear-december-memories.sweet-pony-8082.chatgpt.site) · [中文说明](README.zh-CN.md)

Use **EN / 中文** in the header to switch the interface and export text during a performance. The site uses your browser language on the first visit and remembers your choice on the current device.

## Start

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Use Node.js 20.19+ or 22.12+. For a static build, run `npm run build` and serve `dist/` over HTTPS. `npm run preview` serves a local production build.

1. Write up to five memories. Select the generated Winter Nocturne score or choose a local audio file.
2. Use the mouse, touchscreen or camera. Watch Demo plays a procedural performance with sample memories when the fields are empty.
3. With a mouse, drag to gather particles, hold Shift to spread them, and swipe to add rotation. With the camera, use an open palm, closed fist, sideways swipe, or both palms to shape the tree. Pinch near a memory star, or select it directly.
4. Let the soundtrack finish or select **End performance**. From **Creator**, choose a frame, save a PNG, or record the canvas with soundtrack audio. Choose a supported format before recording and select **Stop recording** to download the clip.

Creator mode offers 9:16 and 16:9 frames, optional local camera compositing in four corners, optional person segmentation, and a UI-free cinematic view. Press Esc or C to restore the controls. Posters use a 2560 px long edge and recordings use a 1280 px long edge at up to 30 fps. Fullscreen and recording formats depend on the browser.

## Implementation

- **Rendering**. Three.js and WebGL 2 draw up to 65,536 simulated particles plus atmospheric and ground particles. The simulation uses ping-pong position and velocity textures, with mass, lifetime, spring, attraction and repulsion, analytic curl, spiral advection and damping. A smaller CPU simulation supports devices without renderable float textures. Low frame rates reduce the number of drawn particles. The opening contains a live study of the tree. Each performance begins by dispersing and reforming the point cloud. Shader point spread, depth attenuation and a soft crown sprite supply the optical treatment.
- **Vision**. MediaPipe Hand Landmarker detects up to two sets of 21 3-D points. The tracker uses palm position, relative hand spacing, EMA stabilization and per-hand temporal histories. The ONNX temporal CNN receives 32 frames of 17 features. Geometry supplies immediate and low-confidence fallback. A confidence threshold, consecutive-frame confirmation and pinch hysteresis limit accidental triggers.
- **Sound**. Web Audio extracts the FFT, frequency band energy, RMS, spectral centroid and flux, plus approximate onset and beat estimates. Smoothed measurements modulate tree breadth, glow, sparkle and a subtle radial wave. Winter Nocturne is synthesized from original oscillators and note envelopes.
- **Privacy**. Memories, audio, camera frames, recording and gesture capture remain on the device. Camera access is opt-in. Google MediaPipe and ONNX Runtime Web may download pinned inference assets from Google Cloud Storage and jsDelivr. The live intervention requires WebGL 2 and camera access requires an HTTPS or localhost context. The mouse/touch and demo modes require no camera.

API references are available from [Google MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js) and [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/deploy.html).

## Reproduce the gesture model

```sh
python -m pip install -r model/requirements.txt
python model/generate.py
python model/train.py
```

The generator writes 6,480 windows with 32 frames each, spanning 18 seeded template and trajectory source groups. Groups 0–11 (4,320 clips) train the model. Groups 12–14 (1,080 clips) select the checkpoint. Groups 15–17 (1,080 clips) form the test. Independent random streams vary hand geometry, orientation, position, scale, movement timing, landmark noise and occlusion. The grouped test stays inside the same synthetic generator family.

`public/model/gesture.onnx` is the exported model. [metrics.json](public/model/metrics.json) contains accuracy, macro F1, per-class statistics and confusion matrices for the temporal CNN and geometry rules. Confusion matrices use actual labels for rows and predicted labels for columns.

| Held-out synthetic test | Accuracy |
| --- | ---: |
| Temporal CNN | 95.37% |
| Geometry baseline | 73.70% |

The **Gesture lab** exposes both matrices and a browser benchmark. The benchmark checks a held-out fixture against the PyTorch prediction, then times 80 warm WASM runs. The timing includes browser tensor construction, inference and result decoding. MediaPipe, startup, inference scheduling and the 32-frame acquisition window are outside that measurement.

A Chromium run on the development machine measured **0.40 ms median** and **0.90 ms p95**. Use the in-app benchmark to measure your browser.

**Independent real-camera evaluation** currently has zero labeled clips. To evaluate your device and test conditions, open **Gesture lab**, enable the camera, label and capture multiple clips of each gesture, and save JSON into `model/captures/`. Use distinct recordings for any future calibration and this independent evaluation. `python model/train.py --real model/captures` recomputes the synthetic model with the fixed seed and scores the real clips separately. The real clips are held out from training and checkpoint selection.

## License

Project source, model generator and project-trained ONNX weights are available under the [MIT license](LICENSE). Linked fonts, third-party libraries and MediaPipe assets retain their own licenses.
