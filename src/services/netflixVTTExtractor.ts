/**
 * Netflix VTT Extractor
 * Matches SmartSubs src/content/03_process/helpers/01_vtt/vtt.js exactly
 */

/**
 * Netflix API access code - from SmartSubs vtt.js
 * Injected into page main world via background script
 */
const NETFLIX_SUBTITLE_INJECT_CODE = `
(function() {
  'use strict';

  if (!window.__SMARTSUBS_JSON_PARSE_INTERCEPTED) {
    window.__SMARTSUBS_JSON_PARSE_INTERCEPTED = true;
    window.__SMARTSUBS_CAPTURED_URLS = window.__SMARTSUBS_CAPTURED_URLS || {};
    
    const originalJSONParse = JSON.parse;
    JSON.parse = function(...args) {
      const value = originalJSONParse.apply(this, args);
      
      if (value && value.result && value.result.timedtexttracks && Array.isArray(value.result.timedtexttracks)) {
        for (const track of value.result.timedtexttracks) {
          if (track.isForcedNarrative || track.isNoneTrack) continue;
          
          if (track.ttDownloadables && track.ttDownloadables['webvtt-lssdh-ios8']) {
            const webvttDL = track.ttDownloadables['webvtt-lssdh-ios8'];
            if (webvttDL && webvttDL.urls) {
              const allUrls = Object.values(webvttDL.urls);
              const urlObj = allUrls[0];
              
              if (urlObj && urlObj.url) {
                const url = urlObj.url;
                const langCode = track.language || track.bcp47 || null;
                
                if (langCode) {
                  const langCodeLower = langCode.toLowerCase();
                  let targetLang = null;
                  if (langCodeLower.includes('th') || langCodeLower.includes('thai')) targetLang = 'th';
                  else if (langCodeLower.includes('en') || langCodeLower.includes('english')) targetLang = 'en';
                  
                  if (targetLang) {
                    if (!window.__SMARTSUBS_CAPTURED_URLS[targetLang]) {
                      window.__SMARTSUBS_CAPTURED_URLS[targetLang] = [];
                    }
                    if (!window.__SMARTSUBS_CAPTURED_URLS[targetLang].includes(url)) {
                      window.__SMARTSUBS_CAPTURED_URLS[targetLang].push(url);
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      return value;
    };
    
    const originalJSONStringify = JSON.stringify;
    JSON.stringify = function(value) {
      const orig = originalJSONStringify.apply(this, arguments);
      if (value === undefined) return orig;
      
      try {
        const data = originalJSONParse(orig);
        if (data && data.params && data.params.profiles && Array.isArray(data.params.profiles)) {
          if (!data.params.profiles.includes('webvtt-lssdh-ios8')) {
            data.params.profiles.unshift('webvtt-lssdh-ios8');
            return originalJSONStringify(data);
          }
        }
      } catch (e) {}
      
      return orig;
    };
  }

  window.addEventListener('message', async function(event) {
    if (!event.data || event.data.type !== 'SMARTSUBS_GET_SUBTITLES_PAGE' || !event.data.langCode) return;

    const langCode = event.data.langCode;
    const excludeCC = event.data.excludeCC !== false;
    
    const videoElement = document.querySelector('video');
    if (!videoElement) {
      window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Video element not found - ensure video is loaded' }, '*');
      return;
    }
    
    if (videoElement.readyState < 2) {
      await new Promise((resolve) => {
        const checkReady = () => {
          if (videoElement.readyState >= 2) {
            videoElement.removeEventListener('loadedmetadata', checkReady);
            resolve();
          }
        };
        videoElement.addEventListener('loadedmetadata', checkReady);
        setTimeout(() => {
          videoElement.removeEventListener('loadedmetadata', checkReady);
          resolve();
        }, 5000);
      });
      
      if (videoElement.readyState < 2) {
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Video not loaded - please ensure video is playing' }, '*');
        return;
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      if (!window.netflix || !window.netflix.appContext || !window.netflix.appContext.state) {
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix API not available' }, '*');
        return;
      }

      const appContext = window.netflix.appContext;
      const state = appContext.state;
      const playerApp = state.playerApp;
      
      if (!playerApp) {
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix playerApp not available' }, '*');
        return;
      }

      const getAPI = playerApp.getAPI;
      if (!getAPI || typeof getAPI !== 'function') {
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix getAPI not available' }, '*');
        return;
      }

      const api = getAPI();
      const videoPlayerAPI = api.videoPlayer;
      if (!videoPlayerAPI) {
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix videoPlayerAPI not available' }, '*');
        return;
      }

      const getAllPlayerSessionIds = videoPlayerAPI.getAllPlayerSessionIds;
      if (!getAllPlayerSessionIds || typeof getAllPlayerSessionIds !== 'function') {
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix getAllPlayerSessionIds not available' }, '*');
        return;
      }

      const sessionIds = getAllPlayerSessionIds();
      if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'No player session IDs' }, '*');
        return;
      }

      const player = videoPlayerAPI.getVideoPlayerBySessionId(sessionIds[0]);
      if (!player) {
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix player not available' }, '*');
        return;
      }

      let tracks = null;
      if (typeof player.getTimedTextTrackList === 'function' && typeof player.getTimedTextTrack === 'function') {
        const trackList = player.getTimedTextTrackList();
        
        if (Array.isArray(trackList) && trackList.length > 0) {
          const first = trackList[0];
          if (typeof first === 'object' && first !== null && (first.trackId != null || first.displayName != null)) {
            tracks = trackList;
          } else {
            tracks = trackList.map((_, index) => {
              try {
                return player.getTimedTextTrack(index);
              } catch (e) {
                return null;
              }
            }).filter(t => t !== null);
          }
        }
      }

      if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Could not get subtitle tracks from player' }, '*');
        return;
      }

      const filteredTracks = tracks.filter(track => {
        const trackLang = (track.bcp47 || track.language || track.langCode || track.lang || track.displayName || '').toLowerCase();
        const langCodeLower = langCode.toLowerCase();
        
        const isMatchingLang = trackLang === langCodeLower || 
                               trackLang.startsWith(langCodeLower) ||
                               trackLang.includes(langCodeLower);
        
        if (!isMatchingLang) return false;

        if (excludeCC) {
          const isCC = (track.isCC === true) ||
                       (track.closedCaptions === true) ||
                       (track.displayName && track.displayName.toLowerCase().includes('closed caption')) ||
                       (track.displayName && track.displayName.toLowerCase().includes('cc')) ||
                       (track.rawTrackType && track.rawTrackType.toUpperCase() === 'CLOSED_CAPTIONS');
          return !isCC;
        }

        return true;
      });

      if (!window.__SMARTSUBS_CAPTURED_URLS) window.__SMARTSUBS_CAPTURED_URLS = {};
      if (!window.__SMARTSUBS_CAPTURED_URLS[langCode]) window.__SMARTSUBS_CAPTURED_URLS[langCode] = [];
      
      const activationPromises = filteredTracks.map(async (track) => {
        try {
          const trackIndex = tracks.findIndex(t => 
            t.trackId === track.trackId || 
            (t.bcp47 === track.bcp47 && t.displayName === track.displayName)
          );
          
          if (trackIndex >= 0 && typeof player.setTimedTextTrack === 'function') {
            let trackToActivate = track;
            
            if (typeof player.getTimedTextTrack === 'function') {
              try {
                const fullTrack = player.getTimedTextTrack(trackIndex);
                if (fullTrack) trackToActivate = fullTrack;
              } catch (e) {}
            }
            
            try {
              player.setTimedTextTrack(trackToActivate);
              if (typeof player.setTimedTextVisibility === 'function') {
                try { player.setTimedTextVisibility(true); } catch (e) {}
              }
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {}
          }
        } catch (e) {}
      });
      
      await Promise.all(activationPromises);
      
      const capturedUrls = window.__SMARTSUBS_CAPTURED_URLS[langCode] || [];
      
      const formattedTracks = filteredTracks.map((track) => {
        const url = capturedUrls.length > 0 ? capturedUrls[0] : null;
        return {
          langCode: track.bcp47 || track.language || track.langCode || track.lang || '',
          lang: track.displayName || track.languageName || track.langName || track.language || '',
          url: url,
          isCC: track.isCC || track.closedCaptions || false,
          track: track
        };
      });

      window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: formattedTracks }, '*');
      
    } catch (error) {
      window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: error.message }, '*');
    }
  });
})();
`;

let subtitleScriptInjected = false;
let subtitleScriptInjectionPromise: Promise<void> | null = null;

export async function injectNetflixSubtitleScript(): Promise<void> {
  if (subtitleScriptInjected) return;
  if (subtitleScriptInjectionPromise) return subtitleScriptInjectionPromise;

  subtitleScriptInjectionPromise = (async () => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('Chrome extension runtime is not available. Make sure the extension is loaded and background script is running.');
      }
      
      const response = await chrome.runtime.sendMessage({
        type: 'INJECT_NETFLIX_SUBTITLE_SCRIPT',
        code: NETFLIX_SUBTITLE_INJECT_CODE
      });

      if (response && response.success) {
        subtitleScriptInjected = true;
        subtitleScriptInjectionPromise = null;
      } else {
        const errorMsg = response?.error || 'Unknown error';
        subtitleScriptInjected = false;
        subtitleScriptInjectionPromise = null;
        throw new Error(`Failed to inject Netflix subtitle script: ${errorMsg}`);
      }
    } catch (error) {
      subtitleScriptInjected = false;
      subtitleScriptInjectionPromise = null;
      throw error;
    }
  })();

  return subtitleScriptInjectionPromise;
}

/**
 * Fetch Thai VTT from Netflix - matches SmartSubs fetchThaiVTTContent flow
 * Returns VTT content string or null (SubtitleDisplay uses string, SmartSubs uses {content, mediaId})
 */
export async function fetchThaiVTTContent(mediaId: string): Promise<string | null> {
  if (!mediaId) throw new Error('Could not identify video - mediaId required');
  
  await injectNetflixSubtitleScript();
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', messageHandler);
      resolve(null);
    }, 10000);
    
    const messageHandler = (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'SMARTSUBS_SUBTITLES_RESPONSE') return;
      
      clearTimeout(timeout);
      window.removeEventListener('message', messageHandler);
      
      const tracks = event.data.tracks || [];

      const thaiTrack = tracks.find((track: { langCode?: string; isCC?: boolean }) => {
        const langLower = (track.langCode || '').toLowerCase();
        return langLower.includes('th');
      });
      
      if (!thaiTrack || !thaiTrack.url) {
        resolve(null);
        return;
      }
      
      fetch(thaiTrack.url)
        .then((r) => (r.ok ? r.text() : null))
        .then((content) => resolve(content || null))
        .catch(() => resolve(null));
    };
    
    window.addEventListener('message', messageHandler);
    
    window.postMessage({
      type: 'SMARTSUBS_GET_SUBTITLES_PAGE',
      langCode: 'th',
      excludeCC: false
    }, '*');
  });
}
