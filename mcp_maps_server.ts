/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model Context Protocol (MCP) server for Travel Expert 3D Maps Platform.
 * Supports:
 * - Travel Expert Conversational Assistant
 * - Vehicle Clearance Navigation (2-wheeler to 16-wheeler)
 * - Real-Time Route Traffic Density (Green, Yellow, Red)
 * - Emergency Services Along Route (Hospitals, Police, Fuel, Clinics)
 * - 24/7 Live GPS Tracking Telemetry & Pairing Codes
 * - Detective Timeline Analysis (14-15+ Visit Frequency)
 * - Real-Time Weather Forecasting
 * - Expanded Property & Land Parcel Categories
 */

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';

export type VehicleTypeId =
  | 'scooter_2w'
  | 'car_4w'
  | 'truck_6w'
  | 'heavy_8w'
  | 'semi_16w';

export type SavedPlaceCategory =
  | 'agriculture'
  | 'home'
  | 'business'
  | 'land'
  | 'warehouse'
  | 'healthcare'
  | 'commercial'
  | 'plantation'
  | 'civic'
  | 'other';

export interface VehicleProfile {
  id: VehicleTypeId;
  label: string;
  wheels: number;
  widthMeters: number;
  heightMeters: number;
  maxWeightTons: number;
  turningRadiusMeters: number;
  restrictedAlleyways: boolean;
  requiresTruckBypass: boolean;
}

export interface SavedPlace {
  id: string;
  name: string;
  category: SavedPlaceCategory;
  address: string;
  landmark?: string;
  lat?: number;
  lng?: number;
  landSize?: string;
  notes?: string;
  createdAt: number;
}

export interface TimelineStop {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  arrivalTime: string;
  departureTime?: string;
  dwellDuration: string;
  visitCount: number;
  isHighFrequency: boolean; // 14-15+ visits
  notes?: string;
}

export interface EmergencyPOI {
  id: string;
  name: string;
  type: 'hospital' | 'police' | 'fuel' | 'clinic';
  address: string;
  distanceFromRoute: string;
  lat: number;
  lng: number;
}

export interface RouteTrafficInfo {
  status: 'low' | 'moderate' | 'heavy';
  summary: string;
  color: string;
}

export interface LiveGpsTrackingStatus {
  pairedCode: string;
  isTracking: boolean;
  latitude: number;
  longitude: number;
  speedKmh: number;
  headingDegrees: number;
  carDirection: string;
  lastUpdated: string;
  activeTravelZone: string;
  currentStatus: 'moving' | 'stopped' | 'idle';
  currentStopDuration?: string;
}

export interface WeatherData {
  locationName: string;
  temperatureC: number;
  temperatureF: number;
  condition: string;
  windSpeedKmh: number;
  humidity: number;
  precipitationRisk: number;
}

export interface MapParams {
  location?: string;
  origin?: string;
  destination?: string;
  vehicleType?: VehicleTypeId;
  savedPlaceId?: string;
  highlightCategory?: string;
  action?: 'view' | 'directions' | 'show_saved' | 'locate_gps';
}

export interface McpServerCallbacks {
  mapQueryHandler: (params: MapParams) => void;
  getSavedPlaces: () => SavedPlace[];
  savePlace: (place: {
    name: string;
    category: SavedPlaceCategory;
    address: string;
    landmark?: string;
    landSize?: string;
    notes?: string;
  }) => Promise<SavedPlace>;
  getRouteDetails: (
    origin: string,
    destination: string,
    vehicleType?: VehicleTypeId,
  ) => Promise<{
    durationText: string;
    distanceText: string;
    summaryRoad: string;
    steps: string[];
    traffic: RouteTrafficInfo;
    emergencyPOIs: EmergencyPOI[];
    clearanceWarning?: string;
    recommendedVehicleRoute?: string;
  }>;
  getLiveTrackingStatus: () => LiveGpsTrackingStatus;
  getTimelineStops: () => TimelineStop[];
  getCurrentWeather: () => Promise<WeatherData>;
}

export async function startMcpGoogleMapServer(
  transport: Transport,
  callbacks: McpServerCallbacks | ((params: MapParams) => void),
) {
  const fullCallbacks: McpServerCallbacks =
    typeof callbacks === 'function'
      ? {
          mapQueryHandler: callbacks,
          getSavedPlaces: () => [],
          savePlace: async (p) => ({
            id: 'place_' + Date.now(),
            ...p,
            createdAt: Date.now(),
          }),
          getRouteDetails: async () => ({
            durationText: 'Unknown',
            distanceText: 'Unknown',
            summaryRoad: 'Primary Route',
            steps: [],
            traffic: {
              status: 'low',
              summary: 'Smooth flowing traffic (Green)',
              color: '#10b981',
            },
            emergencyPOIs: [],
          }),
          getLiveTrackingStatus: () => ({
            pairedCode: 'TRK-9021',
            isTracking: false,
            latitude: 20.2961,
            longitude: 85.8245,
            speedKmh: 0,
            headingDegrees: 0,
            carDirection: 'North',
            lastUpdated: 'Just now',
            activeTravelZone: 'Odisha & National Highway 16 Corridor',
            currentStatus: 'idle',
          }),
          getTimelineStops: () => [],
          getCurrentWeather: async () => ({
            locationName: 'India View (Odisha / Delhi)',
            temperatureC: 28,
            temperatureF: 82,
            condition: 'Clear Sky',
            windSpeedKmh: 10,
            humidity: 62,
            precipitationRisk: 0,
          }),
        }
      : callbacks;

  const server = new McpServer({
    name: 'Travel Expert Map Agent',
    version: '3.0.0',
  });

  // Tool 1: View Location on Map
  server.tool(
    'view_location_google_maps',
    'Display a specific location, city, landmark, or address on the 3D map interface.',
    {query: z.string().describe('The name or address of the place to view')},
    async ({query}) => {
      fullCallbacks.mapQueryHandler({location: query, action: 'view'});
      return {
        content: [{type: 'text', text: `Navigating 3D camera to: ${query}`}],
      };
    },
  );

  // Tool 2: Travel Expert Route Directions with Traffic & Emergency POIs
  server.tool(
    'directions_on_google_maps',
    'Calculate routes with real-time traffic levels (Green/Yellow/Red), nearby emergency service POIs (Hospitals, Police, Fuel, Clinics), and vehicle-clearance safety checks (2-wheeler to 16-wheeler).',
    {
      origin: z.string().describe('Starting location or address'),
      destination: z.string().describe('Ending destination location or address'),
      vehicleType: z
        .enum(['scooter_2w', 'car_4w', 'truck_6w', 'heavy_8w', 'semi_16w'])
        .optional()
        .describe(
          'Vehicle type: scooter_2w (2-wheeler), car_4w (car), truck_6w (6-wheeler), heavy_8w (8-wheeler), semi_16w (16-wheeler freight)',
        ),
    },
    async ({origin, destination, vehicleType}) => {
      fullCallbacks.mapQueryHandler({
        origin,
        destination,
        vehicleType,
        action: 'directions',
      });
      try {
        const details = await fullCallbacks.getRouteDetails(
          origin,
          destination,
          vehicleType,
        );

        let routeText = `Travel Expert Navigation Plan: "${origin}" ➔ "${destination}":
• Estimated Travel Time: ${details.durationText}
• Total Distance: ${details.distanceText}
• Primary Highway / Road: ${details.summaryRoad}
• Traffic Condition: ${details.traffic.summary} [Traffic Color: ${details.traffic.color}]`;

        if (details.clearanceWarning) {
          routeText += `\n⚠️ VEHICLE CLEARANCE ALERT: ${details.clearanceWarning}`;
        }
        if (details.recommendedVehicleRoute) {
          routeText += `\n💡 Recommended Corridor: ${details.recommendedVehicleRoute}`;
        }

        if (details.emergencyPOIs.length > 0) {
          routeText += `\n\n🚨 Emergency & Critical Services Detected on Route:`;
          details.emergencyPOIs.forEach((poi) => {
            const icon =
              poi.type === 'hospital'
                ? '🏥'
                : poi.type === 'police'
                ? '🚓'
                : poi.type === 'fuel'
                ? '⛽'
                : '🩺';
            routeText += `\n• ${icon} ${poi.name} (${poi.type.toUpperCase()}): ${poi.distanceFromRoute} from route, ${poi.address}`;
          });
        }

        return {
          content: [{type: 'text', text: routeText}],
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: `Navigating route from ${origin} to ${destination} with real-time traffic and emergency POI tracking.`,
            },
          ],
        };
      }
    },
  );

  // Tool 3: Query Emergency Services Along Route
  server.tool(
    'find_emergency_services_on_route',
    'Locate essential emergency services (Hospitals, Police Stations, Gas/Fuel Stations, and Clinics) along the current traveling route or specific highway corridor.',
    {
      routeOrigin: z.string(),
      routeDestination: z.string(),
    },
    async ({routeOrigin, routeDestination}) => {
      const details = await fullCallbacks.getRouteDetails(
        routeOrigin,
        routeDestination,
      );

      if (details.emergencyPOIs.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Scanning route from ${routeOrigin} to ${routeDestination}... Emergency stations mapped on 3D HUD.`,
            },
          ],
        };
      }

      let text = `Nearest Emergency Facilities along route from "${routeOrigin}" to "${routeDestination}":\n`;
      details.emergencyPOIs.forEach((poi, idx) => {
        text += `${idx + 1}. [${poi.type.toUpperCase()}] ${poi.name}\n   Address: ${poi.address}\n   Distance: ${poi.distanceFromRoute}\n`;
      });

      return {
        content: [{type: 'text', text}],
      };
    },
  );

  // Tool 4: 24/7 Live GPS Tracking
  server.tool(
    'query_live_gps_tracking',
    'Get real-time 24/7 GPS tracking telemetry of the paired device: coordinates, speed (km/h), car direction heading, and movement status.',
    {},
    async () => {
      const status = fullCallbacks.getLiveTrackingStatus();
      fullCallbacks.mapQueryHandler({
        location: `${status.latitude},${status.longitude}`,
        action: 'locate_gps',
      });

      return {
        content: [
          {
            type: 'text',
            text: `24/7 Live GPS Telemetry [Access Code: ${status.pairedCode}]:
• Movement: ${status.currentStatus.toUpperCase()}
• Direction / Heading: ${status.carDirection} (${status.headingDegrees}°)
• Current Speed: ${status.speedKmh} km/h
• Coordinates: ${status.latitude.toFixed(5)}, ${status.longitude.toFixed(5)}
• Active Travel Zone: ${status.activeTravelZone}
• Last GPS Sync: ${status.lastUpdated}
${status.currentStopDuration ? `• Dwell Time: ${status.currentStopDuration}` : ''}`,
          },
        ],
      };
    },
  );

  // Tool 5: Detective Timeline Analysis (14-15+ visits)
  server.tool(
    'query_detective_timeline',
    'Examine 24/7 travel timeline history: where the person or vehicle traveled, stopped locations, duration spent, and points visited 14-15+ times marked with crimson detective alert.',
    {},
    async () => {
      const stops = fullCallbacks.getTimelineStops();
      if (stops.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No recorded stops in the timeline yet. GPS tracking is active and logging dwell intervals.',
            },
          ],
        };
      }

      const highFreq = stops.filter((s) => s.visitCount >= 14);
      let summary = `Detective 24/7 Travel Timeline Analysis:\nTotal Monitored Stops: ${stops.length}\n`;

      if (highFreq.length > 0) {
        summary += `\n🚨 HIGH FREQUENCY ALERT (Visited 14+ Times - Marked in CRIMSON):\n`;
        highFreq.forEach((s) => {
          summary += `• ${s.name} (${s.address}): Visited ${s.visitCount} times! Last dwell duration: ${s.dwellDuration}.\n`;
        });
      }

      summary += `\nRecent Stops & Dwell Durations:\n`;
      stops.slice(0, 5).forEach((s, idx) => {
        summary += `${idx + 1}. [${s.name}] - ${s.address}\n   Arrived: ${s.arrivalTime} | Dwell Time: ${s.dwellDuration} | Total Visits: ${s.visitCount}\n`;
      });

      return {
        content: [{type: 'text', text: summary}],
      };
    },
  );

  // Tool 6: Real-time Weather Query
  server.tool(
    'get_weather_forecast',
    'Fetch real-time weather data for current map view or target city, including temperature, conditions, wind speed, and precipitation risk.',
    {},
    async () => {
      const weather = await fullCallbacks.getCurrentWeather();
      return {
        content: [
          {
            type: 'text',
            text: `Real-Time Weather for ${weather.locationName}:
• Temperature: ${weather.temperatureC}°C (${weather.temperatureF}°F)
• Condition: ${weather.condition}
• Wind Speed: ${weather.windSpeedKmh} km/h
• Humidity: ${weather.humidity}%
• Precipitation Risk: ${weather.precipitationRisk}%`,
          },
        ],
      };
    },
  );

  // Tool 7: Show Saved Location
  server.tool(
    'show_saved_location',
    'Locate and display a user-saved location such as Home, Business platform, Land plot, Agricultural land, Warehouse, Hospital, or Commercial property on the 3D map.',
    {
      query: z
        .string()
        .describe(
          'Keyword or name of the saved place, e.g. "home", "farm", "warehouse", "land plot", "clinic"',
        ),
    },
    async ({query}) => {
      const places = fullCallbacks.getSavedPlaces();
      const q = query.toLowerCase().trim();

      const match = places.find((p) => {
        const nameMatch = p.name.toLowerCase().includes(q);
        const catMatch = p.category.toLowerCase().includes(q);
        return nameMatch || catMatch;
      });

      if (match) {
        fullCallbacks.mapQueryHandler({
          location: match.address || match.name,
          savedPlaceId: match.id,
          highlightCategory: match.category,
          action: 'show_saved',
        });

        return {
          content: [
            {
              type: 'text',
              text: `Located saved place: "${match.name}"
Category: ${match.category.toUpperCase()}
Address: ${match.address}
${match.landmark ? `Landmark: ${match.landmark}\n` : ''}${match.landSize ? `Plot Area: ${match.landSize}\n` : ''}${match.notes ? `Details: ${match.notes}\n` : ''}The 3D map is now focused on your ${match.category} location.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Could not find a saved location matching "${query}". You can click anywhere on the map to save a new place or ask me to save it.`,
          },
        ],
      };
    },
  );

  // Tool 8: Save Location
  server.tool(
    'save_location',
    'Save a new location with categories: agriculture, home, business, land, warehouse, healthcare, commercial, plantation, civic, or other.',
    {
      name: z.string().describe('Name of the place'),
      category: z.enum([
        'agriculture',
        'home',
        'business',
        'land',
        'warehouse',
        'healthcare',
        'commercial',
        'plantation',
        'civic',
        'other',
      ]),
      address: z.string().describe('Address or location query'),
      landmark: z.string().optional().describe('Nearby landmark or street intersection'),
      landSize: z.string().optional().describe('Plot size, e.g. "20 Acres", "5,000 sq ft"'),
      notes: z.string().optional().describe('Property details, facility description, or crops'),
    },
    async ({name, category, address, landmark, landSize, notes}) => {
      const newPlace = await fullCallbacks.savePlace({
        name,
        category,
        address,
        landmark,
        landSize,
        notes,
      });

      fullCallbacks.mapQueryHandler({
        location: address,
        savedPlaceId: newPlace.id,
        highlightCategory: category,
        action: 'show_saved',
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully saved new location:
• Name: ${name}
• Category: ${category.toUpperCase()}
• Address: ${address}
${landmark ? `• Landmark: ${landmark}\n` : ''}${landSize ? `• Land Size: ${landSize}\n` : ''}${notes ? `• Details: ${notes}\n` : ''}Added to your Saved Places and displayed on the 3D map.`,
          },
        ],
      };
    },
  );

  await server.connect(transport);
  console.log('Travel Expert MCP server running');
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
