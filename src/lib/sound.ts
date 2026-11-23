// Simple Web Audio API bell chime for incoming orders
class SoundAlert {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('gelafehaus-sound-enabled');
      this.enabled = saved !== null ? saved === 'true' : true;
    }
  }

  public setEnabled(val: boolean) {
    this.enabled = val;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('gelafehaus-sound-enabled', String(val));
    }
  }

  public playChime() {
    if (!this.enabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const now = this.ctx.currentTime;
      // Dual-tone pleasant notification chime
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.setValueAtTime(880, now + 0.12); // A5

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, now); // A5
      osc2.frequency.setValueAtTime(1174.66, now + 0.12); // D6

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.6);
      osc2.stop(now + 0.6);
    } catch {
      // Audio autoplay policy or not supported - silent fail
    }
  }
}

export const soundAlert = new SoundAlert();
