import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { watchlistApi, watchedApi, favoritesApi, followsApi, WatchlistItem, SeriesWatchedSummary } from '../services/api';
import { RootStackParamList } from '../navigation/AppNavigator';
import { TMDB_IMG, TMDB_BASE_URL, TMDB_API_KEY } from '../config/tmdb';

const UPCOMING_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

type Nav   = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ProfileSeries'>;

const BAR_YELLOW = '#f0b429';
const BAR_GREEN  = '#16a34a';
const BAR_PURPLE = '#7c3aed';
const BAR_RED    = '#dc2626';

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

const { width: W } = Dimensions.get('window');
const GRID_PAD     = 16;
const GRID_GAP     = 8;
const CARD_W       = Math.floor((W - GRID_PAD * 2 - GRID_GAP * 2) / 3);
const CARD_H       = Math.floor(CARD_W * 1.5);
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function getBar(item: WatchlistItem, summary?: SeriesWatchedSummary, airedCount?: number) {
  // Séries arrêtées : barre rouge
  if ((item.user_status ?? '') === 'stopped') {
    if (!summary || summary.watched_count === 0 || item.total_episodes === 0) return null;
    const pct = Math.min(100, Math.ceil((summary.watched_count / item.total_episodes) * 100));
    return { pct, color: BAR_RED };
  }
  if (!summary || summary.watched_count === 0 || item.total_episodes === 0) return null;
  // À jour par rapport aux épisodes diffusés → barre verte 100%
  if (airedCount !== undefined && airedCount > 0 && summary.watched_count >= airedCount) {
    return { pct: 100, color: BAR_GREEN };
  }
  const pct = Math.min(100, Math.ceil((summary.watched_count / item.total_episodes) * 100));
  const color = summary.watched_count >= item.total_episodes
    ? (item.is_ended ? BAR_PURPLE : BAR_GREEN)
    : BAR_YELLOW;
  return { pct, color };
}

interface Categorised {
  inProgress:         WatchlistItem[];
  notWatchedRecently: WatchlistItem[];
  upToDate:           WatchlistItem[];
  watchLater:         WatchlistItem[];
  notStarted:         WatchlistItem[];
  stopped:            WatchlistItem[];
  completed:          WatchlistItem[];
}

function categorise(
  items: WatchlistItem[],
  summaries: SeriesWatchedSummary[],
  airedCountMap: Record<number, number>,
): Categorised {
  const map: Record<number, SeriesWatchedSummary> = {};
  summaries.forEach(s => { map[s.series_tmdb_id] = s; });

  const cutoff             = Date.now() - ONE_MONTH_MS;
  const inProgress:         WatchlistItem[] = [];
  const notWatchedRecently: WatchlistItem[] = [];
  const upToDate:           WatchlistItem[] = [];
  const watchLater:         WatchlistItem[] = [];
  const notStarted:         WatchlistItem[] = [];
  const stopped:            WatchlistItem[] = [];
  const completed:          WatchlistItem[] = [];

  items.forEach(item => {
    const status = item.user_status ?? '';

    if (status === 'stopped')     { stopped.push(item); return; }
    if (status === 'up_to_date')  { completed.push(item); return; }
    if (status === 'watch_later') { watchLater.push(item); return; }

    const s = map[item.tmdb_id];
    // Jamais commencé : se base sur le watched_count réel, pas sur le statut déclaratif
    if (!s || s.watched_count === 0) {
      if (airedCountMap[item.tmdb_id] === 0) return;
      notStarted.push(item); return;
    }
    if (s.total_episodes > 0 && s.watched_count >= s.total_episodes) {
      if (item.is_ended) { completed.push(item); return; }
      upToDate.push(item); return;
    }

    // À jour sur les épisodes diffusés → catégorie dédiée
    const airedCount = airedCountMap[item.tmdb_id];
    if (airedCount !== undefined && s.watched_count >= airedCount) {
      upToDate.push(item); return;
    }

    if (new Date(s.last_watched_at).getTime() >= cutoff) inProgress.push(item);
    else notWatchedRecently.push(item);
  });

  return { inProgress, notWatchedRecently, upToDate, watchLater, notStarted, stopped, completed };
}

// ─── Carte poster ─────────────────────────────────────────────────────────────

function PosterCard({ item, summary, airedCount }: {
  item: WatchlistItem; summary?: SeriesWatchedSummary; airedCount?: number;
}) {
  const navigation = useNavigation<Nav>();
  const uri = item.poster_path ? `${TMDB_IMG.poster_sm}${item.poster_path}` : null;
  const bar = getBar(item, summary, airedCount);

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: item.tmdb_id, mediaType: 'tv', title: item.title })}
    >
      <View style={styles.posterContainer}>
        {uri ? (
          <Image source={{ uri }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Ionicons name="tv-outline" size={28} color={C.muted} />
          </View>
        )}
        {bar && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${bar.pct}%` as any, backgroundColor: bar.color }]} />
          </View>
        )}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
    </TouchableOpacity>
  );
}

// ─── Section grille ───────────────────────────────────────────────────────────

function Section({
  title, items, summaryMap, accent, airedCountMap,
}: {
  title: string; items: WatchlistItem[];
  summaryMap: Record<number, SeriesWatchedSummary>;
  accent?: string;
  airedCountMap?: Record<number, number>;
}) {
  if (items.length === 0) return null;
  const rows = chunk(items, 3);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, accent ? { color: accent } : {}]}>{title}</Text>
        <View style={styles.countBadge}><Text style={styles.countText}>{items.length}</Text></View>
      </View>
      <View style={styles.grid}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.gridRow}>
            {row.map(item => (
              <PosterCard
                key={item.id} item={item}
                summary={summaryMap[item.tmdb_id]}
                airedCount={airedCountMap?.[item.tmdb_id]}
              />
            ))}
            {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => (
              <View key={`ph-${i}`} style={styles.cardSpacer} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Écran ────────────────────────────────────────────────────────────────────

export default function ProfileSeriesScreen() {
  const navigation              = useNavigation();
  const insets                  = useSafeAreaInsets();
  const { params }              = useRoute<Route>();
  const favoritesOnly           = params?.favoritesOnly ?? false;
  const username                = params?.username;

  const [items,         setItems]         = useState<WatchlistItem[]>([]);
  const [summaries,     setSummaries]     = useState<SeriesWatchedSummary[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(false);
  const [refreshing,    setRefreshing]    = useState(false);
  const [airedCountMap, setAiredCountMap] = useState<Record<number, number>>({});

  const fetchData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const getWatchlist  = username ? followsApi.getUserWatchlist(username, 'tv')  : watchlistApi.list('tv');
    const getSummary    = username ? followsApi.getUserSeriesSummary(username)     : watchedApi.seriesSummary();
    const getFavorites  = username ? followsApi.getUserFavorites(username, 'tv')   : favoritesApi.list('tv');

    const requests: Promise<any>[] = [getWatchlist, getSummary];
    if (favoritesOnly) requests.push(getFavorites);

    Promise.all(requests)
      .then(([wl, sum, favIds]) => {
        let allItems: WatchlistItem[] = wl.data;
        if (favoritesOnly && favIds) {
          const favSet = new Set<number>(favIds.data);
          allItems = allItems.filter(i => favSet.has(i.tmdb_id));
        }
        setItems(allItems);
        setSummaries(sum.data);
        setError(false);
      })
      .catch(() => { if (!isRefresh) setError(true); })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [favoritesOnly, username]);

  useEffect(() => { fetchData(false); }, [fetchData]);

  // Charger les airedCount (cache ou TMDB) pour les séries en cours
  useEffect(() => {
    if (items.length === 0 || summaries.length === 0) return;
    let cancelled = false;
    const now = Date.now();

    const sumMap: Record<number, SeriesWatchedSummary> = {};
    summaries.forEach(s => { sumMap[s.series_tmdb_id] = s; });
    const candidates = items.filter(item => {
      const status = item.user_status ?? '';
      if (status === 'stopped' || status === 'up_to_date' || status === 'watch_later') return false;
      const s = sumMap[item.tmdb_id];
      if (item.total_episodes > 0 && s && s.watched_count >= item.total_episodes) return false;
      return true;
    });
    if (candidates.length === 0) return;

    const keys = candidates.map(i => `@upcoming_tv_${i.tmdb_id}`);
    (async () => {
      try {
        const cached = await AsyncStorage.multiGet(keys);
        const map: Record<number, number> = {};
        const toFetch: WatchlistItem[] = [];

        const todayStr = new Date().toISOString().slice(0, 10);

        for (let i = 0; i < candidates.length; i++) {
          const raw = cached[i][1];
          if (raw) {
            try {
              const entry = JSON.parse(raw);
              if (now - entry.cachedAt <= UPCOMING_CACHE_TTL && entry.airedCount != null) {
                // Si l'épisode "prochain" sort aujourd'hui ou est déjà passé, le compter comme diffusé
                const airDate = entry.data?.airDate as string | undefined;
                const count   = (airDate && airDate <= todayStr) ? entry.airedCount + 1 : entry.airedCount;
                map[candidates[i].tmdb_id] = count;
                continue;
              }
            } catch {}
          }
          toFetch.push(candidates[i]);
        }
        if (!cancelled) setAiredCountMap({ ...map });

        for (const item of toFetch) {
          if (cancelled) break;
          try {
            const { data } = await axios.get(`${TMDB_BASE_URL}/tv/${item.tmdb_id}`, {
              params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
            });
            const nextEp = data.next_episode_to_air;
            const lastEp = data.last_episode_to_air;
            let aired = 0;
            if (!nextEp && !lastEp) {
              // Aucun épisode diffusé ET aucun planifié → série pas encore lancée
              aired = 0;
            } else if (!nextEp) {
              if (!item.is_ended && lastEp) {
                // Nouvelle saison annoncée avec 0 épisodes → calculer depuis le dernier épisode diffusé
                const lastSeason = lastEp.season_number as number;
                const lastEpNum  = lastEp.episode_number as number;
                const seasons    = (data.seasons ?? []) as { season_number: number; episode_count: number }[];
                for (const s of seasons) {
                  if (s.season_number <= 0) continue;
                  if (s.season_number < lastSeason) aired += s.episode_count;
                  else if (s.season_number === lastSeason) aired += lastEpNum;
                }
                await AsyncStorage.setItem(
                  `@upcoming_tv_${item.tmdb_id}`,
                  JSON.stringify({ data: null, airedCount: aired, cachedAt: now })
                );
                if (!cancelled) setAiredCountMap(prev => ({ ...prev, [item.tmdb_id]: aired }));
              }
              continue; // série terminée ou en pause indéfinie → pas de filtrage
            } else {
              const nextSeason = nextEp.season_number as number;
              const nextEpNum  = nextEp.episode_number as number;
              const seasons    = (data.seasons ?? []) as { season_number: number; episode_count: number }[];
              for (const s of seasons) {
                if (s.season_number <= 0) continue;
                if (s.season_number < nextSeason) aired += s.episode_count;
                else if (s.season_number === nextSeason) aired += nextEpNum - 1;
              }
            }
            const ep = data.next_episode_to_air;
            const freshData = ep?.air_date
              ? { seasonNumber: ep.season_number, episodeNumber: ep.episode_number, episodeName: ep.name ?? '', airDate: ep.air_date }
              : null;
            await AsyncStorage.setItem(
              `@upcoming_tv_${item.tmdb_id}`,
              JSON.stringify({ data: freshData, airedCount: aired, cachedAt: now })
            );
            const effectiveCount = (ep?.air_date && ep.air_date <= todayStr) ? aired + 1 : aired;
            if (!cancelled) setAiredCountMap(prev => ({ ...prev, [item.tmdb_id]: effectiveCount }));
          } catch {}
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [items, summaries]);

  const onRefresh = useCallback(() => fetchData(true), [fetchData]);

  const { inProgress, notWatchedRecently, upToDate, watchLater, notStarted, stopped, completed } =
    categorise(items, summaries, airedCountMap);
  const summaryMap: Record<number, SeriesWatchedSummary> = {};
  summaries.forEach(s => { summaryMap[s.series_tmdb_id] = s; });

  const byLastWatched = (a: WatchlistItem, b: WatchlistItem) => {
    const ta = summaryMap[a.tmdb_id]?.last_watched_at;
    const tb = summaryMap[b.tmdb_id]?.last_watched_at;
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return new Date(tb).getTime() - new Date(ta).getTime();
  };

  const isEmpty =
    inProgress.length === 0 && notWatchedRecently.length === 0 &&
    upToDate.length === 0   && watchLater.length === 0 &&
    notStarted.length === 0 && stopped.length === 0 && completed.length === 0;

  return (
    <View style={styles.root}>
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + 8 }]}
        onPress={() => navigation.goBack()}
        activeOpacity={0.8}
      >
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>

      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.headerTitle}>
          {username
            ? (favoritesOnly ? `Séries préférées de @${username}` : `Séries de @${username}`)
            : (favoritesOnly ? 'Séries préférées' : 'Mes séries')}
        </Text>
      </View>

      {loading && <View style={styles.centered}><ActivityIndicator size="large" color={C.primary} /></View>}

      {error && !loading && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={C.primary} />
          <Text style={styles.errorText}>Impossible de charger tes séries.</Text>
        </View>
      )}

      {!loading && !error && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        >
          {isEmpty && (
            <View style={styles.centered}>
              <Ionicons name={favoritesOnly ? 'heart-outline' : 'tv-outline'} size={60} color={C.border} />
              <Text style={styles.emptyTitle}>
                {favoritesOnly ? 'Aucune série préférée' : 'Aucune série'}
              </Text>
              <Text style={styles.emptyText}>
                {username
                  ? (favoritesOnly ? `@${username} n'a pas encore de séries préférées.` : `@${username} n'a pas encore de séries.`)
                  : (favoritesOnly ? 'Appuie sur le ❤️ d\'une série pour l\'ajouter ici.' : 'Explore et ajoute des séries pour les retrouver ici.')}
              </Text>
            </View>
          )}

          {favoritesOnly ? (
            // Mode favoris : grille plate sans catégories, triée par date d'ajout (desc)
            <View style={[styles.grid, { marginTop: 16 }]}>
              {chunk(items, 3).map((row, ri) => (
                <View key={ri} style={styles.gridRow}>
                  {row.map(item => (
                    <PosterCard
                      key={item.id} item={item}
                      summary={summaryMap[item.tmdb_id]}
                      airedCount={airedCountMap[item.tmdb_id]}
                    />
                  ))}
                  {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => (
                    <View key={`ph-${i}`} style={styles.cardSpacer} />
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <>
              <Section title="EN COURS"                      items={[...inProgress].sort(byLastWatched)}         summaryMap={summaryMap} airedCountMap={airedCountMap} />
              <Section title="PAS REGARDÉ DEPUIS UN MOMENT"  items={[...notWatchedRecently].sort(byLastWatched)} summaryMap={summaryMap} airedCountMap={airedCountMap} />
              <Section title="À JOUR"                        items={[...upToDate].sort(byLastWatched)}           summaryMap={summaryMap} airedCountMap={airedCountMap} accent={BAR_GREEN} />
              <Section title="À VOIR PLUS TARD"              items={watchLater}         summaryMap={summaryMap} />
              <Section title="PAS COMMENCÉ"                  items={notStarted}         summaryMap={summaryMap} />
              <Section title="SÉRIES TERMINÉES"              items={[...completed].sort(byLastWatched)}          summaryMap={summaryMap} accent={C.watched} />
              <Section title="ARRÊTÉES"                      items={[...stopped].sort(byLastWatched)}            summaryMap={summaryMap} accent={BAR_RED} />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  backBtn: {
    position: 'absolute', left: 16, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: 8,
  },

  header: {
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 56, paddingBottom: 14, alignItems: 'center',
  },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '700' },

  scroll: { paddingTop: 8 },

  section:       { marginTop: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: GRID_PAD, marginBottom: 12 },
  sectionTitle:  { color: C.text, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  countBadge:    { backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: C.border },
  countText:     { color: C.muted, fontSize: 11, fontWeight: '700' },

  grid:       { paddingHorizontal: GRID_PAD },
  gridRow:    { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP },
  cardSpacer: { width: CARD_W },

  card:              { width: CARD_W, gap: 6 },
  posterContainer:   { width: CARD_W, height: CARD_H, borderRadius: 8, overflow: 'hidden' },
  poster:            { width: CARD_W, height: CARD_H },
  posterPlaceholder: { backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  progressTrack:     { position: 'absolute', bottom: 0, left: 0, right: 0, height: 5, backgroundColor: 'rgba(0,0,0,0.4)' },
  progressFill:      { height: 5 },
  cardTitle:         { color: C.text, fontSize: 11, lineHeight: 15 },

  centered:   { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: 12, marginTop: 60 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  emptyText:  { color: C.muted, fontSize: 14, textAlign: 'center' },
  errorText:  { color: C.primary, fontSize: 14, textAlign: 'center' },
});
