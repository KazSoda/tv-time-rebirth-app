import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import axios from 'axios';
import { TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMAGE_BASE_URL } from '../config/tmdb';
import { RootStackParamList } from '../navigation/AppNavigator';

const colors = {
  background: '#1a1a2e',
  accent: '#16213e',
  card: '#0f2942',
  primary: '#e94560',
  text: '#ffffff',
  muted: '#8892a4',
  inputBg: '#16213e',
  border: '#1f4068',
};

type MediaType = 'movie' | 'tv' | 'person';

interface TmdbResult {
  id: number;
  media_type: MediaType;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
}

type ExplorerNav = NativeStackNavigationProp<RootStackParamList>;

function ResultCard({ item }: { item: TmdbResult }) {
  const navigation = useNavigation<ExplorerNav>();
  const isMovie = item.media_type === 'movie';
  const title = item.title ?? item.name ?? '—';
  const year = (item.release_date ?? item.first_air_date ?? '').slice(0, 4);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
  const posterUri = item.poster_path
    ? `${TMDB_IMAGE_BASE_URL}${item.poster_path}`
    : null;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('Detail', {
        id: item.id,
        mediaType: item.media_type as 'movie' | 'tv',
        title,
      })}
    >
      {posterUri ? (
        <Image source={{ uri: posterUri }} style={styles.poster} />
      ) : (
        <View style={[styles.poster, styles.posterPlaceholder]}>
          <Ionicons name="image-outline" size={28} color={colors.muted} />
        </View>
      )}
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
        <View style={styles.cardMeta}>
          <View style={[styles.badge, isMovie ? styles.badgeMovie : styles.badgeSerie]}>
            <Text style={styles.badgeText}>{isMovie ? 'Film' : 'Série'}</Text>
          </View>
          {year ? <Text style={styles.metaText}>{year}</Text> : null}
          {rating ? (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={11} color="#f5c518" />
              <Text style={styles.metaText}> {rating}</Text>
            </View>
          ) : null}
        </View>
        {item.overview ? (
          <Text style={styles.overview} numberOfLines={2}>{item.overview}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function ExplorerScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => search(trimmed), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const search = async (q: string) => {
    if (!TMDB_API_KEY || TMDB_API_KEY === 'REMPLACE_PAR_TA_CLE_TMDB') {
      setError('Clé API TMDB manquante. Configure EXPO_PUBLIC_TMDB_API_KEY dans le fichier .env.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
        params: {
          api_key: TMDB_API_KEY,
          query: q,
          language: 'fr-FR',
          include_adult: false,
        },
      });
      const filtered = (data.results as TmdbResult[]).filter(
        (r) => r.media_type === 'movie' || r.media_type === 'tv'
      );
      setResults(filtered);
    } catch {
      setError('Erreur lors de la recherche. Vérifie ta connexion ou ta clé API.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Barre de recherche */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.muted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher un film ou une série..."
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && Platform.OS !== 'ios' && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Contenu */}
      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {error && !loading && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.primary} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!loading && !error && query.trim() === '' && (
        <View style={styles.centered}>
          <Ionicons name="film-outline" size={60} color={colors.border} />
          <Text style={styles.emptyTitle}>Explorer</Text>
          <Text style={styles.emptyText}>Tape un titre pour chercher des films et séries</Text>
        </View>
      )}

      {!loading && !error && query.trim() !== '' && results.length === 0 && (
        <View style={styles.centered}>
          <Ionicons name="search-outline" size={40} color={colors.border} />
          <Text style={styles.emptyText}>Aucun résultat pour « {query} »</Text>
        </View>
      )}

      {!loading && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(item) => `${item.media_type}-${item.id}`}
          renderItem={({ item }) => <ResultCard item={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  errorText: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  poster: {
    width: 80,
    height: 120,
  },
  posterPlaceholder: {
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'flex-start',
    gap: 6,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeMovie: {
    backgroundColor: '#1f4068',
  },
  badgeSerie: {
    backgroundColor: '#2d1b4e',
  },
  badgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  metaText: {
    color: colors.muted,
    fontSize: 12,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overview: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
});
