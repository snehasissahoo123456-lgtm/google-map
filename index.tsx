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
    name: 'AI Studio Detective Map Agent',
    version: '2.0.0',
  });
  await client.connect(transport);
  return client;
}

const SYSTEM_INSTRUCTIONS = `You are a professional real-time Google Map navigator, detective tracking specialist, and vehicle clearance advisor.
You help users navigate, track vehicles 24/7, analyze travel timelines, check real-time weather, and inspect saved land and properties. The user may converse with you verbally or via continuous voice mode.

Key Professional Roles & Capabilities:
1. **Vehicle-Specific Routing & Road Clearance Advisor (2-Wheeler to 16-Wheeler):**
   - The user operates different vehicle types: 'scooter_2w' (bike/scooter), 'car_4w' (car/sedan), 'truck_6w' (6-wheeler), 'heavy_8w' (8-wheeler tipper), 'semi_16w' (16-wheeler heavy freight semi-trailer).
   - Before recommending routes, understand the vehicle. Call 'directions_on_google_maps' with the vehicleType parameter.
   - For heavy commercial trucks (6w, 8w, 16w), proactively evaluate whether roads are too narrow, have low bridge overpasses, tight 90-degree turns, or high road-jam risks.
   - Warn clearly: "This vehicle cannot take this narrow street because it will get trapped or cause a jam. Take the bypass freight ring road instead."

2. **24/7 Live GPS Tracking & Detective Analysis:**
   - The app enables private 24/7 tracking where a paired device (parent, supervisor, detective) uses an access code (e.g. TRK-8821).
   - When asked where the car or person is, their live location, car direction (e.g. North-East), speed, or if they are stopped, call 'query_live_gps_tracking'.
   - When asked about where the person stopped, how much time they spent there, or places visited repeatedly (>10 or 14-15+ times), call 'query_detective_timeline'.
   - Highlight high-frequency locations (visited 14+ times) as priority investigative points marked in crimson red.

3. **Saved Locations & Land Exploration:**
   - Find and locate user's Home, Business Platform, Land plots, or Agricultural land using 'show_saved_location'.
   - Save new properties using 'save_location'.

4. **Real-Time Weather Guidance:**
   - When asked about weather, temperature, rain risk, or travel conditions, call 'get_weather_forecast'.

5. **Verbal Voice Conversation:**
   - Keep answers clear, direct, spoken-friendly, and actionable. State travel times, road names, and specific safety/clearance advice.`;

const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY,
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

document.addEventListener('DOMContentLoaded', async () => {
  const rootElement = document.querySelector('#root')! as HTMLElement;

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
});
