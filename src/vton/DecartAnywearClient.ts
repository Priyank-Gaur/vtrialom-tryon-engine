/**
 * src/vton/DecartAnywearClient.ts
 *
 * Real-time Neural Video Virtual Try-On Client powered by Decart AI (Lucy V-TON).
 * Connects via fal.ai real-time WebRTC infrastructure or Decart AI direct pipeline.
 *
 * Technology Architecture:
 *   1. Video-to-Video Diffusion: Streams webcam at 30 FPS via WebRTC to GPU runner.
 *   2. Authentication: Exchanges master fal.ai key for a short-lived scoped JWT token
 *      (via Vite dev-proxy /api/fal/token or direct rest.fal.ai/tokens/realtime),
 *      then initiates WebSocket handshake at wss://fal.run/decart/lucy2-vton/realtime.
 *   3. Bidirectional WebRTC: Exchanging dynamic ICE servers and SDP offer/answer.
 *   4. Prompt & Image Synchronization: Pushes base64 garment images and styling prompts
 *      dynamically into the live video stream.
 */

export interface DecartAnywearConfig {
  apiKey?: string;
  endpointUrl?: string;
  modelId?: string;
  onStream?: (stream: MediaStream) => void;
  onStatus?: (status: string, isError?: boolean) => void;
}

export interface GarmentPrompt {
  name: string;
  imageUrl?: string;
  description?: string;
  prompt?: string;
}

async function resolveImageAsDataUrl(url: string): Promise<string> {
  if (!url || url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(url);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

export class DecartAnywearClient {
  private _config: DecartAnywearConfig;
  private _ws: WebSocket | null = null;
  private _pc: RTCPeerConnection | null = null;
  private _localStream: MediaStream | null = null;
  private _remoteStream: MediaStream | null = null;
  private _activeGarment: GarmentPrompt | null = null;
  private _isConnected = false;

  constructor(config: DecartAnywearConfig = {}) {
    this._config = {
      modelId: "decart/lucy2-vton/realtime",
      ...config,
    };
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get activeGarment(): GarmentPrompt | null {
    return this._activeGarment;
  }

  get remoteStream(): MediaStream | null {
    return this._remoteStream;
  }

  /**
   * Connects webcam stream to Decart Lucy V-TON real-time WebRTC pipeline.
   */
  async connect(localStream: MediaStream, apiKey?: string): Promise<void> {
    if (apiKey) {
      this._config.apiKey = apiKey;
    }

    const rawKey = this._config.apiKey?.trim() || "";
    if (!rawKey) {
      this._notifyStatus("Please enter your fal.ai API key to start cloud neural diffusion.", true);
      return;
    }

    // Clean key format
    let cleanKey = rawKey;
    if (cleanKey.startsWith("Key ")) cleanKey = cleanKey.slice(4).trim();
    if (cleanKey.startsWith("FAL_KEY=")) cleanKey = cleanKey.slice(8).trim();
    cleanKey = cleanKey.replace(/^["']|["']$/g, "").trim();

    this._localStream = localStream;
    this._notifyStatus("Connecting to Decart Lucy V-TON neural pipeline…");

    try {
      let wsUrl: string;

      if (cleanKey.startsWith("decart_")) {
        // Direct Decart API
        wsUrl = `wss://api.decart.ai/v1/stream?api_key=${encodeURIComponent(cleanKey)}&model=lucy-2.1`;
      } else {
        // fal.ai Lucy V-TON endpoint
        let token = cleanKey;
        if (!cleanKey.startsWith("eyJ")) {
          // Exchange raw API key for short-lived JWT token
          token = await this._fetchFalJwtToken(cleanKey);
        }
        const model = this._config.modelId || "decart/lucy2-vton/realtime";
        wsUrl = `wss://fal.run/${model}?fal_jwt_token=${encodeURIComponent(token)}`;
      }

      this._setupWebSocket(wsUrl);
    } catch (err) {
      const msg = (err as Error).message;
      this._notifyStatus(`Decart connection failed: ${msg}. Running local V-Wear try-on.`, true);
    }
  }

  /**
   * Fetches short-lived JWT token from fal.ai security gateway.
   */
  private async _fetchFalJwtToken(apiKey: string): Promise<string> {
    this._notifyStatus("Authenticating with fal.ai security gateway…");

    // 1. Try local dev-server proxy first
    try {
      const proxyRes = await fetch("/api/fal/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          model: this._config.modelId || "decart/lucy2-vton/realtime",
        }),
      });

      if (proxyRes.ok) {
        const data = await proxyRes.json();
        if (data.token) return data.token;
        if (data.detail || data.error) {
          throw new Error(data.detail || data.error);
        }
      } else {
        const errData = await proxyRes.json().catch(() => null);
        if (errData?.detail || errData?.error) {
          throw new Error(errData.detail || errData.error);
        }
      }
    } catch (err) {
      console.warn("[DecartAnywear] Local token proxy attempt:", err);
    }

    // 2. Fallback: Direct REST call
    const targetApp = this._config.modelId || "decart/lucy2-vton/realtime";
    const directRes = await fetch("https://rest.fal.ai/tokens/realtime", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({
        app: targetApp,
      }),
    });

    if (!directRes.ok) {
      const errText = await directRes.text().catch(() => "");
      throw new Error(`fal.ai authentication failed (${directRes.status}): ${errText || directRes.statusText}`);
    }

    const data = await directRes.json();
    if (!data.token) {
      throw new Error("No token returned by fal.ai auth service");
    }
    return data.token;
  }

  /**
   * Initializes WebSocket connection and WebRTC signaling.
   */
  private _setupWebSocket(wsUrl: string): void {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }

    this._ws = new WebSocket(wsUrl);

    this._ws.onopen = () => {
      this._notifyStatus("Connected to Decart AI cluster. Initializing WebRTC handshake…");
    };

    this._ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this._handleServerMessage(msg);
      } catch (err) {
        console.error("[DecartAnywear] Message parsing error:", err);
      }
    };

    this._ws.onerror = (err) => {
      console.warn("[DecartAnywear] WebSocket error:", err);
    };

    this._ws.onclose = (event) => {
      this._isConnected = false;
      if (event.code === 1000 || event.code === 1005) {
        this._notifyStatus("Decart AI session closed.");
      } else {
        this._notifyStatus(
          `Disconnected from Decart AI (code: ${event.code}${event.reason ? ": " + event.reason : ""}). Falling back to local V-Wear try-on.`,
          false
        );
      }
    };
  }

  /**
   * Updates clothing item being tried on in real-time.
   */
  async setGarment(garment: GarmentPrompt): Promise<void> {
    this._activeGarment = garment;
    this._notifyStatus(`Styling with: ${garment.name}…`);
    await this._sendGarmentPrompt(garment);
  }

  private async _sendGarmentPrompt(garment: GarmentPrompt): Promise<void> {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      let resolvedImage = garment.imageUrl;
      if (resolvedImage) {
        resolvedImage = await resolveImageAsDataUrl(resolvedImage);
      }

      this._ws.send(
        JSON.stringify({
          prompt: garment.prompt || garment.description || `Substitute the current upper-body clothing with ${garment.name}`,
          reference_image_url: resolvedImage,
        })
      );
    }
  }

  /**
   * Handles incoming WebRTC negotiation messages from Decart Lucy V-TON.
   */
  private async _handleServerMessage(msg: Record<string, unknown>): Promise<void> {
    const type = msg.type as string;

    if (type === "iceservers" || type === "iceServers") {
      const rawServers = (msg.iceservers || msg.iceServers || msg.ice_servers) as Array<Record<string, unknown>>;
      const iceServers: RTCIceServer[] = Array.isArray(rawServers)
        ? rawServers.map((s) => ({
            urls: (s.urls || s.url) as string | string[],
            username: s.username as string | undefined,
            credential: s.credential as string | undefined,
          }))
        : [{ urls: "stun:stun.l.google.com:19302" }];

      this._pc = new RTCPeerConnection({ iceServers });

      // Add local webcam tracks to send live frames to Decart Lucy V-TON
      if (this._localStream) {
        this._localStream.getTracks().forEach((track) => {
          this._pc!.addTrack(track, this._localStream!);
        });
      }

      // Receive the real-time AI transformed video stream
      this._pc.ontrack = (e) => {
        if (e.streams && e.streams[0]) {
          this._remoteStream = e.streams[0];
          this._isConnected = true;
          this._notifyStatus("✦ Decart Lucy V-TON Live! Photorealistic AI try-on active at 30 FPS.");
          if (this._config.onStream) {
            this._config.onStream(e.streams[0]);
          }
        }
      };

      this._pc.onicecandidate = (e) => {
        if (e.candidate && this._ws && this._ws.readyState === WebSocket.OPEN) {
          this._ws.send(
            JSON.stringify({
              type: "icecandidate",
              candidate: {
                candidate: e.candidate.candidate,
                sdpMid: e.candidate.sdpMid,
                sdpMLineIndex: e.candidate.sdpMLineIndex,
              },
            })
          );
        }
      };

      const offer = await this._pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false,
      });
      await this._pc.setLocalDescription(offer);

      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
      }

      // Sync active garment if one was already chosen
      if (this._activeGarment) {
        await this._sendGarmentPrompt(this._activeGarment);
      }
    } else if (type === "answer" && this._pc) {
      await this._pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: msg.sdp as string }));
    } else if ((type === "icecandidate" || type === "candidate") && this._pc && msg.candidate) {
      try {
        await this._pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit));
      } catch (e) {
        console.warn("[DecartAnywear] Could not add remote ICE candidate:", e);
      }
    } else if (type === "error" || msg.error) {
      const errorMsg = (msg.message || msg.error || JSON.stringify(msg)) as string;
      console.error("[DecartAnywear] Server error:", errorMsg);
      this._notifyStatus(`Decart AI server error: ${errorMsg}`, true);
    }
  }

  /**
   * Disconnects the WebRTC and WebSocket session.
   */
  disconnect(): void {
    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._isConnected = false;
    this._remoteStream = null;
    this._notifyStatus("Session closed.");
  }

  private _notifyStatus(status: string, isError = false): void {
    if (this._config.onStatus) {
      this._config.onStatus(status, isError);
    }
  }
}
