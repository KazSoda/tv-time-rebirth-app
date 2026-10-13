import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  followsApi, PublicProfile,
  SERVER_BASE_URL,
  WatchlistItem, SeriesWatchedSummary,
} from '../services/api';
import { RootStackParamList } from '../navigation/AppNavigator';
import { TMDB_IMG } from '../config/tmdb';

type Nav   = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'UserProfile'>;

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
const BANNER_H    = 160;
const AVATAR_SIZE = 84;
const MINI_W      = 72;
const MINI_H      = 108;

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

// ─── Bloc média ───────────────────────────────────────────────────────────────

function MediaBlock({
  label, icon, items, mediaType, loading, onHeaderPress,
}: {
  label:          string;
  icon:           React.ComponentProps<typeof Ionicons>['name'];
  items:          WatchlistItem[];
  mediaType:      'tv' | 'movie';
  loading:        boolean;
  onHeaderPress?: () => void;
}) {
  return (
    <View style={styles.mediaBlock}>
      <TouchableOpacity
        style={styles.mediaHeader}
        onPress={onHeaderPress}
        activeOpacity={onHeaderPress ? 0.7 : 1}
      >
        <View style={styles.mediaHeaderLeft}>
          <Ionicons name={icon} size={18} color={C.primary} />
          <Text style={styles.mediaHeaderText}>{label}</Text>
        </View>
        {onHeaderPress && <Ionicons name="chevron-forward" size={18} color={C.muted} />}
      </TouchableOpacity>
      {loading ? (
        <View style={styles.miniLoadingRow}>
          <ActivityIndicator size="small" color={C.primary} />
        </View>
      ) : items.length === 0 ? (
        <Text style={styles.miniEmpty}>Aucun contenu</Text>
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

export default function UserProfileScreen() {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const insets     = useSafeAreaInsets();
  const { username } = route.params;

  const [profile,         setProfile]         = useState<PublicProfile | null>(null);
  const [tvItems,         setTvItems]         = useState<WatchlistItem[]>([]);
  const [movieItems,      setMovieItems]       = useState<WatchlistItem[]>([]);
  const [seriesSummaries, setSeriesSummaries]  = useState<SeriesWatchedSummary[]>([]);
  const [watchedMovieIds, setWatchedMovieIds]  = useState<number[]>([]);
  const [favTvIds,        setFavTvIds]         = useState<number[]>([]);
  const [favMovieIds,     setFavMovieIds]      = useState<number[]>([]);
  const [loading,         setLoading]          = useState(true);
  const [togglingFollow,  setTogglingFollow]   = useState(false);

  // ── Chargement ───────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prof, tv, movies, summaries, watched, favTv, favMovie] = await Promise.all([
        followsApi.getPublicProfile(username),
        followsApi.getUserWatchlist(username, 'tv'),
        followsApi.getUserWatchlist(username, 'movie'),
        followsApi.getUserSeriesSummary(username),
        followsApi.getUserWatchedMovies(username),
        followsApi.getUserFavorites(username, 'tv'),
        followsApi.getUserFavorites(username, 'movie'),
      ]);
      setProfile(prof.data);
      setTvItems(tv.data);
      setMovieItems(movies.data);
      setSeriesSummaries(summaries.data);
      setWatchedMovieIds(watched.data);
      setFavTvIds(favTv.data);
      setFavMovieIds(favMovie.data);
    } catch {
      Alert.alert('Erreur', 'Impossible de charger ce profil.');
    }
    setLoading(false);
  }, [username]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Follow / Unfollow ─────────────────────────────────────────────────────

  const handleToggleFollow = useCallback(async () => {
    if (!profile) return;
    setTogglingFollow(true);
    try {
      if (profile.is_following) {
        await followsApi.unfollow(username);
        setProfile(p => p ? { ...p, is_following: false, followers_count: p.followers_count - 1 } : p);
      } else {
        await followsApi.follow(username);
        setProfile(p => p ? { ...p, is_following: true, followers_count: p.followers_count + 1 } : p);
      }
    } catch {
      Alert.alert('Erreur', "Impossible de modifier l'abonnement.");
    }
    setTogglingFollow(false);
  }, [profile, username]);

  // ── Dérivations ──────────────────────────────────────────────────────────

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

  const initial     = username[0]?.toUpperCase() ?? '?';
  const avatarUri   = profile?.avatar_path ? SERVER_BASE_URL + profile.avatar_path : null;
  const bannerUri   = profile?.banner_path ? SERVER_BASE_URL + profile.banner_path : null;

  // ── Rendu ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        {/* ── Bannière ── */}
        <View style={[styles.banner, { height: BANNER_H + insets.top }]}>
          {bannerUri ? (
            <Image source={{ uri: bannerUri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          ) : (
            <>
              <View style={styles.decorCircle1} />
              <View style={styles.decorCircle2} />
            </>
          )}
          <View style={styles.bannerFade} />

          {/* Retour */}
          <TouchableOpacity
            style={[styles.bannerBtn, { top: insets.top + 10, left: 12 }]}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>

          {/* Follow / Unfollow */}
          {profile && (
            <TouchableOpacity
              style={[
                styles.bannerBtn,
                styles.followBannerBtn,
                { top: insets.top + 10, right: 12 },
                profile.is_following && styles.followBannerBtnActive,
              ]}
              onPress={handleToggleFollow}
              activeOpacity={0.8}
              disabled={togglingFollow}
            >
              {togglingFollow ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons
                    name={profile.is_following ? 'person-remove-outline' : 'person-add-outline'}
                    size={15}
                    color="#fff"
                  />
                  <Text style={styles.followBannerText}>
                    {profile.is_following ? 'Abonné' : 'Suivre'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
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
          <Text style={styles.username}>{username}</Text>
          {profile && (
            <View style={styles.countsRow}>
              <Text style={styles.countItem}>
                <Text style={styles.countNum}>{profile.following_count}</Text>
                {'  '}abonnements
              </Text>
              <Text style={styles.countSep}>·</Text>
              <Text style={styles.countItem}>
                <Text style={styles.countNum}>{profile.followers_count}</Text>
                {'  '}abonné{profile.followers_count !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>

        {/* ── Ma liste ── */}
        {loading ? (
          <View style={[styles.section, { alignItems: 'center', paddingTop: 32 }]}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Sa liste</Text>
            <MediaBlock label="Séries"          icon="tv-outline"   items={recentSeries}   mediaType="tv"    loading={false} onHeaderPress={() => navigation.navigate('ProfileSeries', { username })} />
            <MediaBlock label="Séries préférées" icon="heart"        items={favoriteSeries} mediaType="tv"    loading={false} onHeaderPress={() => navigation.navigate('ProfileSeries', { username, favoritesOnly: true })} />
            <MediaBlock label="Films"            icon="film-outline" items={recentFilms}    mediaType="movie" loading={false} onHeaderPress={() => navigation.navigate('ProfileFilms',  { username })} />
            <MediaBlock label="Films préférés"   icon="heart"        items={favoriteFilms}  mediaType="movie" loading={false} onHeaderPress={() => navigation.navigate('ProfileFilms',  { username, favoritesOnly: true })} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Bannière
  banner:      { width: W, backgroundColor: C.surface, overflow: 'hidden' },
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
  bannerBtn: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20, padding: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  followBannerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12,
  },
  followBannerBtnActive: {
    backgroundColor: 'rgba(233,69,96,0.25)',
    borderColor: C.primary,
  },
  followBannerText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Identité
  identity: { alignItems: 'center', marginTop: -(AVATAR_SIZE / 2), paddingBottom: 8 },
  avatarWrapper: {
    width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
    borderWidth: 4, borderColor: C.bg, overflow: 'visible',
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
  avatarInitial: { color: '#fff', fontSize: 34, fontWeight: '800' },
  username:      { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 10 },
  countsRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  countItem:     { color: C.muted, fontSize: 13 },
  countNum:      { color: C.text, fontWeight: '700' },
  countSep:      { color: C.border, fontSize: 16 },

  // Sections
  section:      { marginTop: 28, paddingHorizontal: 16 },
  sectionLabel: {
    color: C.muted, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },

  // Blocs média
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

  // Mini-posters
  miniRow:         { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  miniCard:        { width: MINI_W },
  miniPoster:      { width: MINI_W, height: MINI_H, borderRadius: 7 },
  miniPlaceholder: { backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' },
  miniLoadingRow:  { paddingVertical: 16, alignItems: 'center' },
  miniEmpty:       { color: C.muted, fontSize: 12, padding: 16, textAlign: 'center' },
});
