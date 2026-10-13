import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import UpdateScreen from './src/screens/UpdateScreen';
import { setUpdateRequiredHandler } from './src/services/api';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <ScrollView style={{ flex: 1, backgroundColor: '#1a1a2e', padding: 20, paddingTop: 60 }}>
          <Text style={{ color: '#e94560', fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
            ERREUR JS — copie ce message :
          </Text>
          <Text style={{ color: '#ffffff', fontSize: 13 }}>{err.message}</Text>
          <Text style={{ color: '#aaaaaa', fontSize: 11, marginTop: 10 }}>{err.stack}</Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [updateRequired, setUpdateRequired] = useState(false);

  useEffect(() => {
    setUpdateRequiredHandler(() => setUpdateRequired(true));
  }, []);

  return (
    <ErrorBoundary>
      <View style={{ flex: 1, backgroundColor: '#1a1a2e' }}>
        <StatusBar style="light" backgroundColor="#1a1a2e" />
        {updateRequired ? (
          <UpdateScreen />
        ) : (
          <AuthProvider>
            <AppNavigator />
          </AuthProvider>
        )}
      </View>
    </ErrorBoundary>
  );
}
