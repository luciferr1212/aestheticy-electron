import type { JamParticipant, JamTrackIdentity, Track } from '../shared/ipcTypes.ts';

export function normalizeMetadataToken(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((feat\.?|ft\.?|remaster(ed)?|deluxe|bonus|explicit|clean)[^)]*\)/gi, '')
    .replace(/\[(feat\.?|ft\.?|remaster(ed)?|deluxe|bonus|explicit|clean)[^\]]*\]/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeIsrcCode(isrc: string | null | undefined): string | null {
  if (!isrc) return null;
  const cleaned = isrc.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned.length >= 10 ? cleaned : null;
}

/**
 * Builds a format-independent track identity from a Track object.
 * Priority:
 * 1. ISRC if present
 * 2. Normalized title + artist + album + duration (±1s)
 * 3. Cached Chromaprint acoustic fingerprint
 */
export function buildTrackIdentity(track: Track): JamTrackIdentity {
  const isrc = normalizeIsrcCode(track.isrc);
  const normalizedTitle = normalizeMetadataToken(track.title);
  const normalizedArtist = normalizeMetadataToken(track.artist);
  const normalizedAlbum = normalizeMetadataToken(track.album);
  const duration = Math.round(Number(track.duration || 0));
  const fingerprint = track.chromaprint || null;

  let primaryKey: string;
  if (isrc) {
    primaryKey = `isrc:${isrc}`;
  } else if (normalizedTitle && normalizedArtist) {
    primaryKey = `meta:${normalizedTitle}|${normalizedArtist}|${normalizedAlbum}|${duration}`;
  } else if (fingerprint) {
    primaryKey = `fp:${fingerprint}`;
  } else {
    primaryKey = `meta:${normalizedTitle}|${normalizedArtist}|${normalizedAlbum}|${duration}`;
  }

  return {
    primaryKey,
    isrc,
    normalizedTitle,
    normalizedArtist,
    normalizedAlbum,
    duration: Number(track.duration || 0),
    fingerprint,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverArtUrl: track.coverArtUrl,
    spotifyTrackId: track.spotifyTrackId || null,
    format: track.format,
  };
}

/**
 * Generates canonical identity keys for a local Track so peers can quickly
 * determine who has each song locally across formats (FLAC, MP3, ALAC, WAV, AIFF).
 */
export function getTrackInventoryKeys(track: Track): string[] {
  const keys: string[] = [];
  const isrc = normalizeIsrcCode(track.isrc);
  if (isrc) {
    keys.push(`isrc:${isrc}`);
  }

  const normTitle = normalizeMetadataToken(track.title);
  const normArtist = normalizeMetadataToken(track.artist);
  const normAlbum = normalizeMetadataToken(track.album);
  const durSec = Math.round(Number(track.duration || 0));

  if (normTitle && normArtist) {
    keys.push(`meta:${normTitle}|${normArtist}|${normAlbum}|${durSec}`);
    keys.push(`ta:${normTitle}|${normArtist}|${durSec}`);
  }

  if (track.chromaprint) {
    keys.push(`fp:${track.chromaprint}`);
  }

  return keys;
}

/**
 * Generates lookup keys (including ±1s duration tolerance) for checking
 * whether a participant's inventoryKeys contains a given JamTrackIdentity.
 */
export function getIdentityLookupKeys(identity: JamTrackIdentity): string[] {
  const keys: string[] = [identity.primaryKey];

  if (identity.isrc) {
    keys.push(`isrc:${identity.isrc}`);
  }

  const baseDur = Math.round(Number(identity.duration || 0));
  if (identity.normalizedTitle && identity.normalizedArtist) {
    for (const d of [baseDur - 1, baseDur, baseDur + 1]) {
      keys.push(
        `meta:${identity.normalizedTitle}|${identity.normalizedArtist}|${identity.normalizedAlbum}|${d}`
      );
      keys.push(`ta:${identity.normalizedTitle}|${identity.normalizedArtist}|${d}`);
    }
  }

  if (identity.fingerprint) {
    keys.push(`fp:${identity.fingerprint}`);
  }

  return keys;
}

/**
 * Checks if a participant has a matching local copy of the given track identity.
 */
export function participantHasTrack(
  participant: JamParticipant,
  identity: JamTrackIdentity | null | undefined
): boolean {
  if (!identity) return false;
  if (!participant.inventoryKeys || participant.inventoryKeys.length === 0) return false;
  const lookup = getIdentityLookupKeys(identity);
  const invSet = new Set(participant.inventoryKeys);
  return lookup.some((k) => invSet.has(k));
}

/**
 * Finds the best matching local track in a client's library for a remote JamTrackIdentity.
 * Completely independent of file format (matches FLAC, ALAC, WAV, AIFF, MP3, OGG, etc.).
 */
export function findMatchingLocalTrack(
  identity: JamTrackIdentity | null | undefined,
  localTracks: Track[]
): Track | null {
  if (!identity || localTracks.length === 0) return null;

  const playableTracks = localTracks.filter((t) => !t.unplayable);

  // 1. Match by ISRC if present
  if (identity.isrc) {
    const targetIsrc = normalizeIsrcCode(identity.isrc);
    if (targetIsrc) {
      const byIsrc = playableTracks.find((t) => normalizeIsrcCode(t.isrc) === targetIsrc);
      if (byIsrc) return byIsrc;
    }
  }

  // 2. Match by normalized title + artist + album + duration (±1.5s tolerance)
  if (identity.normalizedTitle && identity.normalizedArtist) {
    const byFullMeta = playableTracks.find((t) => {
      const tTitle = normalizeMetadataToken(t.title);
      const tArtist = normalizeMetadataToken(t.artist);
      const tAlbum = normalizeMetadataToken(t.album);
      const durDiff = Math.abs(Number(t.duration || 0) - Number(identity.duration || 0));
      return (
        tTitle === identity.normalizedTitle &&
        tArtist === identity.normalizedArtist &&
        tAlbum === identity.normalizedAlbum &&
        durDiff <= 1.5
      );
    });
    if (byFullMeta) return byFullMeta;

    // 2b. Fallback: normalized title + artist + duration (±1.5s tolerance) across album editions
    const byTitleArtistDur = playableTracks.find((t) => {
      const tTitle = normalizeMetadataToken(t.title);
      const tArtist = normalizeMetadataToken(t.artist);
      const durDiff = Math.abs(Number(t.duration || 0) - Number(identity.duration || 0));
      return (
        tTitle === identity.normalizedTitle &&
        tArtist === identity.normalizedArtist &&
        durDiff <= 1.5
      );
    });
    if (byTitleArtistDur) return byTitleArtistDur;
  }

  // 3. Match by Chromaprint / acoustic fingerprint
  if (identity.fingerprint) {
    const byFp = playableTracks.find(
      (t) => t.chromaprint && t.chromaprint === identity.fingerprint
    );
    if (byFp) return byFp;
  }

  return null;
}
