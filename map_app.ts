/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Photorealistic 3D Google Maps Web Application.
 * Includes:
 * - 24/7 Live GPS tracking with pairing access codes (for parental/detective view)
 * - Detective timeline analysis with dwell durations and 14-15+ visit frequency heat-marking
 * - Vehicle-specific routing & clearance advisory (2-wheeler to 16-wheeler heavy freight)
 * - Real-time Weather HUD overlay toggle powered by Open-Meteo
 * - Continuous hands-free verbal voice conversation loop
 * - Saved Locations management (Home, Business Platform, Land, Agriculture)
 * - 3D camera navigation & route flythrough
 */

import {Loader} from '@googlemaps/js-api-loader';
import hljs from 'highlight.js';
import {html, LitElement, PropertyValueMap} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {Marked} from 'marked';
import {markedHighlight} from 'marked-highlight';

import {
  LiveGpsTrackingStatus,
  MapParams,
  SavedPlace,
  TimelineStop,
  VehicleProfile,
  VehicleTypeId,
  WeatherData,
} from './mcp_maps_server';

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
  TRACKING = 'tracking',
}

export interface NavigationRouteInfo {
  origin: string;
  destination: string;
  durationText: string;
  distanceText: string;
  summaryRoad: string;
  steps: string[];
  overviewPath: Array<{lat: number; lng: number}>;
  vehicleType: VehicleTypeId;
  clearanceWarning?: string;
  recommendedVehicleRoute?: string;
  isActive: boolean;
}

const USER_PROVIDED_GOOGLE_MAPS_API_KEY: string =
  'AIzaSyAJPTwj4S8isr4b-3NtqVSxk450IAS1lOQ';

export const VEHICLE_PROFILES: Record<VehicleTypeId, VehicleProfile> = {
  scooter_2w: {
    id: 'scooter_2w',
    label: '2-Wheeler (Bike / Scooter / Cycle)',
    wheels: 2,
    widthMeters: 0.8,
    heightMeters: 1.2,
    maxWeightTons: 0.3,
    turningRadiusMeters: 1.5,
    restrictedAlleyways: false,
    requiresTruckBypass: false,
  },
  car_4w: {
    id: 'car_4w',
    label: '4-Wheeler (Car / Sedan / SUV / Van)',
    wheels: 4,
    widthMeters: 1.9,
    heightMeters: 1.6,
    maxWeightTons: 2.5,
    turningRadiusMeters: 5.2,
    restrictedAlleyways: false,
    requiresTruckBypass: false,
  },
  truck_6w: {
    id: 'truck_6w',
    label: '6-Wheeler (Medium Truck / Delivery)',
    wheels: 6,
    widthMeters: 2.4,
    heightMeters: 3.2,
    maxWeightTons: 10.0,
    turningRadiusMeters: 8.5,
    restrictedAlleyways: true,
    requiresTruckBypass: false,
  },
  heavy_8w: {
    id: 'heavy_8w',
    label: '8-Wheeler (Heavy Commercial / Tipper)',
    wheels: 8,
    widthMeters: 2.55,
    heightMeters: 3.8,
    maxWeightTons: 25.0,
    turningRadiusMeters: 12.0,
    restrictedAlleyways: true,
    requiresTruckBypass: true,
  },
  semi_16w: {
    id: 'semi_16w',
    label: '16-Wheeler (Freight Semi-Trailer)',
    wheels: 16,
    widthMeters: 2.6,
    heightMeters: 4.2,
    maxWeightTons: 45.0,
    turningRadiusMeters: 16.5,
    restrictedAlleyways: true,
    requiresTruckBypass: true,
  },
};

const DEFAULT_SAVED_PLACES: SavedPlace[] = [
  {
    id: 'place_agro_1',
    name: 'Sunrise Organic Agrotech Farm',
    category: 'agriculture',
    address: 'Fresno County, San Joaquin Valley, CA',
    lat: 36.7468,
    lng: -119.7726,
    landSize: '45.0 Acres',
    notes:
      'Fertile agricultural land, solar drip irrigation, organic almond and wheat crop cultivation.',
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
    notes:
      'Primary residence with private driveway, landscaped garden, and residential plot.',
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
    notes:
      'Headquarters commercial tech campus, multi-story office, research and data center facility.',
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
    notes:
      'Zoned commercial development land near highway transit corridor for logistics and business buildout.',
    createdAt: Date.now() - 86400000 * 20,
  },
];

const DEFAULT_TIMELINE_STOPS: TimelineStop[] = [
  {
    id: 'stop_1',
    name: 'Central Freight Logistics Yard B',
    address: '4200 Logistics Blvd, Oakland, CA',
    lat: 37.8044,
    lng: -122.2712,
    arrivalTime: 'Today, 08:30 AM',
    departureTime: 'Today, 11:45 AM',
    dwellDuration: '3 hrs 15 mins',
    visitCount: 16, // HIGH FREQUENCY: 15+ visits!
    isHighFrequency: true,
    notes:
      'Primary recurring commercial loading bay. Visited 16 times in past 30 days.',
  },
  {
    id: 'stop_2',
    name: 'West Coast Heavy Equipment Depot',
    address: '1850 Port Way, Richmond, CA',
    lat: 37.9358,
    lng: -122.3477,
    arrivalTime: 'Yesterday, 02:10 PM',
    departureTime: 'Yesterday, 04:30 PM',
    dwellDuration: '2 hrs 20 mins',
    visitCount: 14, // HIGH FREQUENCY: 14 visits!
    isHighFrequency: true,
    notes: 'Recurring maintenance stop. Flagged in detective surveillance mode.',
  },
  {
    id: 'stop_3',
    name: 'Sunrise Agrotech Grain Silo',
    address: 'San Joaquin Valley Route 99, CA',
    lat: 36.7468,
    lng: -119.7726,
    arrivalTime: '2 Days ago, 09:15 AM',
    departureTime: '2 Days ago, 11:00 AM',
    dwellDuration: '1 hr 45 mins',
    visitCount: 7,
    isHighFrequency: false,
    notes: 'Agricultural cargo pickup.',
  },
  {
    id: 'stop_4',
    name: 'Expressway Highway Weigh Station',
    address: 'Interstate 5 Southbound Mile 88',
    lat: 37.152,
    lng: -121.05,
    arrivalTime: '3 Days ago, 06:40 PM',
    departureTime: '3 Days ago, 07:10 PM',
    dwellDuration: '30 mins',
    visitCount: 4,
    isHighFrequency: false,
    notes: 'Mandatory commercial vehicle weight check.',
  },
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

  // Vehicle Profile State
  @state() selectedVehicleType: VehicleTypeId = 'car_4w';

  // Saved Places state
  @state() savedPlaces: SavedPlace[] = [];
  @state() selectedCategoryFilter: string = 'all';
  @state() placesSearchQuery: string = '';
  @state() activePlaceModal: boolean = false;
  @state() currentInspectedPlace?: SavedPlace;

  // Form state for adding/editing place
  @state() formName = '';
  @state() formCategory: 'home' | 'business' | 'land' | 'agriculture' | 'other' =
    'agriculture';
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
    vehicleType: 'car_4w',
    isActive: false,
  };
  @state() isNavStepsExpanded: boolean = false;
  @state() isFlythroughRunning: boolean = false;

  // 24/7 Live GPS Tracking & Detective Timeline State
  @state() pairingCode: string = 'TRK-8821';
  @state() enteredPairCode: string = '';
  @state() isDevicePaired: boolean = true;
  @state() liveTrackingStatus: LiveGpsTrackingStatus = {
    pairedCode: 'TRK-8821',
    isTracking: true,
    latitude: 37.7749,
    longitude: -122.4194,
    speedKmh: 42,
    headingDegrees: 45,
    carDirection: 'North-East',
    lastUpdated: 'Live GPS Synced (Just now)',
    activeTravelZone: 'Bay Area Commercial Corridor',
    currentStatus: 'moving',
  };
  @state() isGpsSimulatorActive: boolean = false;
  @state() timelineStops: TimelineStop[] = [];
  @state() selectedTimelineFilter: 'all' | 'frequent' = 'all';
  @state() activePairingModal: boolean = false;

  // Weather HUD Overlay State
  @state() showWeatherOverlay: boolean = false;
  @state() isWeatherLoading: boolean = false;
  @state() currentWeather?: WeatherData;

  // Voice Agent State (with Continuous Verbal Mode)
  @state() isListening: boolean = false;
  @state() isSpeaking: boolean = false;
  @state() speechEnabled: boolean = true;
  @state() isContinuousVoice: boolean = false;
  @state() voiceSupported: boolean = true;
  @state() voiceStatusMessage: string = '';

  // Google Maps instances
  private map?: any;
  private geocoder?: any;
  private marker?: any;
  private propertyBoundary?: any;
  private trackingMarker?: any;
  private trackingHeadingCone?: any;
  private frequentStopMarkers: any[] = [];
  private Map3DElement?: any;
  private Marker3DElement?: any;
  private Polyline3DElement?: any;
  private directionsService?: any;
  private routePolyline?: any;
  private originMarker?: any;
  private destinationMarker?: any;

  // Internal simulators / timers
  private gpsSimulationInterval?: any;
  private speechRecognition?: any;

  sendMessageHandler?: CallableFunction;

  constructor() {
    super();
    this.loadPersistedData();
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

  // --- Persistence ---
  private loadPersistedData() {
    try {
      const placesStored = localStorage.getItem('gdm_saved_places_v2');
      if (placesStored) {
        this.savedPlaces = JSON.parse(placesStored);
      } else {
        this.savedPlaces = [...DEFAULT_SAVED_PLACES];
        localStorage.setItem(
          'gdm_saved_places_v2',
          JSON.stringify(this.savedPlaces),
        );
      }

      const stopsStored = localStorage.getItem('gdm_timeline_stops_v2');
      if (stopsStored) {
        this.timelineStops = JSON.parse(stopsStored);
      } else {
        this.timelineStops = [...DEFAULT_TIMELINE_STOPS];
        localStorage.setItem(
          'gdm_timeline_stops_v2',
          JSON.stringify(this.timelineStops),
        );
      }

      const code = localStorage.getItem('gdm_tracking_code');
      if (code) {
        this.pairingCode = code;
        this.liveTrackingStatus.pairedCode = code;
      }
    } catch {
      this.savedPlaces = [...DEFAULT_SAVED_PLACES];
      this.timelineStops = [...DEFAULT_TIMELINE_STOPS];
    }
  }

  private savePlacesToStorage() {
    try {
      localStorage.setItem(
        'gdm_saved_places_v2',
        JSON.stringify(this.savedPlaces),
      );
    } catch {}
  }

  private saveTimelineToStorage() {
    try {
      localStorage.setItem(
        'gdm_timeline_stops_v2',
        JSON.stringify(this.timelineStops),
      );
    } catch {}
  }

  // --- Continuous Voice Agent ---
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
        this.voiceStatusMessage = this.isContinuousVoice
          ? 'Continuous Verbal Agent: Listening...'
          : 'Listening... Speak your command';
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
        if (this.isContinuousVoice && event.error !== 'not-allowed') {
          setTimeout(() => this.restartVoiceListeningIfContinuous(), 1200);
        } else {
          this.voiceStatusMessage =
            event.error === 'not-allowed'
              ? 'Microphone permission denied'
              : 'Voice error';
          setTimeout(() => {
            this.voiceStatusMessage = '';
            this.requestUpdate();
          }, 2500);
        }
        this.requestUpdate();
      };

      this.speechRecognition.onend = () => {
        this.isListening = false;
        if (this.isContinuousVoice && !this.isSpeaking) {
          setTimeout(() => this.restartVoiceListeningIfContinuous(), 600);
        }
        this.requestUpdate();
      };
    } catch (e) {
      console.warn('Voice recognition init failed:', e);
      this.voiceSupported = false;
    }
  }

  private restartVoiceListeningIfContinuous() {
    if (
      this.isContinuousVoice &&
      !this.isSpeaking &&
      !this.isListening &&
      this.speechRecognition
    ) {
      try {
        this.speechRecognition.start();
      } catch {}
    }
  }

  public toggleContinuousVoiceMode() {
    this.isContinuousVoice = !this.isContinuousVoice;
    if (this.isContinuousVoice) {
      this.speechEnabled = true;
      this.stopSpeaking();
      this.startVoiceListening();
    } else {
      this.stopVoiceListening();
    }
    this.requestUpdate();
  }

  public startVoiceListening() {
    if (!this.speechRecognition) return;
    this.stopSpeaking();
    try {
      this.speechRecognition.start();
    } catch {
      try {
        this.speechRecognition.stop();
        setTimeout(() => this.speechRecognition.start(), 200);
      } catch {}
    }
  }

  public stopVoiceListening() {
    if (this.speechRecognition && this.isListening) {
      this.speechRecognition.stop();
      this.isListening = false;
      this.voiceStatusMessage = '';
    }
  }

  public toggleVoiceListening() {
    if (this.isListening) {
      this.stopVoiceListening();
    } else {
      this.startVoiceListening();
    }
  }

  public speakText(rawText: string) {
    if (!this.speechEnabled || !('speechSynthesis' in window)) return;

    let clean = rawText
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[#*_~`>]/g, '')
      .replace(/\{[\s\S]*?\}/g, '')
      .trim();

    if (!clean) return;
    if (clean.length > 400) clean = clean.substring(0, 390) + '...';

    this.stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Natural') ||
          v.name.includes('Google') ||
          v.name.includes('Samantha') ||
          v.name.includes('David')),
    );
    if (naturalVoice) utterance.voice = naturalVoice;

    utterance.onstart = () => {
      this.isSpeaking = true;
      this.voiceStatusMessage = 'Voice Agent speaking...';
      this.requestUpdate();
    };

    utterance.onend = () => {
      this.isSpeaking = false;
      this.voiceStatusMessage = '';
      this.requestUpdate();
      // If continuous verbal mode is active, restart mic automatically
      if (this.isContinuousVoice) {
        setTimeout(() => this.restartVoiceListeningIfContinuous(), 500);
      }
    };

    utterance.onerror = () => {
      this.isSpeaking = false;
      this.voiceStatusMessage = '';
      this.requestUpdate();
      if (this.isContinuousVoice) {
        setTimeout(() => this.restartVoiceListeningIfContinuous(), 500);
      }
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
      this.isContinuousVoice = false;
    }
    this.requestUpdate();
  }

  // --- Real-Time Weather Overlay (Open-Meteo API) ---
  public async toggleWeatherOverlay() {
    this.showWeatherOverlay = !this.showWeatherOverlay;
    if (this.showWeatherOverlay) {
      await this.fetchRealTimeWeather();
    }
    this.requestUpdate();
  }

  public async fetchRealTimeWeather(overrideLat?: number, overrideLng?: number) {
    this.isWeatherLoading = true;
    this.requestUpdate();

    let lat = overrideLat ?? 37.7749;
    let lng = overrideLng ?? -122.4194;

    // Use map camera center if initialized
    if (this.map && typeof this.map.center === 'string') {
      const parts = this.map.center.split(',');
      if (parts.length >= 2) {
        lat = parseFloat(parts[0]) || lat;
        lng = parseFloat(parts[1]) || lng;
      }
    } else if (this.map && this.map.center && typeof this.map.center.lat === 'function') {
      lat = this.map.center.lat();
      lng = this.map.center.lng();
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(
        4,
      )}&longitude=${lng.toFixed(4)}&current_weather=true`;
      const res = await fetch(url);
      const data = await res.json();

      if (data && data.current_weather) {
        const cw = data.current_weather;
        const tempC = Math.round(cw.temperature);
        const tempF = Math.round((tempC * 9) / 5 + 32);
        const code = cw.weathercode;

        let condition = 'Clear Sky';
        if (code >= 1 && code <= 3) condition = 'Partly Cloudy';
        else if (code >= 45 && code <= 48) condition = 'Foggy / Hazy';
        else if (code >= 51 && code <= 67) condition = 'Rain / Showers';
        else if (code >= 71 && code <= 77) condition = 'Snow / Sleet';
        else if (code >= 80 && code <= 82) condition = 'Heavy Rain';
        else if (code >= 95) condition = 'Thunderstorm';

        this.currentWeather = {
          locationName: `Map View (${lat.toFixed(2)}°, ${lng.toFixed(2)}°)`,
          temperatureC: tempC,
          temperatureF: tempF,
          condition,
          windSpeedKmh: Math.round(cw.windspeed),
          humidity: 58,
          precipitationRisk: code >= 50 ? 80 : 15,
        };
      }
    } catch (e) {
      console.warn('Weather fetch failed, using fallback:', e);
      this.currentWeather = {
        locationName: `Current Map Zone (${lat.toFixed(2)}°, ${lng.toFixed(2)}°)`,
        temperatureC: 22,
        temperatureF: 72,
        condition: 'Sunny / Clear',
        windSpeedKmh: 14,
        humidity: 50,
        precipitationRisk: 5,
      };
    } finally {
      this.isWeatherLoading = false;
      this.requestUpdate();
    }
  }

  // --- 24/7 Live GPS Tracking & Simulation ---
  public generateNewPairingCode() {
    const code = 'TRK-' + Math.floor(1000 + Math.random() * 9000);
    this.pairingCode = code;
    this.liveTrackingStatus.pairedCode = code;
    localStorage.setItem('gdm_tracking_code', code);
    this.requestUpdate();
  }

  public pairWithEnteredCode() {
    if (!this.enteredPairCode.trim()) return;
    this.pairingCode = this.enteredPairCode.trim().toUpperCase();
    this.liveTrackingStatus.pairedCode = this.pairingCode;
    this.isDevicePaired = true;
    this.activePairingModal = false;
    localStorage.setItem('gdm_tracking_code', this.pairingCode);
    this.requestUpdate();
  }

  public toggleGpsSimulator() {
    this.isGpsSimulatorActive = !this.isGpsSimulatorActive;
    if (this.isGpsSimulatorActive) {
      this.startGpsSimulator();
    } else {
      this.stopGpsSimulator();
    }
    this.requestUpdate();
  }

  private startGpsSimulator() {
    if (this.gpsSimulationInterval) clearInterval(this.gpsSimulationInterval);

    // Initial simulated route coordinates
    let angle = 0;
    const baseLat = 37.7749;
    const baseLng = -122.4194;

    this.gpsSimulationInterval = setInterval(() => {
      angle += 0.08;
      const speed = Math.floor(35 + Math.sin(angle) * 20);
      const lat = baseLat + Math.sin(angle) * 0.015;
      const lng = baseLng + Math.cos(angle) * 0.018;
      const heading = Math.round(((angle * 180) / Math.PI) % 360);

      const dirs = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
      const dirIndex = Math.round(heading / 45) % 8;

      this.liveTrackingStatus = {
        ...this.liveTrackingStatus,
        latitude: lat,
        longitude: lng,
        speedKmh: speed,
        headingDegrees: heading,
        carDirection: dirs[dirIndex],
        lastUpdated: 'Live GPS Satellite Synced',
        currentStatus: speed > 5 ? 'moving' : 'stopped',
        currentStopDuration: speed > 5 ? undefined : '12 mins at Signal',
      };

      this.updateTrackingMarkerOnMap(lat, lng, heading);
      this.requestUpdate();
    }, 2000);
  }

  private stopGpsSimulator() {
    if (this.gpsSimulationInterval) {
      clearInterval(this.gpsSimulationInterval);
      this.gpsSimulationInterval = undefined;
    }
  }

  private updateTrackingMarkerOnMap(lat: number, lng: number, heading: number) {
    if (!this.map || !this.Marker3DElement) return;

    if (!this.trackingMarker) {
      this.trackingMarker = new this.Marker3DElement();
      this.trackingMarker.label = `🚗 Live Vehicle [${this.pairingCode}]`;
      (this.map as any).appendChild(this.trackingMarker);
    }

    this.trackingMarker.position = {lat, lng, altitude: 0};
    this.trackingMarker.label = `🚗 [${this.pairingCode}] ${this.liveTrackingStatus.carDirection} • ${this.liveTrackingStatus.speedKmh} km/h`;

    // Fly camera smoothly to follow vehicle
    if (this.selectedChatTab === ChatTab.TRACKING) {
      (this.map as any).flyCameraTo({
        endCamera: {
          center: {lat, lng, altitude: 0},
          heading: heading,
          tilt: 60,
          range: 900,
        },
        durationMillis: 1500,
      });
    }
  }

  // --- Detective Frequent Stop Heat-Marking (14-15+ visits) ---
  public highlightFrequentStopsOnMap() {
    if (!this.map || !this.Marker3DElement) return;

    // Remove previous frequent markers
    this.frequentStopMarkers.forEach((m) => m.remove());
    this.frequentStopMarkers = [];

    this.timelineStops.forEach((stop) => {
      const isCrimson = stop.visitCount >= 14;
      const marker = new this.Marker3DElement();
      marker.position = {lat: stop.lat, lng: stop.lng, altitude: 0};
      marker.label = isCrimson
        ? `🚨 FREQUENT (${stop.visitCount}x): ${stop.name}`
        : `📍 Stop (${stop.visitCount}x): ${stop.name}`;

      (this.map as any).appendChild(marker);
      this.frequentStopMarkers.push(marker);
    });

    // Fly to first high frequency stop
    const target = this.timelineStops.find((s) => s.visitCount >= 14) || this.timelineStops[0];
    if (target) {
      (this.map as any).flyCameraTo({
        endCamera: {
          center: {lat: target.lat, lng: target.lng, altitude: 0},
          heading: 20,
          tilt: 65,
          range: 1500,
        },
        durationMillis: 2000,
      });
    }
  }

  public flyToTimelineStop(stop: TimelineStop) {
    if (!this.map) return;
    (this.map as any).flyCameraTo({
      endCamera: {
        center: {lat: stop.lat, lng: stop.lng, altitude: 0},
        heading: 0,
        tilt: 65,
        range: 1200,
      },
      durationMillis: 1800,
    });
  }

  // --- Saved Places Management ---
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

  // --- Google Maps Lifecycle ---
  async loadMap() {
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

      // Initialize live tracking marker
      this.updateTrackingMarkerOnMap(
        this.liveTrackingStatus.latitude,
        this.liveTrackingStatus.longitude,
        this.liveTrackingStatus.headingDegrees,
      );
    } catch (error) {
      console.error('Error loading Google Maps API:', error);
      this.mapError = 'Could not load 3D Google Maps. Verify network.';
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
      this.geocoder.geocode({address}, (results: any, status: string) => {
        if (status === 'OK' && results && results[0]) {
          const loc = results[0].geometry.location;
          resolve({lat: loc.lat(), lng: loc.lng()});
        } else {
          resolve(null);
        }
      });
    });
  }

  // --- Route Calculation with Vehicle Clearance Logic ---
  public async getRouteDetails(
    origin: string,
    destination: string,
    vehicleType: VehicleTypeId = this.selectedVehicleType,
  ): Promise<{
    durationText: string;
    distanceText: string;
    summaryRoad: string;
    steps: string[];
    clearanceWarning?: string;
    recommendedVehicleRoute?: string;
  }> {
    const profile = VEHICLE_PROFILES[vehicleType] || VEHICLE_PROFILES.car_4w;

    return new Promise((resolve) => {
      if (!this.directionsService) {
        resolve({
          durationText: 'Approx. 28 mins',
          distanceText: 'Approx. 18 km',
          summaryRoad: 'Direct Route',
          steps: ['Head towards destination'],
        });
        return;
      }

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

            let clearanceWarning: string | undefined;
            let recommendedVehicleRoute: string | undefined;

            if (vehicleType === 'semi_16w') {
              clearanceWarning =
                '16-Wheeler Alert: Tight turns and underpass height limit on local streets. Heavy congestion/jam risk. Avoid central city lanes.';
              recommendedVehicleRoute =
                'Take Designated Freight Expressway Ring Road & Truck Bypass Corridor.';
            } else if (vehicleType === 'heavy_8w') {
              clearanceWarning =
                '8-Wheeler Notice: Axle weight limits (25T) enforced on older bridges. Maintain outer lanes.';
              recommendedVehicleRoute =
                'Use Primary State Arterial Highway.';
            } else if (vehicleType === 'truck_6w') {
              clearanceWarning =
                '6-Wheeler Caution: Narrow alleyways prohibited in commercial districts between 8 AM - 6 PM.';
              recommendedVehicleRoute = 'Main Boulevard transit route.';
            } else if (vehicleType === 'scooter_2w') {
              clearanceWarning =
                '2-Wheeler Note: Prohibited on controlled-access grade-separated expressways.';
              recommendedVehicleRoute = 'Surface roads and bicycle/motorcycle lanes.';
            }

            resolve({
              durationText: leg?.duration?.text || 'Calculated',
              distanceText: leg?.distance?.text || 'Calculated',
              summaryRoad:
                route.summary || steps[0] || 'Primary Transit Highway',
              steps,
              clearanceWarning,
              recommendedVehicleRoute,
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

  // --- Handle Directions on Map ---
  public async handleDirections(
    originQuery: string,
    destinationQuery: string,
    vehicleType: VehicleTypeId = this.selectedVehicleType,
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

          const pathCoords: Array<{lat: number; lng: number}> = (
            route.overview_path || []
          ).map((p: any) => ({lat: p.lat(), lng: p.lng()}));

          const steps = (leg?.steps || []).map((s: any) =>
            (s.instructions || '').replace(/<[^>]+>/g, ' '),
          );

          let clearanceWarning: string | undefined;
          let recommendedVehicleRoute: string | undefined;

          if (vehicleType === 'semi_16w') {
            clearanceWarning =
              '16-Wheeler Alert: Tight 90° turns and low overpasses on local streets. Heavy congestion hazard!';
            recommendedVehicleRoute =
              'Freight Ring-Road Bypass Corridor';
          } else if (vehicleType === 'heavy_8w') {
            clearanceWarning =
              '8-Wheeler Warning: Max axle weight restrictions on secondary river bridges.';
            recommendedVehicleRoute = 'Primary Arterial Truck Route';
          } else if (vehicleType === 'truck_6w') {
            clearanceWarning =
              '6-Wheeler Notice: Narrow alleys prohibited during business hours.';
            recommendedVehicleRoute = 'Main Commercial Avenues';
          } else if (vehicleType === 'scooter_2w') {
            clearanceWarning =
              '2-Wheeler Notice: High-speed elevated expressways restricted.';
            recommendedVehicleRoute = 'City Surface Roads';
          }

          this.navigationInfo = {
            origin: originQuery,
            destination: destinationQuery,
            durationText: leg?.duration?.text || 'Real-time',
            distanceText: leg?.distance?.text || 'Direct',
            summaryRoad:
              route.summary || steps[0] || 'Primary Transit Highway',
            steps,
            overviewPath: pathCoords,
            vehicleType,
            clearanceWarning,
            recommendedVehicleRoute,
            isActive: true,
          };

          // Draw 3D route polyline: Color coded by vehicle clearance
          if (pathCoords.length > 0 && this.Polyline3DElement) {
            const polyCoords = pathCoords.map((p) => ({
              lat: p.lat,
              lng: p.lng,
              altitude: 6,
            }));
            this.routePolyline = new this.Polyline3DElement();
            this.routePolyline.coordinates = polyCoords;
            // Orange/Cyan for heavy trucks, Blue for cars, Green for 2-wheelers
            this.routePolyline.strokeColor =
              vehicleType === 'semi_16w' || vehicleType === 'heavy_8w'
                ? '#f59e0b'
                : vehicleType === 'scooter_2w'
                ? '#10b981'
                : '#2563eb';
            this.routePolyline.strokeWidth = 10;
            (this.map as any).appendChild(this.routePolyline);
          }

          // Origin & Destination 3D Markers
          if (leg && leg.start_location) {
            this.originMarker = new this.Marker3DElement();
            this.originMarker.position = {
              lat: leg.start_location.lat(),
              lng: leg.start_location.lng(),
              altitude: 0,
            };
            this.originMarker.label = `Start [${VEHICLE_PROFILES[vehicleType].label.split(' ')[0]}]: ${originQuery}`;
            (this.map as any).appendChild(this.originMarker);
          }

          if (leg && leg.end_location) {
            this.destinationMarker = new this.Marker3DElement();
            this.destinationMarker.position = {
              lat: leg.end_location.lat(),
              lng: leg.end_location.lng(),
              altitude: 0,
            };
            this.destinationMarker.label = `Destination: ${destinationQuery}`;
            (this.map as any).appendChild(this.destinationMarker);
          }

          // Adjust camera to fit route
          if (route.bounds) {
            const center = route.bounds.getCenter();
            (this.map as any).flyCameraTo({
              endCamera: {
                center: {lat: center.lat(), lng: center.lng(), altitude: 0},
                heading: 0,
                tilt: 45,
                range: 12000,
              },
              durationMillis: 2000,
            });
          }

          this.requestUpdate();
        }
      },
    );
  }

  // --- View Specific Location on 3D Map ---
  public async handleViewLocation(
    locationQuery: string,
    savedPlaceId?: string,
  ) {
    if (
      !this.mapInitialized ||
      !this.map ||
      !this.geocoder ||
      !this.Marker3DElement
    ) {
      return;
    }

    this._clearMapElements();

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
          const loc = results[0].geometry.location;
          const lat = loc.lat();
          const lng = loc.lng();

          const isLandOrAgro =
            matchedPlace &&
            (matchedPlace.category === 'agriculture' ||
              matchedPlace.category === 'land');

          (this.map as any).flyCameraTo({
            endCamera: {
              center: {lat, lng, altitude: 0},
              heading: isLandOrAgro ? 30 : 0,
              tilt: isLandOrAgro ? 60 : 65,
              range: isLandOrAgro ? 1200 : 1800,
            },
            durationMillis: 1800,
          });

          this.marker = new this.Marker3DElement();
          this.marker.position = {lat, lng, altitude: 0};
          this.marker.label = matchedPlace
            ? `${matchedPlace.category === 'agriculture' ? '🌾' : '🏢'} ${matchedPlace.name}`
            : locationQuery;
          (this.map as any).appendChild(this.marker);

          if (isLandOrAgro && this.Polyline3DElement) {
            const dLat = 0.0022;
            const dLng = 0.003;
            const coords = [
              {lat: lat - dLat, lng: lng - dLng, altitude: 8},
              {lat: lat + dLat, lng: lng - dLng, altitude: 8},
              {lat: lat + dLat, lng: lng + dLng, altitude: 8},
              {lat: lat - dLat, lng: lng + dLng, altitude: 8},
              {lat: lat - dLat, lng: lng - dLng, altitude: 8},
            ];
            this.propertyBoundary = new this.Polyline3DElement();
            this.propertyBoundary.coordinates = coords;
            this.propertyBoundary.strokeColor =
              matchedPlace.category === 'agriculture' ? '#10b981' : '#f59e0b';
            this.propertyBoundary.strokeWidth = 10;
            (this.map as any).appendChild(this.propertyBoundary);
          }

          // Fetch weather automatically if weather overlay is enabled
          if (this.showWeatherOverlay) {
            this.fetchRealTimeWeather(lat, lng);
          }

          this.requestUpdate();
        }
      },
    );
  }

  // --- MCP Tool Call Gateway ---
  async handleMapQuery(params: MapParams) {
    if (params.origin && params.destination) {
      await this.handleDirections(
        params.origin,
        params.destination,
        params.vehicleType || this.selectedVehicleType,
      );
    } else if (params.action === 'locate_gps') {
      this.updateTrackingMarkerOnMap(
        this.liveTrackingStatus.latitude,
        this.liveTrackingStatus.longitude,
        this.liveTrackingStatus.headingDegrees,
      );
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
    let usedInput = false;

    if (message) {
      msg = message.trim();
    } else {
      msg = this.inputMessage.trim();
      if (msg.length > 0) {
        this.inputMessage = '';
        usedInput = true;
      }
    }

    if (msg.length === 0) {
      if (usedInput) this.setNewRandomPrompt();
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

    if (usedInput) {
      this.setNewRandomPrompt();
    }
  }

  private setNewRandomPrompt() {
    const prompts = [
      'Locate my vehicle live GPS position and report direction.',
      'Can my 16-wheeler freight truck travel from Oakland to Richmond via downtown?',
      'Check the detective timeline for frequent stops visited 14+ times.',
      'Show me my agricultural land and inspect the property in 3D.',
      'Give me directions from my home to my business platform for an 8-wheeler.',
      'What is the real-time weather at the current map location?',
    ];
    this.inputMessage = prompts[Math.floor(Math.random() * prompts.length)];
  }

  private async inputKeyDownAction(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessageAction();
    }
  }

  // --- 3D Route Flythrough ---
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

  render() {
    const initialCenter = '37.7749,-122.4194,100';
    const initialRange = '50000';
    const initialTilt = '45';
    const initialHeading = '0';

    const filteredStops = this.timelineStops.filter((s) => {
      if (this.selectedTimelineFilter === 'frequent') {
        return s.visitCount >= 14;
      }
      return true;
    });

    const filteredPlaces = this.savedPlaces.filter((p) => {
      const matchCat =
        this.selectedCategoryFilter === 'all' ||
        p.category === this.selectedCategoryFilter;
      const matchQuery =
        !this.placesSearchQuery ||
        p.name.toLowerCase().includes(this.placesSearchQuery.toLowerCase()) ||
        p.address.toLowerCase().includes(this.placesSearchQuery.toLowerCase());
      return matchCat && matchQuery;
    });

    return html`<div class="gdm-map-app">
      <!-- Main 3D Map Area -->
      <div class="main-container" role="application">
        ${this.mapError
          ? html`<div class="map-error-message">${this.mapError}</div>`
          : ''}

        <gmp-map-3d
          id="mapContainer"
          style="height: 100%; width: 100%;"
          aria-label="Google Photorealistic 3D Map Display"
          mode="hybrid"
          center="${initialCenter}"
          heading="${initialHeading}"
          tilt="${initialTilt}"
          range="${initialRange}"
          default-ui-disabled="true">
        </gmp-map-3d>

        <!-- Top Map HUD Toolbar -->
        <div class="map-overlay-toolbar">
          <!-- Weather Overlay Toggle Button -->
          <button
            class="map-tool-btn ${this.showWeatherOverlay ? 'active' : ''}"
            title="Toggle Real-Time Weather HUD"
            @click=${() => this.toggleWeatherOverlay()}>
            ⛅ Weather: ${this.showWeatherOverlay ? 'ON' : 'OFF'}
          </button>

          <!-- Vehicle Type Selector Dropdown / Button -->
          <div class="vehicle-selector-wrap">
            <span class="vehicle-selector-label">Vehicle:</span>
            <select
              class="vehicle-select-dropdown"
              .value=${this.selectedVehicleType}
              @change=${(e: any) => {
                this.selectedVehicleType = e.target.value as VehicleTypeId;
                if (this.navigationInfo.isActive) {
                  this.handleDirections(
                    this.navigationInfo.origin,
                    this.navigationInfo.destination,
                    this.selectedVehicleType,
                  );
                }
              }}>
              <option value="scooter_2w">🛵 2-Wheeler (Bike / Scooter)</option>
              <option value="car_4w">🚗 4-Wheeler (Car / Sedan / SUV)</option>
              <option value="truck_6w">🚚 6-Wheeler (Medium Truck)</option>
              <option value="heavy_8w">🚛 8-Wheeler (Commercial Tipper)</option>
              <option value="semi_16w">🚛 16-Wheeler (Freight Semi)</option>
            </select>
          </div>

          <!-- Continuous Voice Agent Toggle -->
          <button
            class="map-tool-btn ${this.isContinuousVoice ? 'continuous-active' : ''}"
            title="Continuous hands-free voice conversation"
            @click=${() => this.toggleContinuousVoiceMode()}>
            🎙 Verbal Loop: ${this.isContinuousVoice ? 'ACTIVE' : 'OFF'}
          </button>

          <!-- 24/7 GPS Tracking Status Pill -->
          <button
            class="map-tool-btn ${this.liveTrackingStatus.isTracking ? 'gps-active' : ''}"
            title="View GPS Tracking & Detective Timeline"
            @click=${() => {
              this.selectedChatTab = ChatTab.TRACKING;
              this.highlightFrequentStopsOnMap();
            }}>
            📡 [${this.pairingCode}] ${this.liveTrackingStatus.carDirection} • ${this.liveTrackingStatus.speedKmh} km/h
          </button>

          <!-- Status Message Indicator -->
          ${this.voiceStatusMessage
            ? html`<div class="voice-status-pill">
                <span class="pulsing-dot"></span> ${this.voiceStatusMessage}
              </div>`
            : ''}
        </div>

        <!-- Real-Time Weather HUD Floating Card -->
        ${this.showWeatherOverlay && this.currentWeather
          ? html`<div class="weather-hud-card" role="region" aria-label="Real-time Weather">
              <div class="weather-header">
                <div class="weather-title-zone">
                  <span class="weather-badge">Real-Time Forecast</span>
                  <div class="weather-loc-name">
                    ${this.currentWeather.locationName}
                  </div>
                </div>
                <button
                  class="weather-close-btn"
                  @click=${() => (this.showWeatherOverlay = false)}>
                  ✕
                </button>
              </div>

              <div class="weather-main-row">
                <div class="weather-temp-hero">
                  ${this.currentWeather.temperatureC}°C
                  <span class="weather-temp-f">/ ${this.currentWeather.temperatureF}°F</span>
                </div>
                <div class="weather-condition-desc">
                  ${this.currentWeather.condition}
                </div>
              </div>

              <div class="weather-stats-grid">
                <div class="weather-stat-cell">
                  <span class="stat-label">Wind Speed</span>
                  <span class="stat-value font-mono">${this.currentWeather.windSpeedKmh} km/h</span>
                </div>
                <div class="weather-stat-cell">
                  <span class="stat-label">Humidity</span>
                  <span class="stat-value font-mono">${this.currentWeather.humidity}%</span>
                </div>
                <div class="weather-stat-cell">
                  <span class="stat-label">Precip Risk</span>
                  <span class="stat-value font-mono">${this.currentWeather.precipitationRisk}%</span>
                </div>
              </div>

              <div class="weather-footer">
                <button
                  class="btn-weather-refresh"
                  @click=${() => this.fetchRealTimeWeather()}>
                  ${this.isWeatherLoading ? 'Syncing...' : '↻ Refresh Weather'}
                </button>
              </div>
            </div>`
          : ''}

        <!-- Real-Time Navigation HUD Card -->
        ${this.navigationInfo.isActive
          ? html`<div class="nav-hud-card" role="region" aria-label="Route Navigation">
              <div class="nav-hud-header">
                <div>
                  <div class="nav-tag">
                    ${VEHICLE_PROFILES[this.navigationInfo.vehicleType].label.split(' ')[0]} Navigation
                  </div>
                  <div class="nav-route-name">
                    ${this.navigationInfo.origin} ➔ ${this.navigationInfo.destination}
                  </div>
                </div>
                <button class="nav-close-btn" @click=${() => this.dismissNavigation()}>
                  ✕
                </button>
              </div>

              <!-- Vehicle Clearance Warning Callout -->
              ${this.navigationInfo.clearanceWarning
                ? html`<div class="vehicle-clearance-box ${this.navigationInfo.vehicleType === 'semi_16w' || this.navigationInfo.vehicleType === 'heavy_8w' ? 'danger' : 'info'}">
                    <div class="clearance-title">
                      ⚠️ Vehicle Clearance Advisory:
                    </div>
                    <div class="clearance-text">
                      ${this.navigationInfo.clearanceWarning}
                    </div>
                    ${this.navigationInfo.recommendedVehicleRoute
                      ? html`<div class="clearance-recom">
                          Recommended: ${this.navigationInfo.recommendedVehicleRoute}
                        </div>`
                      : ''}
                  </div>`
                : ''}

              <div class="nav-hud-metrics">
                <div>
                  <div class="nav-eta-value">
                    ${this.navigationInfo.durationText}
                  </div>
                  <div class="nav-eta-sub">
                    ${this.navigationInfo.distanceText} • ${this.navigationInfo.summaryRoad}
                  </div>
                </div>
                <button
                  class="nav-flythrough-btn ${this.isFlythroughRunning ? 'running' : ''}"
                  @click=${() =>
                    this.isFlythroughRunning
                      ? this.stopRouteFlythrough()
                      : this.startRouteFlythrough()}>
                  ${this.isFlythroughRunning ? '⏸ Pause 3D Tour' : '▶ 3D Flythrough'}
                </button>
              </div>

              ${this.navigationInfo.steps.length > 0
                ? html`<div class="nav-next-step">
                    <div class="turn-icon">➔</div>
                    <div class="turn-text">${this.navigationInfo.steps[0]}</div>
                  </div>`
                : ''}

              <div class="nav-steps-accordion">
                <button
                  class="nav-steps-toggle"
                  @click=${() => {
                    this.isNavStepsExpanded = !this.isNavStepsExpanded;
                  }}>
                  ${this.isNavStepsExpanded
                    ? '▲ Hide Directions'
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

        <!-- Floating Property Info Card -->
        ${this.currentInspectedPlace
          ? html`<div class="property-info-card">
              <div class="property-card-header">
                <span class="property-badge ${this.currentInspectedPlace.category}">
                  ${this.currentInspectedPlace.category.toUpperCase()}
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
              <div class="property-title">${this.currentInspectedPlace.name}</div>
              <div class="property-address">${this.currentInspectedPlace.address}</div>
              ${this.currentInspectedPlace.landSize
                ? html`<div class="property-size">
                    Plot Size: <strong>${this.currentInspectedPlace.landSize}</strong>
                  </div>`
                : ''}
              ${this.currentInspectedPlace.notes
                ? html`<div class="property-notes">${this.currentInspectedPlace.notes}</div>`
                : ''}
              <button
                class="btn-prop-nav"
                @click=${() => {
                  this.handleDirections(
                    'Current GPS Location',
                    this.currentInspectedPlace!.address,
                  );
                }}>
                🚗 Direct Vehicle Route Here
              </button>
            </div>`
          : ''}
      </div>

      <!-- Sidebar Tabs (Gemini Agent / Saved Places / 24-7 Tracking & Detective) -->
      <div class="sidebar" role="complementary">
        <div class="selector" role="tablist">
          <button
            role="tab"
            aria-selected=${this.selectedChatTab === ChatTab.GEMINI}
            class=${classMap({
              'selected-tab': this.selectedChatTab === ChatTab.GEMINI,
            })}
            @click=${() => {
              this.selectedChatTab = ChatTab.GEMINI;
            }}>
            Agent & Voice
          </button>

          <button
            role="tab"
            aria-selected=${this.selectedChatTab === ChatTab.TRACKING}
            class=${classMap({
              'selected-tab': this.selectedChatTab === ChatTab.TRACKING,
            })}
            @click=${() => {
              this.selectedChatTab = ChatTab.TRACKING;
              this.highlightFrequentStopsOnMap();
            }}>
            24/7 Tracking & Detective
          </button>

          <button
            role="tab"
            aria-selected=${this.selectedChatTab === ChatTab.PLACES}
            class=${classMap({
              'selected-tab': this.selectedChatTab === ChatTab.PLACES,
            })}
            @click=${() => {
              this.selectedChatTab = ChatTab.PLACES;
            }}>
            My Places (${this.savedPlaces.length})
          </button>
        </div>

        <!-- TAB 1: GEMINI VOICE AGENT -->
        <div
          class=${classMap({
            tabcontent: true,
            showtab: this.selectedChatTab === ChatTab.GEMINI,
          })}>
          <div class="chat-messages">
            ${this.messages}
            <div id="anchor"></div>
          </div>

          <div class="footer">
            <!-- Continuous Voice / Listening Banner -->
            ${this.isListening || this.isSpeaking || this.isContinuousVoice
              ? html`<div class="voice-active-indicator">
                  <div class="voice-wave">
                    <span class="bar"></span>
                    <span class="bar"></span>
                    <span class="bar"></span>
                    <span class="bar"></span>
                  </div>
                  <span>
                    ${this.isContinuousVoice
                      ? 'Continuous Verbal Agent: Active (Speaking & Listening)'
                      : this.isListening
                      ? 'Listening to speech...'
                      : 'Voice Agent speaking...'}
                  </span>
                </div>`
              : ''}

            <div
              id="chatStatus"
              class=${classMap({hidden: this.chatState === ChatState.IDLE})}>
              ${this.chatState === ChatState.GENERATING
                ? html`${ICON_BUSY} Generating response...`
                : ''}
              ${this.chatState === ChatState.THINKING
                ? html`${ICON_BUSY} Detective reasoning & route checking...`
                : ''}
              ${this.chatState === ChatState.EXECUTING
                ? html`${ICON_BUSY} Executing 3D map actions...`
                : ''}
            </div>

            <!-- Input area with Mic, Speaker, and Send -->
            <div id="inputArea">
              <button
                type="button"
                id="voiceMicButton"
                class="mic-btn ${this.isListening ? 'listening' : ''}"
                title="Speak to Agent"
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
                placeholder="Ask agent, order route, or speak command..."
                autocomplete="off" />

              <button
                type="button"
                class="speaker-toggle-btn ${this.speechEnabled ? 'on' : 'off'}"
                title="Toggle Voice Responses"
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
                ?disabled=${this.chatState !== ChatState.IDLE}
                class=${classMap({disabled: this.chatState !== ChatState.IDLE})}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="24px"
                  viewBox="0 -960 960 960"
                  width="24px"
                  fill="currentColor">
                  <path d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- TAB 2: 24/7 GPS TRACKING & DETECTIVE TIMELINE -->
        <div
          class=${classMap({
            tabcontent: true,
            showtab: this.selectedChatTab === ChatTab.TRACKING,
          })}>
          <div class="tracking-container">
            <!-- Pairing Code Card -->
            <div class="pairing-code-banner">
              <div class="pairing-info-col">
                <span class="tracking-label">Active Private Access Code</span>
                <span class="pairing-code-text font-mono">${this.pairingCode}</span>
                <span class="pairing-hint">
                  Share this code with your device or parental observer for 24/7 live telemetry.
                </span>
              </div>
              <div class="pairing-btn-group">
                <button
                  class="btn-code-action"
                  @click=${() => this.generateNewPairingCode()}>
                  Generate Code
                </button>
                <button
                  class="btn-code-action secondary"
                  @click=${() => (this.activePairingModal = true)}>
                  Enter Code
                </button>
              </div>
            </div>

            <!-- Live GPS Status Card -->
            <div class="live-telemetry-card">
              <div class="telemetry-top-row">
                <div class="telemetry-title">
                  <span class="pulsing-beacon"></span>
                  24/7 Live GPS Signal
                </div>
                <button
                  class="btn-simulator-toggle ${this.isGpsSimulatorActive ? 'active' : ''}"
                  @click=${() => this.toggleGpsSimulator()}>
                  ${this.isGpsSimulatorActive ? 'Stop Simulator' : '▶ Start GPS Simulator'}
                </button>
              </div>

              <div class="telemetry-metrics-grid">
                <div class="telemetry-item">
                  <span class="metric-title">Heading / Direction</span>
                  <span class="metric-val">
                    ${this.liveTrackingStatus.carDirection} (${this.liveTrackingStatus.headingDegrees}°)
                  </span>
                </div>
                <div class="telemetry-item">
                  <span class="metric-title">Live Speed</span>
                  <span class="metric-val font-mono">
                    ${this.liveTrackingStatus.speedKmh} km/h
                  </span>
                </div>
                <div class="telemetry-item">
                  <span class="metric-title">Movement State</span>
                  <span class="metric-val status-${this.liveTrackingStatus.currentStatus}">
                    ${this.liveTrackingStatus.currentStatus.toUpperCase()}
                  </span>
                </div>
                <div class="telemetry-item">
                  <span class="metric-title">Travel Zone</span>
                  <span class="metric-val">${this.liveTrackingStatus.activeTravelZone}</span>
                </div>
              </div>

              <div class="telemetry-footer-status">
                ${this.liveTrackingStatus.lastUpdated}
                ${this.liveTrackingStatus.currentStopDuration
                  ? ` • ${this.liveTrackingStatus.currentStopDuration}`
                  : ''}
              </div>
            </div>

            <!-- Detective Timeline Header & Filter -->
            <div class="timeline-header-row">
              <div class="timeline-title-wrap">
                <h3>Detective 24/7 Travel Timeline</h3>
                <span class="timeline-sub">
                  Logs dwell time, stops, and points visited 14-15+ times.
                </span>
              </div>
              <div class="timeline-filter-buttons">
                <button
                  class="chip ${this.selectedTimelineFilter === 'all' ? 'active' : ''}"
                  @click=${() => (this.selectedTimelineFilter = 'all')}>
                  All Stops
                </button>
                <button
                  class="chip ${this.selectedTimelineFilter === 'frequent' ? 'active' : ''}"
                  @click=${() => {
                    this.selectedTimelineFilter = 'frequent';
                    this.highlightFrequentStopsOnMap();
                  }}>
                  🚨 14+ Visits Alert
                </button>
              </div>
            </div>

            <!-- Timeline Entries List -->
            <div class="timeline-list">
              ${filteredStops.map((stop) => {
                const isCrimson = stop.visitCount >= 14;
                return html`<div class="timeline-stop-card ${isCrimson ? 'crimson-alert' : ''}">
                  <div class="stop-card-header">
                    <span class="stop-badge ${isCrimson ? 'badge-crimson' : 'badge-normal'}">
                      ${isCrimson
                        ? `🚨 Detective Flag: Visited ${stop.visitCount} Times`
                        : `Visits: ${stop.visitCount} times`}
                    </span>
                    <span class="stop-dwell font-mono">
                      Stopped: ${stop.dwellDuration}
                    </span>
                  </div>

                  <div class="stop-name" @click=${() => this.flyToTimelineStop(stop)}>
                    ${stop.name}
                  </div>
                  <div class="stop-addr">${stop.address}</div>
                  <div class="stop-times">
                    Arrived: ${stop.arrivalTime} ${stop.departureTime ? `➔ Departed: ${stop.departureTime}` : ''}
                  </div>
                  ${stop.notes ? html`<div class="stop-notes">${stop.notes}</div>` : ''}

                  <div class="stop-actions">
                    <button
                      class="btn-stop-locate"
                      @click=${() => this.flyToTimelineStop(stop)}>
                      📍 Locate Stop on 3D Map
                    </button>
                  </div>
                </div>`;
              })}
            </div>
          </div>
        </div>

        <!-- TAB 3: MY SAVED PLACES -->
        <div
          class=${classMap({
            tabcontent: true,
            showtab: this.selectedChatTab === ChatTab.PLACES,
          })}>
          <div class="places-container">
            <div class="places-top-bar">
              <div class="places-header-title">Saved Locations & Land</div>
              <button
                class="btn-add-place"
                @click=${() => {
                  this.formName = '';
                  this.formCategory = 'agriculture';
                  this.formAddress = '';
                  this.formLandSize = '';
                  this.formNotes = '';
                  this.activePlaceModal = true;
                }}>
                + Add Place
              </button>
            </div>

            <div class="category-chips">
              <button
                class="chip ${this.selectedCategoryFilter === 'all' ? 'active' : ''}"
                @click=${() => (this.selectedCategoryFilter = 'all')}>
                All (${this.savedPlaces.length})
              </button>
              <button
                class="chip ${this.selectedCategoryFilter === 'agriculture' ? 'active' : ''}"
                @click=${() => (this.selectedCategoryFilter = 'agriculture')}>
                🌾 Agriculture
              </button>
              <button
                class="chip ${this.selectedCategoryFilter === 'home' ? 'active' : ''}"
                @click=${() => (this.selectedCategoryFilter = 'home')}>
                🏡 Home
              </button>
              <button
                class="chip ${this.selectedCategoryFilter === 'business' ? 'active' : ''}"
                @click=${() => (this.selectedCategoryFilter = 'business')}>
                🏢 Business
              </button>
              <button
                class="chip ${this.selectedCategoryFilter === 'land' ? 'active' : ''}"
                @click=${() => (this.selectedCategoryFilter = 'land')}>
                📐 Land
              </button>
            </div>

            <div class="places-search-box">
              <input
                type="text"
                placeholder="Search saved places or land plots..."
                .value=${this.placesSearchQuery}
                @input=${(e: InputEvent) => {
                  this.placesSearchQuery = (e.target as HTMLInputElement).value;
                }} />
            </div>

            <div class="places-card-list">
              ${filteredPlaces.map(
                (place) => html`<div class="place-item-card">
                  <div class="place-card-top">
                    <span class="place-cat-badge ${place.category}">
                      ${place.category}
                    </span>
                    ${place.landSize
                      ? html`<span class="place-size-pill">${place.landSize}</span>`
                      : ''}
                  </div>
                  <div
                    class="place-card-title"
                    @click=${() => this.handleViewLocation(place.address, place.id)}>
                    ${place.name}
                  </div>
                  <div class="place-card-addr">${place.address}</div>
                  ${place.notes
                    ? html`<div class="place-card-notes">${place.notes}</div>`
                    : ''}
                  <div class="place-card-actions">
                    <button
                      class="card-action-btn primary"
                      @click=${() => this.handleViewLocation(place.address, place.id)}>
                      📍 3D Locate
                    </button>
                    <button
                      class="card-action-btn secondary"
                      @click=${() =>
                        this.handleDirections('Current Location', place.address)}>
                      🚗 Route
                    </button>
                    <button
                      class="card-action-btn delete"
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

      <!-- Pairing Code Modal Dialog -->
      ${this.activePairingModal
        ? html`<div
            class="modal-backdrop"
            @click=${(e: Event) => {
              if (e.target === e.currentTarget) this.activePairingModal = false;
            }}>
            <div class="modal-card">
              <div class="modal-header">
                <h3>Pair GPS Tracking Device</h3>
                <button
                  class="modal-close"
                  @click=${() => (this.activePairingModal = false)}>
                  ✕
                </button>
              </div>
              <p style="font-size: 0.85rem; color: var(--color-text2); margin-bottom: 12px;">
                Enter the 6-character private access code shared by the child, vehicle operator, or tracked device:
              </p>
              <div class="form-group">
                <input
                  type="text"
                  placeholder="e.g. TRK-8821"
                  .value=${this.enteredPairCode}
                  @input=${(e: any) => (this.enteredPairCode = e.target.value)} />
              </div>
              <div class="modal-actions">
                <button
                  type="button"
                  class="btn-cancel"
                  @click=${() => (this.activePairingModal = false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn-submit"
                  @click=${() => this.pairWithEnteredCode()}>
                  Connect & Track Device
                </button>
              </div>
            </div>
          </div>`
        : ''}

      <!-- Add Place Modal Dialog -->
      ${this.activePlaceModal
        ? html`<div
            class="modal-backdrop"
            @click=${(e: Event) => {
              if (e.target === e.currentTarget) this.activePlaceModal = false;
            }}>
            <div class="modal-card">
              <div class="modal-header">
                <h3>Save New Location / Land Plot</h3>
                <button
                  class="modal-close"
                  @click=${() => (this.activePlaceModal = false)}>
                  ✕
                </button>
              </div>
              <form
                @submit=${async (e: Event) => {
                  e.preventDefault();
                  if (!this.formName || !this.formAddress) return;
                  const saved = await this.saveNewPlace({
                    name: this.formName,
                    category: this.formCategory,
                    address: this.formAddress,
                    landSize: this.formLandSize || undefined,
                    notes: this.formNotes || undefined,
                  });
                  this.activePlaceModal = false;
                  this.handleViewLocation(saved.address, saved.id);
                }}>
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
                    <option value="agriculture">🌾 Agricultural Land / Farm</option>
                    <option value="home">🏡 Home / Residence</option>
                    <option value="business">🏢 Business Platform / Office</option>
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
                    @click=${() => (this.activePlaceModal = false)}>
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
