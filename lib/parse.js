'use strict';

const { safeDecode } = require('./util');

const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v|webm|ts|m2ts|flv|wmv|mpg|mpeg)$/i;
const SUB_EXT = /\.(srt|vtt|ass|ssa|sub)$/i;

const TECH_TOKENS = [
  '1080p', '720p', '2160p', '480p', '4K', 'UHD', 'WEBRip', 'WEB-DL', 'WEBDL', 'WEB',
  'BluRay', 'BRRip', 'BDRip', 'HDRip', 'HDCAM', 'HDTS', 'CAM', 'HDTV', 'x264', 'x265',
  'H264', 'H265', 'HEVC', 'AVC', 'DDN', 'DDP5', 'DDP2', 'DDP', 'DD5', 'DD2', 'ESub',
  'ESubs', 'Hindi', 'English', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Punjabi',
  'AMZN', 'NF', 'DSNP', 'HMAX', 'ATVP', 'RePack', 'Proper', 'Extended', 'Uncut', 'HQ',
  '10bit', '8bit', 'AAC', 'AC3', 'DTS', 'Dolby', 'Atmos', 'IMAX', 'Remux', 'Internal',
  'HC', 'ESub', 'DD', 'x265', 'HEVC', 'WEB-DL'
];

const TECH_RE = new RegExp(
  `\\b(?:${TECH_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi'
);

function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Parse an Apache autoindex HTML page into a list of entries. */
function parseListing(html, pageUrl) {
  const entries = [];
  const anchorRe = /<a\s+[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html)) !== null) {
    let href = decodeEntities(match[1]).trim();
    const label = decodeEntities(match[2].replace(/<[^>]+>/g, '')).trim();
    if (!href || href.startsWith('#')) continue;
    if (/^(\.\.\/|\/|\?)/.test(href)) continue;
    if (/^icons\//i.test(href)) continue;

    if (/^https?:\/\//i.test(href)) {
      try {
        if (new URL(href).host !== new URL(pageUrl).host) continue;
      } catch {
        continue;
      }
    }

    if (href.includes('?')) href = href.split('?')[0];

    let url;
    try {
      url = new URL(href, pageUrl).href;
    } catch {
      continue;
    }

    const isDir = href.endsWith('/') || /\b(DIR|PARENTDIR)\b/i.test(label) || /\/$/.test(label);
    const name = safeDecode(href.replace(/\/$/, '').split('/').pop() || '');

    entries.push({
      url,
      name,
      isDir,
      isVideo: !isDir && VIDEO_EXT.test(href),
      isSub: !isDir && SUB_EXT.test(href)
    });
  }
  return entries;
}

function tidyTitle(value) {
  return String(value || '')
    .replace(/[\[\(][^\]\)]*[\]\)]/g, ' ')
    .replace(/\s*[\(\[\-–,:]+$/g, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTech(value) {
  const cleaned = tidyTitle(value);
  const stripped = cleaned.replace(TECH_RE, ' ').replace(/\s+/g, ' ').trim();
  return tidyTitle(stripped) || cleaned;
}

/** Parse a movie release folder/file name. */
function parseMovie(raw) {
  const text = safeDecode(raw).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const maxYear = new Date().getFullYear() + 2;
  const years = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].filter((m) => {
    const year = Number(m[1]);
    return year >= 1900 && year <= maxYear;
  });
  const yearMatch = years[years.length - 1] || null;
  const year = yearMatch ? yearMatch[1] : null;
  const beforeYear = yearMatch ? text.slice(0, yearMatch.index) : text;
  return { title: stripTech(beforeYear), year };
}

/** Parse a series release folder/file name. */
function parseSeries(raw) {
  const text = safeDecode(raw).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const se = text.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);
  const seasonOnly = text.match(/\bS(\d{1,2})\b/i);
  const season = se ? Number(se[1]) : seasonOnly ? Number(seasonOnly[1]) : null;
  const episode = se ? Number(se[2]) : null;
  const before = se ? text.slice(0, se.index) : seasonOnly ? text.slice(0, seasonOnly.index) : text;
  return { title: stripTech(before), season, episode };
}

/** Extract a readable quality label from a release name. */
function qualityLabel(raw) {
  const text = safeDecode(raw).replace(/[._]+/g, ' ').replace(/\s+/g, ' ');
  const res = text.match(/\b(2160p|1080p|720p|480p|4K)\b/i);
  const source = text.match(/\b(WEBRip|WEB-DL|WEBDL|BluRay|HDRip|HDCAM|HDTS|HDTV|AMZN|NF)\b/i);
  return [res && res[1].toUpperCase(), source && source[1].toUpperCase()].filter(Boolean).join(' ');
}

module.exports = {
  parseListing,
  parseMovie,
  parseSeries,
  qualityLabel,
  stripTech,
  VIDEO_EXT,
  SUB_EXT
};
