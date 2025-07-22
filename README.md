# SignalK Sea State Calculator

**Version 0.5.0-beta.1**

A SignalK plugin that calculates approximate wave height, period, and direction from vessel attitude (pitch, roll, yaw) data. This plugin analyzes vessel motion to derive comprehensive sea state information useful for navigation, weather routing, and vessel performance monitoring.

## Features

- **Wave Height Calculation**: Derives significant wave height from vessel pitch and roll motion
- **Wave Period Detection**: Analyzes motion cycles to determine dominant wave period
- **Wave Direction Calculation**: Determines wave direction using motion analysis and vessel heading (requires `navigation.headingMagnetic`)
- **Heave Motion**: Calculates vertical heave motion from pitch angle and vessel geometry
- **Real-time Processing**: Continuous calculation with configurable update rates
- **TypeScript Implementation**: Full type safety and modern JavaScript features
- **Multiple Data Sources**: Supports both streambundle and subscription manager APIs
- **Statistical Analysis**: Uses variance and cross-correlation for robust direction detection

## Installation

Install via npm in your SignalK server:

```bash
npm install signalk-seastate
```

Or install directly through the SignalK App Store.

## Configuration

The plugin provides extensive configuration options:

### Basic Settings

- **Enable Plugin**: Turn the plugin on/off
- **Wave Height Multiplier (K)**: Calibration factor for wave height calculation (default: 0.5)
- **Baseline K Value**: Baseline calculation value for known conditions (default: 0.1)
- **Update Rate**: How often calculations are performed in milliseconds (default: 1000ms)
- **Source Label**: Identifier for derived data (default: "signalk-seastate")

### Advanced Settings

- **Vessel Length**: Overall length of vessel for heave calculation (default: 12m, uses `design.length` if available)
- **Period Buffer Size**: Seconds of data to analyze for wave period (default: 30s)
- **Minimum/Maximum Period**: Valid wave period range (default: 2-20 seconds)
- **Direction Smoothing**: Smoothing factor for wave direction (0.1 = smooth, 0.9 = responsive)

### Feature Toggles

- **Enable Heave Calculation**: Calculate vertical heave motion
- **Enable Period Calculation**: Detect wave period from motion cycles  
- **Enable Direction Calculation**: Calculate wave direction (requires heading data)

## Data Requirements

### Required Inputs

- `navigation.attitude` - Vessel pitch, roll, and optionally yaw in radians

### Optional Inputs

- `navigation.headingMagnetic` - Magnetic heading in radians (required for wave direction)
- `design.length` - Vessel length in meters (improves heave calculation accuracy)

## Outputs

The plugin generates the following SignalK paths:

- `environment.wave.height` - Significant wave height in meters
- `environment.wave.period` - Dominant wave period in seconds
- `navigation.wave.direction` - Wave direction in radians (0 = North)
- `environment.heave` - Vertical heave motion in meters

All outputs include appropriate metadata with units and confidence levels where applicable.

## How It Works

### Wave Height Calculation

Wave height is derived from the vessel's motion magnitude using the formula:
```
Wave Height = K × √(pitch² + roll²)
```

Where K is a calibration factor that depends on vessel characteristics and sea conditions.

### Wave Period Detection

The plugin analyzes zero-crossings in the vessel's roll motion to identify wave cycles. It:

1. Detects sign changes in roll angle over time
2. Calculates time intervals between crossings
3. Filters realistic periods (2-20 seconds by default)
4. Averages multiple cycles for stability

### Wave Direction Calculation

Wave direction is determined through motion analysis:

1. **Motion Statistics**: Calculates variance and cross-correlation between pitch and roll
2. **Dominant Axis**: Identifies whether waves are primarily from bow/stern (pitch-dominant) or beam (roll-dominant)
3. **Relative Direction**: Determines wave direction relative to vessel (0° = bow, 90° = starboard)
4. **Absolute Direction**: Adds vessel heading to get true geographic direction

The algorithm accounts for:
- Vessel heading from `navigation.headingMagnetic`
- Motion phase relationships
- Direction smoothing and confidence calculation

### Heave Calculation

Vertical heave motion is calculated from pitch angle and vessel geometry:
```
Heave = Vessel_Length × sin(pitch_angle)
```

This assumes the motion sensor is at the vessel's center.

## Technical Details

### Algorithm Features

- **Statistical Analysis**: Uses variance and cross-correlation for robust direction detection
- **Smoothing**: Configurable smoothing prevents erratic direction changes
- **Confidence Metrics**: Provides confidence levels for direction calculations
- **Multiple Data Sources**: Supports both streambundle and subscription manager APIs
- **Error Handling**: Graceful degradation when data is unavailable

### Data Processing

The plugin maintains rolling buffers of attitude data for:
- Period analysis (configurable buffer size)
- Direction calculation (last 10 samples for vector analysis)
- Statistical consistency checks

### Coordinate Systems

- **Vessel Coordinates**: 0° = bow, 90° = starboard, 180° = stern, 270° = port
- **Geographic Coordinates**: 0° = North, 90° = East (output format)
- **SignalK Standard**: All angles in radians, distances in meters

## Calibration

### Wave Height Calibration

The wave height multiplier (K factor) requires calibration for accurate readings:

#### Step-by-Step Calibration Process

1. **Collect Reference Data**
   - Record actual wave height measurements using visual observation, marine weather reports, or other instruments
   - Note the corresponding plugin output during the same conditions
   - Collect data across different sea states, if possible

2. **Calculate Calibration Factor**
   ```
   New K Factor = Current K Factor × (Actual Wave Height / Plugin Wave Height)
   ```
   
3. **Apply Calibration**
   - Navigate to SignalK plugin configuration
   - Adjust "Wave Height Multiplier (K)" setting
   - Start with default 0.5, typical range is 0.2-1.0

4. **Validation**
   - Test in known conditions
   - Compare with marine weather forecasts
   - Fine-tune based on vessel-specific characteristics

#### Factors Affecting Calibration
- **Vessel Size**: Larger vessels need lower K factors (0.2-0.4)
- **Vessel Type**: Displacement hulls vs. planning hulls behave differently
- **Sensor Location**: Sensors away from vessel center require adjustment

### Direction Calibration

1. **Verify Heading Accuracy**
   - Ensure magnetic compass is calibrated
   - Check `navigation.headingMagnetic` accuracy against known bearings
   - Compensate for magnetic deviation if needed

2. **Test Direction Output**
   - Compare wave direction with visual observations
   - Use known wind/wave patterns (e.g., onshore wind creates shoreward waves)
   - Verify against marine weather direction forecasts

3. **Adjust Smoothing**
   - Increase smoothing factor (closer to 1.0) for steady conditions
   - Decrease smoothing factor (closer to 0.1) for rapidly changing seas

## Troubleshooting

### No Wave Data Output

1. Check that `navigation.attitude` data is available
2. Verify attitude data contains pitch and roll values
3. Ensure plugin is enabled and configured
4. Check SignalK server logs for errors

### Inaccurate Wave Direction

1. Verify `navigation.headingMagnetic` is available and accurate
2. Check vessel heading calibration
3. Adjust direction smoothing factor
4. Ensure adequate motion for analysis

### Unrealistic Wave Heights

1. Adjust wave height multiplier (K factor)
2. Verify vessel length setting
3. Check attitude sensor calibration
4. Compare with known sea conditions

## Integration

### Node-RED
Access calculated wave height in Node-RED flows:
```
vessels.self.environment.wave.height
```

### Grafana
Query wave height data via SignalK APIs for visualization and trending.

### Other Plugins
Wave height data is available to any SignalK plugin or application subscribing to environment data.

## Development

This plugin is written in TypeScript with full type safety. To contribute:

```bash
# Clone repository
git clone https://github.com/signalk/signalk-seastate.git
cd signalk-seastate

# Install dependencies
npm install

# Build
npm run build

# Development with watch mode
npm run watch

# Linting and formatting
npm run lint
npm run format
```

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions welcome! Please feel free to submit issues, feature requests, or pull requests.

## Changelog

### v0.5.0-beta.1
- Complete TypeScript rewrite
- Added wave direction calculation using vessel heading
- Improved statistical analysis algorithms
- Enhanced configuration options
- Added comprehensive error handling

---

For more information about SignalK, visit [signalk.org](https://signalk.org).