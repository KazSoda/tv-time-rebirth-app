import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';

const colors = {
  background: '#1a1a2e',
  accent: '#16213e',
  primary: '#e94560',
  text: '#ffffff',
  muted: '#8892a4',
};

export default function HomeScreen() {
  const { logout, user } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>TV Rebirth</Text>
          {user && (
            <Text style={styles.greeting}>Hey, {user.username}!</Text>
          )}
        </View>

        {/* Placeholder */}
        <View style={styles.placeholder}>
          <Text style={styles.comingSoon}>Coming soon</Text>
          <Text style={styles.placeholderText}>
            Your personalized watchlist, episode tracker, and show discovery feed are on the way.
          </Text>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} onPress={logout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logo: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1,
  },
  greeting: {
    fontSize: 16,
    color: colors.muted,
    marginTop: 6,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  comingSoon: {
    fontSize: 42,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  placeholderText: {
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  logoutButton: {
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.5,
  },
});
