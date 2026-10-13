import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { followsApi, PublicUser, SERVER_BASE_URL } from '../services/api';
import { RootStackParamList } from '../navigation/AppNavigator';

type Nav   = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'FollowList'>;

const C = {
  bg:      '#1a1a2e',
  surface: '#16213e',
  card:    '#0f2942',
  primary: '#e94560',
  text:    '#ffffff',
  muted:   '#8892a4',
  border:  '#1f4068',
};

const AVATAR = 44;

// ─── Carte utilisateur ────────────────────────────────────────────────────────

function UserCard({
  user,
  onPress,
  onFollowToggle,
  showFollowBtn,
  toggling,
}: {
  user:            PublicUser;
  onPress?:        () => void;
  onFollowToggle?: () => void;
  showFollowBtn?:  boolean;
  toggling?:       boolean;
}) {
  const avatarUri = user.avatar_path ? SERVER_BASE_URL + user.avatar_path : null;
  const initial   = user.username[0]?.toUpperCase() ?? '?';

  return (
    <TouchableOpacity
      style={styles.userCard}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
        )}
      </View>

      {/* Nom */}
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{user.username}</Text>
        <Text style={styles.userSub}>
          {user.followers_count} abonné{user.followers_count !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Bouton follow (résultats de recherche) */}
      {showFollowBtn && (
        <TouchableOpacity
          style={[styles.followBtn, user.is_following && styles.followBtnActive]}
          onPress={onFollowToggle}
          activeOpacity={0.8}
          disabled={toggling}
        >
          {toggling ? (
            <ActivityIndicator size="small" color={user.is_following ? C.primary : '#fff'} />
          ) : (
            <Text style={[styles.followBtnText, user.is_following && styles.followBtnTextActive]}>
              {user.is_following ? 'Abonné' : 'Suivre'}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* Flèche navigable (liste abonnements) */}
      {onPress && !showFollowBtn && (
        <Ionicons name="chevron-forward" size={18} color={C.muted} />
      )}
    </TouchableOpacity>
  );
}

// ─── Écran ────────────────────────────────────────────────────────────────────

export default function FollowListScreen() {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const insets     = useSafeAreaInsets();
  const { type }   = route.params;

  const isFollowing = type === 'following';
  const title       = isFollowing ? 'Abonnements' : 'Abonnés';

  const [users,   setUsers]   = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Recherche ─────────────────────────────────────────────────────────────
  const [searchOpen,    setSearchOpen]    = useState(false);
  const [query,         setQuery]         = useState('');
  const [results,       setResults]       = useState<PublicUser[]>([]);
  const [searching,     setSearching]     = useState(false);
  const [togglingId,    setTogglingId]    = useState<string | null>(null);
  const [listDirty,     setListDirty]     = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Chargement de la liste ────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = isFollowing
        ? await followsApi.myFollowing()
        : await followsApi.myFollowers();
      setUsers(res.data);
    } catch {}
    setLoading(false);
  }, [isFollowing]);

  useEffect(() => { loadList(); }, [loadList]);

  // ── Recherche avec debounce ───────────────────────────────────────────────

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await followsApi.searchUsers(query);
        setResults(res.data);
      } catch {}
      setSearching(false);
    }, 350);
  }, [query]);

  // ── Fermeture du modal de recherche ──────────────────────────────────────

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setResults([]);
    if (listDirty) { setListDirty(false); loadList(); }
  }, [listDirty, loadList]);

  // ── Follow / Unfollow (depuis la recherche) ───────────────────────────────

  const handleToggleFollow = useCallback(async (user: PublicUser) => {
    setTogglingId(user.id);
    try {
      if (user.is_following) {
        await followsApi.unfollow(user.username);
      } else {
        await followsApi.follow(user.username);
      }
      setResults(prev =>
        prev.map(u => u.id === user.id ? { ...u, is_following: !u.is_following } : u)
      );
      setListDirty(true);
    } catch {}
    setTogglingId(null);
  }, []);

  // ── Rendu ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* En-tête */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        {isFollowing ? (
          <TouchableOpacity style={styles.headerBtn} onPress={() => setSearchOpen(true)} activeOpacity={0.7}>
            <Ionicons name="person-add-outline" size={22} color={C.primary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {/* Liste */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : users.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={48} color={C.muted} />
          <Text style={styles.emptyText}>
            {isFollowing ? 'Tu ne suis personne pour l\'instant' : 'Aucun abonné pour l\'instant'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={u => u.id}
          renderItem={({ item }) => (
            <UserCard
              user={item}
              onPress={isFollowing
                ? () => navigation.navigate('UserProfile', { username: item.username })
                : undefined}
            />
          )}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      )}

      {/* Modal de recherche */}
      <Modal
        visible={searchOpen}
        animationType="slide"
        onRequestClose={closeSearch}
      >
        <KeyboardAvoidingView
          style={[styles.modal, { paddingTop: insets.top }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* En-tête modal */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={closeSearch} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Trouver un utilisateur</Text>
            <View style={styles.headerBtn} />
          </View>

          {/* Barre de recherche */}
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={18} color={C.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher par nom d'utilisateur…"
              placeholderTextColor={C.muted}
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
                <Ionicons name="close-circle" size={18} color={C.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Résultats */}
          {searching ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
          ) : query.length < 2 ? (
            <View style={styles.center}>
              <Ionicons name="search-outline" size={40} color={C.muted} style={{ opacity: 0.5 }} />
              <Text style={styles.emptyText}>Tape au moins 2 caractères</Text>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>Aucun utilisateur trouvé</Text>
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={u => u.id}
              renderItem={({ item }) => (
                <UserCard
                  user={item}
                  showFollowBtn
                  toggling={togglingId === item.id}
                  onFollowToggle={() => handleToggleFollow(item)}
                />
              )}
              contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: C.bg },
  modal: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerBtn:   { width: 40, alignItems: 'center' },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '700' },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { color: C.muted, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },

  // Carte utilisateur
  userCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
    gap: 12,
  },
  avatarWrap: {
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2,
    overflow: 'hidden',
  },
  avatarImg:         { width: AVATAR, height: AVATAR },
  avatarPlaceholder: {
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2,
    backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 18, fontWeight: '800' },
  userInfo:      { flex: 1 },
  userName:      { color: C.text, fontSize: 15, fontWeight: '700' },
  userSub:       { color: C.muted, fontSize: 12, marginTop: 2 },

  // Bouton follow
  followBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: C.primary,
    minWidth: 72, alignItems: 'center',
  },
  followBtnActive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.primary },
  followBtnText:   { color: '#fff', fontSize: 13, fontWeight: '700' },
  followBtnTextActive: { color: C.primary },

  // Barre de recherche
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: {
    flex: 1, color: C.text, fontSize: 15,
  },
});
