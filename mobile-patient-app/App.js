import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";

function normalizeBaseUrl(rawUrl) {
  return String(rawUrl || "").trim().replace(/\/+$/, "");
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [webKey, setWebKey] = useState(0);

  const baseUrl = useMemo(() => normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL), []);
  const webAppUrl = baseUrl ? `${baseUrl}/app/patient-login` : "";

  if (!webAppUrl) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="light-content" />
        <ExpoStatusBar style="light" />
        <View style={styles.centerPanel}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>ML</Text>
          </View>
          <Text style={styles.title}>MediLink Patient App</Text>
          <Text style={styles.message}>
            The mobile app is now patient-only. Patients sign in with their ID and password to view their own medical record.
          </Text>
          <Text style={styles.helperText}>
            Start the backend, set EXPO_PUBLIC_API_URL, then reopen the app.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <ExpoStatusBar style="light" />

    

      <View style={styles.webContainer}>
        <WebView
          key={webKey}
          source={{ uri: webAppUrl }}
          startInLoadingState
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          allowsBackForwardNavigationGestures
          onShouldStartLoadWithRequest={(request) => {
            const url = String(request?.url || "");
            const blockedPaths = ["/login", "/patient-access", "/dashboard"];
            const shouldBlock =
              baseUrl &&
              blockedPaths.some((path) => url.startsWith(`${baseUrl}${path}`)) &&
              !url.startsWith(`${baseUrl}/app/patient-login`);

            if (shouldBlock) {
              setLoadError("");
              setIsLoading(true);
              setWebKey((value) => value + 1);
              return false;
            }

            return true;
          }}
          onLoadStart={() => {
            setIsLoading(true);
            setLoadError("");
          }}
          onLoadEnd={() => {
            setIsLoading(false);
          }}
          onError={(event) => {
            setIsLoading(false);
            setLoadError(event?.nativeEvent?.description || "Could not open the MediLink patient app.");
          }}
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#0f4c81" />
              <Text style={styles.loadingText}>Opening your medical record...</Text>
            </View>
          )}
        />

        {isLoading ? (
          <View pointerEvents="none" style={styles.inlineLoader}>
            <ActivityIndicator size="small" color="#0f4c81" />
          </View>
        ) : null}
      </View>

      {loadError ? (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => setWebKey((value) => value + 1)}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  header: {
    backgroundColor: "#0f4c81",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
  },
  headerSubtitle: {
    color: "#dbeafe",
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  webContainer: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  inlineLoader: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    gap: 12,
  },
  loadingText: {
    color: "#0f4c81",
    fontSize: 15,
    fontWeight: "600",
  },
  centerPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "#0f172a",
  },
  logoCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  logoCircleSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    color: "#0f4c81",
    fontSize: 30,
    fontWeight: "800",
  },
  logoTextSmall: {
    color: "#0f4c81",
    fontSize: 18,
    fontWeight: "800",
  },
  title: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 12,
    textAlign: "center",
  },
  message: {
    color: "#e2e8f0",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 10,
  },
  helperText: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  errorBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff1f2",
    borderTopWidth: 1,
    borderTopColor: "#fecdd3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  errorText: {
    flex: 1,
    color: "#9f1239",
    fontSize: 13,
    lineHeight: 18,
  },
  retryButton: {
    backgroundColor: "#0f4c81",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  retryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
  },
});
