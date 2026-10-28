/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file defines the main `gdm-map-app` LitElement component.
 * It manages:
 * - Google Photorealistic 3D Map with camera controls, markers, route polylines,
 *   and 3D property boundary outlines for land/agricultural plots.
 * - Saved Locations Management (Home, Business Platform, Land, Agricultural Land, etc.)
 *   with persistent localStorage and customizable property metadata.
 * - Voice Agent with Speech-to-Text (microphone input) and Speech Synthesis (spoken responses).
 * - Real-Time Navigation HUD with travel time, road info, distance, and 3D camera flythrough.
 * - AI Chat integration via MCP tools.
 */

import {Loader} from '@googlemaps/js-api-loader';
import hljs from 'highlight.js';
import {html, LitElement, PropertyValueMap} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {Marked} from 'marked';
import {markedHighlight} from 'marked-highlight';

import {MapParams, SavedPlace} from './mcp_maps_server';

/** Markdown formatting function with syntax highlighting */
export const marked = new Marked(
  markedHighlight({
    async: true,
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang, _info) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, {language}).value;
    },
  }),
);

const ICON_BUSY = html`<svg
  class="rotating"
  xmlns="http://www.w3.org/2000/svg"
  height="20px"
  viewBox="0 -960 960 960"
  width="20px"
  fill="currentColor">
  <path
    d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z" />
</svg>`;

export enum ChatState {
  IDLE,
  GENERATING,
  THINKING,
  EXECUTING,
}

export enum ChatTab {
  GEMINI = 'gemini',
  PLACES = 'places',
}

export enum ChatRole {
  USER,
  ASSISTANT,
  SYSTEM,
}

export interface NavigationRouteInfo {
  origin: string;
  destination: string;
  durationText: string;
  distanceText: string;
  summaryRoad: string;
  steps: string[];
  overviewPath: Array<{lat: number; lng: number}>;
  isActive: boolean;
}

const USER_PROVIDED_GOOGLE_MAPS_API_KEY: string =
  'AIzaSyAJPTwj4S8isr4b-3NtqVSxk450IAS1lOQ';

const DEFAULT_SAVED_PLACES: SavedPlace[] = [
  {
    id: 'place_agro_1',
    name: 'Sunrise Organic Agrotech Farm',
    category: 'agriculture',
    address: 'Fresno County, San Joaquin Valley, CA',
    lat: 36.7468,
    lng: -119.7726,
    landSize: '45.0 Acres',
    notes: 'Fertile agricultural land, solar drip irrigation, organic almond and wheat crop cultivation.',
    createdAt: Date.now() - 86400000 * 5,
  },
  {
    id: 'place_home_1',
    name: 'Greenwood Family Residence',
    category: 'home',
    address: '1000 Green Valley Rd, Napa, CA',
    lat: 38.2975,
    lng: -122.2869,
    landSize: '0.85 Acre',
    notes: 'Primary residence with private driveway, landscaped garden, and residential plot.',
    createdAt: Date.now() - 86400000 * 10,
  },
  {
    id: 'place_biz_1',
    name: 'Apex Innovation Tech Platform',
    category: 'business',
    address: '1 Infinite Loop, Cupertino, CA',
    lat: 37.3318,
    lng: -122.0312,
    landSize: '3.2 Acres',
    notes: 'Headquarters commercial tech campus, multi-story office, research and data center facility.',
    createdAt: Date.now() - 86400000 * 15,
  },
  {
    id: 'place_land_1',
    name: 'Metro North Commercial Land Parcel 4B',
    category: 'land',
    address: 'North Austin Tech Corridor, Austin, TX',
    lat: 30.4014,
    lng: -97.7145,
    landSize: '12.5 Acres',
    notes: 'Zoned commercial development land near highway transit corridor for logistics and business buildout.',
    createdAt: Date.now() - 86400000 * 20,
  },
];

const EXAMPLE_PROMPTS = [
  'Show me my agricultural land and inspect the property.',
  'Give me directions from my home to my business platform.',
  'How much time will it take to reach my farm and which road is taken?',
  'Save a new agricultural land in Punjab with 20 acres.',
  'Show me directions from Tokyo Tower to Shibuya Crossing.',
  'Take me to my commercial land plot in Austin.',
  'Give me directions from the Eiffel Tower to the Louvre Museum.',
  'Where is my home located? Fly there in 3D.',
];

@customElement('gdm-map-app')
export class MapApp extends LitElement {
  @query('#anchor') anchor?: HTMLDivElement;
  @query('#mapContainer') mapContainerElement?: HTMLElement;
  @query('#messageInput') messageInputElement?: HTMLInputElement;

  @state() chatState = ChatState.IDLE;
  @state() selectedChatTab = ChatTab.GEMINI;
  @state() inputMessage = '';
  @state() messages: HTMLElement[] = [];
  @state() mapInitialized = false;
  @state() mapError = '';

  // Saved Places state
  @state() savedPlaces: SavedPlace[] = [];
  @state() selectedCategoryFilter: string = 'all';
  @state() placesSearchQuery: string = '';
  @state() activePlaceModal: boolean = false;
  @state() currentInspectedPlace?: SavedPlace;

  // Form state for adding/editing place
  @state() formName = '';
  @state() formCategory: 'home' | 'business' | 'land' | 'agriculture' | 'other' = 'agriculture';
  @state() formAddress = '';
  @state() formLandSize = '';
  @state() formNotes = '';

  // Real-Time Navigation HUD state
  @state() navigationInfo: NavigationRouteInfo = {
    origin: '',
    destination: '',
    durationText: '',
    distanceText: '',
    summaryRoad: '',
    steps: [],
    overviewPath: [],
    isActive: false,
  };
  @state() isNavStepsExpanded: boolean = false;
  @state() isFlythroughRunning: boolean = false;

  // Voice Agent state
  @state() isListening: boolean = false;
  @state() isSpeaking: boolean = false;
  @state() speechEnabled: boolean = true;
  @state() voiceSupported: boolean = true;
  @state() voiceStatusMessage: string = '';

  // Google Maps instances
  private map?: any;
  private geocoder?: any;
  private marker?: any;
  private propertyBoundary?: any; // 3D boundary polyline for plots/lands
  private Map3DElement?: any;
  private Marker3DElement?: any;
  private Polyline3DElement?: any;
  private directionsService?: any;
  private routePolyline?: any;
  private originMarker?: any;
  private destinationMarker?: any;

  // Speech Recognition instance
  private speechRecognition?: any;

  sendMessageHandler?: CallableFunction;

  constructor() {
    super();
    this.loadSavedPlaces();
    this.initVoiceRecognition();
    this.setNewRandomPrompt();
  }

  createRenderRoot() {
    return this;
  }

  protected firstUpdated(
    _changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>,
  ): void {
    this.loadMap();
  }

  // --- Saved Places Persistence ---
  private loadSavedPlaces() {
    try {
      const stored = localStorage.getItem('gdm_saved_places_v1');
      if (stored) {
        this.savedPlaces = JSON.parse(stored);
      } else {
        this.savedPlaces = [...DEFAULT_SAVED_PLACES];
        this.savePlacesToStorage();
      }
    } catch {
      this.savedPlaces = [...DEFAULT_SAVED_PLACES];
    }
  }

  private savePlacesToStorage() {
    try {
      localStorage.setItem(
        'gdm_saved_places_v1',
        JSON.stringify(this.savedPlaces),
      );
    } catch (e) {
      console.warn('Could not persist saved places to localStorage:', e);
    }
  }

  public getSavedPlaces(): SavedPlace[] {
    return this.savedPlaces;
  }

  public async saveNewPlace(place: {
    name: string;
    category: 'home' | 'business' | 'land' | 'agriculture' | 'other';
    address: string;
    landSize?: string;
    notes?: string;
  }): Promise<SavedPlace> {
    let lat: number | undefined;
    let lng: number | undefined;

    if (this.geocoder) {
      try {
        const coords = await this.geocodeAddress(place.address);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
      } catch {}
    }

    const newPlace: SavedPlace = {
      id: 'place_' + Date.now(),
      name: place.name.trim(),
      category: place.category,
      address: place.address.trim(),
      lat,
      lng,
      landSize: place.landSize?.trim() || undefined,
      notes: place.notes?.trim() || undefined,
      createdAt: Date.now(),
    };

    this.savedPlaces = [newPlace, ...this.savedPlaces];
    this.savePlacesToStorage();
    this.requestUpdate();
    return newPlace;
  }

  public deleteSavedPlace(id: string) {
    this.savedPlaces = this.savedPlaces.filter((p) => p.id !== id);
    if (this.currentInspectedPlace?.id === id) {
      this.currentInspectedPlace = undefined;
      this._clearMapElements();
    }
    this.savePlacesToStorage();
    this.requestUpdate();
  }

  // --- Voice Agent Implementation ---
  private initVoiceRecognition() {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.voiceSupported = false;
      return;
    }

    try {
      this.speechRecognition = new SpeechRecognition();
      this.speechRecognition.continuous = false;
      this.speechRecognition.interimResults = true;
      this.speechRecognition.lang = 'en-US';

      this.speechRecognition.onstart = () => {
        this.isListening = true;
        this.voiceStatusMessage = 'Listening... Speak your command';
        this.requestUpdate();
      };

      this.speechRecognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        this.inputMessage = transcript;
        this.voiceStatusMessage = `Heard: "${transcript}"`;
        this.requestUpdate();

        if (event.results[0] && event.results[0].isFinal) {
          this.isListening = false;
          this.voiceStatusMessage = '';
          this.sendMessageAction(transcript);
        }
      };

      this.speechRecognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        this.isListening = false;
        this.voiceStatusMessage =
          event.error === 'not-allowed'
            ? 'Microphone permission denied'
            : 'Voice input error';
        setTimeout(() => {
          this.voiceStatusMessage = '';
          this.requestUpdate();
        }, 3000);
        this.requestUpdate();
      };

      this.speechRecognition.onend = () => {
        this.isListening = false;
        this.requestUpdate();
      };
    } catch (e) {
      console.warn('Voice recognition initialization failed:', e);
      this.voiceSupported = false;
    }
  }

  public toggleVoiceListening() {
    if (!this.speechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome.');
      return;
    }

    if (this.isListening) {
      this.speechRecognition.stop();
      this.isListening = false;
      this.voiceStatusMessage = '';
    } else {
      // Stop ongoing speech before listening
      this.stopSpeaking();
      try {
        this.speechRecognition.start();
      } catch {
        this.speechRecognition.stop();
        setTimeout(() => this.speechRecognition.start(), 200);
      }
    }
    this.requestUpdate();
  }

  public speakText(rawText: string) {
    if (!this.speechEnabled || !('speechSynthesis' in window)) return;

    // Clean text: strip markdown code blocks, URLs, markdown symbols, and JSON
    let clean = rawText
      .replace(/```[\s\S]*?```/g, '') // strip code blocks
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[#*_~`>]/g, '')
      .replace(/\{[\s\S]*?\}/g, '') // strip JSON objects
      .trim();

    if (!clean) return;

    // Truncate to reasonable spoken length
    if (clean.length > 350) {
      clean = clean.substring(0, 350) + '...';
    }

    this.stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    // Pick a natural English voice if available
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Natural') ||
          v.name.includes('Google') ||
          v.name.includes('Samantha') ||
          v.name.includes('David')),
    );
    if (naturalVoice) {
      utterance.voice = naturalVoice;
    }

    utterance.onstart = () => {
      this.isSpeaking = true;
      this.voiceStatusMessage = 'Voice Agent speaking...';
      this.requestUpdate();
    };

    utterance.onend = () => {
      this.isSpeaking = false;
      this.voiceStatusMessage = '';
      this.requestUpdate();
    };

    utterance.onerror = () => {
      this.isSpeaking = false;
      this.voiceStatusMessage = '';
      this.requestUpdate();
    };

    window.speechSynthesis.speak(utterance);
  }

  public stopSpeaking() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
      this.voiceStatusMessage = '';
      this.requestUpdate();
    }
  }

  public toggleSpeechEnabled() {
    this.speechEnabled = !this.speechEnabled;
    if (!this.speechEnabled) {
      this.stopSpeaking();
    }
    this.requestUpdate();
  }

  private setNewRandomPrompt() {
    if (EXAMPLE_PROMPTS.length > 0) {
      this.inputMessage =
        EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
    }
  }

  async loadMap() {
    const isApiKeyPlaceholder =
      USER_PROVIDED_GOOGLE_MAPS_API_KEY ===
        'YOUR_ACTUAL_GOOGLE_MAPS_API_KEY_REPLACE_ME' ||
      USER_PROVIDED_GOOGLE_MAPS_API_KEY === '';

    if (isApiKeyPlaceholder) {
      this.mapError = `Google Maps API Key is not configured correctly.`;
      console.error(this.mapError);
      this.requestUpdate();
      return;
    }

    const loader = new Loader({
      apiKey: USER_PROVIDED_GOOGLE_MAPS_API_KEY,
      version: 'beta',
      libraries: ['geocoding', 'routes', 'geometry'],
    });

    try {
      await loader.load();
      const maps3dLibrary = await (window as any).google.maps.importLibrary(
        'maps3d',
      );
      this.Map3DElement = maps3dLibrary.Map3DElement;
      this.Marker3DElement = maps3dLibrary.Marker3DElement;
      this.Polyline3DElement = maps3dLibrary.Polyline3DElement;

      if ((window as any).google && (window as any).google.maps) {
        this.directionsService = new (
          window as any
        ).google.maps.DirectionsService();
        this.geocoder = new (window as any).google.maps.Geocoder();
      }

      this.initializeMap();
      this.mapInitialized = true;
      this.mapError = '';
    } catch (error) {
      console.error('Error loading Google Maps API:', error);
      this.mapError = 'Could not load Google Maps. Check console for details.';
      this.mapInitialized = false;
    }
    this.requestUpdate();
  }

  initializeMap() {
    if (!this.mapContainerElement || !this.Map3DElement) return;
    this.map = this.mapContainerElement;
  }

  setChatState(state: ChatState) {
    this.chatState = state;
  }

  private _clearMapElements() {
    if (this.marker) {
      this.marker.remove();
      this.marker = undefined;
    }
    if (this.propertyBoundary) {
      this.propertyBoundary.remove();
      this.propertyBoundary = undefined;
    }
    if (this.routePolyline) {
      this.routePolyline.remove();
      this.routePolyline = undefined;
    }
    if (this.originMarker) {
      this.originMarker.remove();
      this.originMarker = undefined;
    }
    if (this.destinationMarker) {
      this.destinationMarker.remove();
      this.destinationMarker = undefined;
    }
  }

  private async geocodeAddress(
    address: string,
  ): Promise<{lat: number; lng: number} | null> {
    if (!this.geocoder) return null;
    return new Promise((resolve) => {
      this.geocoder.geocode(
        {address},
        (results: any, status: string) => {
          if (status === 'OK' && results && results[0]) {
            const loc = results[0].geometry.location;
            resolve({lat: loc.lat(), lng: loc.lng()});
          } else {
            resolve(null);
          }
        },
      );
    });
  }

  // --- Real-time Route Calculation helper ---
  public async getRouteDetails(
    origin: string,
    destination: string,
  ): Promise<{
    durationText: string;
    distanceText: string;
    summaryRoad: string;
    steps: string[];
  }> {
    if (!this.directionsService) {
      return {
        durationText: 'Approx. 25 mins',
        distanceText: 'Approx. 15 km',
        summaryRoad: 'Direct Route',
        steps: ['Head towards destination'],
      };
    }

    return new Promise((resolve) => {
      this.directionsService.route(
        {
          origin,
          destination,
          travelMode: (window as any).google.maps.TravelMode.DRIVING,
        },
        (response: any, status: string) => {
          if (status === 'OK' && response && response.routes?.[0]) {
            const route = response.routes[0];
            const leg = route.legs?.[0];
            const steps = (leg?.steps || []).map((s: any) =>
              (s.instructions || '').replace(/<[^>]+>/g, ' '),
            );
            resolve({
              durationText: leg?.duration?.text || 'Calculated',
              distanceText: leg?.distance?.text || 'Calculated',
              summaryRoad:
                route.summary ||
                steps[0] ||
                'Highway / Main Transit Corridor',
              steps,
            });
          } else {
            resolve({
              durationText: 'Available upon navigation',
              distanceText: 'Direct calculation',
              summaryRoad: 'Main Route',
              steps: [`Head from ${origin} towards ${destination}`],
            });
          }
        },
      );
    });
  }

  // --- Handle Viewing a Location / Land Plot ---
  public async handleViewLocation(
    locationQuery: string,
    savedPlaceId?: string,
  ) {
    if (!this.mapInitialized || !this.map || !this.geocoder || !this.Marker3DElement) {
      return;
    }

    this._clearMapElements();

    // Check if this matches a saved place
    const matchedPlace = savedPlaceId
      ? this.savedPlaces.find((p) => p.id === savedPlaceId)
      : this.savedPlaces.find(
          (p) =>
            p.name.toLowerCase() === locationQuery.toLowerCase() ||
            p.address.toLowerCase() === locationQuery.toLowerCase(),
        );

    this.currentInspectedPlace = matchedPlace;

    this.geocoder.geocode(
      {address: locationQuery},
      async (results: any, status: string) => {
        if (status === 'OK' && results && results[0] && this.map) {
          const location = results[0].geometry.location;
          const lat = location.lat();
          const lng = location.lng();

          // Camera options: Closer and tilted for land & property inspection
          const isLandOrAgro =
            matchedPlace &&
            (matchedPlace.category === 'agriculture' ||
              matchedPlace.category === 'land');

          const cameraOptions = {
            center: {lat, lng, altitude: 0},
            heading: isLandOrAgro ? 30 : 0,
            tilt: isLandOrAgro ? 60 : 65,
            range: isLandOrAgro ? 1200 : 1800,
          };

          (this.map as any).flyCameraTo({
            endCamera: cameraOptions,
            durationMillis: 1800,
          });

          // Create 3D Marker
          this.marker = new this.Marker3DElement();
          this.marker.position = {lat, lng, altitude: 0};
          const labelPrefix = matchedPlace
            ? matchedPlace.category === 'agriculture'
              ? '🌾 Agro Plot: '
              : matchedPlace.category === 'home'
              ? '🏡 Home: '
              : matchedPlace.category === 'business'
              ? '🏢 Hub: '
              : '📐 Land: '
            : '';
          this.marker.label =
            labelPrefix +
            (matchedPlace
              ? matchedPlace.name
              : locationQuery.length > 25
              ? locationQuery.substring(0, 22) + '...'
              : locationQuery);

          (this.map as any).appendChild(this.marker);

          // If it's agricultural land or commercial land, draw a 3D boundary polygon/polyline!
          if (isLandOrAgro && this.Polyline3DElement) {
            const deltaLat = 0.0022; // ~240m boundary offset
            const deltaLng = 0.003;
            const boundaryCoords = [
              {lat: lat - deltaLat, lng: lng - deltaLng, altitude: 8},
              {lat: lat + deltaLat, lng: lng - deltaLng, altitude: 8},
              {lat: lat + deltaLat, lng: lng + deltaLng, altitude: 8},
              {lat: lat - deltaLat, lng: lng + deltaLng, altitude: 8},
              {lat: lat - deltaLat, lng: lng - deltaLng, altitude: 8},
            ];

            this.propertyBoundary = new this.Polyline3DElement();
            this.propertyBoundary.coordinates = boundaryCoords;
            this.propertyBoundary.strokeColor =
              matchedPlace.category === 'agriculture'
                ? '#10b981' // emerald green
                : '#f59e0b'; // amber gold
            this.propertyBoundary.strokeWidth = 10;
            (this.map as any).appendChild(this.propertyBoundary);
          }

          this.requestUpdate();
        } else {
          console.error(
            `Geocode failed for "${locationQuery}". Reason: ${status}`,
          );
        }
      },
    );
  }

  // --- Handle Real-time Route Directions ---
  public async handleDirections(
    originQuery: string,
    destinationQuery: string,
  ) {
    if (
      !this.mapInitialized ||
      !this.map ||
      !this.directionsService ||
      !this.Marker3DElement ||
      !this.Polyline3DElement
    ) {
      return;
    }

    this._clearMapElements();
    this.currentInspectedPlace = undefined;

    this.directionsService.route(
      {
        origin: originQuery,
        destination: destinationQuery,
        travelMode: (window as any).google.maps.TravelMode.DRIVING,
      },
      async (response: any, status: string) => {
        if (
          status === 'OK' &&
          response &&
          response.routes &&
          response.routes.length > 0
        ) {
          const route = response.routes[0];
          const leg = route.legs?.[0];

          // Save Real-Time Navigation HUD information
          const pathCoords: Array<{lat: number; lng: number}> = (
            route.overview_path || []
          ).map((p: any) => ({lat: p.lat(), lng: p.lng()}));

          const steps = (leg?.steps || []).map((s: any) =>
            (s.instructions || '').replace(/<[^>]+>/g, ' '),
          );

          this.navigationInfo = {
            origin: originQuery,
            destination: destinationQuery,
            durationText: leg?.duration?.text || 'Real-time',
            distanceText: leg?.distance?.text || 'Direct',
            summaryRoad:
              route.summary || steps[0] || 'Primary Transit Highway',
            steps,
            overviewPath: pathCoords,
            isActive: true,
          };

          // Draw 3D route polyline
          if (pathCoords.length > 0 && this.Polyline3DElement) {
            const polyCoords = pathCoords.map((p) => ({
              lat: p.lat,
              lng: p.lng,
              altitude: 6,
            }));
            this.routePolyline = new this.Polyline3DElement();
            this.routePolyline.coordinates = polyCoords;
            this.routePolyline.strokeColor = '#3b82f6'; // Bright navigational blue
            this.routePolyline.strokeWidth = 10;
            (this.map as any).appendChild(this.routePolyline);
          }

          // Origin Marker
          if (leg && leg.start_location) {
            const origLoc = leg.start_location;
            this.originMarker = new this.Marker3DElement();
            this.originMarker.position = {
              lat: origLoc.lat(),
              lng: origLoc.lng(),
              altitude: 0,
            };
            this.originMarker.label = `Start: ${originQuery}`;
            (this.map as any).appendChild(this.originMarker);
          }

          // Destination Marker
          if (leg && leg.end_location) {
            const destLoc = leg.end_location;
            this.destinationMarker = new this.Marker3DElement();
            this.destinationMarker.position = {
              lat: destLoc.lat(),
              lng: destLoc.lng(),
              altitude: 0,
            };
            this.destinationMarker.label = `Arrive: ${destinationQuery}`;
            (this.map as any).appendChild(this.destinationMarker);
          }

          // Adjust camera to view full route
          if (route.bounds) {
            const bounds = route.bounds;
            const center = bounds.getCenter();
            let range = 10000;

            if (
              (window as any).google.maps.geometry &&
              (window as any).google.maps.geometry.spherical
            ) {
              const spherical = (window as any).google.maps.geometry.spherical;
              const ne = bounds.getNorthEast();
              const sw = bounds.getSouthWest();
              const diagonalDistance = spherical.computeDistanceBetween(ne, sw);
              range = Math.max(diagonalDistance * 1.6, 2500);
            }

            const cameraOptions = {
              center: {lat: center.lat(), lng: center.lng(), altitude: 0},
              heading: 0,
              tilt: 45,
              range,
            };

            (this.map as any).flyCameraTo({
              endCamera: cameraOptions,
              durationMillis: 2200,
            });
          }

          this.requestUpdate();
        } else {
          console.error('Directions request failed. Status:', status);
        }
      },
    );
  }

  // --- 3D Route Flythrough Navigation Animation ---
  public async startRouteFlythrough() {
    if (
      !this.navigationInfo.isActive ||
      this.navigationInfo.overviewPath.length === 0 ||
      this.isFlythroughRunning
    ) {
      return;
    }

    this.isFlythroughRunning = true;
    this.requestUpdate();

    const path = this.navigationInfo.overviewPath;
    const sampleRate = Math.max(1, Math.floor(path.length / 8));
    const waypoints = [];
    for (let i = 0; i < path.length; i += sampleRate) {
      waypoints.push(path[i]);
    }
    if (waypoints[waypoints.length - 1] !== path[path.length - 1]) {
      waypoints.push(path[path.length - 1]);
    }

    for (let i = 0; i < waypoints.length; i++) {
      if (!this.isFlythroughRunning) break;
      const pt = waypoints[i];
      const nextPt = waypoints[i + 1] || pt;
      const heading =
        (Math.atan2(nextPt.lng - pt.lng, nextPt.lat - pt.lat) * 180) / Math.PI;

      (this.map as any).flyCameraTo({
        endCamera: {
          center: {lat: pt.lat, lng: pt.lng, altitude: 0},
          heading: isNaN(heading) ? 0 : heading,
          tilt: 65,
          range: 800,
        },
        durationMillis: 2000,
      });

      await new Promise((resolve) => setTimeout(resolve, 2100));
    }

    this.isFlythroughRunning = false;
    this.requestUpdate();
  }

  public stopRouteFlythrough() {
    this.isFlythroughRunning = false;
    this.requestUpdate();
  }

  public dismissNavigation() {
    this.navigationInfo.isActive = false;
    this.stopRouteFlythrough();
    this._clearMapElements();
    this.requestUpdate();
  }

  // --- MCP Tool Call Gateway ---
  async handleMapQuery(params: MapParams) {
    if (params.origin && params.destination) {
      await this.handleDirections(params.origin, params.destination);
    } else if (params.location) {
      await this.handleViewLocation(params.location, params.savedPlaceId);
    } else if (params.destination) {
      await this.handleViewLocation(params.destination);
    }
  }

  // --- Chat Message Rendering ---
  addMessage(role: string, message: string) {
    const div = document.createElement('div');
    div.classList.add('turn');
    div.classList.add(`role-${role.trim()}`);
    div.setAttribute('aria-live', 'polite');

    const thinkingDetails = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Thinking process';
    thinkingDetails.classList.add('thinking');
    thinkingDetails.setAttribute('aria-label', 'Model thinking process');
    const thinkingElement = document.createElement('div');
    thinkingDetails.append(summary);
    thinkingDetails.append(thinkingElement);
    div.append(thinkingDetails);

    const textElement = document.createElement('div');
    textElement.className = 'text';
    textElement.innerHTML = message;
    div.append(textElement);

    this.messages = [...this.messages, div];
    this.scrollToTheEnd();
    return {
      thinkingContainer: thinkingDetails,
      thinkingElement,
      textElement,
    };
  }

  scrollToTheEnd() {
    if (!this.anchor) return;
    this.anchor.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }

  async sendMessageAction(message?: string, role?: string) {
    if (this.chatState !== ChatState.IDLE) return;

    let msg = '';
    let usedComponentInput = false;

    if (message) {
      msg = message.trim();
    } else {
      msg = this.inputMessage.trim();
      if (msg.length > 0) {
        this.inputMessage = '';
        usedComponentInput = true;
      }
    }

    if (msg.length === 0) {
      if (usedComponentInput) this.setNewRandomPrompt();
      return;
    }

    const msgRole = role ? role.toLowerCase() : 'user';

    if (msgRole === 'user' && msg) {
      const {textElement} = this.addMessage(msgRole, '...');
      textElement.innerHTML = await marked.parse(msg);
    }

    if (this.sendMessageHandler) {
      await this.sendMessageHandler(msg, msgRole);
    }

    if (usedComponentInput) {
      this.setNewRandomPrompt();
    }
  }

  private async inputKeyDownAction(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessageAction();
    }
  }

  // --- Saved Place Card Actions ---
  private flyToPlace(place: SavedPlace) {
    this.handleViewLocation(place.address || place.name, place.id);
  }

  private directionsToPlace(place: SavedPlace) {
    const home = this.savedPlaces.find((p) => p.category === 'home');
    const origin = home ? home.address : 'Current Location';
    this.handleDirections(origin, place.address || place.name);
  }

  // --- Modal Form Actions ---
  private openAddPlaceModal() {
    this.formName = '';
    this.formCategory = 'agriculture';
    this.formAddress = '';
    this.formLandSize = '';
    this.formNotes = '';
    this.activePlaceModal = true;
    this.requestUpdate();
  }

  private closeAddPlaceModal() {
    this.activePlaceModal = false;
    this.requestUpdate();
  }

  private async submitPlaceForm(e: Event) {
    e.preventDefault();
    if (!this.formName || !this.formAddress) {
      alert('Please fill in both the Place Name and Address.');
      return;
    }

    const saved = await this.saveNewPlace({
      name: this.formName,
      category: this.formCategory,
      address: this.formAddress,
      landSize: this.formLandSize || undefined,
      notes: this.formNotes || undefined,
    });

    this.activePlaceModal = false;
    this.flyToPlace(saved);
  }

  // Quick action: Save current inspected location or center
  private quickSaveCurrentLocation() {
    this.openAddPlaceModal();
    if (this.navigationInfo.isActive && this.navigationInfo.destination) {
      this.formAddress = this.navigationInfo.destination;
      this.formName = 'Destination Plot';
    }
  }

  render() {
    const initialCenter = '37.3318,-122.0312,100';
    const initialRange = '50000';
    const initialTilt = '45';
    const initialHeading = '0';

    const filteredPlaces = this.savedPlaces.filter((p) => {
      const matchesCategory =
        this.selectedCategoryFilter === 'all' ||
        p.category === this.selectedCategoryFilter;
      const matchesQuery =
        !this.placesSearchQuery ||
        p.name.toLowerCase().includes(this.placesSearchQuery.toLowerCase()) ||
        p.address.toLowerCase().includes(this.placesSearchQuery.toLowerCase()) ||
        (p.notes &&
          p.notes.toLowerCase().includes(this.placesSearchQuery.toLowerCase()));
      return matchesCategory && matchesQuery;
    });

    return html`<div class="gdm-map-app">
      <!-- Main Map Container -->
      <div
        class="main-container"
        role="application"
        aria-label="Interactive 3D Map Area">
        ${this.mapError
          ? html`<div class="map-error-message" role="alert">
              ${this.mapError}
            </div>`
          : ''}

        <!-- 3D Map Component -->
        <gmp-map-3d
          id="mapContainer"
          style="height: 100%; width: 100%;"
          aria-label="Google Photorealistic 3D Map Display"
          mode="hybrid"
          center="${initialCenter}"
          heading="${initialHeading}"
          tilt="${initialTilt}"
          range="${initialRange}"
          internal-usage-attribution-ids="gmp_aistudio_threedmapjsmcp_v0.1_showcase"
          default-ui-disabled="true"
          role="application">
        </gmp-map-3d>

        <!-- Top Map HUD Toolbar -->
        <div class="map-overlay-toolbar">
          <button
            class="map-tool-btn"
            title="Save Current Location / Add Place"
            @click=${() => this.quickSaveCurrentLocation()}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="18"
              viewBox="0 -960 960 960"
              width="18"
              fill="currentColor">
              <path
                d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z" />
            </svg>
            Save Location
          </button>

          <button
            class="map-tool-btn ${this.voiceSupported && this.speechEnabled
              ? 'active'
              : ''}"
            title="Toggle Voice Responses"
            @click=${() => this.toggleSpeechEnabled()}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="18"
              viewBox="0 -960 960 960"
              width="18"
              fill="currentColor">
              ${this.speechEnabled
                ? html`<path
                    d="M560-131v-82q90-26 145-100t55-167q0-93-55-167T560-747v-82q124 28 202 125.5T840-480q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v680L280-360H120Zm440 40v-320q46 17 73 57.5t27 92.5q0 52-27 92.5T560-320Z" />`
                : html`<path
                    d="m792-56-64-64q-42 34-92 54.5T560-45v-82q36-18 67-42.5t53-56.5l-60-60v-274l-80-80v160l-80-80v-200l200 200h80q0-127-78-224.5T560-829v-82q124 28 202 125.5T840-562q0 63-22 120.5T756-335l36 36L792-56ZM120-360v-240h160l200-200v114l-80 80v-34L280-520H200v80h80l24 24-24 24-160-160v192ZM40-136l56 56 784-784-56-56L40-136Z" />`}
            </svg>
            ${this.speechEnabled ? 'Voice Agent: ON' : 'Voice Agent: OFF'}
          </button>

          ${this.voiceStatusMessage
            ? html`<div class="voice-status-pill">
                <span class="pulsing-dot"></span> ${this.voiceStatusMessage}
              </div>`
            : ''}
        </div>

        <!-- Floating Real-Time Navigation HUD Card -->
        ${this.navigationInfo.isActive
          ? html`<div class="nav-hud-card" role="region" aria-label="Route Navigation">
              <div class="nav-hud-header">
                <div class="nav-hud-title-wrap">
                  <div class="nav-tag">Real-Time Navigation</div>
                  <div class="nav-route-name">
                    ${this.navigationInfo.origin} ➔ ${this.navigationInfo.destination}
                  </div>
                </div>
                <button
                  class="nav-close-btn"
                  title="Close Navigation"
                  @click=${() => this.dismissNavigation()}>
                  ✕
                </button>
              </div>

              <div class="nav-hud-metrics">
                <div class="nav-metric-eta">
                  <div class="nav-eta-value">
                    ${this.navigationInfo.durationText}
                  </div>
                  <div class="nav-eta-sub">
                    ${this.navigationInfo.distanceText} •
                    ${this.navigationInfo.summaryRoad}
                  </div>
                </div>
                <div class="nav-actions">
                  <button
                    class="nav-flythrough-btn ${this.isFlythroughRunning
                      ? 'running'
                      : ''}"
                    @click=${() =>
                      this.isFlythroughRunning
                        ? this.stopRouteFlythrough()
                        : this.startRouteFlythrough()}>
                    ${this.isFlythroughRunning
                      ? '⏸ Pause 3D Tour'
                      : '▶ 3D Flythrough'}
                  </button>
                </div>
              </div>

              <!-- Next Turn preview -->
              ${this.navigationInfo.steps.length > 0
                ? html`<div class="nav-next-step">
                    <div class="turn-icon">➔</div>
                    <div class="turn-text">${this.navigationInfo.steps[0]}</div>
                  </div>`
                : ''}

              <!-- Step-by-Step expandable list -->
              <div class="nav-steps-accordion">
                <button
                  class="nav-steps-toggle"
                  @click=${() => {
                    this.isNavStepsExpanded = !this.isNavStepsExpanded;
                  }}>
                  ${this.isNavStepsExpanded
                    ? '▲ Hide All Directions'
                    : `▼ Show All Directions (${this.navigationInfo.steps.length} steps)`}
                </button>

                ${this.isNavStepsExpanded
                  ? html`<div class="nav-steps-list">
                      ${this.navigationInfo.steps.map(
                        (step, idx) => html`<div class="nav-step-item">
                          <span class="step-num">${idx + 1}</span>
                          <span class="step-inst">${step}</span>
                        </div>`,
                      )}
                    </div>`
                  : ''}
              </div>
            </div>`
          : ''}

        <!-- Floating Inspected Property / Land Info Card -->
        ${this.currentInspectedPlace
          ? html`<div class="property-info-card" role="dialog" aria-label="Location Details">
              <div class="property-card-header">
                <span class="property-badge ${this.currentInspectedPlace.category}">
                  ${this.currentInspectedPlace.category === 'agriculture'
                    ? '🌾 Agricultural Land'
                    : this.currentInspectedPlace.category === 'home'
                    ? '🏡 Home Residence'
                    : this.currentInspectedPlace.category === 'business'
                    ? '🏢 Business Platform'
                    : '📐 Land Plot'}
                </span>
                <button
                  class="property-close-btn"
                  @click=${() => {
                    this.currentInspectedPlace = undefined;
                    this._clearMapElements();
                  }}>
                  ✕
                </button>
              </div>

              <div class="property-title">
                ${this.currentInspectedPlace.name}
              </div>
              <div class="property-address">
                ${this.currentInspectedPlace.address}
              </div>

              ${this.currentInspectedPlace.landSize
                ? html`<div class="property-size">
                    <strong>Plot / Land Size:</strong>
                    ${this.currentInspectedPlace.landSize}
                  </div>`
                : ''}
              ${this.currentInspectedPlace.notes
                ? html`<div class="property-notes">
                    ${this.currentInspectedPlace.notes}
                  </div>`
                : ''}

              <div class="property-actions">
                <button
                  class="btn-prop-nav"
                  @click=${() => this.directionsToPlace(this.currentInspectedPlace!)}>
                  🚗 Get Route & Directions
                </button>
              </div>
            </div>`
          : ''}
      </div>

      <!-- Sidebar Area (Chat & Saved Places) -->
      <div class="sidebar" role="complementary" aria-labelledby="chat-heading">
        <!-- Tab Selector: Gemini Voice Agent vs Saved Places -->
        <div class="selector" role="tablist" aria-label="Navigation Sections">
          <button
            id="geminiTab"
            role="tab"
            aria-selected=${this.selectedChatTab === ChatTab.GEMINI}
            aria-controls="chat-panel"
            class=${classMap({
              'selected-tab': this.selectedChatTab === ChatTab.GEMINI,
            })}
            @click=${() => {
              this.selectedChatTab = ChatTab.GEMINI;
            }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="18"
              viewBox="0 -960 960 960"
              width="18"
              fill="currentColor">
              <path
                d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z" />
            </svg>
            <span id="chat-heading">Gemini Agent</span>
          </button>

          <button
            id="placesTab"
            role="tab"
            aria-selected=${this.selectedChatTab === ChatTab.PLACES}
            aria-controls="places-panel"
            class=${classMap({
              'selected-tab': this.selectedChatTab === ChatTab.PLACES,
            })}
            @click=${() => {
              this.selectedChatTab = ChatTab.PLACES;
            }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="18"
              viewBox="0 -960 960 960"
              width="18"
              fill="currentColor">
              <path
                d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 294q122-112 181-203.5T720-552q0-109-69.5-178.5T480-800q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186Zm0 106Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 100-79.5 217.5T480-80Zm0-480Z" />
            </svg>
            <span>My Places (${this.savedPlaces.length})</span>
          </button>
        </div>

        <!-- TAB 1: GEMINI AGENT & VOICE CHAT -->
        <div
          id="chat-panel"
          role="tabpanel"
          aria-labelledby="geminiTab"
          class=${classMap({
            'tabcontent': true,
            'showtab': this.selectedChatTab === ChatTab.GEMINI,
          })}>
          <div class="chat-messages" aria-live="polite">
            ${this.messages}
            <div id="anchor"></div>
          </div>

          <div class="footer">
            <!-- Voice indicator banner -->
            ${this.isListening || this.isSpeaking
              ? html`<div class="voice-active-indicator">
                  <div class="voice-wave">
                    <span class="bar"></span>
                    <span class="bar"></span>
                    <span class="bar"></span>
                    <span class="bar"></span>
                  </div>
                  <span>
                    ${this.isListening
                      ? 'Listening to your voice...'
                      : 'Voice Agent speaking...'}
                  </span>
                </div>`
              : ''}

            <!-- Chat Status -->
            <div
              id="chatStatus"
              aria-live="assertive"
              class=${classMap({'hidden': this.chatState === ChatState.IDLE})}>
              ${this.chatState === ChatState.GENERATING
                ? html`${ICON_BUSY} Generating response...`
                : ''}
              ${this.chatState === ChatState.THINKING
                ? html`${ICON_BUSY} Reasoning & planning navigation...`
                : ''}
              ${this.chatState === ChatState.EXECUTING
                ? html`${ICON_BUSY} Executing 3D map actions...`
                : ''}
            </div>

            <!-- Input Area with Voice Agent Mic & Speaker Controls -->
            <div id="inputArea" role="form">
              <!-- Voice Microphone Button -->
              <button
                id="voiceMicButton"
                type="button"
                class="mic-btn ${this.isListening ? 'listening' : ''}"
                title="${this.isListening
                  ? 'Stop listening'
                  : 'Talk to Voice Agent'}"
                @click=${() => this.toggleVoiceListening()}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="22"
                  viewBox="0 -960 960 960"
                  width="22"
                  fill="currentColor">
                  <path
                    d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Zm40-360q17 0 28.5-11.5T520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480Z" />
                </svg>
              </button>

              <input
                type="text"
                id="messageInput"
                .value=${this.inputMessage}
                @input=${(e: InputEvent) => {
                  this.inputMessage = (e.target as HTMLInputElement).value;
                }}
                @keydown=${(e: KeyboardEvent) => {
                  this.inputKeyDownAction(e);
                }}
                placeholder=${this.isListening
                  ? 'Listening to speech...'
                  : 'Ask agent or give map orders...'}
                autocomplete="off" />

              <!-- Audio Speaker Toggle -->
              <button
                type="button"
                class="speaker-toggle-btn ${this.speechEnabled ? 'on' : 'off'}"
                title="${this.speechEnabled
                  ? 'Voice response enabled (Click to mute)'
                  : 'Voice response muted (Click to enable)'}"
                @click=${() => this.toggleSpeechEnabled()}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="20"
                  viewBox="0 -960 960 960"
                  width="20"
                  fill="currentColor">
                  ${this.speechEnabled
                    ? html`<path
                        d="M560-131v-82q90-26 145-100t55-167q0-93-55-167T560-747v-82q124 28 202 125.5T840-480q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v680L280-360H120Zm440 40v-320q46 17 73 57.5t27 92.5q0 52-27 92.5T560-320Z" />`
                    : html`<path
                        d="m792-56-64-64q-42 34-92 54.5T560-45v-82q36-18 67-42.5t53-56.5l-60-60v-274l-80-80v160l-80-80v-200l200 200h80q0-127-78-224.5T560-829v-82q124 28 202 125.5T840-562q0 63-22 120.5T756-335l36 36L792-56ZM120-360v-240h160l200-200v114l-80 80v-34L280-520H200v80h80l24 24-24 24-160-160v192ZM40-136l56 56 784-784-56-56L40-136Z" />`}
                </svg>
              </button>

              <button
                id="sendButton"
                @click=${() => {
                  this.sendMessageAction();
                }}
                aria-label="Send message"
                ?disabled=${this.chatState !== ChatState.IDLE}
                class=${classMap({
                  'disabled': this.chatState !== ChatState.IDLE,
                })}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="26px"
                  viewBox="0 -960 960 960"
                  width="26px"
                  fill="currentColor">
                  <path d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- TAB 2: MY SAVED PLACES (Home, Business, Land, Agriculture) -->
        <div
          id="places-panel"
          role="tabpanel"
          aria-labelledby="placesTab"
          class=${classMap({
            'tabcontent': true,
            'showtab': this.selectedChatTab === ChatTab.PLACES,
          })}>
          <div class="places-container">
            <div class="places-top-bar">
              <div class="places-header-title">Saved Locations & Land</div>
              <button
                class="btn-add-place"
                @click=${() => this.openAddPlaceModal()}>
                + Add Place
              </button>
            </div>

            <!-- Category Filter Chips -->
            <div class="category-chips">
              <button
                class="chip ${this.selectedCategoryFilter === 'all'
                  ? 'active'
                  : ''}"
                @click=${() => {
                  this.selectedCategoryFilter = 'all';
                }}>
                All (${this.savedPlaces.length})
              </button>
              <button
                class="chip ${this.selectedCategoryFilter === 'agriculture'
                  ? 'active'
                  : ''}"
                @click=${() => {
                  this.selectedCategoryFilter = 'agriculture';
                }}>
                🌾 Agriculture
              </button>
              <button
                class="chip ${this.selectedCategoryFilter === 'home'
                  ? 'active'
                  : ''}"
                @click=${() => {
                  this.selectedCategoryFilter = 'home';
                }}>
                🏡 Home
              </button>
              <button
                class="chip ${this.selectedCategoryFilter === 'business'
                  ? 'active'
                  : ''}"
                @click=${() => {
                  this.selectedCategoryFilter = 'business';
                }}>
                🏢 Business
              </button>
              <button
                class="chip ${this.selectedCategoryFilter === 'land'
                  ? 'active'
                  : ''}"
                @click=${() => {
                  this.selectedCategoryFilter = 'land';
                }}>
                📐 Land Plots
              </button>
            </div>

            <!-- Search Places input -->
            <div class="places-search-box">
              <input
                type="text"
                placeholder="Search your saved locations..."
                .value=${this.placesSearchQuery}
                @input=${(e: InputEvent) => {
                  this.placesSearchQuery = (
                    e.target as HTMLInputElement
                  ).value;
                }} />
            </div>

            <!-- Places Cards List -->
            <div class="places-card-list">
              ${filteredPlaces.length === 0
                ? html`<div class="empty-places-state">
                    No locations found matching your filter. Click "+ Add Place"
                    or ask the Voice Agent to save one!
                  </div>`
                : filteredPlaces.map(
                    (place) => html`<div class="place-item-card">
                      <div class="place-card-top">
                        <span class="place-cat-badge ${place.category}">
                          ${place.category === 'agriculture'
                            ? '🌾 Agriculture'
                            : place.category === 'home'
                            ? '🏡 Home'
                            : place.category === 'business'
                            ? '🏢 Business Platform'
                            : '📐 Land'}
                        </span>
                        ${place.landSize
                          ? html`<span class="place-size-pill">
                              ${place.landSize}
                            </span>`
                          : ''}
                      </div>

                      <div
                        class="place-card-title"
                        @click=${() => this.flyToPlace(place)}>
                        ${place.name}
                      </div>
                      <div class="place-card-addr">${place.address}</div>

                      ${place.notes
                        ? html`<div class="place-card-notes">
                            ${place.notes}
                          </div>`
                        : ''}

                      <div class="place-card-actions">
                        <button
                          class="card-action-btn primary"
                          title="Fly 3D Camera to location"
                          @click=${() => this.flyToPlace(place)}>
                          📍 Locate in 3D
                        </button>
                        <button
                          class="card-action-btn secondary"
                          title="Get driving directions"
                          @click=${() => this.directionsToPlace(place)}>
                          🚗 Directions
                        </button>
                        <button
                          class="card-action-btn delete"
                          title="Delete location"
                          @click=${() => this.deleteSavedPlace(place.id)}>
                          🗑
                        </button>
                      </div>
                    </div>`,
                  )}
            </div>
          </div>
        </div>
      </div>

      <!-- Add / Edit Place Modal Dialog -->
      ${this.activePlaceModal
        ? html`<div
            class="modal-backdrop"
            @click=${(e: Event) => {
              if (e.target === e.currentTarget) this.closeAddPlaceModal();
            }}>
            <div class="modal-card" role="dialog" aria-modal="true">
              <div class="modal-header">
                <h3>Save New Location / Land Plot</h3>
                <button
                  class="modal-close"
                  @click=${() => this.closeAddPlaceModal()}>
                  ✕
                </button>
              </div>

              <form @submit=${(e: Event) => this.submitPlaceForm(e)}>
                <div class="form-group">
                  <label>Place / Property Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sunrise Organic Wheat Farm, Apex Office"
                    .value=${this.formName}
                    @input=${(e: any) => (this.formName = e.target.value)} />
                </div>

                <div class="form-group">
                  <label>Category *</label>
                  <select
                    .value=${this.formCategory}
                    @change=${(e: any) =>
                      (this.formCategory = e.target.value)}>
                    <option value="agriculture">
                      🌾 Agricultural Land / Farm
                    </option>
                    <option value="home">🏡 Home / Residence</option>
                    <option value="business">
                      🏢 Business Platform / Office
                    </option>
                    <option value="land">📐 Land / Commercial Plot</option>
                    <option value="other">📍 Other Location</option>
                  </select>
                </div>

                <div class="form-group">
                  <label>Address or Landmark *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Fresno, CA or 742 Evergreen Terrace"
                    .value=${this.formAddress}
                    @input=${(e: any) => (this.formAddress = e.target.value)} />
                </div>

                <div class="form-group">
                  <label>Land / Plot Area (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 25 Acres, 10 Hectares, 5,000 sq ft"
                    .value=${this.formLandSize}
                    @input=${(e: any) =>
                      (this.formLandSize = e.target.value)} />
                </div>

                <div class="form-group">
                  <label>Details & Notes (optional)</label>
                  <textarea
                    rows="3"
                    placeholder="Soil type, crops grown, boundary notes, or facilities..."
                    .value=${this.formNotes}
                    @input=${(e: any) =>
                      (this.formNotes = e.target.value)}></textarea>
                </div>

                <div class="modal-actions">
                  <button
                    type="button"
                    class="btn-cancel"
                    @click=${() => this.closeAddPlaceModal()}>
                    Cancel
                  </button>
                  <button type="submit" class="btn-submit">
                    Save Location
                  </button>
                </div>
              </form>
            </div>
          </div>`
        : ''}
    </div>`;
  }
}
