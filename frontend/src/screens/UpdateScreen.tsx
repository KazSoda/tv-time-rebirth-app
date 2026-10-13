import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';

// Lien de téléchargement de la dernière version (optionnel, voir .env.example)
const UPDATE_URL = process.env.EXPO_PUBLIC_UPDATE_URL ?? '';

export default function UpdateScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Une mise à jour est disponible</Text>
      <Text style={styles.message}>
        Veuillez mettre à jour l'application pour continuer.
      </Text>
      {UPDATE_URL !== '' && (
        <TouchableOpacity style={styles.button} onPress={() => Linking.openURL(UPDATE_URL)}>
          <Text style={styles.buttonText}>Mettre à jour</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  message: {
    color: '#aaaaaa',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
  },
  button: {
    backgroundColor: '#e94560',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
