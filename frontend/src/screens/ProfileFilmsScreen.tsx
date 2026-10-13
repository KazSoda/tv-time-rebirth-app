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
import { watchlistApi, watchedApi, favoritesApi, followsApi, WatchlistItem } from '../services/api';
import { RootStackParamList } from '../navigation/AppNavigator';
import { TMDB_IMG, TMDB_BASE_URL, TMDB_API_KEY } from '../config/tmdb';

type Nav   = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ProfileFilms'>;

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
const GRID_PAD  = 16;
const GRID_GAP  = 8;
const CARD_W    = Math.floor((W - GRID_PAD * 2 - GRID_GAP * 2) / 3);
const CARD_H    = Math.floor(CARD_W * 1.5);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── Carte poster ─────────────────────────────────────────────────────────────

function PosterCard({ item }: { item: WatchlistItem }) {
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

// ─── Section grille ───────────────────────────────────────────────────────────

function Section({
  title, items, accent,
}: {
  title: string; items: WatchlistItem[]; accent?: string;
}) {
  if (items.length === 0) return null;
  const rows = chunk(items, 3);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, accent ? { color: accent } : {}]}>{title}</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{items.length}</Text>
        </View>
      </View>
      <View style={styles.grid}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.gridRow}>
            {row.map(item => <PosterCard key={item.id} item={item} />)}
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

export default function ProfileFilmsScreen() {
  const navigation    = useNavigation();
  const insets        = useSafeAreaInsets();
  const { params }    = useRoute<Route>();
  const favoritesOnly = params?.favoritesOnly ?? false;
  const username      = params?.username;

  const [items,           setItems]           = useState<WatchlistItem[]>([]);
  const [watchedIds,      setWatchedIds]      = useState<Set<number>>(new Set());
  const [watchedOrder,    setWatchedOrder]    = useState<number[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(false);
  const [refreshing,      setRefreshing]      = useState(false);
  const [releaseDateSupp, setReleaseDateSupp] = useState<Record<number, string>>({});

  const fetchData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const getWatchlist = username ? followsApi.getUserWatchlist(username, 'movie') : watchlistApi.list('movie');
    const getWatched   = username ? followsApi.getUserWatchedMovies(username)       : watchedApi.watchedMovies();
    const getFavorites = username ? followsApi.getUserFavorites(username, 'movie')  : favoritesApi.list('movie');

    const requests: Promise<any>[] = [getWatchlist, getWatched];
    if (favoritesOnly) requests.push(getFavorites);

    Promise.all(requests)
      .then(([wl, watched, favIds]) => {
        let allItems: WatchlistItem[] = wl.data;
        if (favoritesOnly && favIds) {
          const favSet = new Set<number>(favIds.data);
          allItems = allItems.filter(i => favSet.has(i.tmdb_id));
        }
        setItems(allItems);
        setWatchedIds(new Set(watched.data));
        setWatchedOrder(watched.data);
        setError(false);
      })
      .catch(() => { if (!isRefresh) setError(true); })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [favoritesOnly, username]);

  useEffect(() => { fetchData(false); }, [fetchData]);

  // Compléter les release_date manquantes depuis le cache À venir ou TMDB
  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    const needsDates = items.filter(i => i.media_type === 'movie' && !i.release_date);
    if (needsDates.length === 0) return;

    const keys = needsDates.map(i => `@upcoming_movie_${i.tmdb_id}`);
    (async () => {
      const cached = await AsyncStorage.multiGet(keys).catch(() => [] as [string, string | null][]);
      const map: Record<number, string> = {};
      const toFetch: WatchlistItem[] = [];
      for (let i = 0; i < needsDates.length; i++) {
        const raw = cached[i]?.[1];
        if (raw) {
          try {
            const entry = JSON.parse(raw);
            if (entry.releaseDate) { map[needsDates[i].tmdb_id] = entry.releaseDate; continue; }
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

  const onRefresh = useCallback(() => fetchData(true), [fetchData]);

  const getDate = (i: WatchlistItem) => i.release_date || releaseDateSupp[i.tmdb_id] || '';
  const sortByRelease = (a: WatchlistItem, b: WatchlistItem) => {
    const da = getDate(a);
    const db = getDate(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  };
  // watchedOrder conserve l'ordre watched_at DESC renvoyé par le backend
  const watchedOrderMap = new Map(watchedOrder.map((id, idx) => [id, idx]));
  const notWatched = items.filter(i => !watchedIds.has(i.tmdb_id)).sort(sortByRelease);
  const watched    = items
    .filter(i => watchedIds.has(i.tmdb_id))
    .sort((a, b) => (watchedOrderMap.get(a.tmdb_id) ?? 9999) - (watchedOrderMap.get(b.tmdb_id) ?? 9999));

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
            ? (favoritesOnly ? `Films préférés de @${username}` : `Films de @${username}`)
            : (favoritesOnly ? 'Films préférés' : 'Mes films')}
        </Text>
      </View>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      )}

      {error && !loading && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={C.primary} />
          <Text style={styles.errorText}>Impossible de charger tes films.</Text>
        </View>
      )}

      {!loading && !error && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        >
          {notWatched.length === 0 && watched.length === 0 && (
            <View style={styles.centered}>
              <Ionicons name={favoritesOnly ? 'heart-outline' : 'film-outline'} size={60} color={C.border} />
              <Text style={styles.emptyTitle}>
                {favoritesOnly ? 'Aucun film préféré' : 'Aucun film'}
              </Text>
              <Text style={styles.emptyText}>
                {username
                  ? (favoritesOnly ? `@${username} n'a pas encore de films préférés.` : `@${username} n'a pas encore de films.`)
                  : (favoritesOnly ? 'Appuie sur le ❤️ d\'un film pour l\'ajouter ici.' : 'Explore et ajoute des films pour les retrouver ici.')}
              </Text>
            </View>
          )}
          <Section title="À VOIR"    items={notWatched} />
          <Section title="FILMS VUS" items={watched}    accent={C.watched} />
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
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 56,
    paddingBottom: 14,
    alignItems: 'center',
  },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '700' },

  scroll: { paddingTop: 8 },

  section:       { marginTop: 24 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: GRID_PAD, marginBottom: 12,
  },
  sectionTitle: {
    color: C.text, fontSize: 12, fontWeight: '800',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  countBadge: {
    backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: C.border,
  },
  countText: { color: C.muted, fontSize: 11, fontWeight: '700' },

  grid:       { paddingHorizontal: GRID_PAD },
  gridRow:    { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP },
  cardSpacer: { width: CARD_W },

  card:              { width: CARD_W, gap: 6 },
  posterContainer:   { width: CARD_W, height: CARD_H, borderRadius: 8, overflow: 'hidden' },
  poster:            { width: CARD_W, height: CARD_H },
  posterPlaceholder: { backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  cardTitle:         { color: C.text, fontSize: 11, lineHeight: 15 },

  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32, gap: 12, marginTop: 60,
  },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  emptyText:  { color: C.muted, fontSize: 14, textAlign: 'center' },
  errorText:  { color: C.primary, fontSize: 14, textAlign: 'center' },
});
