/**
 * Timeline Navigation - Player Control
 * 
 * Simple player control - just handles:
 * 1. Get current time
 * 2. Seek to time
 * 3. Pause/Unpause
 * 
 * No decision making - just executes commands
 */

// Import Netflix API injection from netflixPlayer.ts (keeps injection code there)
// We need to access the internal injection function, but since it's not exported,
// we'll duplicate just the injection logic here for getCurrentTime and seekToTime
// The injection code stays in netflixPlayer.ts for other uses

const NETFLIX_PLAYER_INJECT_CODE = `
(function() {
  'use strict';
  
  window.addEventListener('message', function(event) {
    if (!event.data || typeof event.data.type !== 'string') {
      return;
    }
    
    // Handle time request
    if (event.data.type === 'SUBTITLE_DISPLAY_GET_TIME_PAGE') {
      try {
        if (!window.netflix || !window.netflix.appContext || !window.netflix.appContext.state) {
          window.postMessage({ type: 'SUBTITLE_DISPLAY_TIME_RESPONSE', timeSeconds: null, error: 'Netflix API not available' }, '*');
          return;
        }
        
        const playerApp = window.netflix.appContext.state.playerApp;
        if (!playerApp || !playerApp.getAPI) {
          window.postMessage({ type: 'SUBTITLE_DISPLAY_TIME_RESPONSE', timeSeconds: null, error: 'PlayerApp not available' }, '*');
          return;
        }
        
        const videoPlayerAPI = playerApp.getAPI().videoPlayer;
        if (!videoPlayerAPI || !videoPlayerAPI.getAllPlayerSessionIds) {
          window.postMessage({ type: 'SUBTITLE_DISPLAY_TIME_RESPONSE', timeSeconds: null, error: 'VideoPlayerAPI not available' }, '*');
          return;
        }
        
        const sessionIds = videoPlayerAPI.getAllPlayerSessionIds();
        if (!sessionIds || sessionIds.length === 0) {
          window.postMessage({ type: 'SUBTITLE_DISPLAY_TIME_RESPONSE', timeSeconds: null, error: 'No player session IDs' }, '*');
          return;
        }
        
        const player = videoPlayerAPI.getVideoPlayerBySessionId(sessionIds[0]);
        if (!player) {
          window.postMessage({ type: 'SUBTITLE_DISPLAY_TIME_RESPONSE', timeSeconds: null, error: 'Player not available' }, '*');
          return;
        }
        
        // Try different possible method names for getting current time
        let timeSeconds = null;
        
        if (typeof player.getCurrentTime === 'function') {
          const timeMs = player.getCurrentTime();
          if (typeof timeMs === 'number' && !isNaN(timeMs)) {
            timeSeconds = timeMs / 1000; // Convert milliseconds to seconds
          }
        } else if (typeof player.getCurrentTimeMs === 'function') {
          const timeMs = player.getCurrentTimeMs();
          if (typeof timeMs === 'number' && !isNaN(timeMs)) {
            timeSeconds = timeMs / 1000; // Convert milliseconds to seconds
          }
        } else if (typeof player.getVideoTime === 'function') {
          const timeMs = player.getVideoTime();
          if (typeof timeMs === 'number' && !isNaN(timeMs)) {
            timeSeconds = timeMs / 1000; // Convert milliseconds to seconds
          }
        } else if (typeof player.getCurrentTimeSeconds === 'function') {
          const time = player.getCurrentTimeSeconds();
          if (typeof time === 'number' && !isNaN(time)) {
            timeSeconds = time;
          }
        }
        
        if (timeSeconds !== null) {
          window.postMessage({ type: 'SUBTITLE_DISPLAY_TIME_RESPONSE', timeSeconds }, '*');
        } else {
          window.postMessage({ type: 'SUBTITLE_DISPLAY_TIME_RESPONSE', timeSeconds: null, error: 'No time method found on player' }, '*');
        }
      } catch (error) {
        window.postMessage({ type: 'SUBTITLE_DISPLAY_TIME_RESPONSE', timeSeconds: null, error: error.message }, '*');
      }
      return;
    }
    
    // Handle seek request
    if (event.data.type === 'SUBTITLE_DISPLAY_SEEK_PAGE' && typeof event.data.timeSeconds === 'number') {
      const timeSeconds = event.data.timeSeconds;
      if (isNaN(timeSeconds) || timeSeconds < 0) return;
      
      try {
        console.log('[SubtitleDisplay] Injected script received seek message', { timeSeconds });
        
        if (!window.netflix || !window.netflix.appContext || !window.netflix.appContext.state) {
          console.log('[SubtitleDisplay] Netflix API not available');
          return;
        }
        
        const playerApp = window.netflix.appContext.state.playerApp;
        if (!playerApp || !playerApp.getAPI) {
          console.log('[SubtitleDisplay] PlayerApp not available');
          return;
        }
        
        const videoPlayerAPI = playerApp.getAPI().videoPlayer;
        if (!videoPlayerAPI || !videoPlayerAPI.getAllPlayerSessionIds) {
          console.log('[SubtitleDisplay] VideoPlayerAPI not available');
          return;
        }
        
        const sessionIds = videoPlayerAPI.getAllPlayerSessionIds();
        if (!sessionIds || sessionIds.length === 0) {
          console.log('[SubtitleDisplay] No player session IDs');
          return;
        }
        
        const targetMs = Math.round(timeSeconds * 1000);
        const player = videoPlayerAPI.getVideoPlayerBySessionId(sessionIds[0]);
        if (player && player.seek) {
          console.log('[SubtitleDisplay] Calling player.seek()', { targetMs, timeSeconds });
          player.seek(targetMs);
          console.log('[SubtitleDisplay] player.seek() completed');
        } else {
          console.log('[SubtitleDisplay] Player or seek method not available', { hasPlayer: !!player, hasSeek: !!(player && player.seek) });
        }
      } catch (error) {
        console.error('[SubtitleDisplay] Netflix seek error:', error);
      }
      return;
    }
  });
})();
`;

let scriptInjected = false;
let scriptInjectionPromise: Promise<void> | null = null;

async function injectNetflixPlayerScript(): Promise<void> {
  if (scriptInjected) return;
  
  if (scriptInjectionPromise) {
    return scriptInjectionPromise;
  }
  
  scriptInjectionPromise = (async () => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('Chrome extension runtime not available');
      }
      
      const response = await chrome.runtime.sendMessage({
        type: 'INJECT_NETFLIX_PLAYER_SCRIPT',
        code: NETFLIX_PLAYER_INJECT_CODE
      });
      
      if (response && response.success) {
        scriptInjected = true;
        scriptInjectionPromise = null;
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (error) {
      scriptInjected = false;
      scriptInjectionPromise = null;
      throw error;
    }
  })();
  
  return scriptInjectionPromise;
}

/**
 * Get current playback time from Netflix API
 * Falls back to video.currentTime if Netflix API unavailable
 * @returns Current time in seconds, or null if unavailable
 */
export async function getCurrentTime(): Promise<number | null> {
  // Ensure script is injected
  await injectNetflixPlayerScript();
  
  // Fallback to video element if Netflix API fails
  const video = document.querySelector('video');
  const fallbackTime = video ? video.currentTime : null;
  
  return new Promise((resolve) => {
    // Set up timeout for fallback
    const timeout = setTimeout(() => {
      resolve(fallbackTime);
    }, 100);
    
    // Listen for response from injected script
    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'SUBTITLE_DISPLAY_TIME_RESPONSE') {
        clearTimeout(timeout);
        window.removeEventListener('message', messageHandler);
        
        if (event.data.timeSeconds !== null && typeof event.data.timeSeconds === 'number' && !isNaN(event.data.timeSeconds)) {
          resolve(event.data.timeSeconds);
        } else {
          // Fallback to video element if Netflix API returned null/error
          resolve(fallbackTime);
        }
      }
    };
    
    window.addEventListener('message', messageHandler);
    
    // Request time from injected script
    window.postMessage({
      type: 'SUBTITLE_DISPLAY_GET_TIME_PAGE'
    }, '*');
  });
}

/**
 * Seek to specific time using Netflix API
 * @param timeSeconds - Target time in seconds
 */
export async function seekToTime(timeSeconds: number): Promise<void> {
  if (timeSeconds == null || isNaN(timeSeconds) || timeSeconds < 0) {
    return;
  }
  
  // Ensure script is injected
  await injectNetflixPlayerScript();
  
  // Forward seek message to injected script
  window.postMessage({
    type: 'SUBTITLE_DISPLAY_SEEK_PAGE',
    timeSeconds: timeSeconds
  }, '*');
}

/**
 * Pause video
 * @param videoElement - Video element to pause (optional, will find if not provided)
 */
export function pause(videoElement?: HTMLVideoElement): void {
  const video = videoElement || document.querySelector('video');
  if (!video) {
    console.warn('[TimelineNavigation] No video element found to pause');
    return;
  }
  
  try {
    video.pause();
  } catch (error) {
    console.warn('[TimelineNavigation] Could not pause video:', error);
  }
}

/**
 * Unpause video
 * @param videoElement - Video element to unpause (optional, will find if not provided)
 */
export function unpause(videoElement?: HTMLVideoElement): void {
  const video = videoElement || document.querySelector('video');
  if (!video) {
    console.warn('[TimelineNavigation] No video element found to unpause');
    return;
  }
  
  if (video.paused) {
    try {
      video.play();
    } catch (error) {
      console.warn('[TimelineNavigation] Could not unpause video:', error);
    }
  }
}
