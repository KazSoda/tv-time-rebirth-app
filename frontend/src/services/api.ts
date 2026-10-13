import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach JWT token and app version to every request
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('jwt_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers['X-App-Version'] = APP_VERSION;
  return config;
});

// Callback appelé sur 401 (token expiré) — branché par AuthProvider
let _unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  _unauthorizedHandler = handler;
}

// Callback appelé sur 426 (version obsolète) — branché par App
let _updateRequiredHandler: (() => void) | null = null;

export function setUpdateRequiredHandler(handler: () => void) {
  _updateRequiredHandler = handler;
}

api.interceptors.response.use(
  response => response,
  error => {
    const isAuthRoute = (error.config?.url as string | undefined)?.includes('/auth/');
    if (error.response?.status === 401 && !isAuthRoute && _unauthorizedHandler) {
      _unauthorizedHandler();
    }
    if (error.response?.status === 426 && _updateRequiredHandler) {
      _updateRequiredHandler();
    }
    return Promise.reject(error);
  },
);

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: number;
    username: string;
    email: string;
  };
}

export const authApi = {
  login: (payload: LoginPayload) =>
    api.post<AuthResponse>('/auth/login', payload),

  register: (payload: RegisterPayload) =>
    api.post<AuthResponse>('/auth/register', payload),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch('/me/password', { current_password: currentPassword, new_password: newPassword }),
};

export interface WatchlistItem {
  id: string;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  poster_path: string;
  total_episodes: number;
  is_ended: boolean;
  // Statut utilisateur TV Time : '', 'continuing', 'up_to_date', 'stopped', 'watch_later', 'not_started_yet'
  user_status: string;
  release_date: string; // YYYY-MM-DD, vide pour les séries
  added_at: string;
}

export interface AddToWatchlistPayload {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  poster_path: string | null;
  total_episodes?: number;
  is_ended?: boolean;
  user_status?: string;
  release_date?: string;
  genres?: string;    // séparés par virgule
  networks?: string;  // séparés par virgule
}

export interface WeekEntry {
  week: number;
  hours: number;
  count: number;
  is_current: boolean;
}

export interface MarathonEntry {
  title: string;
  episode_count: number;
  hours: number;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface FutureMonthEntry {
  label: string;
  count: number;
  hours: number;
}

export interface PastMonthEntry {
  label: string;
  hours: number;
  count: number;
  is_current: boolean;
}

export interface DecadeEntry {
  decade: number;
  count: number;
}

export interface MovieStatsExtended {
  total_minutes: number;
  minutes_last_7_days: number;
  movie_count: number;
  movies_last_7_days: number;
  movies_added: number;
  movies_remaining: number;
  pace_per_week: number;
  remaining_minutes: number;
  catch_up_date: string;
  week_data: WeekEntry[];
  past_months: PastMonthEntry[];
  future_months: FutureMonthEntry[];
  decades: DecadeEntry[];
}

export interface SeriesStatsExtended {
  total_minutes: number;
  minutes_last_7_days: number;
  episode_count: number;
  episodes_last_7_days: number;
  series_count: number;
  series_in_production: number;
  started_series_count: number;
  remaining_episodes: number;
  remaining_minutes: number;
  pace_per_week: number;
  catch_up_date: string;
  week_data: WeekEntry[];
  past_months: PastMonthEntry[];
  top_marathons: MarathonEntry[];
  top_genres: NameCount[];
  top_networks: NameCount[];
  future_months: FutureMonthEntry[];
}

export const watchlistApi = {
  list: (mediaType?: 'movie' | 'tv') =>
    api.get<WatchlistItem[]>('/watchlist', {
      params: mediaType ? { media_type: mediaType } : {},
    }),

  add: (payload: AddToWatchlistPayload) =>
    api.post('/watchlist', { ...payload, poster_path: payload.poster_path ?? '' }),

  remove: (tmdbId: number, mediaType: 'movie' | 'tv') =>
    api.delete(`/watchlist/${tmdbId}/${mediaType}`),

  check: (tmdbId: number, mediaType: 'movie' | 'tv') =>
    api.get<{ in_watchlist: boolean; user_status?: string }>(`/watchlist/${tmdbId}/${mediaType}`),

  setStatus: (tmdbId: number, mediaType: 'movie' | 'tv', status: string) =>
    api.patch(`/watchlist/${tmdbId}/${mediaType}/status`, { user_status: status }),
};

export interface SeriesWatchedSummary {
  series_tmdb_id: number;
  watched_count: number;
  total_episodes: number;
  last_watched_at: string; // ISO datetime string
  last_watched_season?: number;
  last_watched_episode?: number;
}

export interface MovieWatchedSummary {
  tmdb_id: number;
  rewatch_count: number;
}

export const watchedApi = {
  seriesSummary: () =>
    api.get<SeriesWatchedSummary[]>('/watched/series-summary'),

  // Films
  watchedMovies: () =>
    api.get<number[]>('/watched/movies'),
  checkMovie:  (tmdbId: number) =>
    api.get<{ watched: boolean; rewatch_count: number }>(`/watched/movie/${tmdbId}`),
  markMovie:   (tmdbId: number) =>
    api.post('/watched/movie', { tmdb_id: tmdbId }),
  unmarkMovie: (tmdbId: number) =>
    api.delete(`/watched/movie/${tmdbId}`),
  rewatchMovie: (tmdbId: number) =>
    api.post<{ rewatch_count: number }>('/watched/movie/rewatch', { tmdb_id: tmdbId }),

  // Épisodes
  getWatchedEpisodes: (seriesId: number, seasonNumber: number) =>
    api.get<{ episode_number: number; rewatch_count: number }[]>(`/watched/episodes/${seriesId}/${seasonNumber}`),
  markEpisode: (seriesId: number, seasonNumber: number, episodeNumber: number, runtimeMinutes = 0) =>
    api.post('/watched/episode', {
      series_tmdb_id: seriesId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
      runtime_minutes: runtimeMinutes,
    }),
  unmarkEpisode: (seriesId: number, seasonNumber: number, episodeNumber: number) =>
    api.delete(`/watched/episode/${seriesId}/${seasonNumber}/${episodeNumber}`),
  rewatchEpisode: (seriesId: number, seasonNumber: number, episodeNumber: number) =>
    api.post<{ rewatch_count: number }>('/watched/episode/rewatch', {
      series_tmdb_id: seriesId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
    }),
  markSeason: (seriesId: number, seasonNumber: number, episodeNumbers: number[], runtimeMinutes = 0) =>
    api.post('/watched/season', {
      series_tmdb_id: seriesId,
      season_number: seasonNumber,
      episode_numbers: episodeNumbers,
      runtime_minutes: runtimeMinutes,
    }),

  seriesStats: () =>
    api.get<{ total_minutes: number; episode_count: number; series_count: number }>('/watched/series-stats'),
  seriesStatsExtended: () =>
    api.get<SeriesStatsExtended>('/watched/series-stats-extended'),
  updateEpisodeRuntimes: (seriesId: number, runtimeMinutes: number) =>
    api.put<{ updated: number }>('/watched/episode-runtimes', { series_tmdb_id: seriesId, runtime_minutes: runtimeMinutes }),
  movieStatsExtended: () =>
    api.get<MovieStatsExtended>('/watched/movie-stats-extended'),
  updateMovieRuntime: (tmdbId: number, runtimeMinutes: number, releaseYear: number) =>
    api.put<{ updated: number }>('/watched/movie-runtime', { tmdb_id: tmdbId, runtime_minutes: runtimeMinutes, release_year: releaseYear }),
  setSeriesStats: (totalMinutes: number) =>
    api.put<{ total_minutes: number }>('/watched/series-stats', { total_minutes: totalMinutes }),

  moviesSummary: () =>
    api.get<MovieWatchedSummary[]>('/watched/movies-summary'),
  movieStats: () =>
    api.get<{ total_minutes: number; movie_count: number; decades: { decade: number; count: number }[] }>('/watched/movie-stats'),
  setMovieStats: (totalMinutes: number) =>
    api.put<{ total_minutes: number }>('/watched/movie-stats', { total_minutes: totalMinutes }),
  unmarkSeason: (seriesId: number, seasonNumber: number, episodeNumbers: number[]) =>
    api.delete('/watched/season', {
      data: { series_tmdb_id: seriesId, season_number: seasonNumber, episode_numbers: episodeNumbers },
    }),

  deleteAll: () => api.delete('/watched/all'),

  // Import TV Time : marque des épisodes avec leurs dates réelles
  importEpisodesWithDates: (
    seriesId: number,
    episodes: { season_number: number; episode_number: number; watched_at: string; rewatch_count: number; runtime_minutes: number }[],
  ) =>
    api.post('/watched/import-episodes', { series_tmdb_id: seriesId, episodes }),

  // Import TV Time : marque des films vus avec leurs dates réelles
  importMovies: (movies: { tmdb_id: number; watched_at: string; rewatch_count: number }[]) =>
    api.post('/watched/import-movies', { movies }),
};

export const favoritesApi = {
  list: (mediaType?: 'movie' | 'tv') =>
    api.get<number[]>('/favorites', { params: mediaType ? { media_type: mediaType } : {} }),

  check: (tmdbId: number, mediaType: 'movie' | 'tv') =>
    api.get<{ is_favorite: boolean }>(`/favorites/${tmdbId}/${mediaType}`),

  add: (tmdbId: number, mediaType: 'movie' | 'tv') =>
    api.post<{ is_favorite: boolean }>('/favorites', { tmdb_id: tmdbId, media_type: mediaType }),

  remove: (tmdbId: number, mediaType: 'movie' | 'tv') =>
    api.delete<{ is_favorite: boolean }>(`/favorites/${tmdbId}/${mediaType}`),
};

export const exportApi = {
  export: () => api.get<Record<string, unknown>>('/export'),
};

export interface ProfileInfo {
  avatar_updated_at: string | null;
  banner_updated_at: string | null;
  avatar_path: string | null;
  banner_path: string | null;
}

export const profileApi = {
  getProfile: () => api.get<ProfileInfo>('/profile'),

  uploadAvatar: (uri: string) => {
    const form = new FormData();
    form.append('file', { uri, name: 'avatar.jpg', type: 'image/jpeg' } as any);
    return api.put<{ path: string; updated_at: string }>('/profile/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  uploadBanner: (uri: string) => {
    const form = new FormData();
    form.append('file', { uri, name: 'banner.jpg', type: 'image/jpeg' } as any);
    return api.put<{ path: string; updated_at: string }>('/profile/banner', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export interface PublicUser {
  id: string;
  username: string;
  avatar_path: string | null;
  avatar_updated_at: string | null;
  followers_count: number;
  following_count: number;
  is_following: boolean;
}

export interface PublicProfile extends PublicUser {
  banner_path: string | null;
  banner_updated_at: string | null;
}

export const followsApi = {
  follow:   (username: string) => api.post(`/users/${username}/follow`),
  unfollow: (username: string) => api.delete(`/users/${username}/follow`),

  myFollowing:  () => api.get<PublicUser[]>('/me/following'),
  myFollowers:  () => api.get<PublicUser[]>('/me/followers'),
  followCounts: () => api.get<{ following: number; followers: number }>('/me/follow-counts'),
  searchUsers:  (q: string) => api.get<PublicUser[]>('/search/users', { params: { q } }),

  getPublicProfile:     (username: string) => api.get<PublicProfile>(`/users/${username}/profile`),
  getUserWatchlist:     (username: string, mediaType?: 'movie' | 'tv') =>
    api.get<WatchlistItem[]>(`/users/${username}/watchlist`, {
      params: mediaType ? { media_type: mediaType } : {},
    }),
  getUserFavorites:     (username: string, mediaType?: 'movie' | 'tv') =>
    api.get<number[]>(`/users/${username}/favorites`, {
      params: mediaType ? { media_type: mediaType } : {},
    }),
  getUserWatchedMovies: (username: string) =>
    api.get<number[]>(`/users/${username}/watched/movies`),
  getUserSeriesSummary: (username: string) =>
    api.get<SeriesWatchedSummary[]>(`/users/${username}/watched/series-summary`),
};

/** URL de base du serveur (sans /api), pour construire les URLs d'images. */
export const SERVER_BASE_URL = API_BASE_URL.replace(/\/api$/, '');

export default api;
