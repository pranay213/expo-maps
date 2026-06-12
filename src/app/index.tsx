import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LatLng, Marker, OlaMapView, OlaPlacesModule, OlaNavigationModule, NavigationScreen } from 'rn-ola-maps';

const OLA_API_KEY = 'yoEiCf9bZV4nrjZh4jnl3UwET71IoKmsjJRet18G';

export default function App() {
  const insets = useSafeAreaInsets();

  // Location and map states
  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng>({ latitude: 12.9716, longitude: 77.5946 }); // Default: Bengaluru
  const [zoom, setZoom] = useState<number>(15);
  const [selectedPlace, setSelectedPlace] = useState<Marker | null>(null);
  const [routePoints, setRoutePoints] = useState<LatLng[]>([]);
  const [routeInfo, setRouteInfo] = useState<any>(null);
  const [rawRouteJson, setRawRouteJson] = useState<string>('');
  const [showNavPreview, setShowNavPreview] = useState<boolean>(false);
  const [locationLoading, setLocationLoading] = useState<boolean>(true);

  // Search states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [predictions, setPredictions] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);

  // Initialize Places SDK and request location on mount
  useEffect(() => {
    OlaPlacesModule.initPlaces(OLA_API_KEY);
    let locationSubscription: any = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          // Get initial position quickly
          const initialLoc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const coords = {
            latitude: initialLoc.coords.latitude,
            longitude: initialLoc.coords.longitude,
          };
          setCurrentLocation(coords);
          setMapCenter(coords);

          // Continually watch position and update user location
          locationSubscription = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 5000,
              distanceInterval: 10,
            },
            (loc) => {
              setCurrentLocation({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });
            }
          );
        }
      } catch (err) {
        console.warn('Error fetching location:', err);
      } finally {
        setLocationLoading(false);
      }
    })();

    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, []);

  // Intercept hardware Back button on Android to exit preview mode instead of closing the app
  useEffect(() => {
    const onBackPress = () => {
      if (showNavPreview) {
        setShowNavPreview(false);
        return true; // Intercepted
      }
      return false; // Default action (exit app)
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [showNavPreview]);

  // Debouncing effect for autocomplete with active-flag to prevent race conditions
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setPredictions([]);
      setSearchLoading(false);
      return;
    }

    let active = true;
    setSearchLoading(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const resultsJson = await OlaPlacesModule.fetchAutocomplete(searchQuery);
        if (!active) return;

        const data = JSON.parse(resultsJson);
        if (data && data.predictions) {
          setPredictions(data.predictions);
        } else {
          setPredictions([]);
        }
      } catch (error) {
        console.warn('Autocomplete error:', error);
        if (active) {
          setPredictions([]);
        }
      } finally {
        if (active) {
          setSearchLoading(false);
        }
      }
    }, 450);

    return () => {
      active = false;
      clearTimeout(delayDebounceFn);
    };
  }, [searchQuery]);

  const fetchRoutePoints = async (start: LatLng, end: LatLng) => {
    try {
      const url = `https://api.olamaps.io/routing/v1/directions?origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&api_key=${OLA_API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Request-Id': Math.random().toString(36).substring(2, 15),
          'Content-Type': 'application/json',
        },
      });
      const rawJson = await response.text();
      setRawRouteJson(rawJson);

      const data = JSON.parse(rawJson);
      if (data && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const pointsEncoded = route.overview_polyline;
        if (pointsEncoded) {
          const decoded = decodePolyline(pointsEncoded);
          setRoutePoints(decoded);
        }

        const leg = route.legs?.[0];
        if (leg) {
          setRouteInfo({
            distance: leg.readable_distance || `${(leg.distance / 1000).toFixed(2)} km`,
            duration: leg.readable_duration || `${Math.round(leg.duration / 60)} mins`,
            steps: (leg.steps || []).map((step: any) => ({
              instructions: step.instructions,
              distance: step.distance,
              readable_distance: step.readable_distance,
              duration: step.duration,
              readable_duration: step.readable_duration,
            })),
          });
        }
      }
    } catch (error) {
      console.warn('Error fetching directions:', error);
    }
  };

  // Handle place selection
  const handleSelectPrediction = async (prediction: any) => {
    Keyboard.dismiss();
    setSearchLoading(true);

    try {
      const detailsJson = await OlaPlacesModule.fetchPlaceDetails(prediction.place_id);
      const details = JSON.parse(detailsJson);
      const locationObj = details?.result?.geometry?.location || details?.geometry?.location;

      if (locationObj) {
        const lat = locationObj.lat;
        const lng = locationObj.lng;
        const newCoords = { latitude: lat, longitude: lng };

        const title = prediction.structured_formatting?.main_text || prediction.description || 'Selected Location';
        const snippet = prediction.structured_formatting?.secondary_text || '';

        setSelectedPlace({
          latitude: lat,
          longitude: lng,
          title,
          snippet,
          id: prediction.place_id,
        });

        setMapCenter(newCoords);
        setZoom(16);
        setSearchQuery('');
        setPredictions([]);

        if (currentLocation) {
          await fetchRoutePoints(currentLocation, newCoords);
        }
      }
    } catch (error) {
      console.warn('Error fetching place details:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const recenterToCurrent = () => {
    if (currentLocation) {
      // Perturb coordinate by an imperceptible fraction to ensure the RN bridge always sends center updates
      const perturbation = (Math.random() - 0.5) * 0.0000001;
      setMapCenter({
        latitude: currentLocation.latitude + perturbation,
        longitude: currentLocation.longitude + perturbation,
      });
      setZoom(15);
      setSelectedPlace(null);
      setSearchQuery('');
      setPredictions([]);
      setRoutePoints([]);
      setRouteInfo(null);
      setRawRouteJson('');
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setPredictions([]);
    setSelectedPlace(null);
    setRoutePoints([]);
    setRouteInfo(null);
    setRawRouteJson('');
  };

  // Memoize the OlaMapView to prevent redundant re-renders on keystrokes/debounces
  const renderedMap = useMemo(() => {
    return (
      <OlaMapView
        style={StyleSheet.absoluteFill}
        apiKey={OLA_API_KEY}
        center={mapCenter}
        zoom={zoom}
        markers={selectedPlace ? [selectedPlace] : []}
        routeCoordinates={routePoints}
        polylineColor="#00ffcc"
        polylineWidth={5}
        showMyLocation={true}
        mapStyle="dark"
        showTraffic={true}
        onMapClick={() => {
          Keyboard.dismiss();
          setPredictions([]);
        }}
      />
    );
  }, [mapCenter, zoom, selectedPlace, routePoints]);

  return (
    <View style={styles.container}>
      {/* Map View */}
      {renderedMap}

      {/* Search Header Overlay */}
      <View style={[styles.searchContainer, { paddingTop: Math.max(insets.top, 16) }]}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#64748b" style={styles.searchIcon} />

          <TextInput
            style={styles.input}
            placeholder="Search for a place..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />

          {searchLoading ? (
            <ActivityIndicator size="small" color="#0ea5e9" style={styles.actionIcon} />
          ) : searchQuery.length > 0 ? (
            <TouchableOpacity onPress={clearSearch} style={styles.actionIcon}>
              <Ionicons name="close-circle" size={20} color="#64748b" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Autocomplete Predictions List */}
        {predictions.length > 0 && (
          <View style={styles.predictionsList}>
            <FlatList
              data={predictions}
              keyExtractor={(item) => item.place_id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.predictionItem}
                  onPress={() => handleSelectPrediction(item)}
                >
                  <Ionicons name="location-outline" size={20} color="#0ea5e9" style={styles.pinIcon} />
                  <View style={styles.predictionTexts}>
                    <Text style={styles.mainText} numberOfLines={1}>
                      {item.structured_formatting?.main_text || item.description}
                    </Text>
                    {item.structured_formatting?.secondary_text && (
                      <Text style={styles.secondaryText} numberOfLines={1}>
                        {item.structured_formatting?.secondary_text}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>

      {/* Route Info bottom card */}
      {selectedPlace && routePoints.length > 0 && !showNavPreview && (
        <View style={[styles.bottomCard, { bottom: Math.max(insets.bottom, 20) + 84 }]}>
          <View style={styles.bottomCardContent}>
            <View style={styles.routeTextContainer}>
              <Text style={styles.routeTitle} numberOfLines={1}>
                {selectedPlace.title}
              </Text>
              {routeInfo && (
                <Text style={styles.routeSubtitle}>
                  {routeInfo.duration} • {routeInfo.distance}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.previewButton}
              onPress={() => setShowNavPreview(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="navigate" size={18} color="#ffffff" style={{ marginRight: 6 }} />
              <Text style={styles.previewButtonText}>Go</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Recenter Button */}
      {currentLocation && !showNavPreview && (
        <TouchableOpacity
          style={[
            styles.recenterButton,
            {
              bottom: selectedPlace && routePoints.length > 0
                ? Math.max(insets.bottom, 20) + 176
                : Math.max(insets.bottom, 20) + 16
            }
          ]}
          onPress={recenterToCurrent}
          activeOpacity={0.8}
        >
          <Ionicons name="locate" size={24} color="#0ea5e9" />
        </TouchableOpacity>
      )}

      {/* Navigation Preview Screen Modal */}
      {showNavPreview && routeInfo && selectedPlace && (
        <View style={StyleSheet.absoluteFill}>
          <NavigationScreen
            routeInfo={routeInfo}
            rawRouteJson={rawRouteJson}
            apiKey={OLA_API_KEY}
            origin={currentLocation || { latitude: 12.9716, longitude: 77.5946 }}
            destination={{ latitude: selectedPlace.latitude, longitude: selectedPlace.longitude }}
            destinationName={selectedPlace.title || 'Selected Destination'}
            originName="My Location"
            onBack={() => setShowNavPreview(false)}
            onStartNavigation={() =>
              OlaNavigationModule.startNavigation(rawRouteJson, OLA_API_KEY, 'driving')
            }
          />
        </View>
      )}

      {/* Initial Location Loading Overlay */}
      {locationLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0ea5e9" />
          <Text style={styles.loadingText}>Locating you...</Text>
        </View>
      )}
    </View>
  );
}

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  searchContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 52,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#0f172a',
    height: '100%',
    paddingVertical: 0,
  },
  actionIcon: {
    padding: 4,
  },
  predictionsList: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 250,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  predictionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pinIcon: {
    marginRight: 12,
  },
  predictionTexts: {
    flex: 1,
  },
  mainText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  secondaryText: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  recenterButton: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#ffffff',
    borderRadius: 30,
    width: 54,
    height: 54,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#64748b',
    fontWeight: '500',
  },
  bottomCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  bottomCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routeTextContainer: {
    flex: 1,
    marginRight: 16,
  },
  routeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  routeSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
  },
  previewButton: {
    backgroundColor: '#0ea5e9',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  previewButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});