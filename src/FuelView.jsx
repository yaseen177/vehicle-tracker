import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api';

const containerStyle = { width: '100%', height: '45vh', minHeight: '300px' };

// --- HELPER: Haversine Distance (Miles) ---
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 3958.8; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// --- HELPER: Brand Domain for Logos ---
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

// --- MAP STYLES ---
const mapStyles = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] }
];

export default function FuelView({ googleMapsApiKey, logoKey }) {
  const mapRef = useRef(null);
  
  // State
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState(null);
  
  // Map State (Used for Filtering)
  const [mapBounds, setMapBounds] = useState(null);
  const [mapCenter, setMapCenter] = useState({ lat: 51.5074, lng: -0.1278 }); // London default

  // Search & Filters
  const [postcodeQuery, setPostcodeQuery] = useState("");
  const [fuelType, setFuelType] = useState('E10'); // 'E10' (Unleaded) or 'B7' (Diesel)

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: googleMapsApiKey
  });

  // 1. Fetch Data
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
    // Try to get user location once on load
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setMapCenter({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => console.warn("GPS Permission denied")
      );
    }
  }, []);

  // 2. Handle Map Movements (Zoom/Pan)
  const onMapIdle = useCallback(() => {
    if (mapRef.current) {
      // Get the visible boundaries of the map
      const bounds = mapRef.current.getBounds();
      setMapBounds(bounds);
      
      // Get the center of the screen (for distance calc)
      const center = mapRef.current.getCenter();
      setMapCenter({ lat: center.lat(), lng: center.lng() });
    }
  }, []);

  // 3. Search Postcode
  const handleSearch = () => {
    if (!postcodeQuery || !window.google || !mapRef.current) return;
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ 'address': postcodeQuery + ", UK" }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        mapRef.current.panTo(loc);
        mapRef.current.setZoom(14); // Zoom in closer
      } else {
        alert("Postcode not found!");
      }
    });
  };

  // 4. Smart Filter (Based on Visible Map Area)
  const visibleStations = useMemo(() => {
    if (!stations.length || !mapBounds) return [];
    
    // Filter: Only keep stations inside the current map view
    const local = stations.filter(s => {
      // Create a LatLng object for the station to check against bounds
      const stationLoc = new window.google.maps.LatLng(s.location.latitude, s.location.longitude);
      return mapBounds.contains(stationLoc);
    });

    if (local.length > 0) {
      // Calculate Average Price in this area for Traffic Lights
      const avgPrice = local.reduce((acc, s) => acc + (s.prices[fuelType] || 0), 0) / local.length;
      
      // Add Distance & Color
      const processed = local.map(s => {
        const price = s.prices[fuelType];
        // Distance from the CENTER of your screen
        const dist = getDistance(mapCenter.lat, mapCenter.lng, s.location.latitude, s.location.longitude);
        
        let color = "red";
        if (price < avgPrice - 0.5) color = "green";      
        else if (price < avgPrice + 0.5) color = "orange"; 
        
        return { ...s, color, distance: dist };
      });

      // Sort by Cheapest Price
      return processed.sort((a, b) => (a.prices[fuelType] || 999) - (b.prices[fuelType] || 999));
    }
    return [];
  }, [stations, mapBounds, mapCenter, fuelType]);

  if (!isLoaded) return <div className="spinner">Loading Maps...</div>;

  return (
    <div className="fade-in" style={{height:'100%', display:'flex', flexDirection:'column', overflow:'hidden'}}>
      
      {/* Hide default close button style */}
      <style>{` .gm-ui-hover-effect { display: none !important; } `}</style>

      {/* --- CONTROLS --- */}
      <div className="bento-card" style={{margin:'0 0 10px 0', padding:'12px', display:'flex', flexDirection:'column', gap:'12px'}}>
        
        {/* Search Row */}
        <div style={{display:'flex', gap:'8px'}}>
          <input 
            placeholder="Search location..." 
            value={postcodeQuery}
            onChange={(e) => setPostcodeQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{flex:1, padding:'8px 12px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--background)', color:'white'}}
          />
          <button onClick={handleSearch} className="btn btn-primary">🔍</button>
        </div>

        {/* Filters Row */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
           
           {/* Fuel Toggle */}
           <div style={{display:'flex', background:'rgba(255,255,255,0.1)', borderRadius:'8px', padding:'2px'}}>
              <button 
                onClick={() => setFuelType('E10')}
                style={{
                  padding:'6px 12px', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:'bold', fontSize:'0.85rem',
                  background: fuelType === 'E10' ? '#22c55e' : 'transparent',
                  color: fuelType === 'E10' ? 'black' : 'var(--text-muted)'
                }}
              >Unleaded</button>
              <button 
                onClick={() => setFuelType('B7')}
                style={{
                  padding:'6px 12px', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:'bold', fontSize:'0.85rem',
                  background: fuelType === 'B7' ? '#000000' : 'transparent',
                  color: fuelType === 'B7' ? 'white' : 'var(--text-muted)'
                }}
              >Diesel</button>
           </div>
           
           <div style={{fontSize:'0.8rem', color:'#9ca3af', fontStyle:'italic'}}>
             {visibleStations.length} stations in view
           </div>
        </div>
      </div>

      {/* --- MAP --- */}
      <div style={{height:'45vh', minHeight:'250px', borderRadius:'12px', overflow:'hidden', border:'1px solid var(--border)', flexShrink:0}}>
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={mapCenter}
          zoom={13}
          onLoad={map => mapRef.current = map}
          onIdle={onMapIdle} // <--- Triggers filter when user stops moving map
          options={{
            styles: mapStyles,
            disableDefaultUI: true,
            clickableIcons: false,
            gestureHandling: "cooperative"
          }}
        >
          {/* My Location Pin */}
          <Marker position={mapCenter} icon="https://maps.google.com/mapfiles/ms/icons/blue-dot.png" />
          
          {visibleStations.map((station, i) => (
            <Marker
              key={i}
              position={{ lat: station.location.latitude, lng: station.location.longitude }}
              onClick={() => setSelectedStation(station)}
              // Using HTTPS to fix console errors
              icon={`https://maps.google.com/mapfiles/ms/icons/${station.color === 'green' ? 'green' : station.color === 'orange' ? 'orange' : 'red'}-dot.png`}
            />
          ))}

          {selectedStation && (
            <InfoWindow
              position={{ lat: selectedStation.location.latitude, lng: selectedStation.location.longitude }}
              onCloseClick={() => setSelectedStation(null)}
            >
              <div style={{color:'black', padding:'5px', minWidth:'150px'}}>
                <h4 style={{margin:'0 0 5px 0', fontSize:'1rem', color:'#333'}}>{selectedStation.brand}</h4>
                
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                  <div style={{fontWeight: fuelType === 'E10' ? 'bold' : 'normal', color: fuelType === 'E10' ? '#16a34a' : '#666'}}>
                     UL: {selectedStation.prices.E10}p
                  </div>
                  <div style={{fontWeight: fuelType === 'B7' ? 'bold' : 'normal', color: fuelType === 'B7' ? '#16a34a' : '#666'}}>
                     D: {selectedStation.prices.B7}p
                  </div>
                </div>
                
                <button 
                  onClick={() => setSelectedStation(null)}
                  style={{width: '100%', background: '#333', color: 'white', border: 'none', padding: '4px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem'}}
                >
                  Close
                </button>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>

      {/* --- LIST --- */}
      <div style={{flex:1, overflowY:'auto', paddingBottom:'20px', marginTop:'10px'}}>
         <div style={{fontSize:'0.85rem', color:'#9ca3af', marginBottom:'8px', paddingLeft:'4px'}}>
            Prices for visible area (Sorted by cheapest)
         </div>

         <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
           {visibleStations.map((station, i) => (
             <div 
               key={i} 
               onClick={() => {
                  if (mapRef.current) {
                      mapRef.current.panTo({ lat: station.location.latitude, lng: station.location.longitude });
                      mapRef.current.setZoom(15); 
                  }
                  setSelectedStation(station);
               }}
               className="bento-card"
               style={{
                 padding:'12px', 
                 display:'flex', 
                 alignItems:'center', 
                 gap:'12px',
                 cursor:'pointer',
                 borderLeft: `4px solid ${station.color === 'green' ? '#22c55e' : station.color === 'orange' ? '#f59e0b' : '#ef4444'}`,
                 background: selectedStation === station ? 'rgba(255,255,255,0.1)' : undefined
               }}
             >
               <div style={{width:'40px', height:'40px', background:'white', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', padding:'4px', flexShrink:0}}>
                  <img 
                    src={`https://img.logo.dev/${getBrandDomain(station.brand)}?token=${logoKey}&size=60&format=png`} 
                    style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain'}}
                    onError={e => e.target.style.display='none'}
                    alt={station.brand}
                  />
               </div>

               <div style={{flex:1, minWidth:0}}>
                  <div style={{fontWeight:'bold', fontSize:'0.95rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {station.brand} <span style={{fontSize:'0.75rem', fontWeight:400, color:'#9ca3af'}}>({station.distance.toFixed(1)}m)</span>
                  </div>
                  <div style={{fontSize:'0.75rem', color:'#9ca3af', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {station.address}
                  </div>
               </div>

               <div style={{textAlign:'right'}}>
                  <div style={{fontSize:'1.1rem', fontWeight:'bold', color: station.color === 'green' ? '#4ade80' : 'white'}}>
                    {fuelType === 'E10' ? station.prices.E10 : station.prices.B7}p
                  </div>
                  <div style={{fontSize:'0.75rem', color:'#666'}}>
                     {fuelType === 'E10' ? 'Diesel' : 'Unleaded'}: {fuelType === 'E10' ? station.prices.B7 : station.prices.E10}p
                  </div>
               </div>
             </div>
           ))}
         </div>
      </div>

    </div>
  );
}