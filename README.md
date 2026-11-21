# VTrialom — Real-Time AI Virtual Try-On Engine

VTrialom is an interactive real-time virtual try-on engine engineered for low-latency web browsers. It provides two operational modes: **V-Wear AI Mode** (photorealistic 2D try-on with cloud diffusion and local segmentation fallback) and **3D WebGL Mode** (GPU SkinnedMesh rigging).

---

## 1. Operating Modes Overview

### Mode 1: V-Wear Live AI (Photorealistic Try-On)

V-Wear AI mode replicates the experience of modern neural virtual try-on platforms (such as Decart Anywear) by ensuring garments appear as if the user is genuinely **wearing** them, rather than floating as flat overlays.

V-Wear operates under a dual-pipeline architecture:

```
                          ┌────────────────────────┐
                          │   Live Webcam Stream   │
                          └───────────┬────────────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
  [Cloud Neural Diffusion]                      [Local Segmentation Pipeline]
 (Requires fal.ai API key with balance)          (Zero API key, runs 100% locally)
               │                                             │
               ▼                                             ▼
  • WebRTC Bidirectional Stream                 • MediaPipe Selfie Multiclass Segmentation
  • Decart Lucy V-TON GPU Runner                • Inverse Layer Compositing
  • Frame-by-frame 30 FPS Neural Diffusion      • Torso Inset & Feathered Erase
  • Physical fabric drape & fold synthesis      • Forearm & Hand Front-Depth Occlusion
  • Live video output via `<video>` layer       • Output to HTML5 Canvas
```

#### A. Cloud Mode (Decart Lucy V-TON via fal.ai)
* **Technology**: Real-time generative video diffusion model running on fal.ai cloud GPUs (`decart/lucy2-vton/realtime`).
* **Performance**: 30 FPS streaming at sub-50ms latency via WebRTC.
* **Mechanism**: Your camera feed is streamed upstream to the GPU runner; the model synthesizes authentic fabric drape, skin-contact lighting, and motion-conforming wrinkles frame-by-frame.
* **Garment Injection**: Garment reference images and styling prompts are transmitted through the signaling socket in real time.

#### B. Local Mode (Client-Side Inverse Compositing)
* **Technology**: MediaPipe Vision (`selfie_multiclass_256x256` segmentation + Pose Landmark detection). Runs 100% offline in browser without external servers or GPU costs.
* **The "Wearing" Illusion**:
  1. **Garment Base**: Draws the fitted garment asset onto an offscreen buffer, scaled and oriented to anatomical shoulder span and torso length.
  2. **Person Masking**: Applies the neural segmentation mask to isolate foreground person pixels (head, torso, arms, legs).
  3. **Torso Inset**: Erases the central torso region from the person layer so the garment fabric shows through.
  4. **Compositing**: The person layer (head, neck, shoulders, arms, legs) is drawn back over the garment. The user's head emerges above the collar, and arms emerge from the sleeves.
  5. **Forearm Occlusion**: When hands or forearms are raised across the chest, depth tracking re-composites them in front of the garment fabric.

#### Featured Garment Presets
V-Wear includes 4 instant presets in a floating tray:
1. **Classic Oxford Shirt**: Tailored woven cotton button-down with structured collar.
2. **Streetwear Hoodie**: Heavyweight dark charcoal pullover hoodie with draped hood.
3. **Vintage Crewneck**: Relaxed-fit heather grey cotton-fleece sweatshirt with ribbed trims.
4. **Ribbed High-Neck Sweater**: Oatmeal wool-blend turtleneck extending up the throat.
5. **Universal Upload / Drag-and-Drop**: Drop any clothing photo from Zara, ASOS, Nike, etc.

---

### Mode 2: 3D WebGL Mode (Skeleton Armature Rigging)

* **Technology**: Three.js WebGL rendering engine.
* **Rigging**: Uses a 16-joint procedural bone armature rigged to the 33 MediaPipe pose landmarks.
* **Mesh Fitting**: Automatically adjusts 3D `.glb` garment geometry scale, position, and rotation to body geometry (shoulder width, chest depth, spine angle).
* **Catalogue**: Includes 3D GLB models for Crewneck Tee, Oxford Shirt, Hoodie, and Lightweight Jacket.

---

## 2. Using the fal.ai Cloud Mode (Decart Lucy V-TON)

### Why fal.ai Requires Account Balance
Decart's Lucy V-TON is a video-to-video generative diffusion model. Every second of live video requires dedicated high-performance GPU compute (NVIDIA A100 / H100 clusters) to redraw 30 frames per second. Fal.ai charges per streaming second for running realtime model endpoints.

If you connect with a fal.ai key that has \$0 balance, fal.ai returns:
```json
{"detail": "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing"}
```
The application will automatically detect this and fall back to Local V-Wear Mode without interruption.

### Step-by-Step Setup for Cloud Mode

1. **Create an Account**:
   Go to [fal.ai](https://fal.ai) and sign up.

2. **Add Billing Credits**:
   Visit [fal.ai/dashboard/billing](https://fal.ai/dashboard/billing) and add credits (\$5 to \$10 is typically sufficient for extensive testing).

3. **Generate an API Key**:
   Navigate to [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) and create a new key.

4. **Connect in VTrialom**:
   - Start the app at `http://localhost:5173`.
   - Paste your key into the **fal.ai API key** input in the right sidebar.
   - Click **Connect** (or click **▶ Start Try-On** with the key entered).
   - The engine automatically:
     1. Sends an authentication request to the local `/api/fal/token` proxy.
     2. Exchanges your API key for a scoped, short-lived JWT realtime token.
     3. Connects to `wss://fal.run/decart/lucy2-vton/realtime`.
     4. Establishes the WebRTC peer connection (SDP offer/answer and ICE servers).
     5. Displays the transformed video feed in real time.

---

## 3. Getting Started Locally

### Prerequisites
- Node.js 18+ (tested on Node v24)
- Webcam access (Chrome, Edge, or Safari recommended)

### Installation
```bash
# Clone the repository
git clone <repo-url>
cd vtrialom-tryon

# Install dependencies
npm install
```

### Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### Quality Verification
```bash
# Typecheck TypeScript files
npm run typecheck

# Run Vitest test suite (97 tests)
npm run test

# Production build
npm run build
```

---

## 4. Project Structure

```
vtrialom-tryon/
├── index.html                     # Main application layout, styles & silhouette guide
├── vite.config.ts                 # Vite config with /api/fal/token auth proxy
├── public/
│   └── assets/
│       ├── anywear/               # 4 high-resolution garment presets (shirt, hoodie, etc.)
│       └── garments/              # 3D GLB models and metadata for 3D mode
├── src/
│   ├── main.ts                    # Application orchestration and UI state management
│   ├── api/                       # TryOnComponent public API facade
│   ├── core/                      # Engine state machine, diagnostics, types
│   ├── tracking/                  # MediaPipe Pose tracking and landmark smoothing
│   ├── segmentation/              # Person segmentation and occlusion management
│   ├── rendering/                 # Three.js 3D rendering and body occluder
│   ├── fitting/                   # 3D fitting and GarmentSkinnedRigger armature
│   └── vton/
│       ├── AnywearPresets.ts      # 4 featured preset specifications and prompts
│       ├── VWearRenderer.ts       # Local segmentation inverse compositing renderer
│       └── DecartAnywearClient.ts # fal.ai / Decart Lucy V-TON WebRTC client
└── tests/                         # Vitest test suite (97 unit tests)
```
