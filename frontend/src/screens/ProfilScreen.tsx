import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Image,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import {
  watchlistApi, watchedApi, favoritesApi, profileApi, followsApi,
  SERVER_BASE_URL,
  WatchlistItem, SeriesWatchedSummary,
} from '../services/api';
import { getProfileImageUri } from '../services/imageCache';
import { RootStackParamList } from '../navigation/AppNavigator';
import { TMDB_IMG } from '../config/tmdb';

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
const BANNER_H     = 160;
const AVATAR_SIZE  = 84;
const MINI_W       = 72;
const MINI_H       = 108;

// ─── Carte mini-poster ────────────────────────────────────────────────────────

function MiniPosterCard({ item, mediaType }: { item: WatchlistItem; mediaType: 'tv' | 'movie' }) {
  const navigation = useNavigation<Nav>();
  const uri = item.poster_path ? `${TMDB_IMG.poster_sm}${item.poster_path}` : null;

  return (
    <TouchableOpacity
      style={styles.miniCard}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', { id: item.tmdb_id, mediaType, title: item.title })}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.miniPoster} />
      ) : (
        <View style={[styles.miniPoster, styles.miniPlaceholder]}>
          <Ionicons name={mediaType === 'tv' ? 'tv-outline' : 'film-outline'} size={20} color={C.muted} />
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Bloc Séries/Films ────────────────────────────────────────────────────────

function MediaBlock({
  label, icon, items, mediaType, onHeaderPress, loading,
}: {
  label:         string;
  icon:          React.ComponentProps<typeof Ionicons>['name'];
  items:         WatchlistItem[];
  mediaType:     'tv' | 'movie';
  onHeaderPress: () => void;
  loading:       boolean;
}) {
  return (
    <View style={styles.mediaBlock}>
      <TouchableOpacity style={styles.mediaHeader} onPress={onHeaderPress} activeOpacity={0.7}>
        <View style={styles.mediaHeaderLeft}>
          <Ionicons name={icon} size={18} color={C.primary} />
          <Text style={styles.mediaHeaderText}>{label}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.muted} />
      </TouchableOpacity>

      {loading ? (
        <View style={styles.miniLoadingRow}>
          <ActivityIndicator size="small" color={C.primary} />
        </View>
      ) : items.length === 0 ? (
        <Text style={styles.miniEmpty}>Aucun {mediaType === 'tv' ? 'épisode' : 'film'} vu récemment</Text>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={i => i.id}
          renderItem={({ item }) => <MiniPosterCard item={item} mediaType={mediaType} />}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.miniRow}
        />
      )}
    </View>
  );
}

// ─── Écran ────────────────────────────────────────────────────────────────────

export default function ProfilScreen() {
  const navigation       = useNavigation<Nav>();
  const insets           = useSafeAreaInsets();
  const { user } = useAuth();

  const [tvItems,         setTvItems]         = useState<WatchlistItem[]>([]);
  const [movieItems,      setMovieItems]       = useState<WatchlistItem[]>([]);
  const [seriesSummaries, setSeriesSummaries]  = useState<SeriesWatchedSummary[]>([]);
  const [watchedMovieIds, setWatchedMovieIds]  = useState<number[]>([]);
  const [favTvIds,        setFavTvIds]         = useState<number[]>([]);
  const [favMovieIds,     setFavMovieIds]      = useState<number[]>([]);
  const [loading,         setLoading]          = useState(true);
  const [refreshing,      setRefreshing]       = useState(false);
  const [followingCount,  setFollowingCount]   = useState(0);
  const [followersCount,  setFollowersCount]   = useState(0);

  // Profil
  const [avatarUri,        setAvatarUri]       = useState<string | null>(null);
  const [bannerUri,        setBannerUri]       = useState<string | null>(null);

  // ── Chargement des images de profil ──────────────────────────────────────────

  const loadProfileImages = useCallback(async () => {
    try {
      const { data } = await profileApi.getProfile();

      if (data.avatar_path && data.avatar_updated_at) {
        const uri = await getProfileImageUri(
          'avatar',
          data.avatar_updated_at,
          SERVER_BASE_URL + data.avatar_path,
        );
        setAvatarUri(uri);
      } else {
        setAvatarUri(null);
      }

      if (data.banner_path && data.banner_updated_at) {
        const uri = await getProfileImageUri(
          'banner',
          data.banner_updated_at,
          SERVER_BASE_URL + data.banner_path,
        );
        setBannerUri(uri);
      } else {
        setBannerUri(null);
      }
    } catch {}
  }, []);

  // ── Chargement des données principales ───────────────────────────────────────

  const loadData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    Promise.all([
      watchlistApi.list('tv'),
      watchlistApi.list('movie'),
      watchedApi.seriesSummary(),
      watchedApi.watchedMovies(),
      favoritesApi.list('tv'),
      favoritesApi.list('movie'),
      followsApi.followCounts(),
    ])
      .then(([tv, movies, summaries, watched, favTv, favMovie, counts]) => {
        setTvItems(tv.data);
        setMovieItems(movies.data);
        setSeriesSummaries(summaries.data);
        setWatchedMovieIds(watched.data);
        setFavTvIds(favTv.data);
        setFavMovieIds(favMovie.data);
        setFollowingCount(counts.data.following);
        setFollowersCount(counts.data.followers);
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useFocusEffect(useCallback(() => {
    loadData(false);
    loadProfileImages();
  }, [loadData, loadProfileImages]));

  const onRefresh = useCallback(() => {
    loadData(true);
    loadProfileImages();
  }, [loadData, loadProfileImages]);

  // ── Dérivations ───────────────────────────────────────────────────────────────

  const summaryMap: Record<number, string> = {};
  seriesSummaries.forEach(s => { summaryMap[s.series_tmdb_id] = s.last_watched_at; });

  const recentSeries = [...tvItems]
    .filter(i => summaryMap[i.tmdb_id])
    .sort((a, b) =>
      new Date(summaryMap[b.tmdb_id]).getTime() - new Date(summaryMap[a.tmdb_id]).getTime()
    )
    .slice(0, 10);

  const watchedIdSet  = new Set(watchedMovieIds);
  const recentFilms   = movieItems.filter(i => watchedIdSet.has(i.tmdb_id)).slice(0, 10);
  const favTvSet      = new Set(favTvIds);
  const favMovieSet   = new Set(favMovieIds);
  const favoriteSeries = tvItems.filter(i => favTvSet.has(i.tmdb_id));
  const favoriteFilms  = movieItems.filter(i => favMovieSet.has(i.tmdb_id));

  const initial = user?.username?.[0]?.toUpperCase() ?? '?';

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* ── Bannière ── */}
        <View style={[styles.banner, { height: BANNER_H + insets.top }]}>
          {bannerUri ? (
            <Image
              source={{ uri: bannerUri }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
            />
          ) : (
            <>
              <View style={styles.decorCircle1} />
              <View style={styles.decorCircle2} />
            </>
          )}
          <View style={styles.bannerFade} />

          {/* Bouton paramètres */}
          <TouchableOpacity
            style={[styles.bannerEditBtn, { top: insets.top + 10 }]}
            onPress={() => navigation.navigate('Settings')}
            activeOpacity={0.8}
          >
            <Ionicons name="settings-outline" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* ── Identité ── */}
        <View style={styles.identity}>
          <View style={styles.avatarWrapper}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
          </View>

          <Text style={styles.username}>{user?.username}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        {/* ── Statistiques ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Statistiques</Text>
          <TouchableOpacity
            style={styles.statsCard}
            onPress={() => navigation.navigate('Statistics')}
            activeOpacity={0.8}
          >
            <Ionicons name="bar-chart-outline" size={18} color={C.primary} />
            <Text style={styles.statsLabel}>Voir mes statistiques</Text>
            <Ionicons name="chevron-forward" size={16} color={C.muted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </View>

        {/* ── Abonnements / Abonnés ── */}
        <View style={styles.section}>
          <View style={styles.followRow}>
            <TouchableOpacity
              style={styles.followBlock}
              onPress={() => navigation.navigate('FollowList', { type: 'following' })}
              activeOpacity={0.8}
            >
              <Text style={styles.followCount}>{followingCount}</Text>
              <Text style={styles.followLabel}>Abonnements</Text>
            </TouchableOpacity>
            <View style={styles.followDivider} />
            <TouchableOpacity
              style={styles.followBlock}
              onPress={() => navigation.navigate('FollowList', { type: 'followers' })}
              activeOpacity={0.8}
            >
              <Text style={styles.followCount}>{followersCount}</Text>
              <Text style={styles.followLabel}>Abonnés</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Ma liste ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Ma liste</Text>
          <MediaBlock label="Séries"          icon="tv-outline"   items={recentSeries}  mediaType="tv"    onHeaderPress={() => navigation.navigate('ProfileSeries', {})}                   loading={loading} />
          <MediaBlock label="Séries préférées" icon="heart"        items={favoriteSeries} mediaType="tv"   onHeaderPress={() => navigation.navigate('ProfileSeries', { favoritesOnly: true })} loading={loading} />
          <MediaBlock label="Films"            icon="film-outline" items={recentFilms}   mediaType="movie" onHeaderPress={() => navigation.navigate('ProfileFilms', {})}                    loading={loading} />
          <MediaBlock label="Films préférés"   icon="heart"        items={favoriteFilms} mediaType="movie" onHeaderPress={() => navigation.navigate('ProfileFilms', { favoritesOnly: true })} loading={loading} />
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Bannière
  banner: { width: W, backgroundColor: C.surface, overflow: 'hidden' },
  decorCircle1: {
    position: 'absolute', width: 260, height: 260, borderRadius: 130,
    backgroundColor: C.primary, opacity: 0.12, top: -60, right: -60,
  },
  decorCircle2: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    backgroundColor: C.primary, opacity: 0.08, bottom: 10, left: -40,
  },
  bannerFade: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
    backgroundColor: C.bg, opacity: 0.5,
  },
  bannerEditBtn: {
    position: 'absolute', right: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20, padding: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },

  // Identité
  identity: { alignItems: 'center', marginTop: -(AVATAR_SIZE / 2), paddingBottom: 8 },
  avatarWrapper: {
    width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
    borderWidth: 4, borderColor: C.bg,
    overflow: 'visible',
  },
  avatarImage: {
    width: AVATAR_SIZE - 8, height: AVATAR_SIZE - 8,
    borderRadius: (AVATAR_SIZE - 8) / 2,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE - 8, height: AVATAR_SIZE - 8,
    borderRadius: (AVATAR_SIZE - 8) / 2,
    backgroundColor: C.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarInitial:   { color: '#fff', fontSize: 34, fontWeight: '800' },
  username: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 10 },
  email:    { color: C.muted, fontSize: 13, marginTop: 4 },

  // Sections
  section:      { marginTop: 28, paddingHorizontal: 16 },
  sectionLabel: {
    color: C.muted, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },

  // Statistiques
  statsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  statsLabel: { color: C.text, fontSize: 15, fontWeight: '600' },

  // Blocs Séries / Films
  mediaBlock: {
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    overflow: 'hidden', marginBottom: 12,
  },
  mediaHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  mediaHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mediaHeaderText: { color: C.text, fontSize: 15, fontWeight: '700' },

  // Abonnements / Abonnés
  followRow: {
    flexDirection: 'row',
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    overflow: 'hidden',
  },
  followBlock: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
  },
  followDivider: {
    width: 1, backgroundColor: C.border,
  },
  followCount: { color: C.text, fontSize: 22, fontWeight: '800' },
  followLabel: { color: C.muted, fontSize: 12, marginTop: 2 },

  // Mini-posters
  miniRow:        { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  miniCard:       { width: MINI_W },
  miniPoster:     { width: MINI_W, height: MINI_H, borderRadius: 7 },
  miniPlaceholder:{ backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  miniLoadingRow: { paddingVertical: 16, alignItems: 'center' },
  miniEmpty:      { color: C.muted, fontSize: 12, padding: 16, textAlign: 'center' },

});
