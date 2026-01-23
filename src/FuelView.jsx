import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  { featureType: "administrative.land_parcel", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#e5e5e5" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#dadada" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#e5e5e5" }] },
  { featureType: "transit.station", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] }
];

export default function FuelView({ googleMapsApiKey, logoKey }) {
  const mapRef = useRef(null);
  const [searchCenter, setSearchCenter] = useState({ lat: 51.5074, lng: -0.1278 });
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  
  // Filters
  const [radius, setRadius] = useState(3);
  const [postcodeQuery, setPostcodeQuery] = useState("");
  const [fuelType, setFuelType] = useState('E10'); 

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
    getUserLocation();
  }, []);

  // 2. Get User Location
  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
          setSearchCenter(pos);
          setUserLocation(pos);
        },
        () => console.warn("GPS Permission denied")
      );
    }
  };

  // 3. Search Postcode
  const handleSearch = () => {
    if (!postcodeQuery || !window.google) return;
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ 'address': postcodeQuery + ", UK" }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        const newPos = { lat: loc.lat(), lng: loc.lng() };
        setSearchCenter(newPos);
        setRadius(5); 
      } else {
        alert("Postcode not found!");
      }
    });
  };

  // 4. SMART ZOOM: Fit Map to Radius
  useEffect(() => {
    if (mapRef.current && window.google) {
      const timeoutId = setTimeout(() => {
        const boundsCircle = new window.google.maps.Circle({
          center: searchCenter,
          radius: (radius + 0.2) * 1609.34, 
        });
        mapRef.current.fitBounds(boundsCircle.getBounds());
      }, 100); 

      return () => clearTimeout(timeoutId);
    }
  }, [searchCenter, radius, isLoaded]);

  // 5. Smart Filter & Sort
  const nearbyStations = useMemo(() => {
    if (!stations.length) return [];
    
    // Filter by Distance from SEARCH CENTER
    const local = stations.filter(s => {
      const dist = getDistance(searchCenter.lat, searchCenter.lng, s.location.latitude, s.location.longitude);
      s.distance = dist;
      return dist <= radius;
    });

    if (local.length > 0) {
      // Calculate Average
      const avgPrice = local.reduce((acc, s) => acc + (s.prices[fuelType] || 0), 0) / local.length;
      
      const colored = local.map(s => {
        const price = s.prices[fuelType];
        let color = "red";
        if (price < avgPrice - 0.5) color = "green";      
        else if (price < avgPrice + 0.5) color = "orange"; 
        return { ...s, color };
      });

      // Sort
      return colored.sort((a, b) => (a.prices[fuelType] || 999) - (b.prices[fuelType] || 999));
    }
    return [];
  }, [stations, searchCenter, radius, fuelType]);

  if (!isLoaded) return <div className="spinner">Loading Maps...</div>;

  return (
    <div className="fade-in" style={{height:'100%', display:'flex', flexDirection:'column', overflow:'hidden'}}>
      
      {/* Remove Default Close Button */}
      <style>{`
        .gm-ui-hover-effect { display: none !important; }
      `}</style>

      {/* --- CONTROLS --- */}
      <div className="bento-card" style={{margin:'0 0 10px 0', padding:'12px', display:'flex', flexDirection:'column', gap:'12px'}}>
        
        {/* Row 1: Search & GPS */}
        <div style={{display:'flex', gap:'8px'}}>
          <input 
            placeholder="Enter Postcode..." 
            value={postcodeQuery}
            onChange={(e) => setPostcodeQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{flex:1, padding:'8px 12px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--background)', color:'white'}}
          />
          <button onClick={handleSearch} className="btn btn-primary">🔍</button>
          <button onClick={getUserLocation} className="btn btn-secondary">📍</button>
        </div>

        {/* Row 2: Fuel Toggle & Radius */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px'}}>
           
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

           {/* Radius Slider - VISIBLE NOW */}
           <div style={{display:'flex', flexDirection:'column', flex:1, marginLeft:'10px'}}>
              <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.75rem', color:'#9ca3af', marginBottom:'4px'}}>
                <span>Radius</span>
                <span style={{fontWeight:'bold', color:'white'}}>{radius} miles</span>
              </div>
              <input 
                type="range" min="1" max="25" step="1" 
                value={radius} onChange={(e) => setRadius(Number(e.target.value))}
                style={{
                  width: '100%', 
                  height: '6px', 
                  background: '#4b5563', // Visible grey background
                  borderRadius: '4px',
                  outline: 'none',
                  opacity: '0.9',
                  cursor: 'pointer'
                }}
              />
           </div>
        </div>
      </div>

      {/* --- MAIN CONTENT --- */}
      <div style={{flex:1, display:'flex', flexDirection:'column', gap:'10px', minHeight:0}}>
        
        {/* MAP CONTAINER */}
        <div style={{height:'45vh', minHeight:'250px', borderRadius:'12px', overflow:'hidden', border:'1px solid var(--border)', flexShrink:0}}>
          <GoogleMap
            mapContainerStyle={containerStyle}
            onLoad={map => mapRef.current = map}
            options={{
              styles: mapStyles,
              disableDefaultUI: true,
              clickableIcons: false
            }}
          >
            {userLocation && <Marker position={userLocation} />}
            
            {nearbyStations.map((station, i) => (
              <Marker
                key={i}
                position={{ lat: station.location.latitude, lng: station.location.longitude }}
                onClick={() => setSelectedStation(station)}
                // --- FIXED: Use correct Google Maps Icon URL ---
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
                    style={{
                      width: '100%',
                      background: '#333', color: 'white', border: 'none', 
                      padding: '4px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem'
                    }}
                  >
                    Close
                  </button>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </div>

        {/* LIST CONTAINER */}
        <div style={{flex:1, overflowY:'auto', paddingBottom:'20px'}}>
           <div style={{fontSize:'0.85rem', color:'#9ca3af', marginBottom:'8px', paddingLeft:'4px'}}>
              Cheapest {fuelType === 'E10' ? 'Unleaded' : 'Diesel'} within {radius} miles
           </div>

           <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
             {nearbyStations.map((station, i) => (
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
    </div>
  );
}