import { ServerAPI } from '@signalk/server-api';
import {
  SignalKPlugin,
  PluginConfig,
  PluginState,
  AttitudeBufferEntry,
  SeaStateResults,
  ZeroCrossing,
  MotionStatistics,
  PluginSchema,
} from './types';

// Utility function to format name according to source naming rules
function formatSourceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Utility function to get vessel-based source with suffix
function getVesselBasedSource(configuredPrefix: string | undefined, suffix: string): string {
  // If vessel name is provided, use pattern: {vessel}-seastate-{suffix}
  // If no vessel name, use pattern: seastate-{suffix}
  if (configuredPrefix && configuredPrefix.trim()) {
    const formattedName = formatSourceName(configuredPrefix);
    return `${formattedName}-seastate-${suffix}`;
  } else {
    return `seastate-${suffix}`;
  }
}

export = function (app: ServerAPI): SignalKPlugin {
  const plugin: SignalKPlugin = {} as SignalKPlugin;

  plugin.id = 'signalk-seastate';
  plugin.name = 'SignalK Sea State Calculator';
  plugin.description = 'Calculate wave height, period, and direction from vessel attitude (pitch, roll, yaw)';

  const state: PluginState = {
    unsubscribes: [],
    lastAttitude: {
      pitch: null,
      roll: null,
      yaw: null,
      timestamp: null,
    },
    lastHeading: null,
    attitudeBuffer: [],
    maxBufferSize: 30,
    periodState: {
      periods: [],
      lastZeroCrossing: null,
    },
    directionState: {
      directionBuffer: [],
      lastDirection: null,
      directionConfidence: 0,
    },
    currentConfig: {} as PluginConfig,
    vesselLengthFromDesign: null,
  };

  const schema: PluginSchema = {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Enable Plugin',
        default: true,
      },
      waveMultiplier: {
        type: 'number',
        title: 'Wave Height Multiplier (K)',
        description: 'Multiplier constant for wave height calculation',
        default: 0.5,
      },
      baselineK: {
        type: 'number',
        title: 'Baseline K Value',
        description: 'Baseline calculation value (Known_Wave_Height_in_meters)',
        default: 0.1,
      },
      vesselName: {
        type: 'string',
        title: 'Source Prefix',
        description:
          'Source prefix for identification (defaults to auto-detect from vessels.self.name if not specified)',
        default: '',
      },
      updateRate: {
        type: 'number',
        title: 'Update Rate (ms)',
        description: 'How often to calculate wave height (milliseconds)',
        default: 1000,
        minimum: 100,
      },
      enableHeave: {
        type: 'boolean',
        title: 'Enable Heave Calculation',
        description: 'Calculate vertical heave motion from pitch/roll',
        default: true,
      },
      enablePeriod: {
        type: 'boolean',
        title: 'Enable Period Calculation',
        description: 'Calculate wave period from motion cycles',
        default: true,
      },
      enableDirection: {
        type: 'boolean',
        title: 'Enable Direction Calculation',
        description: 'Calculate wave direction from motion analysis',
        default: true,
      },
      vesselLength: {
        type: 'number',
        title: 'Vessel Length (meters)',
        description: 'Overall length of vessel for heave calculation (from design.length if available)',
        default: 12,
        minimum: 1,
      },
      periodBufferSize: {
        type: 'number',
        title: 'Period Buffer Size (seconds)',
        description: 'How many seconds of data to analyze for wave period',
        default: 30,
        minimum: 10,
        maximum: 120,
      },
      minimumPeriod: {
        type: 'number',
        title: 'Minimum Wave Period (seconds)',
        description: 'Shortest valid wave period to detect',
        default: 2,
        minimum: 1,
      },
      maximumPeriod: {
        type: 'number',
        title: 'Maximum Wave Period (seconds)',
        description: 'Longest valid wave period to detect',
        default: 20,
        minimum: 5,
      },
      directionSmoothing: {
        type: 'number',
        title: 'Direction Smoothing Factor',
        description: 'Smoothing factor for wave direction (0.1 = smooth, 0.9 = responsive)',
        default: 0.3,
        minimum: 0.1,
        maximum: 0.9,
      },
      compassSource: {
        type: 'string',
        title: 'Compass Source Path',
        description: 'Optional: SignalK path for compass data (e.g., navigation.headingMagnetic)',
        default: '',
      },
    },
  };

  plugin.schema = schema;

  plugin.start = function (options: Partial<PluginConfig>): void {
    app.debug('Starting Zennora Sea State Calculator plugin with options: ' + JSON.stringify(options));

    // Get vessel length from design.length if available
    const designLength = app.getSelfPath('design.length');
    state.vesselLengthFromDesign = designLength?.value ? designLength.value : null;

    // Store configuration with defaults
    const config: PluginConfig = {
      enabled: options.enabled ?? true,
      waveMultiplier: options.waveMultiplier ?? 0.5,
      baselineK: options.baselineK ?? 0.1,
      vesselName: options.vesselName,
      updateRate: options.updateRate ?? 1000,
      enableHeave: options.enableHeave ?? true,
      enablePeriod: options.enablePeriod ?? true,
      enableDirection: options.enableDirection ?? true,
      vesselLength: options.vesselLength ?? state.vesselLengthFromDesign ?? 12,
      periodBufferSize: options.periodBufferSize ?? 30,
      minimumPeriod: options.minimumPeriod ?? 2,
      maximumPeriod: options.maximumPeriod ?? 20,
      directionSmoothing: options.directionSmoothing ?? 0.3,
      compassSource: options.compassSource ?? '',
    };

    // Attempt to get vessel name from SignalK if not configured
    if (!config.vesselName || config.vesselName.trim() === '') {
      try {
        // Try to get vessel name from SignalK
        const vesselName = app.getSelfPath('name');
        if (vesselName && typeof vesselName === 'string') {
          config.vesselName = vesselName;
          app.debug('Using vessel name from SignalK: ' + vesselName);
        }
      } catch (error) {
        app.debug('Could not retrieve vessel name from SignalK: ' + (error as Error).message);
      }
    }

    state.currentConfig = config;

    state.maxBufferSize = Math.ceil((state.currentConfig.periodBufferSize * 1000) / state.currentConfig.updateRate);

    app.debug('Plugin configuration: ' + JSON.stringify(state.currentConfig));

    if (state.vesselLengthFromDesign) {
      app.debug(`Using vessel length from design.length: ${state.vesselLengthFromDesign}m`);
    } else {
      app.debug(`Using configured vessel length: ${state.currentConfig.vesselLength}m`);
    }

    // Subscribe to attitude and heading data using streambundle API if available
    if (app.streambundle) {
      app.debug('Using streambundle API for attitude and heading subscription');
      subscribeWithStreambundle();
    } else {
      app.debug('Falling back to subscriptionmanager API');
      subscribeWithSubscriptionManager();
    }

    // Also try direct data access as fallback
    state.directDataTimer = setInterval(() => {
      const currentAttitude = app.getSelfPath('navigation.attitude');
      const currentHeading = app.getSelfPath('navigation.headingMagnetic');

      if (currentAttitude?.value) {
        app.debug('Direct attitude access: ' + JSON.stringify(currentAttitude));
        updateAttitudeFromValue(currentAttitude.value, new Date().toISOString());
      }

      if (currentHeading?.value) {
        app.debug('Direct heading access: ' + currentHeading.value);
        state.lastHeading = currentHeading.value;
      }

      if (currentAttitude?.value) {
        calculateSeaState();
      } else {
        app.debug('No attitude data available via direct access');
      }
    }, 2000);

    state.unsubscribes.push(() => {
      if (state.directDataTimer) {
        clearInterval(state.directDataTimer);
      }
    });

    app.debug('Sea state calculator started');
  };

  plugin.stop = function (): void {
    app.debug('Stopping Zennora Sea State Calculator plugin');

    // Unsubscribe from all subscriptions
    state.unsubscribes.forEach((f) => f());
    state.unsubscribes.length = 0;

    // Clear timers
    if (state.updateTimer) {
      clearInterval(state.updateTimer);
    }
    if (state.directDataTimer) {
      clearInterval(state.directDataTimer);
    }

    app.debug('Sea state calculator stopped');
  };

  // Subscribe using modern streambundle API
  function subscribeWithStreambundle(): void {
    try {
      // Subscribe to attitude data
      const attitudeStream = app.streambundle.getSelfStream('navigation.attitude' as any);
      attitudeStream.onValue((value: any) => {
        app.debug('Streambundle attitude data: ' + JSON.stringify(value));
        if (value && typeof value === 'object') {
          updateAttitudeFromValue(value, new Date().toISOString());
          calculateSeaState();
        }
      });

      // Subscribe to heading data
      const headingStream = app.streambundle.getSelfStream('navigation.headingMagnetic' as any);
      headingStream.onValue((value: any) => {
        app.debug('Streambundle heading data: ' + value);
        if (typeof value === 'number') {
          state.lastHeading = value;
        }
      });

      state.unsubscribes.push(() => {
        attitudeStream.destroy();
        headingStream.destroy();
      });
      app.debug('Successfully subscribed to navigation.attitude and navigation.headingMagnetic via streambundle');
    } catch (error) {
      app.error('Error subscribing via streambundle: ' + error);
      subscribeWithSubscriptionManager();
    }
  }

  // Fallback to subscription manager
  function subscribeWithSubscriptionManager(): void {
    const streamSubscription: any = {
      context: 'vessels.self',
      subscribe: [
        {
          path: 'navigation.attitude',
          period: 1000,
          format: 'delta',
          policy: 'ideal',
          minPeriod: 200,
        },
        {
          path: 'navigation.headingMagnetic',
          period: 1000,
          format: 'delta',
          policy: 'ideal',
          minPeriod: 500,
        },
      ],
    };

    app.debug(
      'Attempting to subscribe to navigation.attitude and navigation.headingMagnetic via subscriptionmanager...'
    );

    app.subscriptionmanager.subscribe(
      streamSubscription,
      state.unsubscribes,
      (subscriptionError: any) => {
        if (subscriptionError) {
          app.error('Error subscribing to attitude data: ' + subscriptionError);
          return;
        }
        app.debug(
          'Successfully subscribed to navigation.attitude and navigation.headingMagnetic via subscriptionmanager'
        );
      },
      (delta: any) => {
        app.debug('Received delta: ' + JSON.stringify(delta, null, 2));

        // Process incoming attitude delta
        if (delta.updates) {
          delta.updates.forEach((update: any) => {
            if (update.values) {
              update.values.forEach((value: any) => {
                if (value.path === 'navigation.attitude' && value.value) {
                  app.debug('Found attitude data: ' + JSON.stringify(value.value));
                  updateAttitudeFromValue(value.value, update.timestamp || new Date().toISOString());
                  calculateSeaState();
                } else if (value.path === 'navigation.headingMagnetic' && typeof value.value === 'number') {
                  app.debug('Found heading data: ' + value.value);
                  state.lastHeading = value.value;
                }
              });
            }
          });
        }
      }
    );
  }

  // Update attitude data from received value
  function updateAttitudeFromValue(value: any, timestamp: string): void {
    if (value && typeof value === 'object') {
      if (typeof value.pitch === 'number') {
        state.lastAttitude.pitch = value.pitch;
      }
      if (typeof value.roll === 'number') {
        state.lastAttitude.roll = value.roll;
      }
      if (typeof value.yaw === 'number') {
        state.lastAttitude.yaw = value.yaw;
      }
      state.lastAttitude.timestamp = timestamp;

      app.debug(
        `Attitude updated - pitch: ${state.lastAttitude.pitch}, roll: ${state.lastAttitude.roll}, yaw: ${state.lastAttitude.yaw}`
      );
    }
  }

  // Calculate heave from pitch motion
  function calculateHeave(pitchRad: number, vesselLength: number): number {
    // For small angles: heave ≈ vessel_length × sin(pitch)
    // This assumes the motion sensor is at the center of the vessel
    return vesselLength * Math.sin(pitchRad);
  }

  // Calculate motion statistics for direction analysis
  function calculateMotionStatistics(buffer: AttitudeBufferEntry[]): MotionStatistics {
    if (buffer.length < 5) {
      return {
        pitchVariance: 0,
        rollVariance: 0,
        crossCorrelation: 0,
        dominantMotionAxis: 'combined',
        motionPhaseShift: 0,
      };
    }

    // Calculate variances
    const pitchValues = buffer.map((b) => b.pitch);
    const rollValues = buffer.map((b) => b.roll);

    const pitchMean = pitchValues.reduce((a, b) => a + b, 0) / pitchValues.length;
    const rollMean = rollValues.reduce((a, b) => a + b, 0) / rollValues.length;

    const pitchVariance = pitchValues.reduce((acc, val) => acc + Math.pow(val - pitchMean, 2), 0) / pitchValues.length;
    const rollVariance = rollValues.reduce((acc, val) => acc + Math.pow(val - rollMean, 2), 0) / rollValues.length;

    // Calculate cross-correlation (simplified)
    const crossCorrelation =
      pitchValues.reduce((acc, pitch, i) => acc + (pitch - pitchMean) * (rollValues[i] - rollMean), 0) /
      (pitchValues.length * Math.sqrt(pitchVariance * rollVariance));

    // Determine dominant motion axis
    let dominantMotionAxis: 'pitch' | 'roll' | 'combined';
    const varianceRatio = pitchVariance / (rollVariance + 1e-10); // Avoid division by zero

    if (varianceRatio > 2) {
      dominantMotionAxis = 'pitch';
    } else if (varianceRatio < 0.5) {
      dominantMotionAxis = 'roll';
    } else {
      dominantMotionAxis = 'combined';
    }

    // Calculate phase shift between pitch and roll (simplified)
    let motionPhaseShift = 0;
    if (buffer.length > 10) {
      // Find peaks in pitch and roll to estimate phase shift
      const pitchPeaks = findPeaks(pitchValues);
      const rollPeaks = findPeaks(rollValues);

      if (pitchPeaks.length > 0 && rollPeaks.length > 0) {
        // Calculate average time difference between corresponding peaks
        const timeDiffs: number[] = [];
        pitchPeaks.forEach((pitchPeak) => {
          const nearestRollPeak = rollPeaks.reduce((nearest, rollPeak) =>
            Math.abs(rollPeak - pitchPeak) < Math.abs(nearest - pitchPeak) ? rollPeak : nearest
          );
          timeDiffs.push((nearestRollPeak - pitchPeak) * state.currentConfig.updateRate);
        });

        if (timeDiffs.length > 0) {
          motionPhaseShift = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
        }
      }
    }

    return {
      pitchVariance,
      rollVariance,
      crossCorrelation: isNaN(crossCorrelation) ? 0 : crossCorrelation,
      dominantMotionAxis,
      motionPhaseShift,
    };
  }

  // Simple peak finding algorithm
  function findPeaks(values: number[]): number[] {
    const peaks: number[] = [];
    for (let i = 1; i < values.length - 1; i++) {
      if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
        peaks.push(i);
      }
    }
    return peaks;
  }

  // Calculate wave direction relative to vessel (0 = bow, π/2 = starboard, π = stern, 3π/2 = port)
  function calculateRelativeWaveDirection(buffer: AttitudeBufferEntry[], stats: MotionStatistics): number | null {
    if (buffer.length < 10) return null;

    let relativeDirection: number;

    // Method 1: Use dominant motion axis and cross-correlation
    if (stats.dominantMotionAxis === 'pitch') {
      // Pitch-dominant: waves coming from bow/stern direction
      // Positive correlation = bow waves, negative = stern waves
      relativeDirection = stats.crossCorrelation > 0 ? 0 : Math.PI;
    } else if (stats.dominantMotionAxis === 'roll') {
      // Roll-dominant: waves coming from beam
      // Positive correlation = starboard waves, negative = port waves
      relativeDirection = stats.crossCorrelation > 0 ? Math.PI / 2 : (3 * Math.PI) / 2;
    } else {
      // Combined motion - use vector analysis
      const recentBuffer = buffer.slice(-10);
      let sumX = 0;
      let sumY = 0;

      recentBuffer.forEach((entry) => {
        // Convert pitch/roll to relative wave direction vector
        // pitch = forward/aft motion, roll = port/starboard motion
        const motionAngle = Math.atan2(entry.roll, entry.pitch);
        sumX += Math.cos(motionAngle) * entry.motionMagnitude;
        sumY += Math.sin(motionAngle) * entry.motionMagnitude;
      });

      relativeDirection = Math.atan2(sumY, sumX);
    }

    // Ensure direction is in range [0, 2π)
    if (relativeDirection < 0) {
      relativeDirection += 2 * Math.PI;
    }

    return relativeDirection;
  }

  // Calculate absolute wave direction using vessel heading
  function calculateAbsoluteWaveDirection(buffer: AttitudeBufferEntry[], stats: MotionStatistics): number | null {
    // Need vessel heading for absolute direction
    if (state.lastHeading === null) {
      app.debug('No vessel heading available - cannot calculate absolute wave direction');
      return null;
    }

    // Get relative wave direction (relative to vessel bow)
    const relativeDirection = calculateRelativeWaveDirection(buffer, stats);
    if (relativeDirection === null) {
      return null;
    }

    // Convert to absolute direction by adding vessel heading
    // relativeDirection: 0 = bow, π/2 = starboard, π = stern, 3π/2 = port
    // Add vessel heading to get true geographic direction
    let absoluteDirection = relativeDirection + state.lastHeading;

    // Ensure direction is in range [0, 2π)
    if (absoluteDirection >= 2 * Math.PI) {
      absoluteDirection -= 2 * Math.PI;
    }
    if (absoluteDirection < 0) {
      absoluteDirection += 2 * Math.PI;
    }

    // Apply smoothing to absolute direction
    if (state.directionState.lastDirection !== null) {
      const smoothing = state.currentConfig.directionSmoothing;
      const lastDir = state.directionState.lastDirection;

      // Handle angle wrapping
      let deltaDir = absoluteDirection - lastDir;
      if (deltaDir > Math.PI) deltaDir -= 2 * Math.PI;
      if (deltaDir < -Math.PI) deltaDir += 2 * Math.PI;

      absoluteDirection = lastDir + smoothing * deltaDir;

      // Ensure still in range after smoothing
      if (absoluteDirection >= 2 * Math.PI) {
        absoluteDirection -= 2 * Math.PI;
      }
      if (absoluteDirection < 0) {
        absoluteDirection += 2 * Math.PI;
      }
    }

    // Update direction buffer for confidence calculation
    state.directionState.directionBuffer.push(absoluteDirection);
    if (state.directionState.directionBuffer.length > 10) {
      state.directionState.directionBuffer.shift();
    }

    // Calculate confidence based on consistency
    if (state.directionState.directionBuffer.length > 5) {
      const directions = state.directionState.directionBuffer;
      const avgDirection = Math.atan2(
        directions.reduce((sum, dir) => sum + Math.sin(dir), 0) / directions.length,
        directions.reduce((sum, dir) => sum + Math.cos(dir), 0) / directions.length
      );

      const variance =
        directions.reduce((sum, dir) => {
          let diff = dir - avgDirection;
          if (diff > Math.PI) diff -= 2 * Math.PI;
          if (diff < -Math.PI) diff += 2 * Math.PI;
          return sum + diff * diff;
        }, 0) / directions.length;

      // Confidence decreases with variance (0 = perfect consistency, 1 = random)
      state.directionState.directionConfidence = Math.max(0, 1 - variance / ((Math.PI * Math.PI) / 4));
    }

    state.directionState.lastDirection = absoluteDirection;

    app.debug(
      `Wave direction: relative=${((relativeDirection * 180) / Math.PI).toFixed(0)}° + heading=${((state.lastHeading * 180) / Math.PI).toFixed(0)}° = absolute=${((absoluteDirection * 180) / Math.PI).toFixed(0)}° (conf: ${(state.directionState.directionConfidence * 100).toFixed(0)}%)`
    );

    return absoluteDirection;
  }

  // Calculate wave period from zero crossings
  function calculatePeriod(): number | null {
    if (state.attitudeBuffer.length < 10) return null;

    const zeroCrossings: ZeroCrossing[] = [];

    // Look for zero crossings in roll motion
    for (let i = 1; i < state.attitudeBuffer.length; i++) {
      const prev = state.attitudeBuffer[i - 1].roll;
      const curr = state.attitudeBuffer[i].roll;

      // Zero crossing detection (sign change)
      if ((prev < 0 && curr >= 0) || (prev > 0 && curr <= 0)) {
        zeroCrossings.push({
          time: state.attitudeBuffer[i].timestamp,
          index: i,
          type: 'roll',
        });
      }
    }

    if (zeroCrossings.length < 2) return null;

    // Calculate periods between consecutive zero crossings
    const currentPeriods: number[] = [];
    for (let j = 1; j < zeroCrossings.length; j++) {
      const timeDiff = zeroCrossings[j].time - zeroCrossings[j - 1].time;
      const periodSeconds = timeDiff / 1000;

      // Filter out unrealistic periods
      if (periodSeconds >= state.currentConfig.minimumPeriod && periodSeconds <= state.currentConfig.maximumPeriod) {
        currentPeriods.push(periodSeconds * 2); // Full cycle is 2x zero crossing interval
      }
    }

    if (currentPeriods.length === 0) return null;

    // Average the current periods and add to history
    const avgPeriod = currentPeriods.reduce((a, b) => a + b, 0) / currentPeriods.length;
    state.periodState.periods.push(avgPeriod);

    // Keep only recent periods
    const maxPeriodSamples = 10;
    if (state.periodState.periods.length > maxPeriodSamples) {
      state.periodState.periods.shift();
    }

    // Return overall average
    return state.periodState.periods.reduce((a, b) => a + b, 0) / state.periodState.periods.length;
  }

  // Main calculation function
  function calculateSeaState(): void {
    app.debug(`Calculating sea state with pitch: ${state.lastAttitude.pitch}, roll: ${state.lastAttitude.roll}`);

    if (state.lastAttitude.pitch === null || state.lastAttitude.roll === null) {
      app.debug(`Insufficient attitude data - pitch: ${state.lastAttitude.pitch}, roll: ${state.lastAttitude.roll}`);
      return;
    }

    const timestamp = Date.now();

    // Convert from radians to degrees for display
    const pitchDeg = state.lastAttitude.pitch * (180 / Math.PI);
    const rollDeg = state.lastAttitude.roll * (180 / Math.PI);

    // Calculate motion magnitude
    const motionMagnitude = Math.hypot(pitchDeg, rollDeg);

    // Add to buffer for period and direction calculation
    const bufferEntry: AttitudeBufferEntry = {
      pitch: state.lastAttitude.pitch,
      roll: state.lastAttitude.roll,
      yaw: state.lastAttitude.yaw || undefined,
      timestamp,
      motionMagnitude: motionMagnitude,
    };

    state.attitudeBuffer.push(bufferEntry);

    // Trim buffer to configured size
    if (state.attitudeBuffer.length > state.maxBufferSize) {
      state.attitudeBuffer.shift();
    }

    // Calculate wave height using the original formula
    const waveHeight = state.currentConfig.waveMultiplier * motionMagnitude;

    // Calculate optional features
    let heave: number | null = null;
    if (state.currentConfig.enableHeave) {
      heave = calculateHeave(state.lastAttitude.pitch, state.currentConfig.vesselLength);
    }

    let period: number | null = null;
    if (state.currentConfig.enablePeriod && state.attitudeBuffer.length >= 10) {
      period = calculatePeriod();
    }

    let direction: number | null = null;
    let directionDegrees: number | null = null;
    if (state.currentConfig.enableDirection && state.attitudeBuffer.length >= 10) {
      const motionStats = calculateMotionStatistics(state.attitudeBuffer);
      direction = calculateAbsoluteWaveDirection(state.attitudeBuffer, motionStats);
      if (direction !== null) {
        directionDegrees = (direction * 180) / Math.PI;
      }
    }

    const results: SeaStateResults = {
      waveHeight,
      heave,
      period,
      direction,
      directionDegrees,
      directionConfidence: state.directionState.directionConfidence,
      motionMagnitude,
      timestamp: new Date().toISOString(),
    };

    // Create SignalK delta message
    emitSeaStateData(results);

    // Log results
    const logParts = [`Wave height: ${waveHeight.toFixed(3)}m`];
    if (heave !== null) logParts.push(`heave: ${heave.toFixed(3)}m`);
    if (period !== null) logParts.push(`period: ${period.toFixed(1)}s`);
    if (directionDegrees !== null) {
      logParts.push(
        `direction: ${directionDegrees.toFixed(0)}° (conf: ${(results.directionConfidence * 100).toFixed(0)}%)`
      );
    }
    logParts.push(`(motion: ${motionMagnitude.toFixed(2)}°)`);

    // console.log(`[${plugin.id}] ${logParts.join(', ')}`);
  }

  // Emit SignalK delta message
  function emitSeaStateData(results: SeaStateResults): void {
    const values: any[] = [
      {
        path: 'environment.wave.height',
        value: results.waveHeight,
      },
    ];

    // Add heave if calculated
    if (results.heave !== null) {
      values.push({
        path: 'environment.heave',
        value: results.heave,
      });
    }

    // Add period if calculated
    if (results.period !== null) {
      values.push({
        path: 'environment.wave.period',
        value: results.period,
      });
    }

    // Add wave direction if calculated
    if (results.direction !== null) {
      values.push({
        path: 'navigation.wave.direction',
        value: results.direction,
      });
      // Add direction confidence as separate path
      values.push({
        path: 'navigation.wave.direction.confidence',
        value: results.directionConfidence,
      });
    }

    // Create SignalK delta message
    const delta: any = {
      context: 'vessels.self',
      updates: [
        {
          $source: getVesselBasedSource(state.currentConfig.vesselName, 'derived'),
          timestamp: results.timestamp,
          values: values,
          // meta: [] - removed all metadata
        },
      ],
    };

    // Emit the delta
    app.handleMessage(plugin.id, delta);

    app.debug('Emitted sea state delta: ' + JSON.stringify(delta, null, 2));
  }

  return plugin;
};
