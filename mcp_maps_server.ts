/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file defines and runs an MCP (Model Context Protocol) server.
 * The server exposes tools that an AI model (like Gemini) can call to interact
 * with Google Maps functionality, saved places (Home, Business, Land, Agriculture),
 * and real-time travel & navigation.
 */

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';

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

export interface MapParams {
  location?: string;
  origin?: string;
  destination?: string;
  savedPlaceId?: string;
  highlightCategory?: string;
  action?: 'view' | 'directions' | 'show_saved';
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
  ) => Promise<{
    durationText: string;
    distanceText: string;
    summaryRoad: string;
    steps: string[];
  }>;
}

export async function startMcpGoogleMapServer(
  transport: Transport,
  callbacks: McpServerCallbacks | ((params: MapParams) => void),
) {
  // Normalize callbacks to support both function and full callback object
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
        }
      : callbacks;

  const server = new McpServer({
    name: 'AI Studio Google Map Agent',
    version: '1.2.0',
  });

  // Tool 1: View Location
  server.tool(
    'view_location_google_maps',
    'View a specific location, city, landmark, or address and display it on the 3D map interface.',
    {query: z.string().describe('The name or address of the place to view (e.g. "Eiffel Tower, Paris" or "Times Square, New York")')},
    async ({query}) => {
      fullCallbacks.mapQueryHandler({location: query, action: 'view'});
      return {
        content: [{type: 'text', text: `Navigating 3D camera to: ${query}`}],
      };
    },
  );

  // Tool 2: Directions on Google Maps
  server.tool(
    'directions_on_google_maps',
    'Search Google Maps for driving directions and navigation route between origin and destination, showing 3D route polyline and calculating duration.',
    {
      origin: z.string().describe('Starting location or address'),
      destination: z.string().describe('Ending destination location or address'),
    },
    async ({origin, destination}) => {
      fullCallbacks.mapQueryHandler({origin, destination, action: 'directions'});
      try {
        const details = await fullCallbacks.getRouteDetails(origin, destination);
        const routeText = `Route calculated from "${origin}" to "${destination}":
• Estimated travel time: ${details.durationText}
• Distance: ${details.distanceText}
• Main road: ${details.summaryRoad}
• First navigation step: ${details.steps[0] || 'Head towards destination'}`;
        return {
          content: [{type: 'text', text: routeText}],
        };
      } catch {
        return {
          content: [
            {type: 'text', text: `Navigating route from ${origin} to ${destination}`},
          ],
        };
      }
    },
  );

  // Tool 3: Show Saved Location (Home, Business Platform, Land, Agricultural Land, etc.)
  server.tool(
    'show_saved_location',
    'Locate and display a user-saved location such as their Home, Business platform, Land plot, or Agricultural land on the 3D map.',
    {
      query: z
        .string()
        .describe(
          'Keyword, category, or name of the saved place, e.g., "home", "agricultural land", "business platform", "my farm", "commercial land", or custom place name.',
        ),
    },
    async ({query}) => {
      const places = fullCallbacks.getSavedPlaces();
      const q = query.toLowerCase().trim();

      // Find best match by category or name
      const match = places.find((p) => {
        const nameMatch = p.name.toLowerCase().includes(q);
        const catMatch = p.category.toLowerCase().includes(q);
        const isAgro =
          (q.includes('agri') || q.includes('farm') || q.includes('crop')) &&
          p.category === 'agriculture';
        const isLand =
          (q.includes('land') || q.includes('plot') || q.includes('property')) &&
          (p.category === 'land' || p.category === 'agriculture');
        const isBiz =
          (q.includes('business') || q.includes('office') || q.includes('work') || q.includes('platform')) &&
          p.category === 'business';
        const isHome =
          (q.includes('home') || q.includes('house') || q.includes('residence')) &&
          p.category === 'home';

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
${match.landSize ? `Land/Plot Area: ${match.landSize}` : ''}
${match.notes ? `Details: ${match.notes}` : ''}
The 3D map is now focused on your ${match.category} location.`,
            },
          ],
        };
      }

      // If no exact match found, return list of available places
      const available = places.map((p) => `• [${p.category.toUpperCase()}] ${p.name} (${p.address})`).join('\n');
      return {
        content: [
          {
            type: 'text',
            text: `Could not find a saved location matching "${query}".
Here are your current saved places:
${available || 'No saved places found yet. You can ask me to save one!'}` ,
          },
        ],
      };
    },
  );

  // Tool 4: Save New Location
  server.tool(
    'save_location',
    'Save a new location with categories: home, business, land, agriculture, or other, including land size and details.',
    {
      name: z.string().describe('Name of the place (e.g. "Sunrise Agro Farm" or "Downtown Office")'),
      category: z.enum(['home', 'business', 'land', 'agriculture', 'other']).describe('Category of the place'),
      address: z.string().describe('Address, city, or coordinate description'),
      landSize: z.string().optional().describe('Size of the land/property if applicable, e.g., "25 Acres", "5,000 sq ft"'),
      notes: z.string().optional().describe('Details, crop info, business type, or property notes'),
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
${landSize ? `• Land Size: ${landSize}\n` : ''}${notes ? `• Details: ${notes}\n` : ''}
It has been added to your Saved Places and displayed on the 3D map.`,
          },
        ],
      };
    },
  );

  // Tool 5: List Saved Locations
  server.tool(
    'list_saved_locations',
    'Get a list of all locations, homes, business platforms, lands, and agricultural plots saved by the user.',
    {},
    async () => {
      const places = fullCallbacks.getSavedPlaces();
      if (places.length === 0) {
        return {
          content: [{type: 'text', text: 'You do not have any saved locations yet.'}],
        };
      }
      const list = places
        .map(
          (p, idx) =>
            `${idx + 1}. [${p.category.toUpperCase()}] ${p.name}\n   Address: ${p.address}${
              p.landSize ? `\n   Area: ${p.landSize}` : ''
            }${p.notes ? `\n   Notes: ${p.notes}` : ''}`,
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Here are all your saved locations:\n\n${list}`,
          },
        ],
      };
    },
  );

  // Tool 6: Get Route Navigation Details
  server.tool(
    'get_route_navigation_info',
    'Get detailed real-time navigation facts between two locations, including travel time, distance, primary roads/highways, and road instructions.',
    {
      origin: z.string().describe('Origin location name, address, or saved place (e.g. "my home")'),
      destination: z.string().describe('Destination location name, address, or saved place (e.g. "my agricultural land")'),
    },
    async ({origin, destination}) => {
      const places = fullCallbacks.getSavedPlaces();

      // Resolve saved place nicknames if passed
      const resolveName = (str: string) => {
        const lower = str.toLowerCase();
        const found = places.find(
          (p) =>
            p.name.toLowerCase().includes(lower) ||
            p.category.toLowerCase() === lower ||
            (lower.includes('home') && p.category === 'home') ||
            ((lower.includes('agro') || lower.includes('farm')) && p.category === 'agriculture') ||
            (lower.includes('biz') && p.category === 'business') ||
            (lower.includes('land') && p.category === 'land'),
        );
        return found ? found.address : str;
      };

      const resolvedOrigin = resolveName(origin);
      const resolvedDest = resolveName(destination);

      fullCallbacks.mapQueryHandler({
        origin: resolvedOrigin,
        destination: resolvedDest,
        action: 'directions',
      });

      const details = await fullCallbacks.getRouteDetails(resolvedOrigin, resolvedDest);

      return {
        content: [
          {
            type: 'text',
            text: `Real-time navigation details from "${origin}" to "${destination}":
• Estimated Travel Time: ${details.durationText}
• Total Distance: ${details.distanceText}
• Primary Highway / Road: ${details.summaryRoad}
• Key Route Guidance:
${details.steps.slice(0, 4).map((s, i) => `  ${i + 1}. ${s}`).join('\n')}

The route has been plotted on the 3D map with real-time navigation view.`,
          },
        ],
      };
    },
  );

  await server.connect(transport);
  console.log('MCP Maps server running with Saved Places & Voice Navigation tools');
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
