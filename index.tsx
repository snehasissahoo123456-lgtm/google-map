/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main application entry point.
 * Initializes MapApp, bridges Gemini AI with the full MCP toolset:
 * - Vehicle Clearance Navigation (2-wheeler to 16-wheeler heavy freight)
 * - 24/7 Live GPS Tracking Telemetry & Pairing Codes
 * - Detective Travel Timeline Analysis & 14-15+ Visit Frequency Alerts
 * - Real-Time Weather Forecasting
 * - Saved Locations Management (Home, Business Platform, Land, Agriculture)
 * - Continuous Verbal Voice Conversation Loop
 */

import {GoogleGenAI, mcpToTool} from './genaiProxy';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {ChatState, MapApp, marked} from './map_app';
import {startMcpGoogleMapServer, VehicleTypeId} from './mcp_maps_server';

async function startClient(transport: Transport) {
  const client = new Client({
    name: 'Travel Expert Map Agent',
    version: '3.0.0',
  });
  await client.connect(transport);
  return client;
}

const SYSTEM_INSTRUCTIONS = `You are the "Travel Expert" — India's premier conversational 3D navigation assistant, vehicle clearance detective, and 24/7 telematics specialist.
You assist Indian drivers, fleet managers, farmers, and property owners with real-time traffic levels, emergency service POIs, heavy truck clearance (from 2-wheelers up to 16-wheeler freight trailers), 24/7 GPS satellite tracking, weather overlays, and land/property parcel management.

Trilingual Native Fluency (CRITICAL REQUIREMENT):
- You MUST converse fluently in Odia (ଓଡ଼ିଆ), Hindi (हिन्दी), and English.
- Automatically detect the language the user speaks or writes, and respond in that exact language:
  • If the user speaks or writes in Odia (e.g., "ନମସ୍କାର", "କଟକ ରୁ ଭୁବନେଶ୍ୱର", "ମୋ ଗାଡ଼ି ପାଇଁ ରାସ୍ତା"), reply warmly in pure, authentic Odia script and phrasing (e.g., "ନମସ୍କାର! ମୁଁ Travel Expert...").
  • If the user speaks or writes in Hindi (e.g., "नमस्ते", "16-पहिया ट्रक के लिए रास्ता बताएं", "ट्रैफिक कैसा है"), reply fluently in Hindi (e.g., "नमस्ते! Travel Expert में आपका स्वागत है...").
  • If the user speaks or writes in English or Hinglish, reply in clear, professional English.
- The user can talk continuously in verbal voice loop mode. Keep spoken responses crisp, actionable, and informative without rambling.

Key Capabilities:
1. **Travel Expert Route Guidance & Traffic Flow:**
   - Color-coded traffic flow: Clear/Smooth (Green), Moderate slow-moving (Yellow), Heavy traffic jams / bottlenecks (Red).
   - Emergency service POIs along Indian highways and cities:
     • Hospitals (🏥) (AIIMS, DHH, Medical Colleges, Trauma Centers)
     • Police Stations (🚓) (Thana / ଥାନା / Highway Patrol)
     • Fuel / EV Stations (⛽) (Indian Oil, BPCL, HPCL Swagat Highway Oasis)
     • Emergency Clinics (🩺) (24/7 Urgent Care & Diagnostic Centers)
   - Call 'directions_on_google_maps' with 'vehicleType'.

2. **Indian Vehicle Clearance & Road Safety (2W to 16W):**
   - Supports: 'scooter_2w', 'car_4w', 'truck_6w', 'heavy_8w', 'semi_16w'.
   - Enforce Indian road clearance: Alert 16-wheelers and 8-wheelers about narrow market alleys, low railway underpasses, weight-restricted river bridges, and dense bazaar streets. Direct them to National Highway bypasses and freight expressway ring roads (e.g., NH-16, NH-53, NH-44, NH-19).

3. **24/7 Live GPS Tracking & Detective Timeline:**
   - Live coordinates, speed, heading, and moving/stopped states via 'query_live_gps_tracking'.
   - 24/7 stop timeline with dwell times and repeated locations. Flag stops visited 14-15+ times with crimson detective alerts via 'query_detective_timeline'.

4. **Saved Places & Land Parcel Registry:**
   - 9 categories: Agriculture (farmlands, paddy, irrigation), Home, Business, Land plot, Warehouse (godown), Healthcare, Commercial mall, Plantation, Civic.
   - Understand Indian land measurements: Guntha, Bigha, Acre, Decimal, Biswa, Kattha, Square Feet.`;

const ai = new GoogleGenAI({
  apiKey: 'server-side',
});

function createAiChat(mcpClient: Client) {
  return ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: SYSTEM_INSTRUCTIONS,
      tools: [mcpToTool(mcpClient)],
    },
  });
}

function camelCaseToDash(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

async function bootstrap() {
  const rootElement = document.querySelector('#root')! as HTMLElement;
  if (!rootElement) return;

  const mapApp = new MapApp();
  rootElement.appendChild(mapApp);

  const [transportA, transportB] = InMemoryTransport.createLinkedPair();

  // Connect MCP Server with live MapApp callbacks
  void startMcpGoogleMapServer(transportA, {
    mapQueryHandler: (params) => {
      mapApp.handleMapQuery(params);
    },
    getSavedPlaces: () => mapApp.getSavedPlaces(),
    savePlace: async (p) => mapApp.saveNewPlace(p),
    getRouteDetails: async (origin, dest, vehicleType) =>
      mapApp.getRouteDetails(
        origin,
        dest,
        (vehicleType as VehicleTypeId) || mapApp.selectedVehicleType,
      ),
    getLiveTrackingStatus: () => mapApp.liveTrackingStatus,
    getTimelineStops: () => mapApp.timelineStops,
    getCurrentWeather: async () => {
      if (!mapApp.currentWeather) {
        await mapApp.fetchRealTimeWeather();
      }
      return mapApp.currentWeather!;
    },
  });

  const mcpClient = await startClient(transportB);
  const aiChat = createAiChat(mcpClient);

  mapApp.sendMessageHandler = async (input: string, role: string) => {
    console.log('sendMessageHandler', input, role);

    const {thinkingElement, textElement, thinkingContainer} = mapApp.addMessage(
      'assistant',
      '',
    );

    mapApp.setChatState(ChatState.GENERATING);
    textElement.innerHTML = '...';

    let newCode = '';
    let thoughtAccumulator = '';

    try {
      try {
        const stream = await aiChat.sendMessageStream({message: input});

        for await (const chunk of stream) {
          for (const candidate of chunk.candidates ?? []) {
            for (const part of candidate.content?.parts ?? []) {
              if (part.functionCall) {
                console.log(
                  'FUNCTION CALL:',
                  part.functionCall.name,
                  part.functionCall.args,
                );
                const mcpCall = {
                  name: camelCaseToDash(part.functionCall.name!),
                  arguments: part.functionCall.args,
                };

                const explanation =
                  'Calling agent tool:\n```json\n' +
                  JSON.stringify(mcpCall, null, 2) +
                  '\n```';
                const {textElement: functionCallText} = mapApp.addMessage(
                  'assistant',
                  '',
                );
                functionCallText.innerHTML = await marked.parse(explanation);
              }

              if (part.thought) {
                mapApp.setChatState(ChatState.THINKING);
                thoughtAccumulator += ' ' + part.thought;
                thinkingElement.innerHTML =
                  await marked.parse(thoughtAccumulator);
                if (thinkingContainer) {
                  thinkingContainer.classList.remove('hidden');
                  thinkingContainer.setAttribute('open', 'true');
                }
              } else if (part.text) {
                mapApp.setChatState(ChatState.EXECUTING);
                newCode += part.text;
                textElement.innerHTML = await marked.parse(newCode);
              }
              mapApp.scrollToTheEnd();
            }
          }
        }
      } catch (e: unknown) {
        console.error('GenAI SDK Error:', e);
        let baseErrorText = e instanceof Error ? e.message : String(e);

        const jsonStartIndex = baseErrorText.indexOf('{');
        const jsonEndIndex = baseErrorText.lastIndexOf('}');

        if (jsonStartIndex > -1 && jsonEndIndex > jsonStartIndex) {
          try {
            const sdkError = JSON.parse(
              baseErrorText.substring(jsonStartIndex, jsonEndIndex + 1),
            );
            if (sdkError?.error?.message) {
              baseErrorText = sdkError.error.message;
            } else if (sdkError?.message) {
              baseErrorText = sdkError.message;
            }
          } catch {}
        }

        const {textElement: errorTextElement} = mapApp.addMessage('error', '');
        errorTextElement.innerHTML = await marked.parse(
          `Error: ${baseErrorText}`,
        );
      }

      if (thinkingContainer && thinkingContainer.hasAttribute('open')) {
        if (!thoughtAccumulator) {
          thinkingContainer.classList.add('hidden');
        }
        thinkingContainer.removeAttribute('open');
      }

      if (
        textElement.innerHTML.trim() === '...' ||
        textElement.innerHTML.trim().length === 0
      ) {
        const hasFunctionCallMessage = mapApp.messages.some((el) =>
          el.innerHTML.includes('Calling agent tool:'),
        );
        if (!hasFunctionCallMessage) {
          textElement.innerHTML = await marked.parse('Done.');
        } else if (textElement.innerHTML.trim() === '...') {
          textElement.innerHTML = '';
        }
      }

      // Voice Agent: Speak output if speech enabled
      if (newCode.trim().length > 0) {
        mapApp.speakText(newCode);
      }
    } finally {
      mapApp.setChatState(ChatState.IDLE);
    }
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
  });
} else {
  void bootstrap();
}
