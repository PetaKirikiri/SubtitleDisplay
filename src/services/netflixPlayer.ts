/**
 * Netflix Player API Service
 * 
 * Single service for all Netflix player API operations (time, seek)
 * 
 * CRITICAL: NEVER write to video.currentTime directly (causes m7375 errors/crashes)
 * ALL operations MUST go through Netflix internal player API
 * 
 * Flow: window.postMessage → content script bridge → injected script → Netflix API
 */

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
 * @param subtitleId - Subtitle ID (for logging/tracking)
 * @param timeSeconds - Target time in seconds
 */
export async function seekToTime(subtitleId: string, timeSeconds: number): Promise<void> {
  // #region agent log
  const logData1 = {location:'netflixPlayer.ts:seekToTime',message:'Function entry',data:{subtitleId,timeSeconds,isValid:timeSeconds != null && !isNaN(timeSeconds) && timeSeconds >= 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
  console.log('[DEBUG]', logData1);
  console.log('[SUBTITLE SEEK]', {
    action: 'Seeking to subtitle',
    subtitleId,
    timeSeconds,
    timestamp: Date.now()
  });
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData1)}).catch(()=>{});
  // #endregion
  
  if (timeSeconds == null || isNaN(timeSeconds) || timeSeconds < 0) {
    // #region agent log
    const logData = {location:'netflixPlayer.ts:seekToTime',message:'Early return - invalid time',data:{timeSeconds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
    console.log('[DEBUG]', logData);
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
    // #endregion
    return;
  }
  
  // Ensure script is injected
  await injectNetflixPlayerScript();
  
  // #region agent log
  const logData2 = {location:'netflixPlayer.ts:seekToTime',message:'Sending seek message',data:{subtitleId,timeSeconds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
  console.log('[DEBUG]', logData2);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData2)}).catch(()=>{});
  // #endregion
  
  // Get video currentTime before seeking for verification
  const video = document.querySelector('video');
  const beforeSeekTime = video ? video.currentTime : null;
  
  // #region agent log
  const logData3 = {location:'netflixPlayer.ts:seekToTime',message:'Before seek - video state',data:{beforeSeekTime,targetTime:timeSeconds,videoExists:!!video},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
  console.log('[DEBUG]', logData3);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData3)}).catch(()=>{});
  // #endregion
  
  // Forward seek message to injected script
  window.postMessage({
    type: 'SUBTITLE_DISPLAY_SEEK_PAGE',
    timeSeconds: timeSeconds
  }, '*');
  
  // Check video time after a short delay to verify seek
  setTimeout(() => {
    const afterSeekTime = video ? video.currentTime : null;
    // #region agent log
    const logData4 = {location:'netflixPlayer.ts:seekToTime',message:'After seek - video state',data:{beforeSeekTime,afterSeekTime,targetTime:timeSeconds,timeDiff:afterSeekTime !== null && beforeSeekTime !== null ? Math.abs(afterSeekTime - timeSeconds) : null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
    console.log('[DEBUG]', logData4);
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData4)}).catch(()=>{});
    // #endregion
  }, 500);
}
