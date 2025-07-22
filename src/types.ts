import { Context, Delta, Update, NormalizedDelta, Path } from '@signalk/server-api';

// Re-export SignalK types for convenience
export { Context, Delta, Update, NormalizedDelta, Path };

// SignalK Plugin Interface
export interface SignalKPlugin {
  id: string;
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  start: (options: Partial<PluginConfig>) => void;
  stop: () => void;
}

// Plugin Configuration Interface
export interface PluginConfig {
  enabled: boolean;
  waveMultiplier: number;
  baselineK: number;
  vesselName?: string; // New vessel name field
  updateRate: number;
  enableHeave: boolean;
  enablePeriod: boolean;
  enableDirection: boolean; // New field for wave direction
  vesselLength: number;
  periodBufferSize: number;
  minimumPeriod: number;
  maximumPeriod: number;
  directionSmoothing: number; // Smoothing factor for direction calculation
  compassSource?: string; // Optional compass data source
}

// Attitude Data Interface
export interface AttitudeData {
  pitch: number | null;
  roll: number | null;
  yaw: number | null;
  timestamp: string | null;
}

// Buffer Entry for Time Series Analysis
export interface AttitudeBufferEntry {
  pitch: number;
  roll: number;
  yaw?: number;
  timestamp: number;
  motionMagnitude: number;
  direction?: number; // Wave direction in radians
}

// Wave Direction Calculation State
export interface DirectionState {
  directionBuffer: number[]; // Rolling buffer of calculated directions
  lastDirection: number | null;
  directionConfidence: number; // Confidence in direction calculation (0-1)
}

// Zero Crossing Detection for Period Calculation
export interface ZeroCrossing {
  time: number;
  index: number;
  type: 'pitch' | 'roll'; // Which motion caused the crossing
}

// Period Calculation State
export interface PeriodState {
  periods: number[];
  lastZeroCrossing: ZeroCrossing | null;
}

// Plugin Internal State
export interface PluginState {
  unsubscribes: Array<() => void>;
  lastAttitude: AttitudeData;
  lastHeading: number | null; // navigation.headingMagnetic in radians
  attitudeBuffer: AttitudeBufferEntry[];
  maxBufferSize: number;
  periodState: PeriodState;
  directionState: DirectionState;
  updateTimer?: any;
  directDataTimer?: any;
  currentConfig: PluginConfig;
  vesselLengthFromDesign: number | null;
}

// Sea State Calculation Results
export interface SeaStateResults {
  waveHeight: number;
  heave: number | null;
  period: number | null;
  direction: number | null; // Wave direction in radians (0 = North)
  directionDegrees: number | null; // Wave direction in degrees (0 = North)
  directionConfidence: number; // Confidence level (0-1)
  motionMagnitude: number;
  timestamp: string;
}

// Use official SignalK Delta types instead of custom ones
// Delta and Update interfaces are imported from @signalk/server-api

// Compass Data Interface (for direction calculation)
export interface CompassData {
  heading: number; // Magnetic or true heading in radians
  variation?: number; // Magnetic variation in radians
  deviation?: number; // Compass deviation in radians
  timestamp: string;
}

// Wave Direction Calculation Methods
export type DirectionMethod = 'motion-analysis' | 'compass-relative' | 'hybrid';

// Direction Calculation Options
export interface DirectionCalculationOptions {
  method: DirectionMethod;
  smoothingFactor: number;
  minConfidence: number;
  useCompass: boolean;
  compassPath?: string;
}

// Statistical Analysis Results
export interface MotionStatistics {
  pitchVariance: number;
  rollVariance: number;
  crossCorrelation: number; // Cross-correlation between pitch and roll
  dominantMotionAxis: 'pitch' | 'roll' | 'combined';
  motionPhaseShift: number; // Phase shift between pitch and roll
}

// Plugin Schema Type (for validation)
export interface PluginSchema {
  type: string;
  properties: Record<
    string,
    {
      type: string;
      title: string;
      description?: string;
      default?: unknown;
      minimum?: number;
      maximum?: number;
      enum?: string[];
    }
  >;
}

// Error Types
export interface PluginError extends Error {
  code?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any;
}

// Utility Types
export type BufferKey = string;
export type TimestampISO = string;
export type RadianValue = number;
export type DegreeValue = number;
export type MetricValue = number;
