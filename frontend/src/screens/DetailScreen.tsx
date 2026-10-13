import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMG } from '../config/tmdb';
import { RootStackParamList } from '../navigation/AppNavigator';
import { watchlistApi, watchedApi, favoritesApi } from '../services/api';

type DetailRouteProp = RouteProp<RootStackParamList, 'Detail'>;
type DetailNav = NativeStackNavigationProp<RootStackParamList>;

const C = {
  bg:      '#1a1a2e',
  surface: '#16213e',
  card:    '#0f2942',
  primary: '#e94560',
  text:    '#ffffff',
  muted:   '#8892a4',
  border:  '#1f4068',
  watched: '#2d6a4f',
};

// ─── Types TMDB ───────────────────────────────────────────────────────────────

interface Genre { id: number; name: string; }

interface MovieDetails {
  id: number; title: string; tagline: string; overview: string;
  poster_path: string | null; backdrop_path: string | null;
  release_date: string; runtime: number | null;
  vote_average: number; genres: Genre[];
}

interface TvSeason {
  id: number; season_number: number; name: string;
  episode_count: number; air_date: string | null; poster_path: string | null;
}

interface Network { id: number; name: string; }

interface TvDetails {
  id: number; name: string; tagline: string; overview: string;
  poster_path: string | null; backdrop_path: string | null;
  first_air_date: string; number_of_seasons: number;
  number_of_episodes: number; vote_average: number;
  status: string; // 'Ended' | 'Canceled' | 'Returning Series' | ...
  genres: Genre[]; seasons: TvSeason[];
  networks: Network[];
}

interface Episode {
  id: number; episode_number: number; name: string; overview: string;
  air_date: string | null; still_path: string | null;
  vote_average: number; runtime: number | null;
}

type Details = MovieDetails | TvDetails;

// ─── Cache ────────────────────────────────────────────────────────────────────

const DETAIL_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 semaine

/** Récupère les épisodes d'une saison : cache AsyncStorage → réseau TMDB. */
async function fetchSeasonEpisodes(tvId: number, seasonNumber: number): Promise<Episode[]> {
  const key = `@season_${tvId}_${seasonNumber}`;
  const now = Date.now();
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const entry: { data: Episode[]; cachedAt: number } = JSON.parse(raw);
      if (now - entry.cachedAt <= DETAIL_CACHE_TTL) return entry.data;
    }
  } catch {}

  const { data } = await axios.get(
    `${TMDB_BASE_URL}/tv/${tvId}/season/${seasonNumber}`,
    { params: { api_key: TMDB_API_KEY, language: 'fr-FR' } }
  );
  const episodes: Episode[] = data.episodes ?? [];
  AsyncStorage.setItem(key, JSON.stringify({ data: episodes, cachedAt: now })).catch(() => {});
  return episodes;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTv(d: Details): d is TvDetails { return 'number_of_seasons' in d; }

function formatRuntime(m: number | null): string {
  if (!m) return '';
  const h = Math.floor(m / 60), min = m % 60;
  return h > 0 ? `${h}h ${min.toString().padStart(2, '0')}min` : `${min}min`;
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '';
  return new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── EpisodeRow ───────────────────────────────────────────────────────────────

function EpisodeRow({
  ep, tvId, seasonNumber, seriesName, isWatched, rewatchCount, onToggleWatched,
}: {
  ep: Episode; tvId: number; seasonNumber: number; seriesName: string;
  isWatched: boolean; rewatchCount: number; onToggleWatched: () => void;
}) {
  const navigation = useNavigation<DetailNav>();
  const still = ep.still_path ? `${TMDB_IMG.still}${ep.still_path}` : null;

  return (
    <View style={styles.epRow}>
      {/* Zone principale → navigation vers le détail */}
      <TouchableOpacity
        style={styles.epMain}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('EpisodeDetail', {
          seriesId: tvId, seriesName, seasonNumber,
          episodeNumber: ep.episode_number,
          episodeName: ep.name, stillPath: ep.still_path,
        })}
      >
        {still ? (
          <Image source={{ uri: still }} style={styles.epStill} />
        ) : (
          <View style={[styles.epStill, styles.epStillPlaceholder]}>
            <Ionicons name="play-circle-outline" size={22} color={C.muted} />
          </View>
        )}
        <View style={styles.epInfo}>
          <Text style={[styles.epTitle, isWatched && styles.epTitleWatched]} numberOfLines={1}>
            {ep.episode_number}. {ep.name}
          </Text>
          <View style={styles.epMeta}>
            {ep.air_date ? <Text style={styles.epMetaText}>{formatDate(ep.air_date)}</Text> : null}
            {ep.runtime  ? <Text style={styles.epMetaText}>· {formatRuntime(ep.runtime)}</Text> : null}
            {ep.vote_average > 0 && (
              <View style={styles.epRating}>
                <Ionicons name="star" size={10} color="#f5c518" />
                <Text style={styles.epMetaText}> {ep.vote_average.toFixed(1)}</Text>
              </View>
            )}
          </View>
          {ep.overview ? <Text style={styles.epOverview} numberOfLines={2}>{ep.overview}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={14} color={C.border} style={{ alignSelf: 'center' }} />
      </TouchableOpacity>

      {/* Bouton "vu" / rewatch */}
      <TouchableOpacity style={styles.epWatchBtn} onPress={onToggleWatched} activeOpacity={0.7}>
        {isWatched && rewatchCount > 0 ? (
          <View style={styles.rewatchBadge}>
            <Text style={styles.rewatchBadgeText}>+{rewatchCount}</Text>
          </View>
        ) : (
          <Ionicons
            name={isWatched ? 'eye' : 'eye-outline'}
            size={22}
            color={isWatched ? C.watched : C.muted}
          />
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── SeasonBlock ──────────────────────────────────────────────────────────────

function SeasonBlock({
  season, tvId, seriesName,
  isExpanded, onToggle,
  episodes, episodesLoading,
  watchedEpisodes, watchedLoading,
  onToggleWatchedEpisode, onMarkSeasonWatched,
}: {
  season: TvSeason; tvId: number; seriesName: string;
  isExpanded: boolean; onToggle: (n: number) => void;
  episodes: Episode[] | null; episodesLoading: boolean;
  watchedEpisodes: Map<number, number>; watchedLoading: boolean;
  onToggleWatchedEpisode: (ep: number) => void;
  onMarkSeasonWatched: () => void;
}) {
  if (season.season_number === 0) return null;

  const allWatched = episodes != null && episodes.length > 0
    ? episodes.every(ep => watchedEpisodes.has(ep.episode_number))
    : watchedEpisodes.size > 0 && watchedEpisodes.size >= season.episode_count;

  return (
    <View style={styles.seasonBlock}>
      <View style={styles.seasonHeader}>
        {/* Zone principale : expand/collapse */}
        <TouchableOpacity
          style={styles.seasonHeaderMain}
          onPress={() => onToggle(season.season_number)}
          activeOpacity={0.7}
        >
          <View style={styles.seasonHeaderLeft}>
            <Text style={styles.seasonName}>{season.name}</Text>
            <Text style={styles.seasonMeta}>
              {season.episode_count} épisode{season.episode_count > 1 ? 's' : ''}
              {season.air_date ? `  ·  ${season.air_date.slice(0, 4)}` : ''}
            </Text>
          </View>
          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={C.muted} />
        </TouchableOpacity>

        {/* Bouton "marquer la saison comme vue" */}
        <TouchableOpacity style={styles.seasonWatchBtn} onPress={onMarkSeasonWatched} activeOpacity={0.7}>
          {watchedLoading ? (
            <ActivityIndicator size="small" color={C.watched} />
          ) : (
            <Ionicons
              name={allWatched ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={26}
              color={allWatched ? C.watched : C.muted}
            />
          )}
        </TouchableOpacity>
      </View>

      {isExpanded && (
        <View style={styles.episodesList}>
          {episodesLoading ? (
            <ActivityIndicator size="small" color={C.primary} style={{ marginVertical: 16 }} />
          ) : episodes && episodes.length > 0 ? (
            episodes.map(ep => (
              <EpisodeRow
                key={ep.id}
                ep={ep}
                tvId={tvId}
                seasonNumber={season.season_number}
                seriesName={seriesName}
                isWatched={watchedEpisodes.has(ep.episode_number)}
                rewatchCount={watchedEpisodes.get(ep.episode_number) ?? 0}
                onToggleWatched={() => onToggleWatchedEpisode(ep.episode_number)}
              />
            ))
          ) : (
            <Text style={styles.noEpisodes}>Aucun épisode disponible.</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function DetailScreen() {
  const navigation = useNavigation();
  const route      = useRoute<DetailRouteProp>();
  const insets     = useSafeAreaInsets();
  const { id, mediaType, title: initialTitle } = route.params;

  const [details,         setDetails]         = useState<Details | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);

  // Watchlist
  const [inWatchlist,     setInWatchlist]     = useState(false);
  const [watchlistLoading,setWatchlistLoading]= useState(false);
  const [userStatus,      setUserStatus]      = useState('');

  // Film vu
  const [isWatched,          setIsWatched]          = useState(false);
  const [movieRewatchCount,  setMovieRewatchCount]  = useState(0);
  const [watchedLoading,     setWatchedLoading]     = useState(false);

  // Favori
  const [isFavorite,      setIsFavorite]      = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  // Menu trois points
  const [menuVisible,     setMenuVisible]     = useState(false);

  // Saisons
  const [expandedSeason,       setExpandedSeason]       = useState<number | null>(null);
  const [episodesCache,        setEpisodesCache]        = useState<Record<number, Episode[]>>({});
  const [seasonLoadingMap,     setSeasonLoadingMap]     = useState<Record<number, boolean>>({});

  // Épisodes vus (TV) — Map<episodeNumber, rewatchCount>
  const [watchedEpisodesCache, setWatchedEpisodesCache] = useState<Record<number, Map<number, number>>>({});
  const [seasonWatchedLoading, setSeasonWatchedLoading] = useState<Record<number, boolean>>({});
  const [seriesWatchedLoading, setSeriesWatchedLoading] = useState(false);

  // ── Chargement initial ────────────────────────────────────────────────────
  useEffect(() => {
    const cacheKey = `@detail_${mediaType}_${id}`;
    const now = Date.now();

    // Checks parallèles — pas de cache : données utilisateur toujours fraîches
    watchlistApi.check(id, mediaType)
      .then(({ data }) => {
        setInWatchlist(data.in_watchlist);
        if (data.user_status) setUserStatus(data.user_status);
      })
      .catch(() => {});
    if (mediaType === 'movie') {
      watchedApi.checkMovie(id)
        .then(({ data }) => {
          setIsWatched(data.watched);
          setMovieRewatchCount(data.rewatch_count ?? 0);
        })
        .catch(() => {});
    }
    favoritesApi.check(id, mediaType)
      .then(({ data }) => setIsFavorite(data.is_favorite))
      .catch(() => {});

    // Détails TMDB avec cache
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const entry: { data: Details; cachedAt: number } = JSON.parse(raw);
          if (now - entry.cachedAt <= DETAIL_CACHE_TTL) {
            setDetails(entry.data);
            setLoading(false);
            return;
          }
        }

        const endpoint = mediaType === 'movie' ? `/movie/${id}` : `/tv/${id}`;
        const { data } = await axios.get(`${TMDB_BASE_URL}${endpoint}`, {
          params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
        });
        setDetails(data);

        // Écriture du cache détail
        AsyncStorage.setItem(cacheKey, JSON.stringify({ data, cachedAt: now })).catch(() => {});

        // Alimentation croisée du cache "à venir" pour les séries TV
        if (mediaType === 'tv') {
          const ep = data.next_episode_to_air;
          AsyncStorage.setItem(`@upcoming_tv_${id}`, JSON.stringify({
            data: ep?.air_date
              ? { seasonNumber: ep.season_number, episodeNumber: ep.episode_number, episodeName: ep.name ?? '', airDate: ep.air_date }
              : null,
            cachedAt: now,
          })).catch(() => {});
        }
      } catch {
        setError('Impossible de charger les détails.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, mediaType]);

  // Pré-charger les épisodes vus de toutes les saisons dès que les détails TV sont disponibles
  useEffect(() => {
    if (!details || !isTv(details)) return;
    details.seasons
      .filter(s => s.season_number > 0)
      .forEach(s => {
        watchedApi.getWatchedEpisodes(id, s.season_number)
          .then(({ data }) =>
            setWatchedEpisodesCache(p => ({
              ...p,
              [s.season_number]: new Map(data.map(d => [d.episode_number, d.rewatch_count])),
            }))
          )
          .catch(() => {});
      });
  }, [details, id]);

  // ── Watchlist ─────────────────────────────────────────────────────────────
  const handleWatchlistToggle = async () => {
    if (!details) return;
    setWatchlistLoading(true);
    try {
      if (inWatchlist) {
        await watchlistApi.remove(id, mediaType);
        setInWatchlist(false);
      } else {
        await watchlistApi.add({
          tmdb_id: id, media_type: mediaType,
          title: isTv(details) ? details.name : details.title,
          poster_path: details.poster_path,
          total_episodes: isTv(details) ? details.number_of_episodes : undefined,
          is_ended: isTv(details)
            ? (details.status === 'Ended' || details.status === 'Canceled')
            : undefined,
          release_date: !isTv(details) ? (details.release_date ?? '') : undefined,
          genres: details.genres?.map(g => g.name).join(',') ?? '',
          networks: isTv(details) ? (details.networks?.map(n => n.name).join(',') ?? '') : undefined,
        });
        setInWatchlist(true);
      }
    } catch {} finally { setWatchlistLoading(false); }
  };

  // ── Favori ───────────────────────────────────────────────────────────────
  const handleFavoriteToggle = async () => {
    setFavoriteLoading(true);
    try {
      if (isFavorite) { await favoritesApi.remove(id, mediaType); setIsFavorite(false); }
      else            { await favoritesApi.add(id, mediaType);    setIsFavorite(true);  }
    } catch {} finally { setFavoriteLoading(false); }
  };

  // ── Statut utilisateur ───────────────────────────────────────────────────
  const handleSetStatus = useCallback(async (newStatus: string) => {
    const next = userStatus === newStatus ? '' : newStatus;
    try {
      await watchlistApi.setStatus(id, mediaType, next);
      setUserStatus(next);
    } catch {}
  }, [userStatus, id, mediaType]);

  // ── Suppression de la liste ───────────────────────────────────────────────
  const handleRemove = useCallback(() => {
    const label = mediaType === 'tv' ? 'la série' : 'le film';
    Alert.alert(
      `Supprimer ${label}`,
      `Cette action retirera ${label} de ta liste.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await watchlistApi.remove(id, mediaType);
              setInWatchlist(false);
              setUserStatus('');
              navigation.goBack();
            } catch {}
          },
        },
      ]
    );
  }, [id, mediaType, navigation]);

  // ── Film vu ───────────────────────────────────────────────────────────────
  const handleMovieWatchedToggle = async () => {
    if (!isWatched) {
      setWatchedLoading(true);
      try { await watchedApi.markMovie(id); setIsWatched(true); }
      catch {} finally { setWatchedLoading(false); }
      return;
    }
    // Film déjà vu → popup
    Alert.alert(
      'Que veux-tu faire ?',
      undefined,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Marquer comme non vu',
          style: 'destructive',
          onPress: async () => {
            setWatchedLoading(true);
            try { await watchedApi.unmarkMovie(id); setIsWatched(false); setMovieRewatchCount(0); }
            catch {} finally { setWatchedLoading(false); }
          },
        },
        {
          text: 'Vu à nouveau',
          onPress: async () => {
            setWatchedLoading(true);
            try {
              const { data } = await watchedApi.rewatchMovie(id);
              setMovieRewatchCount(data.rewatch_count);
            } catch {} finally { setWatchedLoading(false); }
          },
        },
      ]
    );
  };

  // ── Saisons : expand + chargement des épisodes + épisodes vus ────────────
  const handleSeasonToggle = useCallback(async (seasonNumber: number) => {
    if (expandedSeason === seasonNumber) { setExpandedSeason(null); return; }
    setExpandedSeason(seasonNumber);

    if (!episodesCache[seasonNumber]) {
      setSeasonLoadingMap(p => ({ ...p, [seasonNumber]: true }));
      try {
        const episodes = await fetchSeasonEpisodes(id, seasonNumber);
        setEpisodesCache(p => ({ ...p, [seasonNumber]: episodes }));
      } catch {
        setEpisodesCache(p => ({ ...p, [seasonNumber]: [] }));
      } finally {
        setSeasonLoadingMap(p => ({ ...p, [seasonNumber]: false }));
      }
    }

    if (!watchedEpisodesCache[seasonNumber]) {
      watchedApi.getWatchedEpisodes(id, seasonNumber)
        .then(({ data }) => setWatchedEpisodesCache(p => ({
          ...p,
          [seasonNumber]: new Map(data.map(d => [d.episode_number, d.rewatch_count])),
        })))
        .catch(() => setWatchedEpisodesCache(p => ({ ...p, [seasonNumber]: new Map() })));
    }
  }, [expandedSeason, episodesCache, watchedEpisodesCache, id]);

  // ── Épisode individuel vu ─────────────────────────────────────────────────
  const handleEpisodeWatchedToggle = useCallback(async (seasonNumber: number, episodeNumber: number) => {
    const currentlyWatched = watchedEpisodesCache[seasonNumber]?.has(episodeNumber) ?? false;

    if (currentlyWatched) {
      // Épisode déjà vu → popup : non vu / vu à nouveau
      Alert.alert(
        'Que veux-tu faire ?',
        undefined,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Marquer comme non vu',
            style: 'destructive',
            onPress: async () => {
              try {
                await watchedApi.unmarkEpisode(id, seasonNumber, episodeNumber);
                setWatchedEpisodesCache(p => {
                  const m = new Map(p[seasonNumber] ?? new Map<number, number>());
                  m.delete(episodeNumber);
                  return { ...p, [seasonNumber]: m };
                });
              } catch {}
            },
          },
          {
            text: 'Vu à nouveau',
            onPress: async () => {
              try {
                const { data } = await watchedApi.rewatchEpisode(id, seasonNumber, episodeNumber);
                setWatchedEpisodesCache(p => {
                  const m = new Map(p[seasonNumber] ?? new Map<number, number>());
                  m.set(episodeNumber, data.rewatch_count);
                  return { ...p, [seasonNumber]: m };
                });
              } catch {}
            },
          },
        ]
      );
      return;
    }

    // Pas encore vu → marquer comme vu
    try {
      const epRuntime = episodesCache[seasonNumber]?.find(e => e.episode_number === episodeNumber)?.runtime ?? 0;
      await watchedApi.markEpisode(id, seasonNumber, episodeNumber, epRuntime);
      setWatchedEpisodesCache(p => {
        const m = new Map(p[seasonNumber] ?? new Map<number, number>());
        m.set(episodeNumber, 0);
        return { ...p, [seasonNumber]: m };
      });
    } catch { return; }

    // Vérifier les épisodes précédents non vus
    if (!details || !isTv(details)) return;

    const seasonsBefore = details.seasons.filter(s => s.season_number > 0 && s.season_number <= seasonNumber);
    let unwatchedCount = 0;

    for (const season of seasonsBefore) {
      const watchedMap = watchedEpisodesCache[season.season_number] ?? new Map<number, number>();
      if (season.season_number < seasonNumber) {
        unwatchedCount += Math.max(0, season.episode_count - watchedMap.size);
      } else {
        const eps = episodesCache[seasonNumber] ?? [];
        unwatchedCount += eps.filter(ep => ep.episode_number < episodeNumber && !watchedMap.has(ep.episode_number)).length;
      }
    }

    if (unwatchedCount <= 0) return;

    Alert.alert(
      'Épisodes précédents non vus',
      `Il y a ${unwatchedCount} épisode${unwatchedCount > 1 ? 's' : ''} précédent${unwatchedCount > 1 ? 's' : ''} non vu${unwatchedCount > 1 ? 's' : ''}. Veux-tu les marquer comme vus aussi ?`,
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui, tout marquer',
          onPress: async () => {
            const localEpsCache: Record<number, Episode[]> = { ...episodesCache };
            const toLoad = seasonsBefore.filter(s => !localEpsCache[s.season_number]);
            if (toLoad.length > 0) {
              await Promise.all(
                toLoad.map(async s => {
                  try { localEpsCache[s.season_number] = await fetchSeasonEpisodes(id, s.season_number); }
                  catch { localEpsCache[s.season_number] = []; }
                })
              );
              setEpisodesCache(localEpsCache);
            }
            await Promise.all(
              seasonsBefore.map(async season => {
                const eps      = localEpsCache[season.season_number] ?? [];
                const watchedMap = watchedEpisodesCache[season.season_number] ?? new Map<number, number>();
                const toMark   = eps
                  .filter(ep =>
                    season.season_number < seasonNumber
                      ? !watchedMap.has(ep.episode_number)
                      : ep.episode_number < episodeNumber && !watchedMap.has(ep.episode_number)
                  )
                  .map(ep => ep.episode_number);
                if (toMark.length === 0) return;
                try {
                  const marked = eps.filter(e => toMark.includes(e.episode_number) && e.runtime);
                  const rt = marked.length > 0 ? Math.round(marked.reduce((s, e) => s + e.runtime!, 0) / marked.length) : 0;
                  await watchedApi.markSeason(id, season.season_number, toMark, rt);
                  setWatchedEpisodesCache(p => {
                    const m = new Map(p[season.season_number] ?? new Map<number, number>());
                    toMark.forEach(n => m.set(n, 0));
                    return { ...p, [season.season_number]: m };
                  });
                } catch {}
              })
            );
          },
        },
      ]
    );
  }, [watchedEpisodesCache, episodesCache, id, details]);

  // ── Saison entière vue ────────────────────────────────────────────────────
  const handleSeasonWatchedToggle = useCallback(async (seasonNumber: number) => {
    setSeasonWatchedLoading(p => ({ ...p, [seasonNumber]: true }));
    try {
      // Charger les épisodes si pas encore en mémoire (cache AsyncStorage → réseau)
      let episodes = episodesCache[seasonNumber];
      if (!episodes) {
        episodes = await fetchSeasonEpisodes(id, seasonNumber);
        setEpisodesCache(p => ({ ...p, [seasonNumber]: episodes! }));
      }

      const allNums    = episodes.map(ep => ep.episode_number);
      const watched    = watchedEpisodesCache[seasonNumber] ?? new Map<number, number>();
      const allWatched = allNums.every(n => watched.has(n));

      if (allWatched) {
        await watchedApi.unmarkSeason(id, seasonNumber, allNums);
        setWatchedEpisodesCache(p => ({ ...p, [seasonNumber]: new Map() }));
      } else {
        const unwatched = allNums.filter(n => !watched.has(n));
        const uwEps = episodes.filter(e => unwatched.includes(e.episode_number) && e.runtime);
        const rt = uwEps.length > 0 ? Math.round(uwEps.reduce((s, e) => s + e.runtime!, 0) / uwEps.length) : 0;
        await watchedApi.markSeason(id, seasonNumber, unwatched, rt);
        setWatchedEpisodesCache(p => {
          const m = new Map(p[seasonNumber] ?? new Map<number, number>());
          unwatched.forEach(n => m.set(n, 0));
          return { ...p, [seasonNumber]: m };
        });
      }
    } catch {} finally {
      setSeasonWatchedLoading(p => ({ ...p, [seasonNumber]: false }));
    }
  }, [episodesCache, watchedEpisodesCache, id]);

  // ── Série entière vue ─────────────────────────────────────────────────────
  const handleSeriesWatchedToggle = useCallback(async () => {
    if (!details || !isTv(details)) return;
    setSeriesWatchedLoading(true);
    try {
      const validSeasons = details.seasons.filter(s => s.season_number > 0);

      // Charger les saisons non encore en mémoire (cache AsyncStorage → réseau)
      const localEpsCache: Record<number, Episode[]> = { ...episodesCache };
      await Promise.all(
        validSeasons
          .filter(s => !localEpsCache[s.season_number])
          .map(async s => {
            try {
              localEpsCache[s.season_number] = await fetchSeasonEpisodes(id, s.season_number);
            } catch {
              localEpsCache[s.season_number] = [];
            }
          })
      );
      setEpisodesCache(localEpsCache);

      // Tout vu ?
      const allWatched = validSeasons.every(s => {
        const eps = localEpsCache[s.season_number] ?? [];
        const watched = watchedEpisodesCache[s.season_number] ?? new Map<number, number>();
        return eps.length > 0 && eps.every(ep => watched.has(ep.episode_number));
      });

      // Appliquer saison par saison en parallèle
      await Promise.all(
        validSeasons.map(async s => {
          const epNums = (localEpsCache[s.season_number] ?? []).map(ep => ep.episode_number);
          if (epNums.length === 0) return;
          if (allWatched) {
            await watchedApi.unmarkSeason(id, s.season_number, epNums);
          } else {
            const watched = watchedEpisodesCache[s.season_number] ?? new Map<number, number>();
            const unwatched = epNums.filter(n => !watched.has(n));
            if (unwatched.length > 0) {
              const sEps = localEpsCache[s.season_number] ?? [];
              const uwEps = sEps.filter(e => unwatched.includes(e.episode_number) && e.runtime);
              const rt = uwEps.length > 0 ? Math.round(uwEps.reduce((sum, e) => sum + e.runtime!, 0) / uwEps.length) : 0;
              await watchedApi.markSeason(id, s.season_number, unwatched, rt);
            }
          }
        })
      );

      setWatchedEpisodesCache(prev => {
        const next = { ...prev };
        validSeasons.forEach(s => {
          const epNums = (localEpsCache[s.season_number] ?? []).map(ep => ep.episode_number);
          if (allWatched) {
            next[s.season_number] = new Map();
          } else {
            const m = new Map(prev[s.season_number] ?? new Map<number, number>());
            epNums.forEach(n => { if (!m.has(n)) m.set(n, 0); });
            next[s.season_number] = m;
          }
        });
        return next;
      });
    } catch {} finally {
      setSeriesWatchedLoading(false);
    }
  }, [details, episodesCache, watchedEpisodesCache, id]);

  // ── Rendu ─────────────────────────────────────────────────────────────────
  const displayTitle = details ? (isTv(details) ? details.name : details.title) : initialTitle;
  const backdropUri  = details?.backdrop_path ? `${TMDB_IMG.backdrop}${details.backdrop_path}` : null;
  const posterUri    = details?.poster_path   ? `${TMDB_IMG.poster_md}${details.poster_path}`  : null;

  const isSeriesAllWatched = details && isTv(details) && (() => {
    const validSeasons = details.seasons.filter(s => s.season_number > 0);
    if (validSeasons.length === 0) return false;
    return validSeasons.every(s => {
      const watched = watchedEpisodesCache[s.season_number];
      if (!watched || watched.size === 0) return false;
      // Si les épisodes sont chargés, vérification précise ; sinon on compare au nombre déclaré
      const eps = episodesCache[s.season_number];
      return eps && eps.length > 0
        ? eps.every(ep => watched.has(ep.episode_number))
        : watched.size >= s.episode_count;
    });
  })();

  return (
    <View style={styles.root}>
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + 8 }]}
        onPress={() => navigation.goBack()}
        activeOpacity={0.8}
      >
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuDotBtn, { top: insets.top + 8 }]}
        onPress={() => setMenuVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
      </TouchableOpacity>

      {/* ── Menu trois points ── */}
      <Modal visible={menuVisible} transparent animationType="slide" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuVisible(false)}>
          <Pressable style={[styles.menuSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.menuHandle} />

            <MenuRow
              icon={isFavorite ? 'heart' : 'heart-outline'}
              label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              iconColor={isFavorite ? C.primary : C.text}
              loading={favoriteLoading}
              onPress={() => { setMenuVisible(false); handleFavoriteToggle(); }}
            />

            {inWatchlist && (
              <>
                <View style={styles.menuDivider} />
                <MenuRow
                  icon="bookmark-outline"
                  label="Regarder plus tard"
                  active={userStatus === 'watch_later'}
                  onPress={() => { setMenuVisible(false); handleSetStatus('watch_later'); }}
                />
                {mediaType === 'tv' && (
                  <>
                    <View style={styles.menuDivider} />
                    <MenuRow
                      icon="stop-circle-outline"
                      label="Arrêter de regarder"
                      active={userStatus === 'stopped'}
                      danger={userStatus !== 'stopped'}
                      onPress={() => { setMenuVisible(false); handleSetStatus('stopped'); }}
                    />
                  </>
                )}
                <View style={styles.menuDivider} />
                <MenuRow
                  icon="trash-outline"
                  label={mediaType === 'tv' ? 'Supprimer la série' : 'Supprimer le film'}
                  danger
                  onPress={() => { setMenuVisible(false); handleRemove(); }}
                />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {loading && <View style={styles.centered}><ActivityIndicator size="large" color={C.primary} /></View>}

      {error && !loading && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={C.primary} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!loading && !error && details && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Backdrop */}
          <View style={styles.backdropContainer}>
            {backdropUri
              ? <Image source={{ uri: backdropUri }} style={styles.backdrop} resizeMode="cover" />
              : <View style={[styles.backdrop, { backgroundColor: C.surface }]} />}
            <View style={styles.backdropGradient} />
          </View>

          {/* Hero */}
          <View style={styles.heroRow}>
            {posterUri
              ? <Image source={{ uri: posterUri }} style={styles.poster} />
              : <View style={[styles.poster, styles.posterPlaceholder]}><Ionicons name="image-outline" size={36} color={C.muted} /></View>}
            <View style={styles.heroInfo}>
              <Text style={styles.mainTitle}>{displayTitle}</Text>
              {details.tagline ? <Text style={styles.tagline} numberOfLines={2}>{details.tagline}</Text> : null}
              <View style={styles.metaRow}>
                {isTv(details) ? (
                  <>
                    <MetaChip icon="layers-outline" label={`${details.number_of_seasons} saison${details.number_of_seasons > 1 ? 's' : ''}`} />
                    <MetaChip icon="tv-outline"     label={`${details.number_of_episodes} ép.`} />
                  </>
                ) : (
                  <>
                    {details.release_date && <MetaChip icon="calendar-outline" label={details.release_date.slice(0, 4)} />}
                    {details.runtime      && <MetaChip icon="time-outline"     label={formatRuntime(details.runtime)} />}
                  </>
                )}
                {details.vote_average > 0 && <MetaChip icon="star" label={details.vote_average.toFixed(1)} iconColor="#f5c518" />}
                <TouchableOpacity style={styles.heartChip} onPress={handleFavoriteToggle} activeOpacity={0.7} disabled={favoriteLoading}>
                  {favoriteLoading
                    ? <ActivityIndicator size="small" color={C.primary} style={{ width: 16, height: 16 }} />
                    : <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={16} color={isFavorite ? C.primary : C.muted} />}
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Genres */}
          {details.genres.length > 0 && (
            <View style={styles.genreRow}>
              {details.genres.map(g => (
                <View key={g.id} style={styles.pill}><Text style={styles.pillText}>{g.name}</Text></View>
              ))}
            </View>
          )}

          {/* Synopsis */}
          {details.overview ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Synopsis</Text>
              <Text style={styles.overview}>{details.overview}</Text>
            </View>
          ) : null}

          {/* Saisons & épisodes */}
          {isTv(details) && details.seasons.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Saisons & épisodes</Text>
              {details.seasons.map(s => (
                <SeasonBlock
                  key={s.id}
                  season={s}
                  tvId={details.id}
                  seriesName={details.name}
                  isExpanded={expandedSeason === s.season_number}
                  onToggle={handleSeasonToggle}
                  episodes={episodesCache[s.season_number] ?? null}
                  episodesLoading={seasonLoadingMap[s.season_number] ?? false}
                  watchedEpisodes={watchedEpisodesCache[s.season_number] ?? new Map()}
                  watchedLoading={seasonWatchedLoading[s.season_number] ?? false}
                  onToggleWatchedEpisode={epNum => handleEpisodeWatchedToggle(s.season_number, epNum)}
                  onMarkSeasonWatched={() => handleSeasonWatchedToggle(s.season_number)}
                />
              ))}
            </View>
          )}

          {/* Infos film */}
          {!isTv(details) && (
            <View style={styles.section}>
              {details.release_date && <InfoLine label="Date de sortie" value={formatDate(details.release_date)} />}
              {details.runtime      && <InfoLine label="Durée"          value={formatRuntime(details.runtime)} />}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Bannière ── */}
      {!loading && !error && details && (
        <View style={[styles.banner, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.bannerRow}>
            {/* Bouton principal : ajouter à la liste */}
            <TouchableOpacity
              style={[styles.bannerBtn, inWatchlist && styles.bannerBtnAdded]}
              onPress={handleWatchlistToggle}
              disabled={watchlistLoading}
              activeOpacity={0.85}
            >
              {watchlistLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons name={inWatchlist ? 'checkmark-circle' : 'add-circle-outline'} size={18} color="#fff" />
                    <Text style={styles.bannerText}>
                      {inWatchlist
                        ? (mediaType === 'tv' ? 'AJOUTÉE' : 'AJOUTÉ')
                        : (mediaType === 'tv' ? '+ SÉRIE' : '+ FILM')}
                    </Text>
                  </>}
            </TouchableOpacity>

            {/* Bouton "vu" — film */}
            {mediaType === 'movie' && (
              <TouchableOpacity
                style={[styles.bannerWatchedBtn, isWatched && styles.bannerWatchedBtnActive]}
                onPress={handleMovieWatchedToggle}
                disabled={watchedLoading}
                activeOpacity={0.85}
              >
                {watchedLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name={isWatched ? 'eye' : 'eye-outline'} size={18} color="#fff" />
                      <Text style={styles.bannerText}>
                        {isWatched ? (movieRewatchCount > 0 ? `VU +${movieRewatchCount}` : 'VU') : 'MARQUER VU'}
                      </Text>
                    </>}
              </TouchableOpacity>
            )}

            {/* Bouton "vu" — série entière */}
            {mediaType === 'tv' && (
              <TouchableOpacity
                style={[styles.bannerWatchedBtn, isSeriesAllWatched && styles.bannerWatchedBtnActive]}
                onPress={handleSeriesWatchedToggle}
                disabled={seriesWatchedLoading}
                activeOpacity={0.85}
              >
                {seriesWatchedLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name={isSeriesAllWatched ? 'eye' : 'eye-outline'} size={18} color="#fff" />
                      <Text style={styles.bannerText}>{isSeriesAllWatched ? 'VUE ✓' : 'TOUT MARQUER VU'}</Text>
                    </>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Sous-composants utilitaires ──────────────────────────────────────────────

function MenuRow({ icon, label, onPress, active = false, danger = false, iconColor, loading = false }: {
  icon:       React.ComponentProps<typeof Ionicons>['name'];
  label:      string;
  onPress:    () => void;
  active?:    boolean;
  danger?:    boolean;
  iconColor?: string;
  loading?:   boolean;
}) {
  const color = iconColor ?? (danger ? '#ef4444' : active ? C.primary : C.text);
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress} activeOpacity={0.65}>
      {loading
        ? <ActivityIndicator size="small" color={color} style={{ width: 24 }} />
        : <Ionicons name={icon} size={22} color={color} />}
      <Text style={[styles.menuRowText, { color }]}>{label}</Text>
      {active && <Ionicons name="checkmark" size={18} color={C.primary} style={{ marginLeft: 'auto' }} />}
    </TouchableOpacity>
  );
}

function MetaChip({ icon, label, iconColor = C.muted }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; iconColor?: string;
}) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={12} color={iconColor} />
      <Text style={styles.metaChipText}>{label}</Text>
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.bg },
  scroll:  { flex: 1 },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: { color: C.primary, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },

  backBtn: {
    position: 'absolute', left: 16, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: 8,
  },
  menuDotBtn: {
    position: 'absolute', right: 16, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: 8,
  },

  // Menu trois points
  menuOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 12, paddingHorizontal: 8,
  },
  menuHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.border, alignSelf: 'center', marginBottom: 16,
  },
  menuDivider: { height: 1, backgroundColor: C.border, marginVertical: 4, marginHorizontal: 8 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10,
  },
  menuRowText: { fontSize: 16, fontWeight: '500', flex: 1 },

  backdropContainer: { width: '100%', height: 220, position: 'relative' },
  backdrop:          { width: '100%', height: '100%' },
  backdropGradient:  {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 100,
    backgroundColor: 'transparent',
    shadowColor: C.bg, shadowOffset: { width: 0, height: -40 }, shadowOpacity: 1, shadowRadius: 40,
  },

  heroRow: { flexDirection: 'row', marginTop: -60, paddingHorizontal: 16, gap: 14, alignItems: 'flex-end' },
  poster:  { width: 110, height: 165, borderRadius: 10, borderWidth: 2, borderColor: C.border },
  posterPlaceholder: { backgroundColor: C.surface, justifyContent: 'center', alignItems: 'center' },
  heroInfo:   { flex: 1, paddingBottom: 8, gap: 6 },
  mainTitle:  { color: C.text, fontSize: 20, fontWeight: '800', lineHeight: 26 },
  tagline:    { color: C.muted, fontSize: 13, fontStyle: 'italic' },
  metaRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  metaChip:   { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.card, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  metaChipText: { color: C.muted, fontSize: 12 },
  heartChip:  { backgroundColor: C.card, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },

  genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 16 },
  pill:     { backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: C.border },
  pillText: { color: C.text, fontSize: 12, fontWeight: '600' },

  section:      { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  overview:     { color: '#c8d0dd', fontSize: 14, lineHeight: 22 },

  infoLine:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { color: C.muted, fontSize: 14 },
  infoValue: { color: C.text, fontSize: 14, fontWeight: '600' },

  // Saisons
  seasonBlock: { backgroundColor: C.surface, borderRadius: 10, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  seasonHeader: { flexDirection: 'row', alignItems: 'center' },
  seasonHeaderMain: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  seasonHeaderLeft: { flex: 1 },
  seasonName: { color: C.text, fontSize: 15, fontWeight: '700' },
  seasonMeta: { color: C.muted, fontSize: 12, marginTop: 2 },
  seasonWatchBtn: { paddingHorizontal: 14, paddingVertical: 14 },
  episodesList: { borderTopWidth: 1, borderTopColor: C.border },
  noEpisodes:   { color: C.muted, fontSize: 13, textAlign: 'center', padding: 16 },

  // Épisodes
  epRow:  { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, alignItems: 'stretch' },
  epMain: { flex: 1, flexDirection: 'row', padding: 12, gap: 12, alignItems: 'center' },
  epStill:            { width: 96, height: 58, borderRadius: 6, backgroundColor: C.card },
  epStillPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  epInfo:             { flex: 1, gap: 4 },
  epTitle:            { color: C.text, fontSize: 13, fontWeight: '700' },
  epTitleWatched:     { color: C.watched },
  epMeta:             { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  epMetaText:         { color: C.muted, fontSize: 11 },
  epRating:           { flexDirection: 'row', alignItems: 'center' },
  epOverview:         { color: C.muted, fontSize: 11, lineHeight: 16 },
  epWatchBtn:         { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, minWidth: 48 },
  rewatchBadge:       { backgroundColor: C.watched, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 },
  rewatchBadgeText:   { color: '#fff', fontSize: 12, fontWeight: '800' },

  // Bannière
  banner: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border,
    paddingHorizontal: 16, paddingTop: 12,
  },
  bannerRow:        { flexDirection: 'row', gap: 10 },
  bannerBtn:        { flex: 1, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  bannerBtnAdded:   { backgroundColor: C.watched },
  bannerWatchedBtn: { flex: 1, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: C.border },
  bannerWatchedBtnActive: { backgroundColor: C.watched, borderColor: C.watched },
  bannerText:       { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },
});
