export class AudioRecorder {
  private context: AudioContext | null = null;
  public stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  async start(onAudioData: (base64Data: string) => void): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    this.context = new AudioContext({ sampleRate: 16000 });
    this.source = this.context.createMediaStreamSource(this.stream);
    
    // Use ScriptProcessor for simplicity in this environment
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    
    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      // Convert Float32Array to Int16Array
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      
      // Convert Int16Array to base64
      const buffer = new ArrayBuffer(pcm16.length * 2);
      const view = new DataView(buffer);
      for (let i = 0; i < pcm16.length; i++) {
        view.setInt16(i * 2, pcm16[i], true); // true for little-endian
      }
      
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      onAudioData(base64);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);

    return this.stream;
  }

  stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.context) {
      if (this.context.state !== 'closed') {
        this.context.close().catch(console.error);
      }
      this.context = null;
    }
  }
}

export class AudioPlayer {
  private context: AudioContext;
  private nextTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  constructor() {
    this.context = new AudioContext({ sampleRate: 24000 }); // Gemini Live outputs 24kHz PCM
  }

  playBase64Pcm(base64: string) {
    if (this.context.state === 'closed') return;
    
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    // Convert to Int16Array
    const pcm16 = new Int16Array(bytes.buffer);
    
    // Convert to Float32Array
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    const buffer = this.context.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    if (this.nextTime < this.context.currentTime) {
      this.nextTime = this.context.currentTime;
    }
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
    
    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter(s => s !== source);
    };
  }

  stop() {
    this.clearQueue();
    if (this.context.state !== 'closed') {
      this.context.close().catch(console.error);
    }
  }
  
  clearQueue() {
    this.activeSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
    });
    this.activeSources = [];
    this.nextTime = this.context.currentTime;
  }
}
