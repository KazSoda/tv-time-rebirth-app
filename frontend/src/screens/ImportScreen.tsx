import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, TextInput, Image, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import axios from 'axios';
import { watchlistApi, watchedApi, favoritesApi } from '../services/api';
import { TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMG } from '../config/tmdb';

// ─── Types TV Time ────────────────────────────────────────────────────────────

interface TVTimeEpisode {
  id: { tvdb: number | null };
  number: number;
  name: string;
  special: boolean;
  is_watched: boolean;
  watched_at: string | null;
  rewatch_count: number;
}

interface TVTimeSeason {
  number: number;
  is_specials: boolean;
  episodes: TVTimeEpisode[];
}

interface TVTimeSeries {
  uuid: string;
  id: { tvdb: number | null; imdb: string | null };
  title: string;
  status: string;
  is_favorite: boolean;
  _noEpisodeData: boolean;
  seasons: TVTimeSeason[];
}

interface TVTimeMovie {
  uuid: string;
  id: { tvdb: number | null; imdb: string | null };
  title: string;
  year: number;
  watched_at: string | null;
  is_watched: boolean;
  is_favorite: boolean;
  rewatch_count: number;
}

// ─── Types TMDB ───────────────────────────────────────────────────────────────

interface TMDBSeriesResult {
  id: number;
  name: string;
  poster_path: string | null;
  first_air_date: string;
  overview: string;
}

interface TMDBMovieResult {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
}

// ─── Types export propre ──────────────────────────────────────────────────────

interface OwnExportEpisode {
  season:          number;
  episode:         number;
  watched_at:      string;
  rewatch_count:   number;
  runtime_minutes?: number;
}

interface OwnExportSeries {
  tmdb_id:          number;
  title:            string;
  poster_path:      string;
  total_episodes:   number;
  is_ended:         boolean;
  user_status:      string;
  added_at:         string;
  is_favorite:      boolean;
  watched_episodes: OwnExportEpisode[];
}

interface OwnExportMovie {
  tmdb_id:       number;
  title:         string;
  poster_path:   string;
  user_status:   string;
  added_at:      string;
  is_favorite:   boolean;
  watched:       boolean;
  watched_at:    string;
  rewatch_count: number;
}

interface OwnExportData {
  version:     number;
  app:         string;
  exported_at: string;
  series:      OwnExportSeries[];
  movies:      OwnExportMovie[];
}

// ─── Types résultats ──────────────────────────────────────────────────────────

interface ImportProgress {
  total:          number;
  current:        number;
  currentTitle:   string;
  imported:       number;
  episodesMarked: number;
  moviesMarked:   number;
  conflictCount:  number;
}

interface SeriesConflictEntry {
  id:            string;
  tvTimeSeries:  TVTimeSeries;
  resolved:      boolean;
  searchOpen:    boolean;
  searchQuery:   string;
  searchLoading: boolean;
  searchResults: TMDBSeriesResult[];
}

interface MovieConflictEntry {
  id:            string;
  tvTimeMovie:   TVTimeMovie;
  resolved:      boolean;
  searchOpen:    boolean;
  searchQuery:   string;
  searchLoading: boolean;
  searchResults: TMDBMovieResult[];
}

type ScreenState = 'idle' | 'reading' | 'parsed' | 'importing' | 'done';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Détecte le type de contenu d'un fichier TV Time ou de notre appli. */
function detectFileContent(data: any): 'series' | 'movies' | 'own' | 'unknown' {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.app === 'tv-time-rebirth') return 'own';
    return 'unknown';
  }
  if (!Array.isArray(data) || data.length === 0) return 'unknown';
  const first = data[0];
  if (Array.isArray(first?.seasons)) return 'series';
  if ('is_watched' in first && 'year' in first) return 'movies';
  return 'unknown';
}

function countRegularEpisodes(series: TVTimeSeries): number {
  return series.seasons
    .filter(s => !s.is_specials)
    .reduce((sum, s) => sum + s.episodes.filter(e => !e.special).length, 0);
}

function countWatched(series: TVTimeSeries): number {
  return series.seasons
    .filter(s => !s.is_specials)
    .reduce((sum, s) => sum + s.episodes.filter(e => !e.special && e.is_watched).length, 0);
}

type EpisodeWithDate = { season_number: number; episode_number: number; watched_at: string; rewatch_count: number; runtime_minutes: number };

async function importEpisodes(
  tmdbId: number,
  series: TVTimeSeries,
  useFlatMapping: boolean,
  episodeRuntime = 0,
): Promise<number> {
  const regularSeasons = series.seasons.filter(s => !s.is_specials);
  const episodes: EpisodeWithDate[] = [];
  const fallbackDate = new Date().toISOString();

  if (useFlatMapping) {
    let offset = 0;
    for (const season of regularSeasons) {
      const regularEps = season.episodes.filter(e => !e.special);
      regularEps.forEach((ep, idx) => {
        if (ep.is_watched) {
          episodes.push({
            season_number:  1,
            episode_number: offset + idx + 1,
            watched_at:     ep.watched_at ?? fallbackDate,
            rewatch_count:  ep.rewatch_count ?? 0,
            runtime_minutes: episodeRuntime,
          });
        }
      });
      offset += regularEps.length;
    }
  } else {
    for (const season of regularSeasons) {
      for (const ep of season.episodes) {
        if (ep.special || !ep.is_watched) continue;
        episodes.push({
          season_number:  season.number,
          episode_number: ep.number,
          watched_at:     ep.watched_at ?? fallbackDate,
          rewatch_count:  ep.rewatch_count ?? 0,
          runtime_minutes: episodeRuntime,
        });
      }
    }
  }

  if (episodes.length === 0) return 0;
  try {
    await watchedApi.importEpisodesWithDates(tmdbId, episodes);
    return episodes.length;
  } catch {
    return 0;
  }
}

/** Lit un fichier et essaie de parser son contenu JSON (tableau ou objet). */
async function readJsonFile(uri: string): Promise<any | null> {
  try {
    let readableUri = uri;
    if (!readableUri.startsWith('file://')) {
      const dest = FileSystem.cacheDirectory + 'tvtime_tmp.json';
      await FileSystem.copyAsync({ from: readableUri, to: dest });
      readableUri = dest;
    }
    const content = await FileSystem.readAsStringAsync(readableUri);
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** Lit un fichier ZIP et retourne les contenus TV Time + notre propre format. */
async function readZipFile(uri: string): Promise<{
  series: TVTimeSeries[];
  movies: TVTimeMovie[];
  ownData: OwnExportData | null;
}> {
  let readableUri = uri;
  if (!readableUri.startsWith('file://')) {
    const dest = FileSystem.cacheDirectory + 'tvtime_import.zip';
    await FileSystem.copyAsync({ from: readableUri, to: dest });
    readableUri = dest;
  }
  const base64 = await FileSystem.readAsStringAsync(readableUri, { encoding: 'base64' as any });
  const zip    = await JSZip.loadAsync(base64, { base64: true });

  const result: { series: TVTimeSeries[]; movies: TVTimeMovie[]; ownData: OwnExportData | null } =
    { series: [], movies: [], ownData: null };

  await Promise.all(
    Object.entries(zip.files)
      .filter(([name, file]) => !file.dir && name.endsWith('.json'))
      .map(async ([, file]) => {
        try {
          const content = await file.async('string');
          const data = JSON.parse(content);
          const type = detectFileContent(data);
          if (type === 'series')  result.series  = data as TVTimeSeries[];
          else if (type === 'movies')  result.movies  = data as TVTimeMovie[];
          else if (type === 'own')     result.ownData = data as OwnExportData;
        } catch { /* fichier JSON invalide, on ignore */ }
      })
  );

  return result;
}

// ─── Écran ────────────────────────────────────────────────────────────────────

export default function ImportScreen() {
  const navigation = useNavigation();
  const insets     = useSafeAreaInsets();

  const [screenState,     setScreenState]     = useState<ScreenState>('idle');
  const [parsedSeries,    setParsedSeries]    = useState<TVTimeSeries[]>([]);
  const [parsedMovies,    setParsedMovies]    = useState<TVTimeMovie[]>([]);
  const [parsedOwnData,   setParsedOwnData]   = useState<OwnExportData | null>(null);
  const [progress,        setProgress]        = useState<ImportProgress | null>(null);
  const [seriesConflicts, setSeriesConflicts] = useState<SeriesConflictEntry[]>([]);
  const [movieConflicts,  setMovieConflicts]  = useState<MovieConflictEntry[]>([]);
  const [finalStats,      setFinalStats]      = useState<{ imported: number; episodesMarked: number; moviesMarked: number } | null>(null);

  // ── 1. Chargement du fichier ───────────────────────────────────────────────

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', 'application/zip', 'application/x-zip-compressed', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const asset    = result.assets[0];
      const isZip    = asset.name?.toLowerCase().endsWith('.zip')
        || asset.mimeType?.includes('zip');

      setScreenState('reading');

      let series: TVTimeSeries[] = [];
      let movies: TVTimeMovie[]  = [];

      let ownData: OwnExportData | null = null;

      if (isZip) {
        // ── ZIP : extraire tous les fichiers reconnus ─────────────────────
        const extracted = await readZipFile(asset.uri);
        series  = extracted.series;
        movies  = extracted.movies;
        ownData = extracted.ownData;

        if (series.length === 0 && movies.length === 0 && !ownData) {
          setScreenState('idle');
          Alert.alert('ZIP invalide', 'Aucun fichier d\'export reconnu dans ce ZIP.');
          return;
        }
      } else {
        // ── JSON : détecter le type par le contenu ────────────────────────
        const data = await readJsonFile(asset.uri);
        if (!data) {
          setScreenState('idle');
          Alert.alert('Fichier invalide', 'Impossible de lire ce fichier JSON.');
          return;
        }
        const type = detectFileContent(data);
        if      (type === 'series')  series  = data as TVTimeSeries[];
        else if (type === 'movies')  movies  = data as TVTimeMovie[];
        else if (type === 'own')     ownData = data as OwnExportData;
        else {
          setScreenState('idle');
          Alert.alert('Fichier non reconnu', 'Ce fichier ne ressemble pas à un export connu.');
          return;
        }
      }

      setParsedSeries(series);
      setParsedMovies(movies);
      setParsedOwnData(ownData);
      setScreenState('parsed');
    } catch (e) {
      setScreenState('idle');
      Alert.alert('Erreur', `Impossible de lire le fichier.\n\n${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── 2. Lancement de l'import ──────────────────────────────────────────────

  const handleStartImport = async () => {
    setScreenState('importing');

    const total = parsedSeries.length + parsedMovies.length
      + (parsedOwnData?.series.length ?? 0) + (parsedOwnData?.movies.length ?? 0);
    const prog: ImportProgress = {
      total, current: 0, currentTitle: '',
      imported: 0, episodesMarked: 0, moviesMarked: 0, conflictCount: 0,
    };
    setProgress({ ...prog });

    const newSeriesConflicts: SeriesConflictEntry[] = [];
    const newMovieConflicts:  MovieConflictEntry[]  = [];

    // ── A. Import des séries ─────────────────────────────────────────────

    for (let i = 0; i < parsedSeries.length; i++) {
      const series = parsedSeries[i];
      prog.current      = i + 1;
      prog.currentTitle = series.title;
      setProgress({ ...prog });

      let tmdbId:     number | null = null;
      let tmdbName:   string        = series.title;
      let posterPath: string | null = null;

      if (series.id.tvdb) {
        try {
          const { data } = await axios.get(`${TMDB_BASE_URL}/find/${series.id.tvdb}`, {
            params: { api_key: TMDB_API_KEY, external_source: 'tvdb_id', language: 'fr-FR' },
          });
          const tvResults = data.tv_results as TMDBSeriesResult[] | undefined;
          if (tvResults?.length) { tmdbId = tvResults[0].id; tmdbName = tvResults[0].name; posterPath = tvResults[0].poster_path; }
        } catch {}
      }

      if (!tmdbId) {
        try {
          const { data } = await axios.get(`${TMDB_BASE_URL}/search/tv`, {
            params: { api_key: TMDB_API_KEY, query: series.title, language: 'fr-FR' },
          });
          const results = data.results as TMDBSeriesResult[] | undefined;
          if (results?.length) { tmdbId = results[0].id; tmdbName = results[0].name; posterPath = results[0].poster_path; }
        } catch {}
      }

      if (!tmdbId) {
        newSeriesConflicts.push({
          id: series.uuid, tvTimeSeries: series, resolved: false,
          searchOpen: false, searchQuery: series.title, searchLoading: false, searchResults: [],
        });
        prog.conflictCount++;
        setProgress({ ...prog });
        await delay(150);
        continue;
      }

      let tmdbSeasonCount = series.seasons.filter(s => !s.is_specials).length;
      let tmdbTotalEps    = countRegularEpisodes(series);
      let isEnded         = series.status === 'ended' || series.status === 'canceled';
      let episodeRuntime  = 0;
      try {
        const { data: det } = await axios.get(`${TMDB_BASE_URL}/tv/${tmdbId}`, {
          params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
        });
        tmdbSeasonCount = det.number_of_seasons ?? tmdbSeasonCount;
        tmdbTotalEps    = det.number_of_episodes ?? tmdbTotalEps;
        isEnded         = ['Ended', 'Canceled'].includes(det.status ?? '') || isEnded;
        if (det.poster_path) posterPath = det.poster_path;
        episodeRuntime  = (det.episode_run_time as number[] | undefined)?.[0] ?? 0;
      } catch {}

      const tvTimeSeasonCount = series.seasons.filter(s => !s.is_specials).length;
      const useFlatMapping    = tvTimeSeasonCount > 1 && tmdbSeasonCount < tvTimeSeasonCount;

      try {
        await watchlistApi.add({
          tmdb_id: tmdbId, media_type: 'tv', title: tmdbName,
          poster_path: posterPath, total_episodes: tmdbTotalEps,
          is_ended: isEnded, user_status: series.status,
        });
        prog.imported++;
      } catch {}

      if (!series._noEpisodeData) {
        prog.episodesMarked += await importEpisodes(tmdbId, series, useFlatMapping, episodeRuntime);
      }

      if (series.is_favorite) {
        try { await favoritesApi.add(tmdbId, 'tv'); } catch {}
      }

      setProgress({ ...prog });
      await delay(250);
    }

    // ── B. Import des films ──────────────────────────────────────────────

    const watchedMoviesBatch: { tmdb_id: number; watched_at: string }[] = [];

    for (let i = 0; i < parsedMovies.length; i++) {
      const movie = parsedMovies[i];
      prog.current      = parsedSeries.length + i + 1;
      prog.currentTitle = movie.title;
      setProgress({ ...prog });

      let tmdbId:     number | null = null;
      let tmdbTitle:  string        = movie.title;
      let posterPath: string | null = null;

      // Recherche par IMDB ID en priorité
      if (movie.id.imdb) {
        try {
          const { data } = await axios.get(`${TMDB_BASE_URL}/find/${movie.id.imdb}`, {
            params: { api_key: TMDB_API_KEY, external_source: 'imdb_id', language: 'fr-FR' },
          });
          const movieResults = data.movie_results as TMDBMovieResult[] | undefined;
          if (movieResults?.length) {
            tmdbId = movieResults[0].id; tmdbTitle = movieResults[0].title; posterPath = movieResults[0].poster_path;
          }
        } catch {}
      }

      // Fallback : recherche par titre + année
      if (!tmdbId) {
        try {
          const { data } = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
            params: { api_key: TMDB_API_KEY, query: movie.title, year: movie.year, language: 'fr-FR' },
          });
          const results = data.results as TMDBMovieResult[] | undefined;
          if (results?.length) {
            tmdbId = results[0].id; tmdbTitle = results[0].title; posterPath = results[0].poster_path;
          }
        } catch {}
      }

      if (!tmdbId) {
        newMovieConflicts.push({
          id: movie.uuid, tvTimeMovie: movie, resolved: false,
          searchOpen: false, searchQuery: movie.title, searchLoading: false, searchResults: [],
        });
        prog.conflictCount++;
        setProgress({ ...prog });
        await delay(150);
        continue;
      }

      try {
        await watchlistApi.add({
          tmdb_id: tmdbId, media_type: 'movie', title: tmdbTitle, poster_path: posterPath,
        });
        prog.imported++;
      } catch {}

      if (movie.is_watched) {
        watchedMoviesBatch.push({
          tmdb_id:       tmdbId,
          watched_at:    movie.watched_at ?? new Date().toISOString(),
          rewatch_count: movie.rewatch_count ?? 0,
        });
        prog.moviesMarked++;
      }

      if (movie.is_favorite) {
        try { await favoritesApi.add(tmdbId, 'movie'); } catch {}
      }

      setProgress({ ...prog });
      await delay(150);
    }

    // Envoi batch des films vus (TV Time)
    if (watchedMoviesBatch.length > 0) {
      try { await watchedApi.importMovies(watchedMoviesBatch); } catch {}
    }

    // ── C. Import de nos propres données ─────────────────────────────────────

    if (parsedOwnData) {
      // Séries
      for (let i = 0; i < parsedOwnData.series.length; i++) {
        const s = parsedOwnData.series[i];
        prog.current      = parsedSeries.length + parsedMovies.length + i + 1;
        prog.currentTitle = s.title;
        setProgress({ ...prog });

        try {
          await watchlistApi.add({
            tmdb_id:        s.tmdb_id,
            media_type:     'tv',
            title:          s.title,
            poster_path:    s.poster_path || null,
            total_episodes: s.total_episodes,
            is_ended:       s.is_ended,
            user_status:    s.user_status,
          });
          prog.imported++;
        } catch {}

        if (s.watched_episodes.length > 0) {
          try {
            await watchedApi.importEpisodesWithDates(
              s.tmdb_id,
              s.watched_episodes.map(ep => ({
                season_number:   ep.season,
                episode_number:  ep.episode,
                watched_at:      ep.watched_at,
                rewatch_count:   ep.rewatch_count,
                runtime_minutes: ep.runtime_minutes ?? 0,
              }))
            );
            prog.episodesMarked += s.watched_episodes.length;
          } catch {}
        }

        if (s.is_favorite) { try { await favoritesApi.add(s.tmdb_id, 'tv'); } catch {} }

        setProgress({ ...prog });
        await delay(80);
      }

      // Films
      const ownWatchedMovies: { tmdb_id: number; watched_at: string; rewatch_count: number }[] = [];

      for (let i = 0; i < parsedOwnData.movies.length; i++) {
        const m = parsedOwnData.movies[i];
        prog.current      = parsedSeries.length + parsedMovies.length + parsedOwnData.series.length + i + 1;
        prog.currentTitle = m.title;
        setProgress({ ...prog });

        try {
          await watchlistApi.add({
            tmdb_id:     m.tmdb_id,
            media_type:  'movie',
            title:       m.title,
            poster_path: m.poster_path || null,
            user_status: m.user_status,
          });
          prog.imported++;
        } catch {}

        if (m.watched) {
          ownWatchedMovies.push({
            tmdb_id:       m.tmdb_id,
            watched_at:    m.watched_at || new Date().toISOString(),
            rewatch_count: m.rewatch_count,
          });
          prog.moviesMarked++;
        }

        if (m.is_favorite) { try { await favoritesApi.add(m.tmdb_id, 'movie'); } catch {} }

        setProgress({ ...prog });
      }

      if (ownWatchedMovies.length > 0) {
        try { await watchedApi.importMovies(ownWatchedMovies); } catch {}
      }
    }

    setSeriesConflicts(newSeriesConflicts);
    setMovieConflicts(newMovieConflicts);
    setFinalStats({ imported: prog.imported, episodesMarked: prog.episodesMarked, moviesMarked: prog.moviesMarked });
    setScreenState('done');
  };

  // ── 3. Résolution des conflits — séries ───────────────────────────────────

  const updateSeriesConflict = (uuid: string, patch: Partial<SeriesConflictEntry>) =>
    setSeriesConflicts(prev => prev.map(c => c.id === uuid ? { ...c, ...patch } : c));

  const handleSeriesConflictSearch = async (uuid: string, query: string) => {
    updateSeriesConflict(uuid, { searchLoading: true, searchResults: [] });
    try {
      const { data } = await axios.get(`${TMDB_BASE_URL}/search/tv`, {
        params: { api_key: TMDB_API_KEY, query, language: 'fr-FR' },
      });
      updateSeriesConflict(uuid, { searchResults: (data.results ?? []).slice(0, 6), searchLoading: false });
    } catch {
      updateSeriesConflict(uuid, { searchLoading: false });
    }
  };

  const handleSeriesConflictResolve = async (uuid: string, result: TMDBSeriesResult) => {
    const conflict = seriesConflicts.find(c => c.id === uuid);
    if (!conflict) return;
    updateSeriesConflict(uuid, { searchOpen: false, searchLoading: true });
    try {
      const series = conflict.tvTimeSeries;
      let tmdbSeasonCount = series.seasons.filter(s => !s.is_specials).length;
      let tmdbTotalEps    = countRegularEpisodes(series);
      let isEnded         = series.status === 'ended' || series.status === 'canceled';
      let posterPath      = result.poster_path;
      let episodeRuntime  = 0;
      try {
        const { data: det } = await axios.get(`${TMDB_BASE_URL}/tv/${result.id}`, {
          params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
        });
        tmdbSeasonCount = det.number_of_seasons ?? tmdbSeasonCount;
        tmdbTotalEps    = det.number_of_episodes ?? tmdbTotalEps;
        isEnded         = ['Ended', 'Canceled'].includes(det.status ?? '') || isEnded;
        if (det.poster_path) posterPath = det.poster_path;
        episodeRuntime  = (det.episode_run_time as number[] | undefined)?.[0] ?? 0;
      } catch {}

      const tvTimeSeasonCount = series.seasons.filter(s => !s.is_specials).length;
      const useFlatMapping    = tvTimeSeasonCount > 1 && tmdbSeasonCount < tvTimeSeasonCount;

      await watchlistApi.add({
        tmdb_id: result.id, media_type: 'tv', title: result.name, poster_path: posterPath,
        total_episodes: tmdbTotalEps, is_ended: isEnded, user_status: series.status,
      });
      if (!series._noEpisodeData) await importEpisodes(result.id, series, useFlatMapping, episodeRuntime);
      if (series.is_favorite) { try { await favoritesApi.add(result.id, 'tv'); } catch {} }

      updateSeriesConflict(uuid, { resolved: true, searchLoading: false });
      setFinalStats(prev => prev ? { ...prev, imported: prev.imported + 1 } : { imported: 1, episodesMarked: 0, moviesMarked: 0 });
    } catch {
      updateSeriesConflict(uuid, { searchLoading: false });
      Alert.alert('Erreur', 'Impossible d\'importer cette série.');
    }
  };

  // ── 4. Résolution des conflits — films ────────────────────────────────────

  const updateMovieConflict = (uuid: string, patch: Partial<MovieConflictEntry>) =>
    setMovieConflicts(prev => prev.map(c => c.id === uuid ? { ...c, ...patch } : c));

  const handleMovieConflictSearch = async (uuid: string, query: string) => {
    updateMovieConflict(uuid, { searchLoading: true, searchResults: [] });
    try {
      const conflict = movieConflicts.find(c => c.id === uuid);
      const { data } = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
        params: { api_key: TMDB_API_KEY, query, year: conflict?.tvTimeMovie.year, language: 'fr-FR' },
      });
      updateMovieConflict(uuid, { searchResults: (data.results ?? []).slice(0, 6), searchLoading: false });
    } catch {
      updateMovieConflict(uuid, { searchLoading: false });
    }
  };

  const handleMovieConflictResolve = async (uuid: string, result: TMDBMovieResult) => {
    const conflict = movieConflicts.find(c => c.id === uuid);
    if (!conflict) return;
    updateMovieConflict(uuid, { searchOpen: false, searchLoading: true });
    try {
      const movie = conflict.tvTimeMovie;
      await watchlistApi.add({
        tmdb_id: result.id, media_type: 'movie', title: result.title, poster_path: result.poster_path,
      });
      if (movie.is_watched) {
        await watchedApi.importMovies([{
          tmdb_id:    result.id,
          watched_at: movie.watched_at ?? new Date().toISOString(),
        }]);
      }
      if (movie.is_favorite) { try { await favoritesApi.add(result.id, 'movie'); } catch {} }

      updateMovieConflict(uuid, { resolved: true, searchLoading: false });
      setFinalStats(prev => prev ? { ...prev, imported: prev.imported + 1 } : { imported: 1, episodesMarked: 0, moviesMarked: 0 });
    } catch {
      updateMovieConflict(uuid, { searchLoading: false });
      Alert.alert('Erreur', 'Impossible d\'importer ce film.');
    }
  };

  // ── Rendu ─────────────────────────────────────────────────────────────────

  const totalWatchedSeries = parsedSeries.reduce((s, series) => s + countWatched(series), 0);
  const totalWatchedMovies = parsedMovies.filter(m => m.is_watched).length;
  const ownTotalEpisodes   = parsedOwnData?.series.reduce((s, ser) => s + ser.watched_episodes.length, 0) ?? 0;
  const unresolvedSeries   = seriesConflicts.filter(c => !c.resolved).length;
  const unresolvedMovies   = movieConflicts.filter(c => !c.resolved).length;
  const unresolvedCount    = unresolvedSeries + unresolvedMovies;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Importer des données</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>

        {/* ── IDLE ── */}
        {screenState === 'idle' && (
          <View style={styles.centered}>
            <Ionicons name="cloud-upload-outline" size={72} color={C.border} />
            <Text style={styles.idleTitle}>Importer des données</Text>
            <Text style={styles.idleText}>
              Sélectionne un export TV Time (séries, films ou ZIP) ou une sauvegarde de cette application.
              Le format est détecté automatiquement.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handlePickFile} activeOpacity={0.85}>
              <Ionicons name="document-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Choisir le fichier</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── READING ── */}
        {screenState === 'reading' && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.idleTitle}>Lecture du fichier en cours…</Text>
            <Text style={styles.idleText}>Veuillez patienter.</Text>
          </View>
        )}

        {/* ── PARSED : confirmation ── */}
        {screenState === 'parsed' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Fichier chargé</Text>

            {parsedSeries.length > 0 && (
              <>
                <Text style={styles.groupLabel}>SÉRIES</Text>
                <StatRow icon="tv-outline"    label="Séries"         value={String(parsedSeries.length)} />
                <StatRow icon="eye-outline"   label="Épisodes vus"   value={String(totalWatchedSeries)} />
                <StatRow icon="heart-outline" label="Favoris"        value={String(parsedSeries.filter(s => s.is_favorite).length)} />
              </>
            )}

            {parsedMovies.length > 0 && (
              <>
                <Text style={styles.groupLabel}>FILMS</Text>
                <StatRow icon="film-outline"  label="Films"          value={String(parsedMovies.length)} />
                <StatRow icon="eye-outline"   label="Films vus"      value={String(totalWatchedMovies)} />
                <StatRow icon="heart-outline" label="Favoris"        value={String(parsedMovies.filter(m => m.is_favorite).length)} />
              </>
            )}

            {parsedOwnData && (
              <>
                <Text style={styles.groupLabel}>SAUVEGARDE</Text>
                <StatRow icon="tv-outline"     label="Séries"             value={String(parsedOwnData.series.length)} />
                <StatRow icon="eye-outline"    label="Épisodes à restaurer" value={String(ownTotalEpisodes)} />
                <StatRow icon="film-outline"   label="Films"              value={String(parsedOwnData.movies.length)} />
                <StatRow icon="heart-outline"  label="Favoris"            value={String(
                  parsedOwnData.series.filter(s => s.is_favorite).length +
                  parsedOwnData.movies.filter(m => m.is_favorite).length
                )} />
              </>
            )}

            <Text style={styles.cardNote}>
              {parsedOwnData && parsedSeries.length === 0 && parsedMovies.length === 0
                ? 'Les TMDB IDs sont déjà connus — import direct, rapide et sans conflit.'
                : 'Les identifiants TMDB seront retrouvés automatiquement. L\'import peut prendre quelques minutes.'}
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleStartImport} activeOpacity={0.85}>
              <Ionicons name="play-circle-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Lancer l'import</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── IMPORTING : progression ── */}
        {screenState === 'importing' && progress && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Import en cours…</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round((progress.current / progress.total) * 100)}%` as any }]} />
            </View>
            <Text style={styles.progressLabel}>{progress.current} / {progress.total}</Text>
            <Text style={styles.currentTitle} numberOfLines={1}>{progress.currentTitle}</Text>
            <View style={styles.statsRow}>
              <MiniStat label="Ajoutés"      value={progress.imported} />
              <MiniStat label="Épisodes vus" value={progress.episodesMarked} />
              <MiniStat label="Films vus"    value={progress.moviesMarked} />
              <MiniStat label="Conflits"     value={progress.conflictCount} />
            </View>
          </View>
        )}

        {/* ── DONE : résumé + conflits ── */}
        {screenState === 'done' && finalStats && (
          <>
            <View style={styles.card}>
              <View style={styles.doneHeader}>
                <Ionicons name="checkmark-circle" size={36} color="#16a34a" />
                <Text style={styles.doneTitle}>Import terminé !</Text>
              </View>
              <StatRow icon="layers-outline" label="Éléments importés"    value={String(finalStats.imported)} />
              <StatRow icon="eye-outline"    label="Épisodes marqués vus" value={String(finalStats.episodesMarked)} />
              <StatRow icon="film-outline"   label="Films marqués vus"    value={String(finalStats.moviesMarked)} />
              {unresolvedCount > 0 && (
                <StatRow icon="alert-circle-outline" label="Conflits à résoudre"
                  value={String(unresolvedCount)} valueColor={C.primary} />
              )}
            </View>

            {/* Conflits séries */}
            {seriesConflicts.length > 0 && (
              <View style={styles.conflictsSection}>
                <Text style={styles.sectionLabel}>
                  {unresolvedSeries > 0
                    ? `${unresolvedSeries} série${unresolvedSeries > 1 ? 's' : ''} introuvable${unresolvedSeries > 1 ? 's' : ''}`
                    : 'Séries — tous les conflits résolus ✓'}
                </Text>
                {seriesConflicts.map(conflict => (
                  <SeriesConflictCard
                    key={conflict.id}
                    conflict={conflict}
                    onToggleSearch={() => updateSeriesConflict(conflict.id, { searchOpen: !conflict.searchOpen })}
                    onSearchQueryChange={q => updateSeriesConflict(conflict.id, { searchQuery: q })}
                    onSearch={() => handleSeriesConflictSearch(conflict.id, conflict.searchQuery)}
                    onSelectResult={r => handleSeriesConflictResolve(conflict.id, r)}
                  />
                ))}
              </View>
            )}

            {/* Conflits films */}
            {movieConflicts.length > 0 && (
              <View style={styles.conflictsSection}>
                <Text style={styles.sectionLabel}>
                  {unresolvedMovies > 0
                    ? `${unresolvedMovies} film${unresolvedMovies > 1 ? 's' : ''} introuvable${unresolvedMovies > 1 ? 's' : ''}`
                    : 'Films — tous les conflits résolus ✓'}
                </Text>
                {movieConflicts.map(conflict => (
                  <MovieConflictCard
                    key={conflict.id}
                    conflict={conflict}
                    onToggleSearch={() => updateMovieConflict(conflict.id, { searchOpen: !conflict.searchOpen })}
                    onSearchQueryChange={q => updateMovieConflict(conflict.id, { searchQuery: q })}
                    onSearch={() => handleMovieConflictSearch(conflict.id, conflict.searchQuery)}
                    onSelectResult={r => handleMovieConflictResolve(conflict.id, r)}
                  />
                ))}
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, { marginHorizontal: 16 }]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Terminé</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function StatRow({ icon, label, value, valueColor }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string; value: string; valueColor?: string;
}) {
  return (
    <View style={styles.statRow}>
      <View style={styles.statRowLeft}>
        <Ionicons name={icon} size={16} color={C.muted} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

function SeriesConflictCard({
  conflict, onToggleSearch, onSearchQueryChange, onSearch, onSelectResult,
}: {
  conflict: SeriesConflictEntry;
  onToggleSearch: () => void;
  onSearchQueryChange: (q: string) => void;
  onSearch: () => void;
  onSelectResult: (r: TMDBSeriesResult) => void;
}) {
  const s = conflict.tvTimeSeries;

  if (conflict.resolved) {
    return (
      <View style={[styles.conflictCard, styles.conflictCardResolved]}>
        <View style={styles.conflictCardHeader}>
          <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
          <Text style={[styles.conflictTitle, { color: '#16a34a' }]} numberOfLines={1}>{s.title}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.conflictCard}>
      <View style={styles.conflictCardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.conflictTitle} numberOfLines={1}>{s.title}</Text>
          <Text style={styles.conflictMeta}>
            {s.seasons.length} saison{s.seasons.length > 1 ? 's' : ''} · {countWatched(s)} épisodes vus
          </Text>
        </View>
        <TouchableOpacity style={styles.resolveBtn} onPress={onToggleSearch} activeOpacity={0.8} disabled={conflict.searchLoading}>
          {conflict.searchLoading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.resolveBtnText}>{conflict.searchOpen ? 'Annuler' : 'Chercher'}</Text>}
        </TouchableOpacity>
      </View>

      {conflict.searchOpen && (
        <View style={styles.searchZone}>
          <View style={styles.searchInputRow}>
            <TextInput
              style={styles.searchInput}
              value={conflict.searchQuery}
              onChangeText={onSearchQueryChange}
              placeholder="Titre de la série…"
              placeholderTextColor={C.muted}
              onSubmitEditing={onSearch}
              returnKeyType="search"
            />
            <TouchableOpacity style={styles.searchBtn} onPress={onSearch} activeOpacity={0.8}>
              <Ionicons name="search" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          {conflict.searchLoading && <ActivityIndicator size="small" color={C.primary} style={{ marginTop: 8 }} />}
          {conflict.searchResults.map(r => (
            <TouchableOpacity key={r.id} style={styles.searchResult} onPress={() => onSelectResult(r)} activeOpacity={0.75}>
              {r.poster_path
                ? <Image source={{ uri: `${TMDB_IMG.poster_sm}${r.poster_path}` }} style={styles.searchResultPoster} />
                : <View style={[styles.searchResultPoster, styles.searchResultPosterPlaceholder]}><Ionicons name="tv-outline" size={14} color={C.muted} /></View>}
              <View style={styles.searchResultInfo}>
                <Text style={styles.searchResultName} numberOfLines={1}>{r.name}</Text>
                {r.first_air_date ? <Text style={styles.searchResultYear}>{r.first_air_date.slice(0, 4)}</Text> : null}
              </View>
              <Ionicons name="add-circle-outline" size={20} color={C.primary} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function MovieConflictCard({
  conflict, onToggleSearch, onSearchQueryChange, onSearch, onSelectResult,
}: {
  conflict: MovieConflictEntry;
  onToggleSearch: () => void;
  onSearchQueryChange: (q: string) => void;
  onSearch: () => void;
  onSelectResult: (r: TMDBMovieResult) => void;
}) {
  const m = conflict.tvTimeMovie;

  if (conflict.resolved) {
    return (
      <View style={[styles.conflictCard, styles.conflictCardResolved]}>
        <View style={styles.conflictCardHeader}>
          <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
          <Text style={[styles.conflictTitle, { color: '#16a34a' }]} numberOfLines={1}>{m.title}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.conflictCard}>
      <View style={styles.conflictCardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.conflictTitle} numberOfLines={1}>{m.title}</Text>
          <Text style={styles.conflictMeta}>{m.year} · {m.is_watched ? 'Vu' : 'Non vu'}</Text>
        </View>
        <TouchableOpacity style={styles.resolveBtn} onPress={onToggleSearch} activeOpacity={0.8} disabled={conflict.searchLoading}>
          {conflict.searchLoading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.resolveBtnText}>{conflict.searchOpen ? 'Annuler' : 'Chercher'}</Text>}
        </TouchableOpacity>
      </View>

      {conflict.searchOpen && (
        <View style={styles.searchZone}>
          <View style={styles.searchInputRow}>
            <TextInput
              style={styles.searchInput}
              value={conflict.searchQuery}
              onChangeText={onSearchQueryChange}
              placeholder="Titre du film…"
              placeholderTextColor={C.muted}
              onSubmitEditing={onSearch}
              returnKeyType="search"
            />
            <TouchableOpacity style={styles.searchBtn} onPress={onSearch} activeOpacity={0.8}>
              <Ionicons name="search" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          {conflict.searchLoading && <ActivityIndicator size="small" color={C.primary} style={{ marginTop: 8 }} />}
          {conflict.searchResults.map(r => (
            <TouchableOpacity key={r.id} style={styles.searchResult} onPress={() => onSelectResult(r)} activeOpacity={0.75}>
              {r.poster_path
                ? <Image source={{ uri: `${TMDB_IMG.poster_sm}${r.poster_path}` }} style={styles.searchResultPoster} />
                : <View style={[styles.searchResultPoster, styles.searchResultPosterPlaceholder]}><Ionicons name="film-outline" size={14} color={C.muted} /></View>}
              <View style={styles.searchResultInfo}>
                <Text style={styles.searchResultName} numberOfLines={1}>{r.title}</Text>
                {r.release_date ? <Text style={styles.searchResultYear}>{r.release_date.slice(0, 4)}</Text> : null}
              </View>
              <Ionicons name="add-circle-outline" size={20} color={C.primary} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Constantes & styles ──────────────────────────────────────────────────────

const C = {
  bg:      '#1a1a2e',
  surface: '#16213e',
  card:    '#0f2942',
  primary: '#e94560',
  text:    '#ffffff',
  muted:   '#8892a4',
  border:  '#1f4068',
};

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border, gap: 12,
  },
  backBtn:     {},
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '700' },

  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, paddingVertical: 48, gap: 16,
  },
  idleTitle: { color: C.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  idleText:  { color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 22 },

  card: {
    margin: 16, backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, padding: 16, gap: 14,
  },
  cardTitle:  { color: C.text, fontSize: 17, fontWeight: '700' },
  cardNote:   { color: C.muted, fontSize: 13, lineHeight: 20 },
  groupLabel: {
    color: C.muted, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4,
  },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 24,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  statRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  statRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel:   { color: C.muted, fontSize: 14 },
  statValue:   { color: C.text, fontSize: 14, fontWeight: '700' },

  progressTrack: { height: 8, backgroundColor: C.card, borderRadius: 4, overflow: 'hidden' },
  progressFill:  { height: 8, backgroundColor: C.primary, borderRadius: 4 },
  progressLabel: { color: C.muted, fontSize: 12, textAlign: 'right' },
  currentTitle:  { color: C.text, fontSize: 14, fontWeight: '600' },
  statsRow:      { flexDirection: 'row', justifyContent: 'space-around' },
  miniStat:      { alignItems: 'center', gap: 4 },
  miniStatValue: { color: C.text, fontSize: 20, fontWeight: '800' },
  miniStatLabel: { color: C.muted, fontSize: 11 },

  doneHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  doneTitle:  { color: C.text, fontSize: 18, fontWeight: '800' },

  sectionLabel: {
    color: C.muted, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: 16, marginBottom: 8,
  },
  conflictsSection: { marginTop: 8, marginBottom: 16 },

  conflictCard: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  conflictCardResolved: { borderColor: '#16a34a' },
  conflictCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  conflictTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  conflictMeta:  { color: C.muted, fontSize: 12, marginTop: 2 },
  resolveBtn: {
    backgroundColor: C.primary, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, minWidth: 80, alignItems: 'center',
  },
  resolveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  searchZone:     { borderTopWidth: 1, borderTopColor: C.border, padding: 12, gap: 8 },
  searchInputRow: { flexDirection: 'row', gap: 8 },
  searchInput: {
    flex: 1, backgroundColor: C.card, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    color: C.text, fontSize: 14, borderWidth: 1, borderColor: C.border,
  },
  searchBtn: {
    backgroundColor: C.primary, borderRadius: 8,
    paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
  },
  searchResult: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border,
  },
  searchResultPoster:            { width: 36, height: 54, borderRadius: 5 },
  searchResultPosterPlaceholder: { backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  searchResultInfo:              { flex: 1 },
  searchResultName:              { color: C.text, fontSize: 13, fontWeight: '700' },
  searchResultYear:              { color: C.muted, fontSize: 12 },
});
