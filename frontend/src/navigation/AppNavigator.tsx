import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import TabNavigator from './TabNavigator';
import DetailScreen from '../screens/DetailScreen';
import EpisodeDetailScreen from '../screens/EpisodeDetailScreen';
import ProfileSeriesScreen from '../screens/ProfileSeriesScreen';
import ProfileFilmsScreen from '../screens/ProfileFilmsScreen';
import ImportScreen from '../screens/ImportScreen';
import StatisticsScreen from '../screens/StatisticsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import FollowListScreen from '../screens/FollowListScreen';
import UserProfileScreen from '../screens/UserProfileScreen';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Main: undefined;
  Detail: {
    id: number;
    mediaType: 'movie' | 'tv';
    title: string;
  };
  EpisodeDetail: {
    seriesId: number;
    seriesName: string;
    seasonNumber: number;
    episodeNumber: number;
    episodeName: string;
    stillPath: string | null;
  };
  ProfileSeries: { favoritesOnly?: boolean; username?: string };
  ProfileFilms:  { favoritesOnly?: boolean; username?: string };
  Import: undefined;
  Statistics: undefined;
  Settings: undefined;
  FollowList: { type: 'following' | 'followers' };
  UserProfile: { username: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background:   '#1a1a2e',
    card:         '#16213e',
    primary:      '#e94560',
    text:         '#ffffff',
    border:       '#1f4068',
    notification: '#e94560',
  },
};

function SplashScreen() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color="#e94560" />
    </View>
  );
}

export default function AppNavigator() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <SplashScreen />;

  return (
    <NavigationContainer theme={AppTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#1a1a2e' } }}>
        {user ? (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen
              name="Detail"
              component={DetailScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="EpisodeDetail"
              component={EpisodeDetailScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ProfileSeries"
              component={ProfileSeriesScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ProfileFilms"
              component={ProfileFilmsScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Import"
              component={ImportScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Statistics"
              component={StatisticsScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="FollowList"
              component={FollowListScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="UserProfile"
              component={UserProfileScreen}
              options={{ animation: 'slide_from_right' }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
