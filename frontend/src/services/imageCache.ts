import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_DIR = (FileSystem.cacheDirectory ?? '') + 'profile/';

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

/**
 * Retourne l'URI locale d'une image de profil mise en cache.
 * Si le cache est périmé (updatedAt différent), re-télécharge l'image depuis le serveur.
 * Renvoie null si aucune image n'existe ou en cas d'erreur réseau.
 */
export async function getProfileImageUri(
  kind: 'avatar' | 'banner',
  serverUpdatedAt: string,
  remoteUrl: string,
): Promise<string | null> {
  const cacheKey = `@profile_img_${kind}`;
  const localPath = CACHE_DIR + kind + '.jpg';

  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const { updatedAt } = JSON.parse(raw);
      if (updatedAt === serverUpdatedAt) {
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) return localPath;
      }
    }

    // Cache manquant ou périmé → téléchargement
    await ensureDir();
    const result = await FileSystem.downloadAsync(remoteUrl, localPath);
    if (result.status === 200) {
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ updatedAt: serverUpdatedAt }));
      return localPath;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Copie une image locale (depuis le picker) dans le cache et enregistre les métadonnées.
 * Utilisé après un upload réussi pour éviter de re-télécharger l'image qu'on vient d'uploader.
 */
export async function cacheProfileImage(
  kind: 'avatar' | 'banner',
  sourceUri: string,
  updatedAt: string,
): Promise<string> {
  await ensureDir();
  const dest = CACHE_DIR + kind + '.jpg';
  // Supprimer l'ancien fichier si présent (évite les conflits)
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  await AsyncStorage.setItem(`@profile_img_${kind}`, JSON.stringify({ updatedAt }));
  return dest;
}
