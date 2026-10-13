import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMG } from '../config/tmdb';
import { RootStackParamList } from '../navigation/AppNavigator';
import { watchedApi } from '../services/api';

type EpisodeDetailRouteProp = RouteProp<RootStackParamList, 'EpisodeDetail'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const STILL_HEIGHT = Math.round(SCREEN_WIDTH * 9 / 16); // ratio 16:9

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

const BANNER_HEIGHT = 72;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Person {
  id: number;
  name: string;
  character?: string;   // guest stars
  job?: string;         // crew
  profile_path: string | null;
}

interface EpisodeFullDetails {
  id: number;
  name: string;
  overview: string;
  air_date: string | null;
  episode_number: number;
  season_number: number;
  still_path: string | null;
  vote_average: number;
  vote_count: number;
  runtime: number | null;
  crew: Person[];
  guest_stars: Person[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRuntime(minutes: number | null): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}min` : `${m}min`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function PersonCard({ person, sub }: { person: Person; sub: string }) {
  const photoUri = person.profile_path
    ? `${TMDB_IMG.still}${person.profile_path}`
    : null;

  return (
    <View style={styles.personCard}>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.personPhoto} />
      ) : (
        <View style={[styles.personPhoto, styles.personPhotoPlaceholder]}>
          <Ionicons name="person" size={22} color={C.muted} />
        </View>
      )}
      <Text style={styles.personName} numberOfLines={2}>{person.name}</Text>
      <Text style={styles.personSub} numberOfLines={2}>{sub}</Text>
    </View>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function EpisodeDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<EpisodeDetailRouteProp>();
  const insets = useSafeAreaInsets();
  const { seriesId, seriesName, seasonNumber, episodeNumber, episodeName, stillPath } = route.params;

  const [episode, setEpisode] = useState<EpisodeFullDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isWatched, setIsWatched] = useState(false);
  const [watchedLoading, setWatchedLoading] = useState(false);

  useEffect(() => {
    axios
      .get(`${TMDB_BASE_URL}/tv/${seriesId}/season/${seasonNumber}/episode/${episodeNumber}`, {
        params: { api_key: TMDB_API_KEY, language: 'fr-FR' },
      })
      .then(({ data }) => setEpisode(data))
      .catch(() => setError("Impossible de charger les détails de l'épisode."))
      .finally(() => setLoading(false));
  }, [seriesId, seasonNumber, episodeNumber]);

  useEffect(() => {
    watchedApi
      .getWatchedEpisodes(seriesId, seasonNumber)
      .then(({ data }) => setIsWatched(data.includes(episodeNumber)))
      .catch(() => {});
  }, [seriesId, seasonNumber, episodeNumber]);

  async function handleWatchedToggle() {
    if (watchedLoading) return;
    setWatchedLoading(true);
    try {
      if (isWatched) {
        await watchedApi.unmarkEpisode(seriesId, seasonNumber, episodeNumber);
        setIsWatched(false);
      } else {
        await watchedApi.markEpisode(seriesId, seasonNumber, episodeNumber, episode?.runtime ?? 0);
        setIsWatched(true);
      }
    } catch {
      // silently ignore
    } finally {
      setWatchedLoading(false);
    }
  }

  // Image affichée en attendant le fetch (depuis le cache parent)
  const initialStill = stillPath ? `${TMDB_IMG.still}${stillPath}` : null;
  const fullStill = episode?.still_path ? `${TMDB_IMG.backdrop}${episode.still_path}` : initialStill;

  const directors = episode?.crew.filter((p) => p.job === 'Director') ?? [];
  const writers   = episode?.crew.filter((p) => p.job === 'Writer' || p.job === 'Screenplay') ?? [];
  const guests    = episode?.guest_stars.slice(0, 10) ?? [];

  return (
    <View style={styles.root}>
      {/* Bouton retour */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + 8 }]}
        onPress={() => navigation.goBack()}
        activeOpacity={0.8}
      >
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BANNER_HEIGHT + 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Still plein largeur (affiché immédiatement depuis params) */}
        {fullStill ? (
          <Image source={{ uri: fullStill }} style={styles.still} resizeMode="cover" />
        ) : (
          <View style={styles.stillPlaceholder}>
            <Ionicons name="film-outline" size={48} color={C.border} />
          </View>
        )}

        {/* Overlay sombre en bas du still */}
        <View style={styles.stillOverlay} />

        {/* En-tête */}
        <View style={styles.header}>
          <Text style={styles.breadcrumb}>
            {seriesName}  ·  Saison {seasonNumber}
          </Text>
          <Text style={styles.episodeLabel}>Épisode {episodeNumber}</Text>
          <Text style={styles.title}>{episode?.name ?? episodeName}</Text>

          {/* Méta chips */}
          <View style={styles.metaRow}>
            {episode?.air_date ? (
              <MetaChip icon="calendar-outline" label={formatDate(episode.air_date)} />
            ) : null}
            {episode?.runtime ? (
              <MetaChip icon="time-outline" label={formatRuntime(episode.runtime)} />
            ) : null}
            {(episode?.vote_average ?? 0) > 0 ? (
              <MetaChip icon="star" label={`${episode!.vote_average.toFixed(1)} (${episode!.vote_count} votes)`} iconColor="#f5c518" />
            ) : null}
          </View>
        </View>

        {/* Spinner pendant le fetch */}
        {loading && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={styles.loadingText}>Chargement…</Text>
          </View>
        )}

        {error && !loading && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={20} color={C.primary} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Synopsis */}
        {episode?.overview ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Synopsis</Text>
            <Text style={styles.overview}>{episode.overview}</Text>
          </View>
        ) : null}

        {/* Réalisateur / scénariste */}
        {(directors.length > 0 || writers.length > 0) && (
          <View style={styles.section}>
            {directors.length > 0 && (
              <InfoLine
                label={directors.length > 1 ? 'Réalisateurs' : 'Réalisateur'}
                value={directors.map((d) => d.name).join(', ')}
              />
            )}
            {writers.length > 0 && (
              <InfoLine
                label={writers.length > 1 ? 'Scénaristes' : 'Scénariste'}
                value={writers.map((w) => w.name).join(', ')}
              />
            )}
          </View>
        )}

        {/* Guests stars */}
        {guests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Guests</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.guestScroll}>
              {guests.map((g) => (
                <PersonCard key={g.id} person={g} sub={g.character ?? ''} />
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {/* Bannière fixe : marquer comme vu */}
      <View style={[styles.banner, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.watchedBtn, isWatched && styles.watchedBtnActive]}
          onPress={handleWatchedToggle}
          activeOpacity={0.8}
          disabled={watchedLoading}
        >
          {watchedLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons
                name={isWatched ? 'eye' : 'eye-outline'}
                size={18}
                color="#fff"
              />
              <Text style={styles.watchedBtnText}>
                {isWatched ? 'VU ✓' : 'MARQUER VU'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MetaChip({
  icon,
  label,
  iconColor = C.muted,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  iconColor?: string;
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
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },

  backBtn: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    padding: 8,
  },

  still: {
    width: SCREEN_WIDTH,
    height: STILL_HEIGHT,
  },
  stillPlaceholder: {
    width: SCREEN_WIDTH,
    height: STILL_HEIGHT,
    backgroundColor: C.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stillOverlay: {
    position: 'absolute',
    top: STILL_HEIGHT - 60,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: C.bg,
    opacity: 0.7,
  },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 4,
  },
  breadcrumb: {
    color: C.primary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  episodeLabel: {
    color: C.muted,
    fontSize: 12,
    marginTop: 2,
  },
  title: {
    color: C.text,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.card,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaChipText: { color: C.muted, fontSize: 12 },

  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 20,
  },
  loadingText: { color: C.muted, fontSize: 13 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(233,69,96,0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.primary,
  },
  errorText: { color: C.primary, fontSize: 13, flex: 1 },

  section: { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  overview: { color: '#c8d0dd', fontSize: 14, lineHeight: 22 },

  infoLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
  },
  infoLabel: { color: C.muted, fontSize: 14, flexShrink: 0 },
  infoValue: { color: C.text, fontSize: 14, fontWeight: '600', textAlign: 'right', flex: 1 },

  guestScroll: { marginLeft: -4 },
  personCard: {
    width: 90,
    marginRight: 12,
    alignItems: 'center',
    gap: 4,
  },
  personPhoto: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.card,
  },
  personPhotoPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  personName: { color: C.text, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  personSub:  { color: C.muted, fontSize: 10, textAlign: 'center' },

  banner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  watchedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.card,
    borderRadius: 10,
    paddingVertical: 12,
  },
  watchedBtnActive: {
    backgroundColor: C.watched,
  },
  watchedBtnText: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
