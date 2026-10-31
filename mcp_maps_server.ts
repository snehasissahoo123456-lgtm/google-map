/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model Context Protocol (MCP) server for Google Maps 3D,
 * Vehicle Clearance Routing (2-wheeler to 16-wheeler),
 * 24/7 Live GPS Tracking, Detective Timeline, Weather HUD, and Saved Locations.
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
  category: 'home' | 'business' | 'land' | 'agriculture' | 'other';
  address: string;
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
    category: 'home' | 'business' | 'land' | 'agriculture' | 'other';
    address: string;
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
          }),
          getLiveTrackingStatus: () => ({
            pairedCode: 'TRK-9021',
            isTracking: false,
            latitude: 37.7749,
            longitude: -122.4194,
            speedKmh: 0,
            headingDegrees: 0,
            carDirection: 'North',
            lastUpdated: 'Just now',
            activeTravelZone: 'Metro Zone',
            currentStatus: 'idle',
          }),
          getTimelineStops: () => [],
          getCurrentWeather: async () => ({
            locationName: 'Current View',
            temperatureC: 22,
            temperatureF: 72,
            condition: 'Clear Sky',
            windSpeedKmh: 12,
            humidity: 45,
            precipitationRisk: 0,
          }),
        }
      : callbacks;

  const server = new McpServer({
    name: 'AI Studio Detective Map Agent',
    version: '2.0.0',
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

  // Tool 2: Vehicle-Aware Directions on Google Maps
  server.tool(
    'directions_on_google_maps',
    'Search Google Maps for driving directions tailored to vehicle types (scooter/bike 2-wheeler, car 4-wheeler, 6-wheeler truck, 8-wheeler commercial, 16-wheeler heavy freight). Checks road clearance, weight/turning restrictions, and warns about road jams.',
    {
      origin: z.string().describe('Starting location or address'),
      destination: z.string().describe('Ending destination location or address'),
      vehicleType: z
        .enum(['scooter_2w', 'car_4w', 'truck_6w', 'heavy_8w', 'semi_16w'])
        .optional()
        .describe(
          'Vehicle type: scooter_2w (bike/scooter), car_4w (car), truck_6w (6-wheeler), heavy_8w (8-wheeler), semi_16w (16-wheeler freight)',
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
        let routeText = `Route calculated from "${origin}" to "${destination}":
• Estimated travel time: ${details.durationText}
• Distance: ${details.distanceText}
• Primary route: ${details.summaryRoad}`;

        if (details.clearanceWarning) {
          routeText += `\n⚠️ VEHICLE CLEARANCE ALERT: ${details.clearanceWarning}`;
        }
        if (details.recommendedVehicleRoute) {
          routeText += `\n💡 Recommended Corridor: ${details.recommendedVehicleRoute}`;
        }
        if (details.steps.length > 0) {
          routeText += `\n• Guidance: ${details.steps[0]}`;
        }

        return {
          content: [{type: 'text', text: routeText}],
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: `Navigating route from ${origin} to ${destination} for ${
                vehicleType || 'standard vehicle'
              }`,
            },
          ],
        };
      }
    },
  );

  // Tool 3: Check Vehicle Road Clearance & Jam Hazard
  server.tool(
    'check_vehicle_clearance',
    'Analyze route road geometry, low bridge overpasses, tight turns, and road jam risks for large commercial vehicles (6-wheeler, 8-wheeler, 16-wheeler). Advises whether vehicle can pass or must use truck bypass corridors.',
    {
      routeOrigin: z.string(),
      routeDestination: z.string(),
      vehicleType: z
        .enum(['scooter_2w', 'car_4w', 'truck_6w', 'heavy_8w', 'semi_16w'])
        .describe('The vehicle type being operated'),
    },
    async ({routeOrigin, routeDestination, vehicleType}) => {
      const details = await fullCallbacks.getRouteDetails(
        routeOrigin,
        routeDestination,
        vehicleType,
      );

      let advice = '';
      if (vehicleType === 'semi_16w') {
        advice =
          '16-Wheeler Heavy Freight: Avoid downtown alleys, historic archways, and residential roads. Restricted turning radius (18m). Use National Highway freight corridors and expressway ring-roads.';
      } else if (vehicleType === 'heavy_8w') {
        advice =
          '8-Wheeler Multi-Axle: Max load 25 tons. Avoid sub-arterial streets with low hanging utility cables or weight-restricted bridges.';
      } else if (vehicleType === 'truck_6w') {
        advice =
          '6-Wheeler Medium Delivery: Suitable for major city avenues; avoid narrow market lanes during peak hours.';
      } else if (vehicleType === 'scooter_2w') {
        advice =
          '2-Wheeler Scooter/Bike: Unrestricted through narrow alleys, but prohibit access onto high-speed grade-separated expressways where 2-wheelers are barred.';
      } else {
        advice = '4-Wheeler Car: Standard road network access permitted.';
      }

      return {
        content: [
          {
            type: 'text',
            text: `Vehicle Clearance Analysis [${vehicleType.toUpperCase()}]:
Origin: ${routeOrigin} ➔ Destination: ${routeDestination}
Clearance Status: ${details.clearanceWarning ? 'RESTRICTED / CAUTION' : 'CLEAR PASS'}
${details.clearanceWarning ? `Warning: ${details.clearanceWarning}\n` : ''}
Advice: ${advice}
Estimated Duration: ${details.durationText} via ${details.summaryRoad}`,
          },
        ],
      };
    },
  );

  // Tool 4: 24/7 Live GPS Tracking & Direction Status
  server.tool(
    'query_live_gps_tracking',
    'Get real-time 24/7 GPS tracking telemetry of the paired device: current coordinates, speed (km/h), car heading direction (N, NE, S, etc.), movement status (moving/stopped), and current active travel zone.',
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
            text: `24/7 Live GPS Tracking Telemetry [Code: ${status.pairedCode}]:
• Device Status: ${status.currentStatus.toUpperCase()}
• Car Direction & Heading: ${status.carDirection} (${status.headingDegrees}°)
• Live Speed: ${status.speedKmh} km/h
• Coordinates: ${status.latitude.toFixed(5)}, ${status.longitude.toFixed(5)}
• Active Travel Zone: ${status.activeTravelZone}
• Last Signal: ${status.lastUpdated}
${
  status.currentStopDuration
    ? `• Current Stopped Dwell Time: ${status.currentStopDuration}`
    : ''
}
The 3D map camera is now focused on the live GPS beacon.`,
          },
        ],
      };
    },
  );

  // Tool 5: Detective Timeline & Frequent Stop Analysis (14-15+ visits)
  server.tool(
    'query_detective_timeline',
    'Examine 24/7 travel timeline history: where the person or vehicle traveled, stopped locations, duration spent in each place, and identify points visited repeatedly (14-15+ times) marked with detective frequency colors.',
    {},
    async () => {
      const stops = fullCallbacks.getTimelineStops();
      if (stops.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No recorded stops in the timeline yet. GPS tracking is active and will log dwell intervals automatically as stops occur.',
            },
          ],
        };
      }

      const highFreq = stops.filter((s) => s.visitCount >= 14);
      const regular = stops.filter((s) => s.visitCount < 14);

      let summary = `Detective 24/7 Travel Timeline Analysis:\nTotal Monitored Stops: ${stops.length}\n`;

      if (highFreq.length > 0) {
        summary += `\n🚨 FREQUENT PATTERN ALERT (Visited 14+ Times - Marked in CRIMSON):\n`;
        highFreq.forEach((s) => {
          summary += `• ${s.name} (${s.address}): Visited ${s.visitCount} times! Last dwell duration: ${s.dwellDuration}. (Marked as Priority Location)\n`;
        });
      }

      summary += `\nRecent Recorded Stops & Time Spent:\n`;
      stops.slice(0, 5).forEach((s, idx) => {
        summary += `${idx + 1}. [${s.name}] - ${s.address}\n   Arrived: ${
          s.arrivalTime
        } | Duration Stopped: ${s.dwellDuration} | Total Visits: ${
          s.visitCount
        }\n`;
      });

      return {
        content: [{type: 'text', text: summary}],
      };
    },
  );

  // Tool 6: Real-time Weather Query
  server.tool(
    'get_weather_forecast',
    'Fetch real-time weather data for the current map view or target city, including temperature, conditions, wind speed, and precipitation risk.',
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
    'Locate and display a user-saved location such as Home, Business platform, Land plot, or Agricultural land on the 3D map.',
    {
      query: z
        .string()
        .describe(
          'Keyword, category, or name of the saved place, e.g. "home", "farm", "agricultural land", "business platform"',
        ),
    },
    async ({query}) => {
      const places = fullCallbacks.getSavedPlaces();
      const q = query.toLowerCase().trim();

      const match = places.find((p) => {
        const nameMatch = p.name.toLowerCase().includes(q);
        const catMatch = p.category.toLowerCase().includes(q);
        const isAgro =
          (q.includes('agri') || q.includes('farm') || q.includes('crop')) &&
          p.category === 'agriculture';
        const isLand =
          (q.includes('land') || q.includes('plot')) &&
          (p.category === 'land' || p.category === 'agriculture');
        const isBiz =
          (q.includes('business') ||
            q.includes('office') ||
            q.includes('platform')) &&
          p.category === 'business';
        const isHome =
          (q.includes('home') || q.includes('house')) && p.category === 'home';

        return nameMatch || catMatch || isAgro || isLand || isBiz || isHome;
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
${match.landSize ? `Land/Plot Area: ${match.landSize}\n` : ''}${
                match.notes ? `Details: ${match.notes}\n` : ''
              }The 3D map is now focused on your ${match.category} location.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Could not find a saved location matching "${query}". You can ask me to save a new place or list your saved locations.`,
          },
        ],
      };
    },
  );

  // Tool 8: Save Location
  server.tool(
    'save_location',
    'Save a new location with categories: home, business, land, agriculture, or other.',
    {
      name: z.string().describe('Name of the place'),
      category: z.enum(['home', 'business', 'land', 'agriculture', 'other']),
      address: z.string().describe('Address or location query'),
      landSize: z.string().optional().describe('Plot size, e.g. "20 Acres"'),
      notes: z.string().optional().describe('Property details or crops grown'),
    },
    async ({name, category, address, landSize, notes}) => {
      const newPlace = await fullCallbacks.savePlace({
        name,
        category,
        address,
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
${landSize ? `• Land Size: ${landSize}\n` : ''}${
              notes ? `• Details: ${notes}\n` : ''
            }Added to your Saved Places and displayed on the 3D map.`,
          },
        ],
      };
    },
  );

  await server.connect(transport);
  console.log(
    'MCP Maps server running with Vehicle Clearance, 24/7 Tracking, Detective Timeline, Weather HUD & Voice tools',
  );
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
