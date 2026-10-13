import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useAuth } from '../context/AuthContext';
import { watchedApi, exportApi, profileApi, authApi } from '../services/api';
import { cacheProfileImage } from '../services/imageCache';
import { RootStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const C = {
  bg:      '#1a1a2e',
  surface: '#16213e',
  border:  '#1f4068',
  primary: '#e94560',
  text:    '#ffffff',
  muted:   '#8892a4',
};

export default function SettingsScreen() {
  const navigation       = useNavigation<Nav>();
  const insets           = useSafeAreaInsets();
  const { logout }       = useAuth();

  const [uploadingAvatar,  setUploadingAvatar]  = useState(false);
  const [uploadingBanner,  setUploadingBanner]  = useState(false);
  const [exportLoading,    setExportLoading]    = useState(false);

  const [pwdModalVisible,  setPwdModalVisible]  = useState(false);
  const [currentPwd,       setCurrentPwd]       = useState('');
  const [newPwd,           setNewPwd]           = useState('');
  const [confirmPwd,       setConfirmPwd]       = useState('');
  const [pwdLoading,       setPwdLoading]       = useState(false);

  // ── Upload image ─────────────────────────────────────────────────────────────

  const handlePickImage = useCallback(async (kind: 'avatar' | 'banner') => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', "Autorise l'accès à ta galerie pour choisir une image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: kind === 'avatar' ? [1, 1] : [16, 6],
      quality: 1,
    });

    if (result.canceled) return;

    const asset = result.assets[0];

    const compressed = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: kind === 'avatar' ? 400 : 1200 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );

    if (kind === 'avatar') setUploadingAvatar(true);
    else setUploadingBanner(true);

    try {
      const { data } = kind === 'avatar'
        ? await profileApi.uploadAvatar(compressed.uri)
        : await profileApi.uploadBanner(compressed.uri);

      await cacheProfileImage(kind, compressed.uri, data.updated_at);
      Alert.alert('Mis à jour', `Photo de ${kind === 'avatar' ? 'profil' : 'bannière'} modifiée.`);
    } catch {
      Alert.alert('Erreur', "Impossible de téléverser l'image.");
    } finally {
      if (kind === 'avatar') setUploadingAvatar(false);
      else setUploadingBanner(false);
    }
  }, []);

  // ── Export ───────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setExportLoading(true);
    try {
      const { data } = await exportApi.export();
      const json     = JSON.stringify(data, null, 2);
      const date     = new Date().toISOString().slice(0, 10);
      const filename = `tvtime-rebirth-export-${date}.json`;

      if (Platform.OS === 'android') {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permissions.granted) return;
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          permissions.directoryUri,
          filename,
          'application/json',
        );
        await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });
        Alert.alert('Exporté !', 'Fichier enregistré dans le dossier choisi.');
      } else {
        const fileUri = (FileSystem.cacheDirectory ?? '') + filename;
        await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/json',
            dialogTitle: "Enregistrer l'export",
            UTI: 'public.json',
          });
        } else {
          Alert.alert('Export', `Fichier créé : ${fileUri}`);
        }
      }
    } catch {
      Alert.alert('Erreur', "Impossible d'exporter les données.");
    } finally {
      setExportLoading(false);
    }
  }, []);

  // ── Changement de mot de passe ───────────────────────────────────────────────

  const closePwdModal = useCallback(() => {
    setPwdModalVisible(false);
    setCurrentPwd('');
    setNewPwd('');
    setConfirmPwd('');
  }, []);

  const handleChangePassword = useCallback(async () => {
    if (newPwd.length < 8) {
      Alert.alert('Erreur', 'Le nouveau mot de passe doit faire au moins 8 caractères.');
      return;
    }
    if (newPwd !== confirmPwd) {
      Alert.alert('Erreur', 'Les deux nouveaux mots de passe ne correspondent pas.');
      return;
    }
    setPwdLoading(true);
    try {
      await authApi.changePassword(currentPwd, newPwd);
      closePwdModal();
      Alert.alert('Mot de passe modifié', 'Ton mot de passe a bien été mis à jour.');
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Impossible de modifier le mot de passe.';
      Alert.alert('Erreur', msg);
    } finally {
      setPwdLoading(false);
    }
  }, [currentPwd, newPwd, confirmPwd, closePwdModal]);

  // ── Réinitialisation ─────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    Alert.alert(
      'Réinitialiser toutes les données',
      'Cette action supprime ta watchlist, tes favoris et tout ton historique de visionnage. Elle est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: async () => {
            try {
              await watchedApi.deleteAll();
              Alert.alert('Fait', 'Toutes les données ont été réinitialisées.');
            } catch {
              Alert.alert('Erreur', 'Impossible de réinitialiser les données.');
            }
          },
        },
      ]
    );
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>

      {/* ── Modal changement de mot de passe ── */}
      <Modal visible={pwdModalVisible} transparent animationType="fade" onRequestClose={closePwdModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={styles.modalOverlay} onPress={closePwdModal}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>Modifier le mot de passe</Text>

              <Text style={styles.inputLabel}>Mot de passe actuel</Text>
              <TextInput
                style={styles.input}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor={C.muted}
                value={currentPwd}
                onChangeText={setCurrentPwd}
                autoCapitalize="none"
              />

              <Text style={[styles.inputLabel, { marginTop: 12 }]}>Nouveau mot de passe</Text>
              <TextInput
                style={styles.input}
                secureTextEntry
                placeholder="8 caractères minimum"
                placeholderTextColor={C.muted}
                value={newPwd}
                onChangeText={setNewPwd}
                autoCapitalize="none"
              />

              <Text style={[styles.inputLabel, { marginTop: 12 }]}>Confirmer le nouveau mot de passe</Text>
              <TextInput
                style={styles.input}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor={C.muted}
                value={confirmPwd}
                onChangeText={setConfirmPwd}
                autoCapitalize="none"
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={closePwdModal} activeOpacity={0.8}>
                  <Text style={styles.modalCancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirmBtn, (!currentPwd || !newPwd || !confirmPwd) && { opacity: 0.4 }]}
                  onPress={handleChangePassword}
                  activeOpacity={0.8}
                  disabled={pwdLoading || !currentPwd || !newPwd || !confirmPwd}
                >
                  {pwdLoading
                    ? <ActivityIndicator size="small" color={C.text} />
                    : <Text style={styles.modalConfirmText}>Modifier</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      {/* ── En-tête ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Paramètres</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>

        {/* ── Profil ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Profil</Text>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handlePickImage('avatar')}
            activeOpacity={0.8}
            disabled={uploadingAvatar}
          >
            {uploadingAvatar
              ? <ActivityIndicator size="small" color={C.text} style={{ width: 18 }} />
              : <Ionicons name="person-circle-outline" size={18} color={C.text} />}
            <Text style={styles.actionText}>Changer la photo de profil</Text>
            <Ionicons name="chevron-forward" size={16} color={C.muted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { marginTop: 8 }]}
            onPress={() => handlePickImage('banner')}
            activeOpacity={0.8}
            disabled={uploadingBanner}
          >
            {uploadingBanner
              ? <ActivityIndicator size="small" color={C.text} style={{ width: 18 }} />
              : <Ionicons name="image-outline" size={18} color={C.text} />}
            <Text style={styles.actionText}>Changer la photo de bannière</Text>
            <Ionicons name="chevron-forward" size={16} color={C.muted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        </View>

        {/* ── Données ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Données</Text>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigation.navigate('Import')}
            activeOpacity={0.8}
          >
            <Ionicons name="cloud-upload-outline" size={18} color={C.text} />
            <Text style={styles.actionText}>Importer des données</Text>
            <Ionicons name="chevron-forward" size={16} color={C.muted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { marginTop: 8 }]}
            onPress={handleExport}
            activeOpacity={0.8}
            disabled={exportLoading}
          >
            {exportLoading
              ? <ActivityIndicator size="small" color={C.text} style={{ width: 18 }} />
              : <Ionicons name="cloud-download-outline" size={18} color={C.text} />}
            <Text style={styles.actionText}>Exporter mes données</Text>
            <Ionicons name="chevron-forward" size={16} color={C.muted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { marginTop: 8, borderColor: C.primary }]}
            onPress={handleReset}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={18} color={C.primary} />
            <Text style={[styles.actionText, { color: C.primary }]}>Réinitialiser toutes les données</Text>
          </TouchableOpacity>
        </View>

        {/* ── Compte ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Compte</Text>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setPwdModalVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="lock-closed-outline" size={18} color={C.text} />
            <Text style={styles.actionText}>Modifier le mot de passe</Text>
            <Ionicons name="chevron-forward" size={16} color={C.muted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.logoutBtn, { marginTop: 8 }]} onPress={logout} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={18} color={C.primary} />
            <Text style={styles.logoutText}>Se déconnecter</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn:     { width: 40, alignItems: 'center' },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '700' },

  section:      { marginTop: 28, paddingHorizontal: 16 },
  sectionLabel: {
    color: C.muted, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  actionText: { color: C.text, fontSize: 15, fontWeight: '600' },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  logoutText: { color: C.primary, fontSize: 15, fontWeight: '600' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', backgroundColor: C.surface,
    borderRadius: 16, padding: 24,
    borderWidth: 1, borderColor: C.border,
  },
  modalTitle: {
    color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 20,
  },
  inputLabel: { color: C.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: '#0f2942', borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row', gap: 10, marginTop: 24,
  },
  modalCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 10,
    backgroundColor: '#0f2942', borderWidth: 1, borderColor: C.border,
    alignItems: 'center',
  },
  modalCancelText: { color: C.muted, fontSize: 15, fontWeight: '600' },
  modalConfirmBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 10,
    backgroundColor: C.primary, alignItems: 'center',
  },
  modalConfirmText: { color: C.text, fontSize: 15, fontWeight: '700' },
});
