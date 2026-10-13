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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { watchlistApi, watchedApi, WatchlistItem, SeriesWatchedSummary } from '../services/api';
import { RootStackParamList } from '../navigation/AppNavigator';
import { TMDB_IMG, TMDB_BASE_URL, TMDB_API_KEY } from '../config/tmdb';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useViewMode, ViewMode } from '../hooks/useViewMode';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const C = {
  bg:      '#1a1a2e',
  surface: '#16213e',
  card:    '#0f2942',
  primary: '#e94560',
  text:    '#ffffff',
  muted:   '#8892a4',
  border:  '#1f4068',
};

const { width: W } = Dimensions.get('window');
const GRID_PAD     = 16;
const GRID_GAP     = 8;
const CARD_W       = Math.floor((W - GRID_PAD * 2 - GRID_GAP * 2) / 3);
const CARD_H       = Math.floor(CARD_W * 1.5);

const ONE_MONTH_MS        = 30 * 24 * 60 * 60 * 1000;
const UPCOMING_CACHE_TTL  =  1 * 24 * 60 * 60 * 1000; // 1 jour
const BAR_YELLOW   = '#f0b429';
const BAR_GREEN    = '#16a34a';
const BAR_PURPLE   = '#7c3aed';
const DAYS_FR      = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

const BAR_RED = '#dc2626';

function getBar(item: WatchlistItem, summary?: SeriesWatchedSummary) {
  if (!summary || summary.watched_count === 0 || item.total_episodes === 0) return null;
  const pct = Math.min(100, Math.ceil((summary.watched_count / item.total_episodes) * 100));
  if ((item.user_status ?? '') === 'stopped') return { pct, color: BAR_RED };
  const color = summary.watched_count >= item.total_episodes
    ? (item.is_ended ? BAR_PURPLE : BAR_GREEN)
    : BAR_YELLOW;
  return { pct, color };
}

// ─── Helpers À venir ──────────────────────────────────────────────────────────

interface UpcomingEpisode {
  seriesId:      number;
  seriesName:    string;
  posterPath:    string | null;
  seasonNumber:  number;
  episodeNumber: number;
  episodeName:   string;
  airDate:       string;
  daysFromNow:   number;
}

interface DayGroup {
  label:       string;
  daysFromNow: number;
  items:       UpcomingEpisode[];
}

function computeDaysFromNow(airDateStr: string): number {
  const [y, m, d] = airDateStr.split('-').map(Number);
  const air   = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((air.getTime() - today.getTime()) / 86_400_000);
}

function dayLabel(n: number): string {
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return 'Demain';
  const d = new Date();
  d.setDate(d.getDate() + n);
  return DAYS_FR[d.getDay()];
}

function groupByDay(episodes: UpcomingEpisode[]): DayGroup[] {
  const byDay: Record<number, UpcomingEpisode[]> = {};
  const later: UpcomingEpisode[] = [];
  for (const ep of episodes) {
    if (ep.daysFromNow >= 7) later.push(ep);
    else (byDay[ep.daysFromNow] ??= []).push(ep);
  }
  const groups: DayGroup[] = [];
  for (let d = 0; d <= 6; d++) {
    if (byDay[d]?.length) groups.push({ label: dayLabel(d), daysFromNow: d, items: byDay[d] });
  }
  if (later.length) groups.push({ label: 'Plus tard', daysFromNow: 999, items: later });
  return groups;
}

// ─── Aired count (pour filtrer les séries à jour dans "À voir") ──────────────

function computeAiredCount(data: any, isEnded = true): number | null {
  const nextEp = data.next_episode_to_air;
  const lastEp = data.last_episode_to_air;
  const seasons = (data.seasons ?? []) as { season_number: number; episode_count: number }[];
  // Aucun épisode diffusé ET aucun planifié → série pas encore lancée
  if (!nextEp && !lastEp) return 0;
  if (!nextEp) {
    // Série non terminée (ex: nouvelle saison annoncée avec 0 épisodes) → calculer depuis le dernier épisode diffusé
    if (!isEnded && lastEp) {
      const lastSeason = lastEp.season_number as number;
      const lastEpNum  = lastEp.episode_number as number;
      let aired = 0;
      for (const s of seasons) {
        if (s.season_number <= 0) continue;
        if (s.season_number < lastSeason) aired += s.episode_count;
        else if (s.season_number === lastSeason) aired += lastEpNum;
      }
      return aired;
    }
    // Série terminée ou en pause indéfinie
    return null;
  }
  const nextSeason = nextEp.season_number as number;
  const nextEpNum  = nextEp.episode_number as number;
  let aired = 0;
  for (const s of seasons) {
    if (s.season_number <= 0) continue;
    if (s.season_number < nextSeason) aired += s.episode_count;
    else if (s.season_number === nextSeason) aired += nextEpNum - 1;
  }
  return aired;
}

// ─── Catégorisation À voir ────────────────────────────────────────────────────

interface CategorisedSeries {
  inProgress:         WatchlistItem[];
  notWatchedRecently: WatchlistItem[];
  watchLater:         WatchlistItem[];
  notStarted:         WatchlistItem[];
}

function categorise(
  items: WatchlistItem[],
  summaries: SeriesWatchedSummary[],
  airedCountMap: Record<number, number>,
): CategorisedSeries {
  const map: Record<number, SeriesWatchedSummary> = {};
  summaries.forEach(s => { map[s.series_tmdb_id] = s; });
  const cutoff             = Date.now() - ONE_MONTH_MS;
  const inProgress:         WatchlistItem[] = [];
  const notWatchedRecently: WatchlistItem[] = [];
  const watchLater:         WatchlistItem[] = [];
  const notStarted:         WatchlistItem[] = [];

  items.forEach(item => {
    const status = item.user_status ?? '';

    // Exclure les séries arrêtées et celles dont l'utilisateur est à jour
    if (status === 'stopped' || status === 'up_to_date') return;

    // À voir plus tard
    if (status === 'watch_later') { watchLater.push(item); return; }

    const s = map[item.tmdb_id];

    // Jamais commencé : se base sur le watched_count réel, pas sur le statut déclaratif
    if (!s || s.watched_count === 0) {
      // Masquer si aucun épisode n'est encore sorti (série annoncée mais pas diffusée)
      if (airedCountMap[item.tmdb_id] === 0) return;
      notStarted.push(item); return;
    }

    // Toutes les épisodes vus → on n'affiche plus ici
    if (s.total_episodes > 0 && s.watched_count >= s.total_episodes) return;

    // À jour par rapport aux épisodes déjà diffusés → masquer (prochain ep pas encore sorti)
    const airedCount = airedCountMap[item.tmdb_id];
    if (airedCount !== undefined && s.watched_count >= airedCount) return;

    // En cours : vu récemment ou non
    if (new Date(s.last_watched_at).getTime() >= cutoff) inProgress.push(item);
    else notWatchedRecently.push(item);
  });

  return { inProgress, notWatchedRecently, watchLater, notStarted };
}

// ─── Carte poster (grille) ────────────────────────────────────────────────────

function PosterCard({ item, summary }: { item: WatchlistItem; summary?: SeriesWatchedSummary }) {
  const navigation = useNavigation<Nav>();
  const uri = item.poster_path ? `${TMDB_IMG.poster_sm}${item.poster_path}` : null;
  const bar = getBar(item, summary);
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: item.tmdb_id, mediaType: 'tv', title: item.title })}
    >
      <View style={styles.posterContainer}>
        {uri
          ? <Image source={{ uri }} style={styles.poster} />
          : <View style={[styles.poster, styles.posterPlaceholder]}><Ionicons name="tv-outline" size={28} color={C.muted} /></View>}
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

// ─── Carte ligne — À voir (mode liste) ───────────────────────────────────────

interface NextEp { season: number; episode: number; title: string }

function SeriesRowCard({
  item,
  summary,
  onMarked,
}: {
  item: WatchlistItem;
  summary?: SeriesWatchedSummary;
  onMarked?: () => void;
}) {
  const navigation = useNavigation<Nav>();
  const uri = item.poster_path ? `${TMDB_IMG.poster_sm}${item.poster_path}` : null;

  const [nextEp,     setNextEp]     = useState<NextEp | null>(null);
  const [marking,    setMarking]    = useState(false);
  const [justMarked, setJustMarked] = useState(false);

  const lastSeason  = summary?.last_watched_season  ?? 0;
  const lastEpisode = summary?.last_watched_episode ?? 0;
  const hasWatched  = (summary?.watched_count ?? 0) > 0;

  // Fetch du prochain épisode depuis TMDB (avec cache AsyncStorage)
  useEffect(() => {
    if (!hasWatched || lastSeason === 0) { setNextEp(null); return; }

    const cacheKey = `@ep_next_${item.tmdb_id}_${lastSeason}_${lastEpisode}`;
    let cancelled = false;

    (async () => {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        try { if (!cancelled) setNextEp(JSON.parse(cached)); return; } catch {}
      }

      const tryFetch = async (season: number, episode: number): Promise<NextEp> => {
        const { data } = await axios.get(
          `${TMDB_BASE_URL}/tv/${item.tmdb_id}/season/${season}/episode/${episode}`,
          { params: { api_key: TMDB_API_KEY, language: 'fr-FR' } },
        );
        return { season, episode, title: data.name ?? `Épisode ${episode}` };
      };

      try {
        const ep = await tryFetch(lastSeason, lastEpisode + 1);
        if (!cancelled) { setNextEp(ep); AsyncStorage.setItem(cacheKey, JSON.stringify(ep)); }
      } catch {
        try {
          const ep = await tryFetch(lastSeason + 1, 1);
          if (!cancelled) { setNextEp(ep); AsyncStorage.setItem(cacheKey, JSON.stringify(ep)); }
        } catch {
          if (!cancelled) setNextEp(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [item.tmdb_id, lastSeason, lastEpisode, hasWatched]);

  const handleMark = async () => {
    if (!nextEp || marking) return;
    setMarking(true);
    try {
      await watchedApi.markEpisode(item.tmdb_id, nextEp.season, nextEp.episode);
      setJustMarked(true);
      AsyncStorage.removeItem(`@ep_next_${item.tmdb_id}_${lastSeason}_${lastEpisode}`);
      onMarked?.();
      setTimeout(() => setJustMarked(false), 1500);
    } catch {}
    finally { setMarking(false); }
  };

  const hasMore = (summary?.watched_count ?? 0) < (item.total_episodes || Infinity);
  const showNextEp = hasWatched && hasMore && nextEp !== null;

  const epCode   = nextEp ? `S${String(nextEp.season).padStart(2, '0')}E${String(nextEp.episode).padStart(2, '0')}` : '';
  const subtitle = !hasWatched
    ? 'Pas commencé'
    : showNextEp
    ? `${epCode} · ${nextEp!.title}`
    : `${summary!.watched_count} / ${item.total_episodes || summary!.total_episodes} épisodes`;

  return (
    <TouchableOpacity
      style={styles.rowCard}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: item.tmdb_id, mediaType: 'tv', title: item.title })}
    >
      {uri
        ? <Image source={{ uri }} style={styles.rowPoster} />
        : <View style={[styles.rowPoster, styles.rowPosterPlaceholder]}><Ionicons name="tv-outline" size={18} color={C.muted} /></View>}
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{subtitle}</Text>
      </View>
      {showNextEp && (
        <TouchableOpacity onPress={handleMark} style={styles.checkBtn} activeOpacity={0.7} disabled={marking}>
          {marking
            ? <ActivityIndicator size="small" color={C.text} />
            : <Ionicons
                name={justMarked ? 'checkmark-circle' : 'checkmark-circle-outline'}
                size={28}
                color={justMarked ? BAR_GREEN : C.text}
              />
          }
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ─── Carte poster — À venir (mode grille) ────────────────────────────────────

function UpcomingPosterCard({ ep }: { ep: UpcomingEpisode }) {
  const navigation = useNavigation<Nav>();
  const uri = ep.posterPath ? `${TMDB_IMG.poster_sm}${ep.posterPath}` : null;
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: ep.seriesId, mediaType: 'tv', title: ep.seriesName })}
    >
      <View style={styles.posterContainer}>
        {uri
          ? <Image source={{ uri }} style={styles.poster} />
          : <View style={[styles.poster, styles.posterPlaceholder]}><Ionicons name="tv-outline" size={28} color={C.muted} /></View>}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{ep.seriesName}</Text>
    </TouchableOpacity>
  );
}

// ─── Carte épisode (liste) ────────────────────────────────────────────────────

function EpisodeCard({ ep, showDays }: { ep: UpcomingEpisode; showDays: boolean }) {
  const navigation = useNavigation<Nav>();
  const uri = ep.posterPath ? `${TMDB_IMG.poster_sm}${ep.posterPath}` : null;
  const epCode = `S${ep.seasonNumber.toString().padStart(2, '0')}E${ep.episodeNumber.toString().padStart(2, '0')}`;
  return (
    <TouchableOpacity
      style={styles.epCard}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: ep.seriesId, mediaType: 'tv', title: ep.seriesName })}
    >
      {uri
        ? <Image source={{ uri }} style={styles.epPoster} />
        : <View style={[styles.epPoster, styles.epPosterPlaceholder]}><Ionicons name="tv-outline" size={18} color={C.muted} /></View>}
      <View style={styles.epInfo}>
        <Text style={styles.epSeries} numberOfLines={1}>{ep.seriesName}</Text>
        <Text style={styles.epMeta} numberOfLines={1}>{epCode}{ep.episodeName ? ` · ${ep.episodeName}` : ''}</Text>
      </View>
      {showDays && (
        <View style={styles.daysTag}><Text style={styles.daysText}>Dans {ep.daysFromNow}j</Text></View>
      )}
    </TouchableOpacity>
  );
}

// ─── Grille 3 colonnes ────────────────────────────────────────────────────────

function Grid<T>({ items, renderItem, keyExtractor }: {
  items: T[];
  renderItem: (item: T) => React.ReactElement;
  keyExtractor: (item: T) => string;
}) {
  const rows = chunk(items, 3);
  return (
    <View style={styles.grid}>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.gridRow}>
          {row.map(item => renderItem(item))}
          {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => (
            <View key={`ph-${i}`} style={styles.cardSpacer} />
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Section À voir ───────────────────────────────────────────────────────────

function Section({
  title, items, summaryMap, viewMode, toggle, onMarked,
}: {
  title: string; items: WatchlistItem[];
  summaryMap: Record<number, SeriesWatchedSummary>;
  viewMode: ViewMode;
  toggle?: React.ReactNode;
  onMarked?: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.countBadge}><Text style={styles.countText}>{items.length}</Text></View>
        {toggle && <View style={{ marginLeft: 'auto' }}>{toggle}</View>}
      </View>
      {viewMode === 'grid' ? (
        <Grid
          items={items}
          keyExtractor={i => i.id}
          renderItem={item => <PosterCard key={item.id} item={item} summary={summaryMap[item.tmdb_id]} />}
        />
      ) : (
        <View style={styles.vertList}>
          {items.map(item => (
            <SeriesRowCard key={item.id} item={item} summary={summaryMap[item.tmdb_id]} onMarked={onMarked} />
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Section journée — À venir ────────────────────────────────────────────────

function DaySection({ group, viewMode, toggle }: { group: DayGroup; viewMode: ViewMode; toggle?: React.ReactNode }) {
  const isLater = group.daysFromNow === 999;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{group.label}</Text>
        <View style={styles.countBadge}><Text style={styles.countText}>{group.items.length}</Text></View>
        {toggle && <View style={{ marginLeft: 'auto' }}>{toggle}</View>}
      </View>
      {viewMode === 'list' ? (
        <View style={styles.epList}>
          {group.items.map(ep => (
            <EpisodeCard
              key={`${ep.seriesId}-${ep.seasonNumber}-${ep.episodeNumber}`}
              ep={ep}
              showDays={isLater}
            />
          ))}
        </View>
      ) : (
        <Grid
          items={group.items}
          keyExtractor={ep => `${ep.seriesId}-${ep.seasonNumber}-${ep.episodeNumber}`}
          renderItem={ep => <UpcomingPosterCard key={`${ep.seriesId}-${ep.seasonNumber}-${ep.episodeNumber}`} ep={ep} />}
        />
      )}
    </View>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

type Tab = 'voir' | 'avenir';

export default function SeriesScreen() {
  const [tab,             setTab]             = useState<Tab>('voir');
  const [items,           setItems]           = useState<WatchlistItem[]>([]);
  const [summaries,       setSummaries]       = useState<SeriesWatchedSummary[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(false);

  const [upcoming,        setUpcoming]        = useState<UpcomingEpisode[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [upcomingLoaded,  setUpcomingLoaded]  = useState(false);
  const [upcomingProgress, setUpcomingProgress] = useState(0);
  const [refreshing,      setRefreshing]      = useState(false);

  const [airedCountMap,  setAiredCountMap]  = useState<Record<number, number>>({});

  const [viewModeAvoir,  toggleAvoir]  = useViewMode('pref_series_voir',   'grid');
  const [viewModeAvenir, toggleAvenir] = useViewMode('pref_series_avenir', 'list');

  const currentViewMode = tab === 'voir' ? viewModeAvoir : viewModeAvenir;
  const currentToggle   = tab === 'voir' ? toggleAvoir   : toggleAvenir;

  const loadData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else { setLoading(true); setError(false); }
    setUpcomingLoaded(false);
    setUpcoming([]);
    setUpcomingLoading(false);
    setUpcomingProgress(0);
    Promise.all([watchlistApi.list('tv'), watchedApi.seriesSummary()])
      .then(([wl, sum]) => { setItems(wl.data); setSummaries(sum.data); })
      .catch(() => { if (!isRefresh) setError(true); })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useFocusEffect(useCallback(() => { loadData(false); }, [loadData]));

  // Charger les airedCount (cache ou TMDB) pour filtrer "À voir"
  useEffect(() => {
    if (items.length === 0 || summaries.length === 0) return;

    let cancelled = false;
    const now = Date.now();

    // Séries en cours + pas commencées (pour détecter celles pas encore diffusées)
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

        // Fetch TMDB en arrière-plan pour les entrées manquantes ou sans airedCount
        for (const item of toFetch) {
          if (cancelled) break;
          try {
            const { data } = await axios.get(`${TMDB_BASE_URL}/tv/${item.tmdb_id}`, {
              params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
            });
            const airedCount = computeAiredCount(data, item.is_ended);
            if (airedCount == null) continue;

            const ep = data.next_episode_to_air;
            const freshData = ep?.air_date
              ? { seasonNumber: ep.season_number, episodeNumber: ep.episode_number, episodeName: ep.name ?? '', airDate: ep.air_date }
              : null;
            await AsyncStorage.setItem(
              `@upcoming_tv_${item.tmdb_id}`,
              JSON.stringify({ data: freshData, airedCount, cachedAt: now })
            );

            const effectiveCount = (ep?.air_date && ep.air_date <= todayStr) ? airedCount + 1 : airedCount;
            if (!cancelled) setAiredCountMap(prev => ({ ...prev, [item.tmdb_id]: effectiveCount }));
          } catch {}
        }
      } catch {}
    })();

    return () => { cancelled = true; };
  }, [items, summaries]);

  const onRefresh = useCallback(() => loadData(true), [loadData]);

  const handleEpisodeMarked = useCallback(() => {
    watchedApi.seriesSummary()
      .then(res => setSummaries(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'avenir' || loading || upcomingLoaded || upcomingLoading) return;
    if (items.length === 0) { setUpcomingLoaded(true); return; }

    setUpcomingLoading(true);
    let cancelled = false;

    // Exclure les séries arrêtées du calendrier À venir
    const activeItems = items.filter(i => (i.user_status ?? '') !== 'stopped');
    const cacheKeys   = activeItems.map(i => `@upcoming_tv_${i.tmdb_id}`);
    const now         = Date.now();

    (async () => {
      try {
        // 1. Lecture en batch du cache
        const cached = await AsyncStorage.multiGet(cacheKeys);
        const results: UpcomingEpisode[] = [];
        const toFetch: WatchlistItem[]   = [];

        for (let idx = 0; idx < activeItems.length; idx++) {
          const item     = activeItems[idx];
          const rawEntry = cached[idx][1];

          if (rawEntry) {
            const entry: {
              data: { seasonNumber: number; episodeNumber: number; episodeName: string; airDate: string } | null;
              cachedAt: number;
            } = JSON.parse(rawEntry);

            if (now - entry.cachedAt <= UPCOMING_CACHE_TTL) {
              if (entry.data) {
                const daysFromNow = computeDaysFromNow(entry.data.airDate);
                if (daysFromNow >= 0) {
                  // Épisode encore à venir — cache valide
                  results.push({
                    seriesId: item.tmdb_id, seriesName: item.title, posterPath: item.poster_path,
                    seasonNumber: entry.data.seasonNumber, episodeNumber: entry.data.episodeNumber,
                    episodeName: entry.data.episodeName, airDate: entry.data.airDate, daysFromNow,
                  });
                  continue;
                }
                // L'épisode en cache est passé → re-fetch pour trouver le prochain
              } else {
                // Pas d'épisode prochain connu — re-vérifier quotidiennement au cas où TMDB se met à jour
                continue; // Pas d'épisode connu, cache valide 1 jour
              }
            }
          }
          // Absent ou périmé → à fetcher
          toFetch.push(item);
        }

        // 2. Fetch des entrées manquantes/périmées
        const total      = activeItems.length;
        let   doneCount  = activeItems.length - toFetch.length;
        if (!cancelled) setUpcomingProgress(total > 0 ? doneCount / total : 1);

        const fetched = await Promise.allSettled(
          toFetch.map(async item => {
            try {
              const { data } = await axios.get(`${TMDB_BASE_URL}/tv/${item.tmdb_id}`, {
                params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
              });
              const ep = data.next_episode_to_air;
              const entryData = ep?.air_date
                ? { seasonNumber: ep.season_number, episodeNumber: ep.episode_number, episodeName: ep.name ?? '', airDate: ep.air_date }
                : null;
              const airedCount = computeAiredCount(data, item.is_ended);

              await AsyncStorage.setItem(
                `@upcoming_tv_${item.tmdb_id}`,
                JSON.stringify({ data: entryData, airedCount, cachedAt: now })
              );

              if (!entryData) return null;
              const daysFromNow = computeDaysFromNow(entryData.airDate);
              if (daysFromNow < 0) return null;
              return {
                seriesId: item.tmdb_id, seriesName: item.title, posterPath: item.poster_path,
                ...entryData, daysFromNow,
              } as UpcomingEpisode;
            } catch { return null; }
            finally {
              doneCount++;
              if (!cancelled) setUpcomingProgress(total > 0 ? doneCount / total : 1);
            }
          })
        );

        if (cancelled) return;

        const freshEps = fetched
          .filter((r): r is PromiseFulfilledResult<UpcomingEpisode> => r.status === 'fulfilled' && r.value !== null)
          .map(r => r.value);

        const all = [...results, ...freshEps]
          .sort((a, b) => a.daysFromNow - b.daysFromNow || a.seriesName.localeCompare(b.seriesName));

        setUpcoming(all);
      } catch {
        if (!cancelled) setUpcoming([]);
      } finally {
        if (!cancelled) {
          setUpcomingLoaded(true);
          setUpcomingLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [tab, loading, upcomingLoaded, items]); // upcomingLoading exclu volontairement : l'inclure cause une race condition

  const { inProgress, notWatchedRecently, watchLater, notStarted } = categorise(items, summaries, airedCountMap);
  const summaryMap: Record<number, SeriesWatchedSummary> = {};
  summaries.forEach(s => { summaryMap[s.series_tmdb_id] = s; });
  const groups = groupByDay(upcoming);

  const toggleBtn = (
    <TouchableOpacity style={styles.viewToggleBtn} onPress={currentToggle} activeOpacity={0.8}>
      <Ionicons
        name={currentViewMode === 'grid' ? 'list-outline' : 'grid-outline'}
        size={18}
        color={C.text}
      />
    </TouchableOpacity>
  );
  const voirCategories = [inProgress, notWatchedRecently, watchLater, notStarted];
  const firstVoirIdx   = voirCategories.findIndex(arr => arr.length > 0);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* ── Onglets ── */}
      <View style={styles.tabs}>
        {(['voir', 'avenir'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'voir' ? 'À VOIR' : 'À VENIR'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && <View style={styles.centered}><ActivityIndicator size="large" color={C.primary} /></View>}
      {error && !loading && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={C.primary} />
          <Text style={styles.errorText}>Impossible de charger tes séries.</Text>
        </View>
      )}

      {/* ── À VOIR ── */}
      {!loading && !error && tab === 'voir' && (
        items.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="tv-outline" size={60} color={C.border} />
            <Text style={styles.emptyTitle}>Aucune série</Text>
            <Text style={styles.emptyText}>Explore et ajoute des séries pour les retrouver ici.</Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          >
            <Section title="À VOIR"                       items={inProgress}         summaryMap={summaryMap} viewMode={viewModeAvoir} toggle={firstVoirIdx === 0 ? toggleBtn : undefined} onMarked={handleEpisodeMarked} />
            <Section title="Pas regardé depuis un moment" items={notWatchedRecently} summaryMap={summaryMap} viewMode={viewModeAvoir} toggle={firstVoirIdx === 1 ? toggleBtn : undefined} onMarked={handleEpisodeMarked} />
            <Section title="À voir plus tard"             items={watchLater}         summaryMap={summaryMap} viewMode={viewModeAvoir} toggle={firstVoirIdx === 2 ? toggleBtn : undefined} onMarked={handleEpisodeMarked} />
            <Section title="Pas commencé"                 items={notStarted}         summaryMap={summaryMap} viewMode={viewModeAvoir} toggle={firstVoirIdx === 3 ? toggleBtn : undefined} onMarked={handleEpisodeMarked} />
          </ScrollView>
        )
      )}

      {/* ── À VENIR ── */}
      {!loading && !error && tab === 'avenir' && (
        upcomingLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.emptyText}>
              Récupération des épisodes… {Math.round(upcomingProgress * 100)}%
            </Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.round(upcomingProgress * 100)}%` as any }]} />
            </View>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="tv-outline" size={60} color={C.border} />
            <Text style={styles.emptyTitle}>Aucune série</Text>
            <Text style={styles.emptyText}>Ajoute des séries pour voir leurs prochains épisodes.</Text>
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="calendar-outline" size={60} color={C.border} />
            <Text style={styles.emptyTitle}>Aucun épisode à venir</Text>
            <Text style={styles.emptyText}>Toutes tes séries sont à jour ou terminées.</Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          >
            {groups.map((group, idx) => <DaySection key={group.label} group={group} viewMode={viewModeAvenir} toggle={idx === 0 ? toggleBtn : undefined} />)}
          </ScrollView>
        )
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },

  tabs: {
    flexDirection: 'row', backgroundColor: C.surface,
    marginHorizontal: 12, marginTop: 12,
    borderRadius: 10, padding: 4,
    borderWidth: 1, borderColor: C.border,
  },
  tab:           { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 7 },
  tabActive:     { backgroundColor: C.primary },
  tabText:       { color: C.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  tabTextActive: { color: C.text },

  viewToggleBtn: {
    backgroundColor: C.surface, borderRadius: 10,
    padding: 8, borderWidth: 1, borderColor: C.border,
  },

  scrollContent: { paddingBottom: 32 },

  section:       { marginTop: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: GRID_PAD, marginBottom: 12 },
  sectionTitle:  { color: C.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  countBadge:    { backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: C.border },
  countText:     { color: C.muted, fontSize: 11, fontWeight: '700' },

  // Grille 3 colonnes
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

  // Carte ligne (mode liste)
  vertList: { paddingHorizontal: GRID_PAD, gap: 8 },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, padding: 10,
  },
  rowPoster:            { width: 50, height: 75, borderRadius: 6 },
  rowPosterPlaceholder: { backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  rowInfo:  { flex: 1, gap: 4, minWidth: 0 },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  rowMeta:  { color: C.muted, fontSize: 12 },
  checkBtn: { padding: 6 },

  // Carte épisode (liste À venir)
  epList: { paddingHorizontal: GRID_PAD, gap: 8 },
  epCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, padding: 10,
  },
  epPoster:            { width: 50, height: 75, borderRadius: 6 },
  epPosterPlaceholder: { backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  epInfo:   { flex: 1, gap: 4 },
  epSeries: { color: C.text, fontSize: 14, fontWeight: '700' },
  epMeta:   { color: C.muted, fontSize: 12 },
  daysTag:  { backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  daysText: { color: C.muted, fontSize: 11, fontWeight: '700' },

  centered:   { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  emptyText:  { color: C.muted, fontSize: 14, textAlign: 'center' },
  errorText:  { color: C.primary, fontSize: 14, textAlign: 'center' },

  progressBarTrack: { width: '70%', height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  progressBarFill:  { height: 4, backgroundColor: C.primary, borderRadius: 2 },
});
