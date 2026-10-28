/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main entry point for the application.
 * Sets up MapApp, initializes Gemini AI with MCP tools (Saved Places, Real-Time Navigation,
 * Voice Commands, and 3D Maps exploration), and bridges Voice Agent speech synthesis.
 */

import {GoogleGenAI, mcpToTool} from './genaiProxy';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {ChatState, MapApp, marked} from './map_app';
import {startMcpGoogleMapServer} from './mcp_maps_server';

async function startClient(transport: Transport) {
  const client = new Client({name: 'AI Studio Google Map Agent', version: '1.2.0'});
  await client.connect(transport);
  return client;
}

const SYSTEM_INSTRUCTIONS = `You are a real-time smart location agent, voice navigator, and property explorer for Google Maps.
Your role is to navigate the 3D map, manage saved places (such as Home, Business Platforms, Land plots, and Agricultural lands), provide real-time travel navigation details, and answer voice commands.

Key Capabilities & Tools:
1. **Saved Places Management:**
   - The user has saved locations categorized into: 'home', 'business', 'land', 'agriculture', 'other'.
   - When the user says "take me to my land", "show my agricultural farm", "where is my home", or "locate my business platform", call 'show_saved_location' with the appropriate keyword or name.
   - If the user says "save this place" or "save my new agricultural land in [location] with [size]", call 'save_location'.
   - To review what places are saved, call 'list_saved_locations'.

2. **Real-Time Travel & Navigation:**
   - When the user asks "how much time will it take", "which road is taken", "how do I get from my home to my agricultural land", or requests directions between any two places, call 'directions_on_google_maps' or 'get_route_navigation_info'.
   - Always clearly report the travel duration (e.g., "35 minutes"), total distance (e.g., "24.5 km"), and the primary road or highway used (e.g., "via I-280 S / NH 48").

3. **General 3D Map Exploration:**
   - For general cities, landmarks, or points of interest, call 'view_location_google_maps' with specific, recognizable place names.

4. **Voice Agent Friendly Communication:**
   - The user may interact via voice. Keep spoken descriptions clear, engaging, and professional.
   - Highlight land size, crop types, or facility details when viewing agricultural or commercial land.`;

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

  // Start MCP server with full callbacks to mapApp
  void startMcpGoogleMapServer(transportA, {
    mapQueryHandler: (params) => {
      mapApp.handleMapQuery(params);
    },
    getSavedPlaces: () => mapApp.getSavedPlaces(),
    savePlace: async (p) => mapApp.saveNewPlace(p),
    getRouteDetails: async (origin, dest) => mapApp.getRouteDetails(origin, dest),
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
                  'Calling map agent function:\n```json\n' +
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
          el.innerHTML.includes('Calling map agent function:'),
        );
        if (!hasFunctionCallMessage) {
          textElement.innerHTML = await marked.parse('Done.');
        } else if (textElement.innerHTML.trim() === '...') {
          textElement.innerHTML = '';
        }
      }

      // Voice Agent: Speak the assistant's response aloud
      if (newCode.trim().length > 0) {
        mapApp.speakText(newCode);
      }
    } finally {
      mapApp.setChatState(ChatState.IDLE);
    }
  };
});
