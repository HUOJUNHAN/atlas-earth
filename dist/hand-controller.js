/**
 * Local MediaPipe camera controller.
 * yawDelta/pitchDelta are radians. Positive zoomDelta enlarges the globe:
 *     scale *= Math.exp(zoomDelta)
 * All model/runtime URLs are local; start() requests the camera on user action.
 */
const VISION_URL = new URL('./vendor/vision_bundle.mjs', import.meta.url).href;
const WASM_ROOT = new URL('./vendor/wasm', import.meta.url).href;
const MODEL_URL = new URL('./vendor/hand_landmarker.task', import.meta.url).href;
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20],
];
const LABELS = {
  tracking: '手掌已识别',
  pinch: '捏合拖动 · 旋转地球',
  'open-palm': '张开手掌 · 放大地球',
  fist: '握拳 · 缩小地球',
  victory: '比出 V 手势 · 召唤流星雨',
  'two-hands': '双手拉开或靠拢 · 缩放地球',
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const mean = points => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  z: points.reduce((sum, p) => sum + (p.z || 0), 0) / points.length,
});

export class HandController {
  constructor({ onUpdate = () => {}, onStatus = () => {}, video, overlay, delegate = 'GPU' } = {}) {
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.video = video || document.createElement('video');
    this.overlay = overlay || null;
    this.delegate = delegate === 'CPU' ? 'CPU' : 'GPU';
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this._runId = 0;
    this._running = false;
    this._startPromise = null;
    this._stream = null;
    this._detector = null;
    this._raf = 0;
    this._videoFrame = 0;
    this._statusText = '';
    this._resetTracking();
  }

  get running() { return this._running; }

  start() {
    if (this._running) return Promise.resolve(true);
    if (this._startPromise) return this._startPromise;
    const runId = ++this._runId;
    const request = this._start(runId);
    this._startPromise = request;
    request.finally(() => {
      if (this._startPromise === request) this._startPromise = null;
    });
    return request;
  }

  async _start(runId) {
    let stream;
    let detector;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('Camera unavailable'), { name: 'InsecureContext' });
      }
      this._status('正在请求摄像头权限…');
      // This call happens before model loading, while start() follows a click.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
      });
      if (runId !== this._runId) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      this._stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (runId !== this._runId) return false;
      this._status('正在载入本地手势识别模型…');
      const { FilesetResolver, HandLandmarker } = await import(VISION_URL);
      const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
      if (runId !== this._runId) return false;
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: this.delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      };
      try {
        detector = await HandLandmarker.createFromOptions(fileset, options);
      } catch (gpuError) {
        if(this.delegate === 'CPU') throw gpuError;
        // Older graphics adapters can still use the same local model on CPU.
        if (runId !== this._runId) return false;
        options.baseOptions.delegate = 'CPU';
        detector = await HandLandmarker.createFromOptions(fileset, options);
      }
      if (runId !== this._runId) {
        detector.close();
        return false;
      }
      this._detector = detector;
      this._running = true;
      this._resetTracking();
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (this._running && this._stream === stream) {
            this.stop();
            this._status('摄像头连接已断开，请重新开启');
          }
        }, { once: true });
      }
      this._status('摄像头已开启，将手掌放入画面');
      this._schedule(runId);
      return true;
    } catch (error) {
      if (runId !== this._runId) return false;
      this._release();
      const messages = {
        NotAllowedError: '摄像头权限未开启，请在浏览器中允许访问',
        PermissionDeniedError: '摄像头权限未开启，请在浏览器中允许访问',
        NotFoundError: '未找到摄像头，请连接后重试',
        DevicesNotFoundError: '未找到摄像头，请连接后重试',
        NotReadableError: '摄像头正被其他程序占用，请关闭后重试',
        TrackStartError: '摄像头正被其他程序占用，请关闭后重试',
        InsecureContext: '请通过本地启动器或 HTTPS 页面开启摄像头',
      };
      this._status(messages[error.name] || '手势模型加载失败，请检查本地文件并重新开启');
      console.warn('Hand controller could not start:', error);
      return false;
    } finally {
      // stop() may run while a permission prompt or model load is pending.
      if (runId !== this._runId && stream) stream.getTracks().forEach(track => track.stop());
    }
  }

  stop() {
    ++this._runId;
    this._startPromise = null;
    this._release();
    this._status('摄像头已关闭');
  }

  _release() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    if (this._videoFrame && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this._videoFrame);
    }
    this._raf = this._videoFrame = 0;
    this._stream?.getTracks().forEach(track => track.stop());
    this._stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this._detector?.close();
    this._detector = null;
    this._resetTracking();
    this._draw([]);
    this._emit({ gesture: 'none', handCount: 0, landmarks: [] });
  }

  _resetTracking() {
    this._hands = [];
    this._gesture = 'none';
    this._candidate = 'none';
    this._candidateSince = 0;
    this._motionAnchor = null;
    this._gapAnchor = null;
    this._pinched = false;
    this._lastVideoTime = -1;
    this._lastInference = 0;
    this._lastSeen = 0;
    this._lostSince = 0;
    this._delta = { yawDelta: 0, pitchDelta: 0, zoomDelta: 0 };
  }

  _schedule(runId) {
    if (!this._running || runId !== this._runId) return;
    const next = time => {
      this._videoFrame = this._raf = 0;
      if (!this._running || runId !== this._runId) return;
      this._frame(time);
      this._schedule(runId);
    };
    if (this.video.requestVideoFrameCallback) {
      this._videoFrame = this.video.requestVideoFrameCallback(next);
    } else {
      this._raf = requestAnimationFrame(next);
    }
  }

  _frame(now) {
    if (document.hidden) {
      this._motionAnchor = this._gapAnchor = null;
      return;
    }
    // Inference is synchronous; limiting it to 20 fps keeps globe animation fluid.
    if (now - this._lastInference < 48 || this.video.readyState < 2 || this.video.currentTime === this._lastVideoTime) return;
    const dt = this._lastInference ? clamp((now - this._lastInference) / 1000, 0.016, 0.08) : 0.05;
    this._lastInference = now;
    this._lastVideoTime = this.video.currentTime;
    try {
      const result = this._detector.detectForVideo(this.video, now);
      this._process(result.landmarks || [], now, dt);
    } catch (error) {
      console.warn('Hand tracking stopped:', error);
      this.stop();
      this._status('手势识别已暂停，请重新开启摄像头');
    }
  }

  _process(rawHands, now, dt) {
    if (!rawHands.length) {
      if (!this._lostSince) this._lostSince = now;
      this._motionAnchor = this._gapAnchor = null;
      this._delta = { yawDelta: 0, pitchDelta: 0, zoomDelta: 0 };
      this._draw([]);
      this._emit({ gesture: 'none', handCount: 0, landmarks: [] });
      if (now - this._lostSince > 180) {
        this._hands = [];
        this._gesture = this._candidate = 'none';
        this._pinched = false;
      }
      if (now - this._lostSince > 450) this._status('未检测到手掌，请将手放到摄像头前');
      return;
    }
    this._lostSince = 0;
    this._lastSeen = now;
    const ordered = [...rawHands].sort((a, b) => a[0].x - b[0].x);
    const countChanged = ordered.length !== this._hands.length;
    const aspect = (this.video.videoWidth || 640) / (this.video.videoHeight || 480);
    const distance = (a, b) => Math.hypot((a.x-b.x)*aspect, a.y-b.y, ((a.z||0)-(b.z||0))*aspect*0.25);
    this._hands = ordered.map((hand, index) => {
      const previous = countChanged ? null : this._hands[index];
      const motion = previous ? distance(hand[0], previous[0]) : 1;
      const alpha = 1 - Math.exp(-dt * (motion > 0.025 ? 22 : 10));
      return hand.map((p, i) => previous ? {
        x: previous[i].x + (p.x - previous[i].x) * alpha,
        y: previous[i].y + (p.y - previous[i].y) * alpha,
        z: (previous[i].z||0) + ((p.z||0) - (previous[i].z||0)) * alpha,
      } : { x: p.x, y: p.y, z: p.z || 0 });
    });
    const metrics = this._hands.map(hand => {
      const center = mean([hand[0], hand[5], hand[9], hand[13], hand[17]]);
      const palmSize = Math.max(distance(hand[5], hand[17]), distance(hand[0], hand[9]), 0.035);
      const tips = [8,12,16,20];
      const ratios = tips.map(tip => distance(hand[tip], hand[0]) / Math.max(distance(hand[tip-2], hand[0]), 0.015));
      const extendedFlags = ratios.map(ratio => ratio > 1.22);
      const extended = extendedFlags.filter(Boolean).length;
      const spread = tips.reduce((sum, tip) => sum + distance(hand[tip], center), 0) / (4 * palmSize);
      const pinch = distance(hand[4], hand[8]) / palmSize;
      return { center, palmSize, extended, extendedFlags, spread, pinch, pinchPoint: mean([hand[4], hand[8]]) };
    });

    let candidate;
    const first = metrics[0];
    if (metrics.length === 2) {
      candidate = 'two-hands';
      this._pinched = false;
    } else {
      // A curled fist also brings thumb/index together; require other fingers to be extended.
      const pinchEligible = first.extended >= 2;
      this._pinched = pinchEligible && (this._pinched ? first.pinch < 0.43 : first.pinch < 0.29);
      const victory = first.extendedFlags[0] && first.extendedFlags[1] && !first.extendedFlags[2] && !first.extendedFlags[3];
      candidate = this._pinched ? 'pinch'
        : victory ? 'victory'
        : first.extended <= 1 && first.spread < 1.4 ? 'fist'
        : first.extended >= 3 && first.spread > 1.4 ? 'open-palm'
        : 'tracking';
    }
    if (countChanged) {
      this._gesture = 'tracking';
      this._motionAnchor = this._gapAnchor = null;
    }
    if (candidate !== this._candidate) {
      this._candidate = candidate;
      this._candidateSince = now;
    }
    const settleTime = candidate === 'pinch' ? 75 : candidate === 'victory' ? 180 : 120;
    if (candidate !== this._gesture && now - this._candidateSince >= settleTime) {
      this._gesture = candidate;
      this._motionAnchor = this._gapAnchor = null;
      this._delta = { yawDelta: 0, pitchDelta: 0, zoomDelta: 0 };
      this._status(LABELS[candidate]);
    }
    if (this._gesture === 'tracking') this._status(LABELS.tracking);

    let yawDelta = 0;
    let pitchDelta = 0;
    let zoomDelta = 0;
    const settled = candidate === this._gesture;
    if (settled && candidate === 'two-hands') {
      const gap = distance(metrics[0].center, metrics[1].center);
      if (this._gapAnchor !== null) {
        const logChange = Math.log(Math.max(gap, 0.06) / Math.max(this._gapAnchor, 0.06));
        if (Math.abs(logChange) > 0.008) {
          zoomDelta = clamp(logChange * 1.25, -0.09, 0.09);
          this._gapAnchor = gap;
        }
      } else this._gapAnchor = gap;
      this._motionAnchor = null;
    } else if (settled) {
      this._gapAnchor = null;
      if (candidate === 'pinch' || candidate === 'open-palm' || candidate === 'tracking') {
        const source = candidate === 'pinch' ? first.pinchPoint : first.center;
        const point = { x: 1 - source.x, y: source.y }; // Selfie movement follows the user's hand.
        if (this._motionAnchor) {
          const dx = point.x - this._motionAnchor.x;
          const dy = point.y - this._motionAnchor.y;
          // Keep the anchor while still so tiny motions accumulate instead of jittering.
          if (Math.abs(dx) > 0.003) {
            yawDelta = clamp(dx * (candidate === 'pinch' ? 3.8 : 2.7), -0.12, 0.12);
            this._motionAnchor.x = point.x;
          }
          if (Math.abs(dy) > 0.004) {
            pitchDelta = clamp(dy * (candidate === 'pinch' ? 2.8 : 1.8), -0.07, 0.07);
            this._motionAnchor.y = point.y;
          }
        } else this._motionAnchor = point;
      } else this._motionAnchor = null;
      if (candidate === 'open-palm') zoomDelta = dt * 0.36;
      if (candidate === 'fist') zoomDelta = -dt * 0.42;
    } else {
      this._motionAnchor = this._gapAnchor = null;
    }
    // Smooth deltas as well as landmarks, but stop immediately when tracking is lost.
    const alpha = 1 - Math.exp(-dt * 18);
    for (const [key, target] of Object.entries({ yawDelta, pitchDelta, zoomDelta })) {
      this._delta[key] += (target - this._delta[key]) * alpha;
      if (Math.abs(this._delta[key]) < 0.00005) this._delta[key] = 0;
    }
    this._draw(this._hands);
    this._emit({ ...this._delta, gesture: this._gesture, handCount: this._hands.length, landmarks: this._hands });
  }

  _emit(values) {
    this.onUpdate({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0, gesture: 'none', landmarks: [], handCount: 0, ...values });
  }

  _status(message) {
    if (!message || message === this._statusText) return;
    this._statusText = message;
    this.onStatus(message);
  }

  _draw(hands) {
    if (!this.overlay) return;
    const canvas = this.overlay;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.clientWidth || this.video.videoWidth || 320;
    const height = canvas.clientHeight || this.video.videoHeight || 240;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
      canvas.width = Math.round(width*dpr);
      canvas.height = Math.round(height*dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const videoWidth = this.video.videoWidth || 640;
    const videoHeight = this.video.videoHeight || 480;
    // Matches an object-fit: cover selfie video underneath the canvas.
    const scale = Math.max(width/videoWidth, height/videoHeight);
    const offsetX = (width-videoWidth*scale)/2;
    const offsetY = (height-videoHeight*scale)/2;
    const xy = p => ({ x: (1-p.x)*videoWidth*scale+offsetX, y: p.y*videoHeight*scale+offsetY });
    hands.forEach((hand, index) => {
      ctx.strokeStyle = index === 0 ? 'rgba(71,235,255,.82)' : 'rgba(244,164,255,.82)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      CONNECTIONS.forEach(([from,to]) => {
        const a = xy(hand[from]);
        const b = xy(hand[to]);
        ctx.moveTo(a.x,a.y);
        ctx.lineTo(b.x,b.y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
      hand.forEach((landmark, i) => {
        const point = xy(landmark);
        ctx.beginPath();
        ctx.arc(point.x, point.y, i === 4 || i === 8 ? 3 : 2, 0, Math.PI*2);
        ctx.fillStyle = i === 4 || i === 8 ? '#e6ff76' : '#d6fbff';
        ctx.fill();
      });
    });
  }
}
