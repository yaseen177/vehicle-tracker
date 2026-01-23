import React, { useState, useEffect, useMemo } from 'react';
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api';

const containerStyle = { width: '100%', height: '100%' };

// --- HELPER: Haversine Distance (Miles) ---
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 3958.8; // Radius of Earth in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export default function FuelView({ googleMapsApiKey }) {
  // State
  const [center, setCenter] = useState({ lat: 51.5074, lng: -0.1278 }); // Default London
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  
  // Load Maps API
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: googleMapsApiKey
  });

  // 1. Fetch Data on Mount
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/fuel-prices'); // Calls your new Worker
        const data = await res.json();
        setStations(data.stations);
        setLoading(false);
      } catch (err) {
        console.error("Failed to load fuel data", err);
        setLoading(false);
      }
    }
    fetchData();
    getUserLocation();
  }, []);

  // 2. Get User Location
  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
          setCenter(pos);
          setUserLocation(pos);
        },
        () => alert("Could not get location. Ensure GPS is on.")
      );
    }
  };

  // 3. Filter & Sort Stations (3 Mile Radius)
  const nearbyStations = useMemo(() => {
    if (!stations.length) return [];
    
    // Filter by distance
    const local = stations.filter(s => {
      const dist = getDistance(center.lat, center.lng, s.location.latitude, s.location.longitude);
      return dist <= 3.5; // Slightly over 3 miles to be safe
    });

    // Calculate Average Price for Traffic Light Logic
    if (local.length > 0) {
      const avgPrice = local.reduce((acc, s) => acc + s.prices.E10, 0) / local.length;
      
      return local.map(s => {
        const price = s.prices.E10;
        let color = "red";
        if (price < avgPrice - 1) color = "green"; // Cheap
        else if (price < avgPrice + 1) color = "orange"; // Average
        
        return { ...s, color };
      });
    }
    return [];
  }, [stations, center]);


  if (!isLoaded) return <div className="spinner"></div>;

  return (
    <div className="fade-in" style={{height:'100%', display:'flex', flexDirection:'column'}}>
      
      {/* HEADER CONTROLS */}
      <div className="bento-card" style={{marginBottom:'10px', padding:'12px', display:'flex', gap:'10px', alignItems:'center'}}>
        <div style={{flex:1}}>
           <h3 style={{margin:0}}>Fuel Finder</h3>
           <p style={{margin:0, fontSize:'0.8rem', color:'#9ca3af'}}>
             Found {nearbyStations.length} stations near you
           </p>
        </div>
        <button onClick={getUserLocation} className="btn btn-primary btn-sm">📍 My Location</button>
      </div>

      {/* MAP CONTAINER */}
      <div style={{flex:1, borderRadius:'12px', overflow:'hidden', border:'1px solid var(--border)'}}>
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={center}
          zoom={13}
          options={{
            styles: [ // Dark Mode Map Style
              { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
              { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
              { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            ],
            disableDefaultUI: true,
          }}
        >
          {/* USER MARKER */}
          {userLocation && (
            <Marker position={userLocation} icon="http://maps.google.com/mapfiles/ms/icons/blue-dot.png" />
          )}

          {/* STATION MARKERS */}
          {nearbyStations.map((station, i) => (
            <Marker
              key={i}
              position={{ lat: station.location.latitude, lng: station.location.longitude }}
              onClick={() => setSelectedStation(station)}
              icon={`http://maps.google.com/mapfiles/ms/icons/${station.color}-dot.png`}
            />
          ))}

          {/* INFO WINDOW */}
          {selectedStation && (
            <InfoWindow
              position={{ lat: selectedStation.location.latitude, lng: selectedStation.location.longitude }}
              onCloseClick={() => setSelectedStation(null)}
            >
              <div style={{color:'black', padding:'4px'}}>
                <h4 style={{margin:'0 0 5px 0'}}>{selectedStation.brand}</h4>
                <div style={{fontSize:'1.1rem', fontWeight:'bold', color: selectedStation.color==='green' ? '#16a34a' : 'black'}}>
                   Unleaded: {selectedStation.prices.E10}p
                </div>
                <div style={{fontSize:'0.9rem'}}>Diesel: {selectedStation.prices.B7}p</div>
                <div style={{fontSize:'0.8rem', color:'#666', marginTop:'4px'}}>{selectedStation.address}</div>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>
    </div>
  );
}