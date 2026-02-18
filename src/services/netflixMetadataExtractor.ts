/**
 * Netflix Metadata Extractor
 * Gets show_title, episode_number, episode_title from Netflix DOM.
 * Matches SmartSubs exactly: content script, document.querySelector, no injection.
 */

import { episodeSchema, type Episode } from '@/schemas/episodeSchema';

/**
 * Get media ID from Netflix URL pattern
 */
export function getMediaIdFromUrl(url: string): string | null {
  const urlMatch = url.match(/\/watch\/(\d+)/);
  return urlMatch && urlMatch[1] ? urlMatch[1] : null;
}

/**
 * Generate episode ID from media_id
 */
function generateEpisodeId(media_id: string): bigint {
  try {
    const mediaIdNum = parseInt(media_id, 10);
    if (!isNaN(mediaIdNum)) {
      return BigInt(mediaIdNum);
    } else {
      let hash = 0;
      for (let i = 0; i < media_id.length; i++) {
        const char = media_id.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return BigInt(Math.abs(hash));
    }
  } catch {
    return BigInt(Date.now());
  }
}

/**
 * Extract raw strings from DOM - same as SmartSubs extract-metadata.js
 * Content script context, plain document.querySelector
 */
function fetchMetadataStringsFromPage(): { rawShowName: string; episodeText: string } {
  const showNameElement = document.querySelector('[data-uia="video-title"]');
  const episodeInfoElement = document.querySelector('[data-uia="video-title-secondary"]');
  const rawShowName = showNameElement ? (showNameElement.textContent || '').trim() : '';
  const episodeText = episodeInfoElement ? (episodeInfoElement.textContent || '').trim() : '';
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixMetadataExtractor.ts:fetchMetadataStringsFromPage',message:'DOM query',data:{hasShowEl:!!showNameElement,hasEpisodeEl:!!episodeInfoElement,rawShowName:rawShowName.substring(0,80),episodeText:episodeText.substring(0,80)},timestamp:Date.now(),hypothesisId:'DOM'})}).catch(()=>{});
  // #endregion
  return { rawShowName, episodeText };
}

/**
 * Parse raw strings into show_title, episode_number, episode_title (SmartSubs logic)
 */
function parseMetadataStrings(rawShowName: string, episodeText: string): {
  show_title: string | undefined;
  episode_number: number | undefined;
  episode_title: string | undefined;
} {
  let show_title: string | undefined;
  let episode_number: number | undefined;
  let episode_title: string | undefined;

  if (rawShowName) {
    const episodePattern = /([Ee](\d+)|[Ee]pisode\s+(\d+))/;
    const episodeMatch = rawShowName.match(episodePattern);
    if (episodeMatch && episodeMatch.index !== undefined) {
      show_title = rawShowName.substring(0, episodeMatch.index).trim() || undefined;
      episode_number = parseInt(episodeMatch[2] || episodeMatch[3], 10);
      episode_title = rawShowName.substring(episodeMatch.index + episodeMatch[0].length).trim() || undefined;
    } else {
      show_title = rawShowName || undefined;
    }
    if (!episode_title && rawShowName) {
      const combinedPattern = /([Ee](\d+)|[Ee]pisode\s+(\d+))(.+)?$/;
      const combinedMatch = rawShowName.match(combinedPattern);
      if (combinedMatch) {
        if (!episode_number) episode_number = parseInt(combinedMatch[2] || combinedMatch[3], 10);
        if (combinedMatch[4]) episode_title = combinedMatch[4].trim() || undefined;
      }
    }
  }

  if (episodeText) {
    if (!episode_title) episode_title = episodeText || undefined;
    if (!episode_number) {
      const m = episodeText.match(/[Ee]pisode\s+(\d+)|[Ee](\d+)/);
      if (m) episode_number = parseInt(m[1] || m[2], 10);
    }
  }

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixMetadataExtractor.ts:parseMetadataStrings',message:'Parsed result',data:{rawShowName,episodeText,show_title,episode_number,episode_title},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
  // #endregion
  return { show_title, episode_number, episode_title };
}

/**
 * Extract episode from Netflix page - same flow as SmartSubs handleLoadSubtitles
 */
export function extractEpisodeFromNetflixPage(): Episode | null {
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const media_id = getMediaIdFromUrl(url);
  if (!media_id) return null;

  const { rawShowName, episodeText } = fetchMetadataStringsFromPage();
  const { show_title, episode_number, episode_title } = parseMetadataStrings(rawShowName, episodeText);

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixMetadataExtractor.ts:extractEpisodeFromNetflixPage',message:'Final return',data:{media_id,show_title,episode_number,episode_title},timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
  // #endregion
  const episode = {
    id: generateEpisodeId(media_id),
    media_id,
    show_title,
    episode_number,
    season_number: 1,
    episode_title,
  };

  return episodeSchema.parse(episode);
}
