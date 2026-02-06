/**
 * Netflix Seek Service
 * 
 * CRITICAL: NEVER write to video.currentTime directly (causes m7375 errors/crashes)
 * ALL seeking MUST go through Netflix internal player API
 * 
 * Flow: window.postMessage → content script bridge → injected script → Netflix API
 */

const NETFLIX_SEEK_INJECT_CODE = `
(function() {
  'use strict';
  
  window.addEventListener('message', function(event) {
    if (!event.data || event.data.type !== 'SUBTITLE_DISPLAY_SEEK_PAGE' || typeof event.data.timeSeconds !== 'number') {
      return;
    }
    
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
  });
})();
`;

let scriptInjected = false;
let scriptInjectionPromise: Promise<void> | null = null;

async function injectNetflixSeekScript(): Promise<void> {
  // #region agent log
  const logData1 = {location:'netflixSeek.ts:injectNetflixSeekScript',message:'Function entry',data:{scriptInjected,hasPromise:!!scriptInjectionPromise},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'};
  console.log('[DEBUG]', logData1);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData1)}).catch(()=>{});
  // #endregion
  
  if (scriptInjected) return;
  
  if (scriptInjectionPromise) {
    return scriptInjectionPromise;
  }
  
  scriptInjectionPromise = (async () => {
    try {
      // #region agent log
      const logData2 = {location:'netflixSeek.ts:injectNetflixSeekScript',message:'Requesting script injection',data:{hasChrome:typeof chrome !== 'undefined',hasRuntime:typeof chrome !== 'undefined' && !!chrome.runtime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'};
      console.log('[DEBUG]', logData2);
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData2)}).catch(()=>{});
      // #endregion
      
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('Chrome extension runtime not available');
      }
      
      const response = await chrome.runtime.sendMessage({
        type: 'INJECT_NETFLIX_SEEK_SCRIPT',
        code: NETFLIX_SEEK_INJECT_CODE
      });
      
      // #region agent log
      const logData3 = {location:'netflixSeek.ts:injectNetflixSeekScript',message:'Script injection response',data:{success:response?.success,error:response?.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'};
      console.log('[DEBUG]', logData3);
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData3)}).catch(()=>{});
      // #endregion
      
      if (response && response.success) {
        scriptInjected = true;
        scriptInjectionPromise = null;
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (error) {
      // #region agent log
      const logData4 = {location:'netflixSeek.ts:injectNetflixSeekScript',message:'Script injection error',data:{error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'};
      console.log('[DEBUG]', logData4);
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData4)}).catch(()=>{});
      // #endregion
      scriptInjected = false;
      scriptInjectionPromise = null;
      throw error;
    }
  })();
  
  return scriptInjectionPromise;
}

/**
 * Seek to subtitle time using Netflix API
 * @param subtitleId - Subtitle ID (for logging/tracking)
 * @param timeSeconds - Target time in seconds
 */
export async function seekToSubtitleTime(subtitleId: string, timeSeconds: number): Promise<void> {
  // #region agent log
  const logData1 = {location:'netflixSeek.ts:seekToSubtitleTime',message:'Function entry',data:{subtitleId,timeSeconds,isValid:timeSeconds != null && !isNaN(timeSeconds) && timeSeconds >= 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
  console.log('[DEBUG]', logData1);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData1)}).catch(()=>{});
  // #endregion
  
  if (timeSeconds == null || isNaN(timeSeconds) || timeSeconds < 0) {
    // #region agent log
    const logData = {location:'netflixSeek.ts:seekToSubtitleTime',message:'Early return - invalid time',data:{timeSeconds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
    console.log('[DEBUG]', logData);
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
    // #endregion
    return;
  }
  
  // Ensure script is injected
  await injectNetflixSeekScript();
  
  // #region agent log
  const logData2 = {location:'netflixSeek.ts:seekToSubtitleTime',message:'Sending seek message',data:{subtitleId,timeSeconds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
  console.log('[DEBUG]', logData2);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData2)}).catch(()=>{});
  // #endregion
  
  // Get video currentTime before seeking for verification
  const video = document.querySelector('video');
  const beforeSeekTime = video ? video.currentTime : null;
  
  // #region agent log
  const logData3 = {location:'netflixSeek.ts:seekToSubtitleTime',message:'Before seek - video state',data:{beforeSeekTime,targetTime:timeSeconds,videoExists:!!video},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
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
    const logData4 = {location:'netflixSeek.ts:seekToSubtitleTime',message:'After seek - video state',data:{beforeSeekTime,afterSeekTime,targetTime:timeSeconds,timeDiff:afterSeekTime !== null && beforeSeekTime !== null ? Math.abs(afterSeekTime - timeSeconds) : null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'};
    console.log('[DEBUG]', logData4);
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData4)}).catch(()=>{});
    // #endregion
  }, 500);
}
