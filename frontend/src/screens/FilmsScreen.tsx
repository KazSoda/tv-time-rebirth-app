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
import { watchlistApi, watchedApi, WatchlistItem } from '../services/api';
import { RootStackParamList } from '../navigation/AppNavigator';
import { TMDB_IMG, TMDB_BASE_URL, TMDB_API_KEY } from '../config/tmdb';
import { useViewMode, ViewMode } from '../hooks/useViewMode';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

const DAYS_FR             = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const UPCOMING_CACHE_TTL  =  1 * 24 * 60 * 60 * 1000; // 1 jour

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── Helpers À venir ──────────────────────────────────────────────────────────

interface UpcomingMovie {
  tmdbId:      number;
  title:       string;
  posterPath:  string | null;
  releaseDate: string;
  daysFromNow: number;
}

interface DayGroup {
  label:       string;
  daysFromNow: number;
  items:       UpcomingMovie[];
}

function computeDaysFromNow(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const release = new Date(y, m - 1, d);
  const today   = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((release.getTime() - today.getTime()) / 86_400_000);
}

function dayLabel(n: number): string {
  if (n === 1) return 'Demain';
  const d = new Date();
  d.setDate(d.getDate() + n);
  return DAYS_FR[d.getDay()];
}

function groupByDay(movies: UpcomingMovie[]): DayGroup[] {
  const byDay: Record<number, UpcomingMovie[]> = {};
  const later: UpcomingMovie[] = [];
  for (const m of movies) {
    if (m.daysFromNow >= 7) later.push(m);
    else (byDay[m.daysFromNow] ??= []).push(m);
  }
  const groups: DayGroup[] = [];
  for (let d = 1; d <= 6; d++) {
    if (byDay[d]?.length) groups.push({ label: dayLabel(d), daysFromNow: d, items: byDay[d] });
  }
  if (later.length) groups.push({ label: 'Plus tard', daysFromNow: 999, items: later });
  return groups;
}

// ─── Grille 3 colonnes générique ──────────────────────────────────────────────

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

// ─── Carte film (grille) ──────────────────────────────────────────────────────

function FilmGridCard({ item }: { item: WatchlistItem }) {
  const navigation = useNavigation<Nav>();
  const uri = item.poster_path ? `${TMDB_IMG.poster_sm}${item.poster_path}` : null;
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: item.tmdb_id, mediaType: 'movie', title: item.title })}
    >
      <View style={styles.posterContainer}>
        {uri ? (
          <Image source={{ uri }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Ionicons name="film-outline" size={28} color={C.muted} />
          </View>
        )}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
    </TouchableOpacity>
  );
}

// ─── Carte film (ligne) ───────────────────────────────────────────────────────

function FilmRowCard({ item }: { item: WatchlistItem }) {
  const navigation = useNavigation<Nav>();
  const uri = item.poster_path ? `${TMDB_IMG.poster_sm}${item.poster_path}` : null;
  return (
    <TouchableOpacity
      style={styles.rowCard}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: item.tmdb_id, mediaType: 'movie', title: item.title })}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.rowPoster} />
      ) : (
        <View style={[styles.rowPoster, styles.rowPosterPlaceholder]}>
          <Ionicons name="film-outline" size={18} color={C.muted} />
        </View>
      )}
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Carte film (liste — À venir) ─────────────────────────────────────────────

function UpcomingFilmListCard({ movie, showDays }: { movie: UpcomingMovie; showDays: boolean }) {
  const navigation = useNavigation<Nav>();
  const uri = movie.posterPath ? `${TMDB_IMG.poster_sm}${movie.posterPath}` : null;
  return (
    <TouchableOpacity
      style={styles.rowCard}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: movie.tmdbId, mediaType: 'movie', title: movie.title })}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.rowPoster} />
      ) : (
        <View style={[styles.rowPoster, styles.rowPosterPlaceholder]}>
          <Ionicons name="film-outline" size={18} color={C.muted} />
        </View>
      )}
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={2}>{movie.title}</Text>
        <Text style={styles.rowMeta}>{movie.releaseDate}</Text>
      </View>
      {showDays && (
        <View style={styles.daysTag}><Text style={styles.daysText}>Dans {movie.daysFromNow}j</Text></View>
      )}
    </TouchableOpacity>
  );
}

// ─── Carte film (grille — À venir) ────────────────────────────────────────────

function UpcomingFilmGridCard({ movie }: { movie: UpcomingMovie }) {
  const navigation = useNavigation<Nav>();
  const uri = movie.posterPath ? `${TMDB_IMG.poster_sm}${movie.posterPath}` : null;
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: movie.tmdbId, mediaType: 'movie', title: movie.title })}
    >
      <View style={styles.posterContainer}>
        {uri ? (
          <Image source={{ uri }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Ionicons name="film-outline" size={28} color={C.muted} />
          </View>
        )}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{movie.title}</Text>
    </TouchableOpacity>
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
        <View style={styles.vertList}>
          {group.items.map(movie => (
            <UpcomingFilmListCard key={movie.tmdbId} movie={movie} showDays={isLater} />
          ))}
        </View>
      ) : (
        <Grid
          items={group.items}
          keyExtractor={m => String(m.tmdbId)}
          renderItem={m => <UpcomingFilmGridCard key={m.tmdbId} movie={m} />}
        />
      )}
    </View>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

type Tab = 'voir' | 'avenir';

export default function FilmsScreen() {
  const [tab,             setTab]             = useState<Tab>('voir');
  const [items,           setItems]           = useState<WatchlistItem[]>([]);
  const [watchedIds,      setWatchedIds]      = useState<Set<number>>(new Set());
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(false);

  const [upcoming,        setUpcoming]        = useState<UpcomingMovie[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [upcomingLoaded,  setUpcomingLoaded]  = useState(false);
  const [upcomingProgress, setUpcomingProgress] = useState(0);
  const [refreshing,      setRefreshing]      = useState(false);

  const [releaseDateSupp, setReleaseDateSupp] = useState<Record<number, string>>({});

  const [viewModeAvoir,  toggleAvoir]  = useViewMode('pref_films_voir',   'grid');
  const [viewModeAvenir, toggleAvenir] = useViewMode('pref_films_avenir', 'list');

  const currentViewMode = tab === 'voir' ? viewModeAvoir : viewModeAvenir;
  const currentToggle   = tab === 'voir' ? toggleAvoir   : toggleAvenir;

  const loadData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else { setLoading(true); setError(false); }
    setUpcomingLoaded(false);
    setUpcoming([]);
    setUpcomingLoading(false);
    setUpcomingProgress(0);
    Promise.all([watchlistApi.list('movie'), watchedApi.watchedMovies()])
      .then(([wl, watched]) => {
        setItems(wl.data);
        setWatchedIds(new Set(watched.data));
      })
      .catch(() => { if (!isRefresh) setError(true); })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useFocusEffect(useCallback(() => { loadData(false); }, [loadData]));

  // Compléter les release_date manquantes depuis le cache À venir ou TMDB
  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const needsDates = items.filter(i => !i.release_date);
    if (needsDates.length === 0) return;

    const keys = needsDates.map(i => `@upcoming_movie_${i.tmdb_id}`);
    (async () => {
      const now    = Date.now();
      const cached = await AsyncStorage.multiGet(keys).catch(() => [] as [string, string | null][]);
      const map: Record<number, string> = {};
      const toFetch: WatchlistItem[] = [];
      for (let i = 0; i < needsDates.length; i++) {
        const raw = cached[i]?.[1];
        if (raw) {
          try {
            const entry = JSON.parse(raw);
            // Utiliser le cache seulement s'il est récent et que la date est encore dans le futur
            if (entry.releaseDate && now - entry.cachedAt <= UPCOMING_CACHE_TTL) {
              const daysFromNow = computeDaysFromNow(entry.releaseDate);
              if (daysFromNow >= 1) { map[needsDates[i].tmdb_id] = entry.releaseDate; continue; }
            }
          } catch {}
        }
        toFetch.push(needsDates[i]);
      }
      if (!cancelled) setReleaseDateSupp({ ...map });

      for (const item of toFetch) {
        if (cancelled) break;
        try {
          const { data } = await axios.get(`${TMDB_BASE_URL}/movie/${item.tmdb_id}`, {
            params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
          });
          const rd = data.release_date as string | undefined;
          if (!rd) continue;
          await AsyncStorage.setItem(`@upcoming_movie_${item.tmdb_id}`, JSON.stringify({ releaseDate: rd, cachedAt: Date.now() }));
          if (!cancelled) setReleaseDateSupp(prev => ({ ...prev, [item.tmdb_id]: rd }));
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [items]);

  const onRefresh = useCallback(() => loadData(true), [loadData]);

  useEffect(() => {
    if (tab !== 'avenir' || loading || upcomingLoaded || upcomingLoading) return;
    if (items.length === 0) { setUpcomingLoaded(true); return; }

    setUpcomingLoading(true);
    let cancelled = false;

    const cacheKeys = items.map(i => `@upcoming_movie_${i.tmdb_id}`);
    const now       = Date.now();

    (async () => {
      try {
        // 1. Lecture en batch du cache
        const cached = await AsyncStorage.multiGet(cacheKeys);
        const results: UpcomingMovie[] = [];
        const toFetch: WatchlistItem[] = [];

        for (let idx = 0; idx < items.length; idx++) {
          const item     = items[idx];
          const rawEntry = cached[idx][1];

          if (rawEntry) {
            const entry: { releaseDate: string | null; cachedAt: number } = JSON.parse(rawEntry);

            if (now - entry.cachedAt <= UPCOMING_CACHE_TTL) {
              if (entry.releaseDate) {
                const daysFromNow = computeDaysFromNow(entry.releaseDate);
                if (daysFromNow >= 1) {
                  // Sortie encore à venir — cache valide
                  results.push({
                    tmdbId: item.tmdb_id, title: item.title,
                    posterPath: item.poster_path || null,
                    releaseDate: entry.releaseDate, daysFromNow,
                  });
                  continue;
                }
                // Date passée → re-fetch (date peut avoir été repoussée)
              } else {
                continue; // Pas de date connue, cache valide 1 jour
              }
            }
          }
          toFetch.push(item);
        }

        // 2. Fetch des entrées manquantes/périmées
        const total     = items.length;
        let   doneCount = items.length - toFetch.length;
        if (!cancelled) setUpcomingProgress(total > 0 ? doneCount / total : 1);

        const fetched = await Promise.allSettled(
          toFetch.map(async item => {
            try {
              const { data } = await axios.get(`${TMDB_BASE_URL}/movie/${item.tmdb_id}`, {
                params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
              });
              const releaseDate = (data.release_date as string | undefined) ?? null;

              await AsyncStorage.setItem(
                `@upcoming_movie_${item.tmdb_id}`,
                JSON.stringify({ releaseDate, cachedAt: now })
              );

              if (!releaseDate) return null;
              const daysFromNow = computeDaysFromNow(releaseDate);
              if (daysFromNow < 1) return null;
              return {
                tmdbId: item.tmdb_id, title: item.title,
                posterPath: item.poster_path || null,
                releaseDate, daysFromNow,
              } as UpcomingMovie;
            } catch { return null; }
            finally {
              doneCount++;
              if (!cancelled) setUpcomingProgress(total > 0 ? doneCount / total : 1);
            }
          })
        );

        if (cancelled) return;

        const freshMovies = fetched
          .filter((r): r is PromiseFulfilledResult<UpcomingMovie> => r.status === 'fulfilled' && r.value !== null)
          .map(r => r.value);

        const all = [...results, ...freshMovies]
          .sort((a, b) => a.daysFromNow - b.daysFromNow || a.title.localeCompare(b.title));

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

  const getDate = (i: WatchlistItem) => i.release_date || releaseDateSupp[i.tmdb_id] || '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const notWatched = items
    .filter(i => {
      if (watchedIds.has(i.tmdb_id)) return false;
      const dateStr = getDate(i);
      if (!dateStr) return true; // date inconnue → on affiche
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d) <= today;
    })
    .sort((a, b) => {
      const da = getDate(a);
      const db = getDate(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    });
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
          <Text style={styles.errorText}>Impossible de charger tes films.</Text>
        </View>
      )}

      {/* ── À VOIR ── */}
      {!loading && !error && tab === 'voir' && (
        notWatched.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="film-outline" size={60} color={C.border} />
            <Text style={styles.emptyTitle}>Aucun film à voir</Text>
            <Text style={styles.emptyText}>
              {items.length === 0
                ? 'Explore et ajoute des films pour les retrouver ici.'
                : 'Tu as regardé tous les films de ta liste !'}
            </Text>
          </View>
        ) : viewModeAvoir === 'grid' ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          >
            <View style={styles.toggleHeader}>{toggleBtn}</View>
            <Grid
              items={notWatched}
              keyExtractor={i => i.id}
              renderItem={item => <FilmGridCard key={item.id} item={item} />}
            />
          </ScrollView>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          >
            <View style={styles.toggleHeader}>{toggleBtn}</View>
            {notWatched.map(item => <FilmRowCard key={item.id} item={item} />)}
          </ScrollView>
        )
      )}

      {/* ── À VENIR ── */}
      {!loading && !error && tab === 'avenir' && (
        upcomingLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.emptyText}>
              Récupération des films… {Math.round(upcomingProgress * 100)}%
            </Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.round(upcomingProgress * 100)}%` as any }]} />
            </View>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="film-outline" size={60} color={C.border} />
            <Text style={styles.emptyTitle}>Aucun film</Text>
            <Text style={styles.emptyText}>Ajoute des films pour voir leurs dates de sortie.</Text>
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="calendar-outline" size={60} color={C.border} />
            <Text style={styles.emptyTitle}>Aucun film à venir</Text>
            <Text style={styles.emptyText}>Tous les films de ta liste sont déjà sortis.</Text>
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

  scrollContent:  { paddingBottom: 32, paddingTop: 8 },
  listContent:    { paddingHorizontal: GRID_PAD, paddingVertical: 8, gap: 8, paddingBottom: 32 },
  toggleHeader:   { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: GRID_PAD, paddingTop: 16, paddingBottom: 4 },

  section:       { marginTop: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: GRID_PAD, marginBottom: 12 },
  sectionTitle:  { color: C.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  countBadge:    { backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: C.border },
  countText:     { color: C.muted, fontSize: 11, fontWeight: '700' },

  // Grille 3 colonnes
  grid:       { paddingHorizontal: GRID_PAD, paddingTop: 4 },
  gridRow:    { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP },
  cardSpacer: { width: CARD_W },

  card:              { width: CARD_W, gap: 6 },
  posterContainer:   { width: CARD_W, height: CARD_H, borderRadius: 8, overflow: 'hidden' },
  poster:            { width: CARD_W, height: CARD_H },
  posterPlaceholder: { backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  cardTitle:         { color: C.text, fontSize: 11, lineHeight: 15 },

  // Carte ligne
  vertList: { paddingHorizontal: GRID_PAD, gap: 8 },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, padding: 10,
  },
  rowPoster:            { width: 50, height: 75, borderRadius: 6 },
  rowPosterPlaceholder: { backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  rowInfo:  { flex: 1, gap: 4 },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  rowMeta:  { color: C.muted, fontSize: 12 },
  daysTag:  { backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  daysText: { color: C.muted, fontSize: 11, fontWeight: '700' },

  centered:   { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  emptyText:  { color: C.muted, fontSize: 14, textAlign: 'center' },
  errorText:  { color: C.primary, fontSize: 14, textAlign: 'center' },

  progressBarTrack: { width: '70%', height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  progressBarFill:  { height: 4, backgroundColor: C.primary, borderRadius: 2 },
});
