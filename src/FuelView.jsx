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

// --- HELPER: Guess Domain for Logo ---
const getBrandDomain = (brand) => {
  if (!brand) return 'fuel.com';
  const b = brand.toLowerCase().replace(/['\s]/g, '');
  const overrides = {
    'shell': 'shell.com', 'bp': 'bp.com', 'esso': 'esso.co.uk',
    'texaco': 'texaco.com', 'sainsburys': 'sainsburys.co.uk',
    'tesco': 'tesco.com', 'asda': 'asda.com', 'morrisons': 'morrisons.com',
    'jet': 'jetlocal.co.uk', 'applegreen': 'applegreenstores.com',
    'gulf': 'gulfretail.co.uk'
  };
  return overrides[b] || `${b}.com`;
};

export default function FuelView({ googleMapsApiKey, logoKey }) {
  // --- STATE ---
  const [center, setCenter] = useState({ lat: 51.5074, lng: -0.1278 }); // Default London
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  
  // Filters
  const [radius, setRadius] = useState(3); // Default 3 miles
  const [postcodeQuery, setPostcodeQuery] = useState("");
  const [searching, setSearching] = useState(false);

  // Load Maps API
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: googleMapsApiKey
  });

  // 1. Fetch Data on Mount
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/fuel-prices'); 
        const data = await res.json();
        setStations(data.stations || []);
        setLoading(false);
      } catch (err) {
        console.error("Failed to load fuel data", err);
        setLoading(false);
      }
    }
    fetchData();
    getUserLocation();
  }, []);

  // 2. Get User Location (GPS)
  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
          setCenter(pos);
          setUserLocation(pos);
        },
        () => console.warn("GPS Permission denied")
      );
    }
  };

  // 3. Handle Postcode Search (Geocoding)
  const handleSearch = () => {
    if (!postcodeQuery || !window.google) return;
    setSearching(true);
    
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ 'address': postcodeQuery + ", UK" }, (results, status) => {
      setSearching(false);
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        setCenter({ lat: loc.lat(), lng: loc.lng() });
        setRadius(5); // Auto-expand radius slightly for manual searches
      } else {
        alert("Postcode not found!");
      }
    });
  };

  // 4. Filter, Sort & Color Logic
  const nearbyStations = useMemo(() => {
    if (!stations.length) return [];
    
    // A. Filter by Distance
    const local = stations.filter(s => {
      const dist = getDistance(center.lat, center.lng, s.location.latitude, s.location.longitude);
      s.distance = dist; // Attach distance for display
      return dist <= radius;
    });

    // B. Calculate Avg Price for Traffic Lights
    if (local.length > 0) {
      const avgPrice = local.reduce((acc, s) => acc + s.prices.E10, 0) / local.length;
      
      const colored = local.map(s => {
        const price = s.prices.E10;
        let color = "red";
        if (price < avgPrice - 1) color = "green";      // Cheap
        else if (price < avgPrice + 1) color = "orange"; // Average
        return { ...s, color };
      });

      // C. Sort by Price (Cheapest First)
      return colored.sort((a, b) => a.prices.E10 - b.prices.E10);
    }
    return [];
  }, [stations, center, radius]);

  if (!isLoaded) return <div className="spinner">Loading Maps...</div>;

  return (
    <div className="fade-in" style={{height:'100%', display:'flex', flexDirection:'column', overflow:'hidden'}}>
      
      {/* --- CONTROLS HEADER --- */}
      <div className="bento-card" style={{margin:'0 0 10px 0', padding:'12px', display:'flex', flexDirection:'column', gap:'12px'}}>
        
        {/* Search Bar Row */}
        <div style={{display:'flex', gap:'8px'}}>
          <input 
            placeholder="Enter Postcode..." 
            value={postcodeQuery}
            onChange={(e) => setPostcodeQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{flex:1, padding:'8px 12px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--background)', color:'white'}}
          />
          <button onClick={handleSearch} disabled={searching} className="btn btn-primary">
            {searching ? '...' : '🔍'}
          </button>
          <button onClick={getUserLocation} className="btn btn-secondary">📍</button>
        </div>

        {/* Radius Slider Row */}
        <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
           <span style={{fontSize:'0.85rem', color:'#9ca3af', minWidth:'60px'}}>Radius:</span>
           <input 
             type="range" min="1" max="25" step="1" 
             value={radius} onChange={(e) => setRadius(Number(e.target.value))}
             style={{flex:1}}
           />
           <span style={{fontSize:'0.9rem', fontWeight:'bold', minWidth:'40px', textAlign:'right'}}>{radius}m</span>
        </div>
      </div>

      {/* --- SPLIT VIEW (Map Top / List Bottom) --- */}
      <div style={{flex:1, display:'flex', flexDirection:'column', gap:'10px', minHeight:0}}>
        
        {/* TOP: MAP (Fixed Height) */}
        <div style={{height:'40vh', minHeight:'250px', borderRadius:'12px', overflow:'hidden', border:'1px solid var(--border)', flexShrink:0}}>
          <GoogleMap
            mapContainerStyle={containerStyle}
            center={center}
            zoom={12} // Slightly zoomed out to see radius
            options={{
              styles: [
                { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
              ],
              disableDefaultUI: true,
            }}
          >
            {userLocation && <Marker position={userLocation} icon="http://maps.google.com/mapfiles/ms/icons/blue-dot.png" />}
            
            {nearbyStations.map((station, i) => (
              <Marker
                key={i}
                position={{ lat: station.location.latitude, lng: station.location.longitude }}
                onClick={() => setSelectedStation(station)}
                icon={`http://maps.google.com/mapfiles/ms/icons/$${station.color}-dot.png`}
              />
            ))}

            {selectedStation && (
              <InfoWindow
                position={{ lat: selectedStation.location.latitude, lng: selectedStation.location.longitude }}
                onCloseClick={() => setSelectedStation(null)}
              >
                <div style={{color:'black', padding:'4px'}}>
                  <strong style={{fontSize:'1rem'}}>{selectedStation.brand}</strong>
                  <div style={{marginTop:'4px', color: selectedStation.color==='green'?'#16a34a':'black'}}>
                    {selectedStation.prices.E10}p
                  </div>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </div>

        {/* BOTTOM: SCROLLABLE LIST */}
        <div style={{flex:1, overflowY:'auto', paddingBottom:'20px'}}>
           <div style={{fontSize:'0.85rem', color:'#9ca3af', marginBottom:'8px', paddingLeft:'4px'}}>
              Cheapest stations near center ({nearbyStations.length} found)
           </div>

           {nearbyStations.length === 0 && !loading && (
             <div style={{textAlign:'center', padding:'40px', color:'#666'}}>
               No stations found within {radius} miles. Try increasing the radius.
             </div>
           )}

           <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
             {nearbyStations.map((station, i) => (
               <div 
                 key={i} 
                 onClick={() => {
                    setCenter({ lat: station.location.latitude, lng: station.location.longitude });
                    setSelectedStation(station);
                 }}
                 className="bento-card"
                 style={{
                   padding:'12px', 
                   display:'flex', 
                   alignItems:'center', 
                   gap:'12px',
                   cursor:'pointer',
                   borderLeft: `4px solid ${station.color === 'green' ? '#22c55e' : station.color === 'orange' ? '#f59e0b' : '#ef4444'}`
                 }}
               >
                 {/* LOGO */}
                 <div style={{width:'40px', height:'40px', background:'white', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', padding:'4px', flexShrink:0}}>
                    <img 
                      src={`https://img.logo.dev/${getBrandDomain(station.brand)}?token=${logoKey}&size=60&format=png`} 
                      style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain'}}
                      onError={e => e.target.style.display='none'}
                      alt={station.brand}
                    />
                 </div>

                 {/* DETAILS */}
                 <div style={{flex:1, minWidth:0}}>
                    <div style={{fontWeight:'bold', fontSize:'0.95rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {station.brand} <span style={{fontSize:'0.75rem', fontWeight:400, color:'#9ca3af'}}>({station.distance.toFixed(1)}m)</span>
                    </div>
                    <div style={{fontSize:'0.75rem', color:'#9ca3af', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {station.address}
                    </div>
                 </div>

                 {/* PRICES */}
                 <div style={{textAlign:'right'}}>
                    <div style={{fontSize:'1.1rem', fontWeight:'bold', color: station.color === 'green' ? '#4ade80' : 'white'}}>
                      {station.prices.E10}p
                    </div>
                    <div style={{fontSize:'0.75rem', color:'#9ca3af'}}>Diesel: {station.prices.B7}p</div>
                 </div>
               </div>
             ))}
           </div>
        </div>

      </div>
    </div>
  );
}