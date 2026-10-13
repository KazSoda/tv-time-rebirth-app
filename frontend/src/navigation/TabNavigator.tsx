import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SeriesScreen from '../screens/SeriesScreen';
import FilmsScreen from '../screens/FilmsScreen';
import ExplorerScreen from '../screens/ExplorerScreen';
import ProfilScreen from '../screens/ProfilScreen';

const Tab = createBottomTabNavigator();

const colors = {
  background: '#16213e',
  border: '#1f4068',
  primary: '#e94560',
  muted: '#8892a4',
  text: '#ffffff',
};

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS = [
  { name: 'Séries',    component: SeriesScreen,   icon: 'tv-outline' as IoniconName,        iconActive: 'tv' as IoniconName },
  { name: 'Films',     component: FilmsScreen,    icon: 'film-outline' as IoniconName,      iconActive: 'film' as IoniconName },
  { name: 'Explorer',  component: ExplorerScreen, icon: 'search-outline' as IoniconName,    iconActive: 'search' as IoniconName },
  { name: 'Profil',    component: ProfilScreen,   icon: 'person-outline' as IoniconName,    iconActive: 'person' as IoniconName },
];

export default function TabNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const tab = TABS.find((t) => t.name === route.name);
        return {
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            paddingTop: 8,
            // Inset explicite pour les appareils Samsung qui ne le remontent pas correctement
            paddingBottom: insets.bottom + 4,
            height: 56 + insets.bottom + 4,
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
          },
          tabBarIcon: ({ focused, color, size }) => {
            const iconName = focused ? tab?.iconActive : tab?.icon;
            return <Ionicons name={iconName ?? 'help-outline'} size={size} color={color} />;
          },
        };
      }}
    >
      {TABS.map((tab) => (
        <Tab.Screen key={tab.name} name={tab.name} component={tab.component} />
      ))}
    </Tab.Navigator>
  );
}
