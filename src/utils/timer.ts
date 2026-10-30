/**
 * Cooking timer and duration utilities for CrockBites recipe steps.
 */

export interface ParsedDuration {
  totalSeconds: number;
  minutes: number;
  hours: number;
  label: string;
}

/**
 * Extracts explicit cooking durations from instruction text.
 * Never invents a duration; only matches concrete minute/hour expressions.
 */
export function extractInstructionDuration(text: string): ParsedDuration | null {
  if (!text || typeof text !== 'string') return null;

  // Pattern 1: Hours (e.g. "4 hours", "6 to 8 hours", "1.5 hours")
  const hourMatch = text.match(/(?:cook|simmer|bake|leave|rest|stand)?.*?(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:hours|hrs|hr|hour)\b/i)
    ?? text.match(/(\d+(?:\.\d+)?)\s*(?:hours|hrs|hr|hour)\b/i);

  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]);
    if (isFinite(hours) && hours > 0 && hours <= 14) {
      const totalSeconds = Math.round(hours * 3600);
      const label = hours === 1 ? '1 hr' : `${hours} hrs`;
      return {
        totalSeconds,
        minutes: Math.round(hours * 60),
        hours: Math.floor(hours),
        label,
      };
    }
  }

  // Pattern 2: Minutes (e.g. "20 minutes", "10-15 minutes", "30 mins")
  const minuteMatch = text.match(/(?:cook|simmer|bake|leave|rest|stand)?.*?(\d+)\s*(?:-|to)\s*(\d+)\s*(?:minutes|mins|min)\b/i)
    ?? text.match(/(\d+)\s*(?:minutes|mins|min)\b/i);

  if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1], 10);
    if (isFinite(minutes) && minutes > 0 && minutes <= 720) {
      const totalSeconds = minutes * 60;
      const label = `${minutes} min`;
      return {
        totalSeconds,
        minutes,
        hours: Math.floor(minutes / 60),
        label,
      };
    }
  }

  return null;
}

/**
 * Formats remaining seconds as HH:MM:SS or MM:SS
 */
export function formatTimerCountdown(remainingSeconds: number): string {
  const secs = Math.max(0, Math.floor(remainingSeconds));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');

  if (h > 0) {
    const hh = String(h).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Plays a gentle, pleasant dual-tone kitchen chime using Web Audio API.
 * 100% client-side, zero external audio asset dependencies.
 */
export function playKitchenChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Two-tone chime: E5 (659.25 Hz) then A5 (880 Hz)
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    };

    playTone(659.25, now, 0.6);
    playTone(880.0, now + 0.3, 0.9);
  } catch {
    // Non-fatal if browser blocks audio autoplay
  }
}

/**
 * Displays a browser system notification if permissions allow.
 */
export function sendTimerNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/favicon.svg',
      });
    } catch {
      // Ignored if notifications fail
    }
  }
}

