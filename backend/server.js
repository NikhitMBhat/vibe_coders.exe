const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeGeocoder = require('node-geocoder');
const OverpassNode = require('overpass-api');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Geocoder setup (Nominatim)
const geocoder = NodeGeocoder({
  provider: 'openstreetmap'
});

// Overpass API client
const overpass = new OverpassNode();

// Simulated safety data (in production, integrate with real crime/accident APIs)
const SAFETY_DATA = {
  accidents: [
    { lat: 12.9780, lng: 77.5910, severity: 9, name: "Silk Board Junction", count: 47 },
    { lat: 12.9716, lng: 77.5948, severity: 7, name: "KR Circle", count: 31 },
    // ... more from your frontend
  ],
  lighting: [
    { lat: 12.9550, lng: 77.6200, name: "Domlur Underpass" },
    // ... more
  ]
};

app.get('/api/geocode/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const results = await geocoder.geocode(query + ', Bengaluru');
    res.json(results.slice(0, 5));
  } catch (error) {
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

app.post('/api/directions', async (req, res) => {
  try {
    const { origin, destination, avoidAccidents = true, preferLit = true, avoidCrime = false } = req.body;
    
    // Geocode if strings provided
    let start = typeof origin === 'string' ? (await geocoder.geocode(origin))[0] : origin;
    let end = typeof destination === 'string' ? (await geocoder.geocode(destination))[0] : destination;
    
    const routes = await calculateSafeRoutes({
      start: [start.latitude, start.longitude],
      end: [end.latitude, end.longitude],
      avoidAccidents,
      preferLit,
      avoidCrime
    });

    res.json(routes);
  } catch (error) {
    res.status(500).json({ error: 'Route calculation failed' });
  }
});

app.get('/api/safety-data/:lat/:lng/:radius?', async (req, res) => {
  try {
    const { lat, lng, radius = 0.02 } = req.params;
    const bounds = {
      minlat: parseFloat(lat) - parseFloat(radius),
      maxlat: parseFloat(lat) + parseFloat(radius),
      minlon: parseFloat(lng) - parseFloat(radius),
      maxlon: parseFloat(lng) + parseFloat(radius)
    };

    // Query OSM for nearby roads, lighting, etc.
    const overpassQuery = `
    [out:json];
    (
      way["highway"](if:!t["highway"]~"^path$|^footway$|^steps$")(bbox=${bounds.minlat},${bounds.minlon},${bounds.maxlat},${bounds.maxlon});
      way["lit"](bbox=${bounds.minlat},${bounds.minlon},${bounds.maxlat},${bounds.maxlon});
    );
    out geom;`;
    
    const osmData = await overpass.query(overpassQuery);
    
    // Combine with safety data
    const safetyZones = SAFETY_DATA.accidents
      .filter(h => {
        const dlat = h.lat - parseFloat(lat);
        const dlng = h.lng - parseFloat(lng);
        return Math.sqrt(dlat*dlat + dlng*dlng) < parseFloat(radius);
      });

    res.json({
      accidents: safetyZones,
      lighting: SAFETY_DATA.lighting.filter(l => {
        const dlat = l.lat - parseFloat(lat);
        const dlng = l.lng - parseFloat(lng);
        return Math.sqrt(dlat*dlat + dlng*dlng) < parseFloat(radius);
      }),
      osmRoads: osmData.elements || [],
      stats: {
        hotspotCount: safetyZones.length,
        darkZones: SAFETY_DATA.lighting.length,
        safePercentage: 75 + Math.random() * 15
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Safety data fetch failed' });
  }
});

async function calculateSafeRoutes({ start, end, avoidAccidents, preferLit, avoidCrime }) {
  // Simulate route calculation with safety weighting
  const baseDistance = haversineDistance(start, end);
  
  // Generate 3 route variants
  const routes = [
    {
      id: 'safest',
      name: 'SafeRoute (Recommended)',
      path: generateSafePath(start, end, avoidAccidents, preferLit),
      distance: (baseDistance * 1.12).toFixed(1),
      duration: Math.round(baseDistance * 1.12 * 3.2),
      safetyScore: 92,
      hotspotsCrossed: 0,
      color: '#00d4aa'
    },
    {
      id: 'fastest',
      name: 'Fastest Route',
      path: generateDirectPath(start, end),
      distance: baseDistance.toFixed(1),
      duration: Math.round(baseDistance * 2.8),
      safetyScore: 68,
      hotspotsCrossed: 2,
      color: '#f59e0b'
    },
    {
      id: 'alternate',
      name: 'Alternate Route',
      path: generateAlternatePath(start, end),
      distance: (baseDistance * 1.05).toFixed(1),
      duration: Math.round(baseDistance * 1.05 * 3.0),
      safetyScore: 54,
      hotspotsCrossed: 3,
      color: '#8896b3'
    }
  ];

  return routes;
}

function haversineDistance([lat1, lon1], [lat2, lon2]) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function generateSafePath(start, end, avoidAccidents, preferLit) {
  // Simplified path generation avoiding known hotspots
  const midOffset = avoidAccidents ? 0.008 : 0;
  return [
    start,
    [start[0] + (end[0]-start[0])*0.3 + midOffset, start[1] + (end[1]-start[1])*0.3],
    [start[0] + (end[0]-start[0])*0.7 - midOffset, start[1] + (end[1]-start[1])*0.7],
    end
  ];
}

function generateDirectPath(start, end) {
  return [
    start,
    [(start[0]+end[0])/2, (start[1]+end[1])/2],
    end
  ];
}

function generateAlternatePath(start, end) {
  return [
    start,
    [start[0] + (end[0]-start[0])*0.4, start[1] + (end[1]-start[1])*0.4 - 0.005],
    [start[0] + (end[0]-start[0])*0.8, start[1] + (end[1]-start[1])*0.8 + 0.003],
    end
  ];
}

app.listen(PORT, () => {
  console.log(`🚀 SafeRoute API running on http://localhost:${PORT}`);
});
