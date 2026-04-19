import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, Marker, InfoWindow, DirectionsRenderer, Autocomplete } from '@react-google-maps/api';
import { Search, MapPin, Info, Sparkles, ChevronDown, ChevronUp, Route as RouteIcon, Navigation, TrendingDown, TrendingUp } from 'lucide-react'; 
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

const containerStyle = { width: '100%', height: '45vh', minHeight: '300px' };

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

const getBrandDomain = (brand) => {
  if (!brand) return 'fuel.com';
  const b = brand.toLowerCase().replace(/['\s]/g, '');
  const overrides = {
    'shell': 'shell.com', 'bp': 'bp.com', 'esso': 'esso.co.uk',
    'texaco': 'texaco.com', 'sainsburys': 'sainsburys.co.uk',
    'tesco': 'tesco.com', 'asda': 'asda.com', 'morrisons': 'morrisons.com',
    'jet': 'jetlocal.co.uk', 'applegreen': 'applegreenstores.com',
    'gulf': 'gulfretail.co.uk', 'costco': 'costco.co.uk',
    'co-op': 'coop.co.uk'
  };
  return overrides[b] || `${b}.com`;
};

const formatStationTime = (isoString) => {
    if (!isoString) return "Unknown";
    const d = new Date(isoString);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const getReliability = (isoString) => {
    if (!isoString) return { text: "Unknown", color: "#6b7280", score: Infinity }; 
    const diffHours = (new Date() - new Date(isoString)) / (1000 * 60 * 60);
    
    if (diffHours < 24) return { text: "High Reliability", color: "#4ade80", score: diffHours }; 
    if (diffHours < 72) return { text: "Medium Reliability", color: "#f59e0b", score: diffHours }; 
    return { text: "Low Reliability", color: "#ef4444", score: diffHours }; 
};

const getOpenStatus = (openingTimes) => {
    if (!openingTimes || !openingTimes.usual_days) return null;

    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const now = new Date();
    const currentDayStr = days[now.getDay()];
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const parseTime = (str) => {
        if (!str) return 0;
        const [h, m] = str.split(':');
        return parseInt(h, 10) * 60 + parseInt(m, 10);
    };

    const formatTime = (str) => str ? str.substring(0, 5) : '';

    const todayHours = openingTimes.usual_days[currentDayStr];
    if (!todayHours) return null;

    if (todayHours.is_24_hours) {
        return { text: "Open 24 Hours", color: "#4ade80" }; 
    }

    const openMins = parseTime(todayHours.open);
    const closeMins = parseTime(todayHours.close);

    if (openMins === 0 && closeMins === 0) {
        let nextDayName = "Tomorrow";
        let nextOpenTime = "00:00";
        for (let i = 1; i <= 7; i++) {
            const nextDay = days[(now.getDay() + i) % 7];
            const nextHours = openingTimes.usual_days[nextDay];
            if (nextHours && (nextHours.is_24_hours || parseTime(nextHours.open) > 0)) {
                nextDayName = i === 1 ? "Tomorrow" : nextDay.charAt(0).toUpperCase() + nextDay.slice(1);
                nextOpenTime = formatTime(nextHours.open) || "00:00";
                if (nextHours.is_24_hours) nextOpenTime = "24 Hrs";
                break;
            }
        }
        return { text: `Closed • Opens ${nextOpenTime} ${nextDayName}`, color: "#ef4444" }; 
    }

    let isOpen = false;
    if (closeMins <= openMins) { 
        isOpen = currentMins >= openMins || currentMins < closeMins;
    } else {
        isOpen = currentMins >= openMins && currentMins < closeMins;
    }

    if (isOpen) {
        return { text: `Open Now • Closes at ${formatTime(todayHours.close)}`, color: "#4ade80" };
    } else {
        if (currentMins < openMins) {
            return { text: `Closed • Opens at ${formatTime(todayHours.open)}`, color: "#ef4444" };
        } else {
            const nextDay = days[(now.getDay() + 1) % 7];
            const nextHours = openingTimes.usual_days[nextDay];
            let opensNext = formatTime(nextHours?.open) || "00:00";
            if(nextHours?.is_24_hours) opensNext = "24 Hrs";
            return { text: `Closed • Opens at ${opensNext} Tomorrow`, color: "#ef4444" };
        }
    }
};

const mapStyles = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] }
];

export default function FuelView({ googleMapsApiKey, logoKey, user }) {
  const mapRef = useRef(null);
  
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState(null);
  
  const [progress, setProgress] = useState(0);
  const [isSyncing, setIsSyncing] = useState(true);

  const [directionsOpenFor, setDirectionsOpenFor] = useState(null);
  const [appSyncTime, setAppSyncTime] = useState(null); 
  
  const [mapBounds, setMapBounds] = useState(null);
  const [mapCenter, setMapCenter] = useState({ lat: 51.5074, lng: -0.1278 }); 
  
  const [userCoords, setUserCoords] = useState(null);
  const [profileCoords, setProfileCoords] = useState({ home: '', work: '' });

  const [viewMode, setViewMode] = useState('area'); 
  const [routeOrigin, setRouteOrigin] = useState("");
  const [routeDestination, setRouteDestination] = useState("");
  const [directionsResult, setDirectionsResult] = useState(null);

  const [postcodeQuery, setPostcodeQuery] = useState("");
  const [fuelType, setFuelType] = useState('E10'); 

  const [sortBy, setSortBy] = useState('price'); 
  const [filterBrand, setFilterBrand] = useState('All');
  const [searchName, setSearchName] = useState(''); 
  const [showSmartInfo, setShowSmartInfo] = useState(false); 
  const [priceTrend, setPriceTrend] = useState(null); 

  const autocompleteAreaRef = useRef(null);
  const autocompleteOriginRef = useRef(null);
  const autocompleteDestRef = useRef(null);

  const [libraries] = useState(['places', 'geometry']);
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: googleMapsApiKey,
    libraries: libraries
  });

  // Fetch Profile Locations for the One-Tap Commutes
  useEffect(() => {
    if (user) {
      getDoc(doc(db, "users", user.uid)).then(snap => {
        if (snap.exists()) {
          setProfileCoords({
            home: snap.data().homeLocation || '',
            work: snap.data().workLocation || ''
          });
        }
      }).catch(err => console.error("Failed to load profile commutes:", err));
    }
  }, [user]);

  useEffect(() => {
    let isMounted = true;
    
    async function fetchBatches() {
        const maxBatches = 20;
        const concurrencyLimit = 3; 
        let loadedCount = 0;
        
        const fetchBatch = async (batch) => {
            try {
                const res = await fetch(`/api/fuel-prices?batch=${batch}&t=${new Date().getTime()}`); 
                if (!res.ok) return; 
                const data = await res.json();

                if (data.stations && data.stations.length > 0 && isMounted) {
                    setStations(prev => {
                        const newMap = new Map();
                        prev.forEach(s => newMap.set(s.site_id, s));
                        data.stations.forEach(s => newMap.set(s.site_id, s));
                        return Array.from(newMap.values());
                    });
                    
                    if (data.updated && !appSyncTime) {
                        const dateObj = new Date(data.updated);
                        setAppSyncTime(dateObj.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' }));
                    }
                }
            } catch (err) {
                console.error(`[Frontend] 🚨 Error processing batch ${batch}:`, err);
            } finally {
                if (isMounted) {
                    loadedCount++;
                    setProgress(Math.round((loadedCount / maxBatches) * 100));
                    if (loadedCount >= 1) setLoading(false); 
                }
            }
        };

        for (let i = 0; i < maxBatches; i += concurrencyLimit) {
            // Relentlessly loop through all 20 batches without aborting early
            if (!isMounted) break;
            const promises = [];
            for (let j = 1; j <= concurrencyLimit; j++) {
                if (i + j <= maxBatches) promises.push(fetchBatch(i + j));
            }
            await Promise.all(promises);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        if (isMounted) {
            setProgress(100);
            setIsSyncing(false);
            if (loading) setLoading(false);
        }
    }
    
    fetchBatches();
    return () => { isMounted = false; };
  }, []);

  const onMapIdle = useCallback(() => {
    if (mapRef.current && viewMode === 'area') {
      const bounds = mapRef.current.getBounds();
      setMapBounds(bounds);
      const center = mapRef.current.getCenter();
      setMapCenter({ lat: center.lat(), lng: center.lng() });
    }
  }, [viewMode]);

  const handleMyLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const loc = { lat: p.coords.latitude, lng: p.coords.longitude };
          setUserCoords(loc);
          setMapCenter(loc);
          
          if (viewMode === 'route') {
              setRouteOrigin("Your Location");
          } else {
              setPostcodeQuery("Your Location");
              if (mapRef.current) {
                mapRef.current.panTo(loc);
                mapRef.current.setZoom(14);
              }
          }
        },
        (err) => alert(`Unable to retrieve location. Please check browser permissions. (${err.message})`),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } 
      );
    } else {
      alert("Geolocation is not supported by your browser.");
    }
  };

  const handleAreaSearch = () => {
    if (!postcodeQuery || !window.google || !mapRef.current) return;
    
    if (postcodeQuery === "Your Location" && userCoords) {
        mapRef.current.panTo(userCoords);
        mapRef.current.setZoom(14);
        return;
    }

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ 'address': postcodeQuery + ", UK" }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        mapRef.current.panTo(loc);
        mapRef.current.setZoom(14); 
      } else {
        alert("Location not found!");
      }
    });
  };

  const executeRouteSearch = (originVal, destVal) => {
    if (!originVal || !destVal || !window.google) return;
    
    let finalOrigin = originVal;
    if (originVal === "Your Location" && userCoords) {
        finalOrigin = new window.google.maps.LatLng(userCoords.lat, userCoords.lng);
    } else if (!finalOrigin.toLowerCase().includes('uk') && !finalOrigin.toLowerCase().includes('united kingdom')) {
        finalOrigin += ", UK";
    }

    let finalDest = destVal;
    if (destVal === "Your Location" && userCoords) {
        finalDest = new window.google.maps.LatLng(userCoords.lat, userCoords.lng);
    } else if (!finalDest.toLowerCase().includes('uk') && !finalDest.toLowerCase().includes('united kingdom')) {
        finalDest += ", UK";
    }

    const directionsService = new window.google.maps.DirectionsService();
    
    directionsService.route(
      {
        origin: finalOrigin,
        destination: finalDest,
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          setDirectionsResult(result);
          setMapCenter({ 
              lat: result.routes[0].legs[0].start_location.lat(), 
              lng: result.routes[0].legs[0].start_location.lng() 
          });
        } else {
          alert(`Could not calculate route: ${status}`);
        }
      }
    );
  };

  const handleRouteSearch = () => {
      executeRouteSearch(routeOrigin, routeDestination);
  };

  const visibleStations = useMemo(() => {
    if (!isLoaded || !window.google || !stations.length) return [];
    
    let routePolyline = null;
    let startCoords = null;
    let endCoords = null;

    if (viewMode === 'route' && directionsResult) {
        routePolyline = new window.google.maps.Polyline({ path: directionsResult.routes[0].overview_path });
        const leg = directionsResult.routes[0].legs[0];
        startCoords = { lat: leg.start_location.lat(), lng: leg.start_location.lng() };
        endCoords = { lat: leg.end_location.lat(), lng: leg.end_location.lng() };
    }

    const local = stations.filter(s => {
      if (!s.prices || !s.prices[fuelType]) return false; 
      if (filterBrand !== 'All' && s.brand !== filterBrand) return false; 
      if (searchName.trim() !== '') {
          if (!s.brand.toLowerCase().includes(searchName.toLowerCase())) return false;
      }
      
      const stationLoc = new window.google.maps.LatLng(s.location.latitude, s.location.longitude);
      
      if (viewMode === 'area') {
         if (!mapBounds) return false;
         return mapBounds.contains(stationLoc);
      } else {
         if (!routePolyline) return false;

         const distFromStart = getDistance(startCoords.lat, startCoords.lng, s.location.latitude, s.location.longitude);
         if (distFromStart <= 3.0) return true;

         const distFromEnd = getDistance(endCoords.lat, endCoords.lng, s.location.latitude, s.location.longitude);
         if (distFromEnd <= 3.0) return true;

         return window.google.maps.geometry.poly.isLocationOnEdge(stationLoc, routePolyline, 0.015);
      }
    });

    if (local.length > 0) {
      const avgPrice = local.reduce((acc, s) => acc + s.prices[fuelType], 0) / local.length;
      
      const rawProcessed = local.map(s => {
        const price = s.prices[fuelType];
        const dist = getDistance(mapCenter.lat, mapCenter.lng, s.location.latitude, s.location.longitude);
        const reliability = getReliability(s.last_updated);
        
        let color = "red";
        if (price < avgPrice - 0.5) color = "green";      
        else if (price < avgPrice + 0.5) color = "orange"; 
        
        return { ...s, color, distance: dist, reliability };
      });

      const prices = rawProcessed.map(s => s.prices[fuelType]);
      const dists = rawProcessed.map(s => s.distance);
      const rels = rawProcessed.map(s => s.reliability.score);

      const minPrice = Math.min(...prices); const maxPrice = Math.max(...prices);
      const minDist = Math.min(...dists);   const maxDist = Math.max(...dists);
      const minRel = Math.min(...rels);     const maxRel = Math.max(...rels);

      const finalProcessed = rawProcessed.map(s => {
         const normPrice = maxPrice === minPrice ? 100 : 100 - (((s.prices[fuelType] - minPrice) / (maxPrice - minPrice)) * 100);
         const normDist = maxDist === minDist ? 100 : 100 - (((s.distance - minDist) / (maxDist - minDist)) * 100);
         const normRel = maxRel === minRel ? 100 : 100 - (((s.reliability.score - minRel) / (maxRel - minRel)) * 100);

         const smartScore = (normPrice * 0.5) + (normDist * 0.3) + (normRel * 0.2);
         return { ...s, smartScore };
      });

      return finalProcessed.sort((a, b) => {
        if (sortBy === 'price') return a.prices[fuelType] - b.prices[fuelType];
        if (sortBy === 'distance') return a.distance - b.distance;
        if (sortBy === 'reliability') return a.reliability.score - b.reliability.score;
        if (sortBy === 'smart') return b.smartScore - a.smartScore; 
        return 0;
      });
    }
    return [];
  }, [isLoaded, stations, mapBounds, mapCenter, fuelType, filterBrand, searchName, sortBy, viewMode, directionsResult]); 

  // --- Price Trend Forecasting Logic ---
  useEffect(() => {
    if (visibleStations.length > 5) {
        const currentAvg = visibleStations.reduce((acc, s) => acc + s.prices[fuelType], 0) / visibleStations.length;
        const storageKey = `fuel_trend_avg_${fuelType}`;
        const lastAvgStr = localStorage.getItem(storageKey);
        
        if (lastAvgStr) {
            const lastAvg = parseFloat(lastAvgStr);
            const diff = currentAvg - lastAvg;
            if (diff <= -0.5) {
                setPriceTrend({ type: 'down', diff: Math.abs(diff).toFixed(1), text: `Prices have dropped by ${Math.abs(diff).toFixed(1)}p since your last visit. Great time to fill up!` });
            } else if (diff >= 0.5) {
                setPriceTrend({ type: 'up', diff: diff.toFixed(1), text: `Prices have risen by ${diff.toFixed(1)}p since your last visit.` });
            } else {
                setPriceTrend(null);
            }
        }
        
        localStorage.setItem(storageKey, currentAvg.toString());
    }
  }, [visibleStations, fuelType]);

  if (loading || !isLoaded) return (
      <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', padding:'20px', textAlign:'center'}}>
          <div style={{width:'40px', height:'40px', border:'4px solid rgba(255,255,255,0.1)', borderTop:'4px solid #3b82f6', borderRadius:'50%', animation:'spin 1s linear infinite', marginBottom:'20px'}}></div>
          <h3 style={{margin:0}}>Finding Fuel Prices...</h3>
          <p style={{color:'#9ca3af', fontSize:'0.9rem'}}>Downloading live prices for 8,000+ UK forecourts.</p>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
  );

  return (
    <div className="fade-in" style={{height:'100%', display:'flex', flexDirection:'column', overflow:'hidden'}}>
      
      <style>{` .gm-ui-hover-effect { display: none !important; } `}</style>

      {/* --- CONTROLS --- */}
      <div className="bento-card" style={{margin:'0 0 10px 0', padding:'12px', display:'flex', flexDirection:'column', gap:'12px'}}>
        
        {/* MODE TOGGLE */}
        <div style={{display: 'flex', gap: '8px', marginBottom: '4px'}}>
            <button 
                onClick={() => setViewMode('area')} 
                style={{flex: 1, padding: '8px', background: viewMode === 'area' ? '#3b82f6' : 'rgba(255,255,255,0.05)', color: 'white', borderRadius: '8px', border: viewMode === 'area' ? '1px solid #3b82f6' : '1px solid var(--border)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer', transition: 'all 0.2s'}}
            >
                <MapPin size={16} /> Area Search
            </button>
            <button 
                onClick={() => setViewMode('route')} 
                style={{flex: 1, padding: '8px', background: viewMode === 'route' ? '#8b5cf6' : 'rgba(255,255,255,0.05)', color: 'white', borderRadius: '8px', border: viewMode === 'route' ? '1px solid #8b5cf6' : '1px solid var(--border)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer', transition: 'all 0.2s'}}
            >
                <RouteIcon size={16} /> Route Search
            </button>
        </div>

        {/* INPUT FIELDS WITH AUTOCOMPLETE */}
        {viewMode === 'area' ? (
            <div style={{display:'flex', gap:'8px'}}>
                <div style={{flex: 1}}>
                    <Autocomplete
                        onLoad={ref => autocompleteAreaRef.current = ref}
                        onPlaceChanged={() => {
                            const place = autocompleteAreaRef.current.getPlace();
                            if(place?.formatted_address) {
                                setPostcodeQuery(place.formatted_address);
                                if(place.geometry?.location && mapRef.current) {
                                    mapRef.current.panTo(place.geometry.location);
                                    mapRef.current.setZoom(14);
                                }
                            }
                        }}
                        options={{ componentRestrictions: { country: "gb" } }}
                    >
                        <input 
                            placeholder="Search map location (e.g. London)" 
                            value={postcodeQuery}
                            onChange={(e) => setPostcodeQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAreaSearch()}
                            style={{width:'100%', padding:'8px 12px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--background)', color:'white', boxSizing:'border-box'}}
                        />
                    </Autocomplete>
                </div>
                <button onClick={handleAreaSearch} className="btn btn-primary" title="Search" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer'}}>
                    <Search size={18} />
                </button>
                <button 
                    onClick={handleMyLocation} 
                    className="btn btn-primary" 
                    title="My Location"
                    style={{background: 'var(--background)', border: '1px solid var(--border)', color: 'white', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'}}
                >
                    <Navigation size={18} />
                </button>
            </div>
        ) : (
            <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                <div style={{display: 'flex', gap: '8px'}}>
                    <div style={{flex: 1}}>
                        <Autocomplete
                            onLoad={ref => autocompleteOriginRef.current = ref}
                            onPlaceChanged={() => {
                                const place = autocompleteOriginRef.current.getPlace();
                                if(place?.formatted_address) setRouteOrigin(place.formatted_address);
                            }}
                            options={{ componentRestrictions: { country: "gb" } }}
                        >
                            <input 
                                placeholder="Origin (e.g. Manchester)" 
                                value={routeOrigin}
                                onChange={(e) => setRouteOrigin(e.target.value)}
                                style={{width:'100%', padding:'8px 12px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--background)', color:'white', boxSizing:'border-box'}}
                            />
                        </Autocomplete>
                    </div>
                    <button 
                        onClick={handleMyLocation} 
                        className="btn btn-primary" 
                        title="Use My GPS Location"
                        style={{background: 'var(--background)', border: '1px solid var(--border)', color: 'white', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'}}
                    >
                        <Navigation size={18} />
                    </button>
                </div>
                <div style={{display: 'flex', gap: '8px'}}>
                    <div style={{flex: 1}}>
                        <Autocomplete
                            onLoad={ref => autocompleteDestRef.current = ref}
                            onPlaceChanged={() => {
                                const place = autocompleteDestRef.current.getPlace();
                                if(place?.formatted_address) setRouteDestination(place.formatted_address);
                            }}
                            options={{ componentRestrictions: { country: "gb" } }}
                        >
                            <input 
                                placeholder="Destination (e.g. London)" 
                                value={routeDestination}
                                onChange={(e) => setRouteDestination(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleRouteSearch()}
                                style={{width:'100%', padding:'8px 12px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--background)', color:'white', boxSizing:'border-box'}}
                            />
                        </Autocomplete>
                    </div>
                    <button onClick={handleRouteSearch} style={{background: '#8b5cf6', color: 'white', padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'}}>
                        Calculate <RouteIcon size={16} />
                    </button>
                </div>
                
                {/* QUICK COMMUTE ACTIONS */}
                {(profileCoords.home && profileCoords.work) && (
                    <div style={{display: 'flex', gap: '8px', marginTop: '4px'}}>
                        <button 
                            onClick={() => {
                                setRouteOrigin(profileCoords.home);
                                setRouteDestination(profileCoords.work);
                                executeRouteSearch(profileCoords.home, profileCoords.work);
                            }}
                            style={{flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', color: '#bfdbfe', borderRadius: '8px', border: '1px dashed rgba(59, 130, 246, 0.4)', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold'}}
                        >
                            🏠 Home → Work
                        </button>
                        <button 
                            onClick={() => {
                                setRouteOrigin(profileCoords.work);
                                setRouteDestination(profileCoords.home);
                                executeRouteSearch(profileCoords.work, profileCoords.home);
                            }}
                            style={{flex: 1, padding: '8px', background: 'rgba(255,255,255,0.05)', color: '#bfdbfe', borderRadius: '8px', border: '1px dashed rgba(59, 130, 246, 0.4)', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold'}}
                        >
                            🏢 Work → Home
                        </button>
                    </div>
                )}
            </div>
        )}

        {/* FILTERS & FUEL TOGGLES */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
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
           
           <div style={{fontSize:'0.75rem', color:'#9ca3af', fontStyle:'italic', display: 'flex', flexDirection: 'column', alignItems: 'flex-end'}}>
             <span>{visibleStations.length} stations {viewMode === 'route' ? 'along route' : 'in view'}</span>
             {appSyncTime && <span style={{fontSize: '0.7rem', opacity: 0.8}}>App Synced: {appSyncTime}</span>}
           </div>
        </div>

        <div style={{display:'flex', gap:'8px', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px'}}>
            
            <div style={{display: 'flex', flex: 1, gap: '4px'}}>
                <select 
                    value={sortBy} 
                    onChange={(e) => setSortBy(e.target.value)}
                    style={{flex: 1, minWidth: '130px', padding:'8px', borderRadius:'6px', border:'1px solid var(--border)', background:'#1f2937', color:'white', fontSize:'0.8rem', cursor:'pointer'}}
                >
                    <option value="smart">Sort by: Smart Sort (Best Overall)</option>
                    <option value="price">Sort by: Price (Lowest)</option>
                    <option value="distance">Sort by: Distance (Nearest)</option>
                    <option value="reliability">Sort by: Reliability (Most Recent)</option>
                </select>
                
                <button 
                    onClick={() => setShowSmartInfo(!showSmartInfo)}
                    style={{background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', minWidth: '36px', height: '36px', flexShrink: 0, cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center'}}
                    title="What is Smart Sort?"
                >
                    <Info size={18} />
                </button>
            </div>
            
            <select 
                value={filterBrand} 
                onChange={(e) => setFilterBrand(e.target.value)}
                style={{flex: 1, minWidth: '130px', padding:'8px', borderRadius:'6px', border:'1px solid var(--border)', background:'#1f2937', color:'white', fontSize:'0.8rem', cursor:'pointer'}}
            >
                <option value="All">All Major Brands</option>
                <option value="Asda">Asda</option>
                <option value="BP">BP</option>
                <option value="Co-op">Co-op</option>
                <option value="Costco">Costco</option>
                <option value="Esso">Esso</option>
                <option value="Gulf">Gulf</option>
                <option value="Jet">Jet</option>
                <option value="Morrisons">Morrisons</option>
                <option value="Sainsburys">Sainsbury's</option>
                <option value="Shell">Shell</option>
                <option value="Tesco">Tesco</option>
                <option value="Texaco">Texaco</option>
            </select>
            
            <input 
                type="text"
                placeholder="Search specific garage name..."
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                style={{flex: '1 1 100%', padding:'8px', borderRadius:'6px', border:'1px solid var(--border)', background:'rgba(255,255,255,0.05)', color:'white', fontSize:'0.8rem'}}
            />
        </div>

        {showSmartInfo && (
            <div className="fade-in" style={{background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '8px', padding: '12px', marginTop: '4px', fontSize: '0.85rem', color: '#bfdbfe', lineHeight: '1.5'}}>
                <strong>What is Smart Sort?</strong><br/>
                It calculates a score out of 100 to find the best overall compromise by weighing three factors:<br/>
                • <strong>Price (50%)</strong> - Because saving money is key.<br/>
                • <strong>Distance (30%)</strong> - To prevent driving too far out of your way.<br/>
                • <strong>Data Freshness (20%)</strong> - To ensure the price hasn't changed since it was reported.<br/>
                <button onClick={() => setShowSmartInfo(false)} style={{background: 'none', border: 'none', color: '#60a5fa', fontWeight: 'bold', marginTop: '8px', cursor: 'pointer', padding: 0}}>Dismiss</button>
            </div>
        )}

        {isSyncing && (
            <div style={{marginTop: '4px'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#9ca3af', marginBottom: '4px'}}>
                    <span>Syncing national database...</span>
                    <span>{progress}%</span>
                </div>
                <div style={{height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden'}}>
                    <div style={{height: '100%', width: `${progress}%`, background: '#3b82f6', transition: 'width 0.3s ease'}}></div>
                </div>
            </div>
        )}

      </div>

      {/* --- MAP --- */}
      <div style={{height:'45vh', minHeight:'250px', borderRadius:'12px', overflow:'hidden', border:'1px solid var(--border)', flexShrink:0}}>
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={mapCenter}
          zoom={13}
          onLoad={map => mapRef.current = map}
          onIdle={onMapIdle} 
          options={{
            styles: mapStyles,
            disableDefaultUI: true,
            clickableIcons: false,
            gestureHandling: "cooperative"
          }}
        >
          <Marker position={mapCenter} icon="https://maps.google.com/mapfiles/ms/icons/blue-dot.png" />
          
          {viewMode === 'route' && directionsResult && (
             <DirectionsRenderer
                directions={directionsResult}
                options={{
                    suppressMarkers: false,
                    polylineOptions: { strokeColor: '#8b5cf6', strokeWeight: 5, strokeOpacity: 0.8 }
                }}
             />
          )}

          {visibleStations.map((station, i) => (
            <Marker
              key={i}
              position={{ lat: station.location.latitude, lng: station.location.longitude }}
              onClick={() => setSelectedStation(station)}
              icon={`https://maps.google.com/mapfiles/ms/icons/${station.color === 'green' ? 'green' : station.color === 'orange' ? 'orange' : 'red'}-dot.png`}
            />
          ))}

          {selectedStation && (
            <InfoWindow
              position={{ lat: selectedStation.location.latitude, lng: selectedStation.location.longitude }}
              onCloseClick={() => setSelectedStation(null)}
            >
              <div style={{color:'black', padding:'5px', minWidth:'180px'}}>
                <h4 style={{margin:'0 0 5px 0', fontSize:'1rem', color:'#333'}}>{selectedStation.brand}</h4>
                
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                  <div style={{fontWeight: fuelType === 'E10' ? 'bold' : 'normal', color: fuelType === 'E10' ? '#16a34a' : '#666'}}>
                     UL: {selectedStation.prices.E10}p
                  </div>
                  <div style={{fontWeight: fuelType === 'B7' ? 'bold' : 'normal', color: fuelType === 'B7' ? '#16a34a' : '#666'}}>
                     D: {selectedStation.prices.B7}p
                  </div>
                </div>
                
                <div style={{fontSize: '0.7rem', color: '#666', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px'}}>
                    <span>Updated: {formatStationTime(selectedStation.last_updated)}</span>
                </div>

                <div style={{display:'flex', gap:'5px', marginTop:'10px'}}>
                  <a 
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStation.location.latitude},${selectedStation.location.longitude}`}
                    target="_blank" rel="noreferrer"
                    style={{flex: 1, textAlign: 'center', background: '#3b82f6', color: 'white', textDecoration: 'none', padding: '6px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold'}}
                  >
                    Go
                  </a>
                  <button 
                    onClick={() => setSelectedStation(null)}
                    style={{flex: 1, background: '#e5e7eb', color: '#374151', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold'}}
                  >
                    Close
                  </button>
                </div>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>

      {/* --- LIST --- */}
      <div style={{flex:1, overflowY:'auto', paddingBottom:'20px', marginTop:'10px'}}>
         
         {/* PRICE TREND FORECASTING BANNER */}
         {priceTrend && (
             <div className="fade-in" style={{background: priceTrend.type === 'down' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: priceTrend.type === 'down' ? '#34d399' : '#f87171', padding: '10px 14px', borderRadius: '8px', border: `1px solid ${priceTrend.type === 'down' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`, marginBottom: '12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px'}}>
                 {priceTrend.type === 'down' ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
                 {priceTrend.text}
             </div>
         )}

         <div style={{fontSize:'0.85rem', color:'#9ca3af', marginBottom:'8px', paddingLeft:'4px'}}>
            {viewMode === 'route' ? 'Stations along your route (' : 'Prices for visible area ('}
            {sortBy === 'price' && 'Sorted by cheapest)'}
            {sortBy === 'distance' && 'Sorted by nearest)'}
            {sortBy === 'reliability' && 'Sorted by highest reliability)'}
            {sortBy === 'smart' && 'Recommended Best Compromise)'}
         </div>

         {visibleStations.length === 0 && (
             <div style={{padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '0.9rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)'}}>
                 {viewMode === 'route' && !directionsResult 
                    ? "Enter an Origin and Destination to find stations along your journey."
                    : "No stations found matching your filters."}
             </div>
         )}

         <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
           {visibleStations.map((station, i) => {
             const openStatus = getOpenStatus(station.opening_times);

             return (
                 <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                    
                    {sortBy === 'smart' && i === 0 && (
                        <div style={{background: 'linear-gradient(to right, #3b82f6, #8b5cf6)', color: 'white', padding: '4px 10px', borderRadius: '8px 8px 0 0', fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', width: 'fit-content', marginLeft: '12px', marginBottom: '-8px', position: 'relative', zIndex: 1, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}>
                            <Sparkles size={14} /> Top Recommended 
                        </div>
                    )}

                    <div 
                    className="bento-card"
                    style={{
                        padding:'12px', 
                        display:'flex', 
                        flexDirection:'column',
                        borderLeft: `4px solid ${station.color === 'green' ? '#22c55e' : station.color === 'orange' ? '#f59e0b' : '#ef4444'}`,
                        background: selectedStation === station ? 'rgba(255,255,255,0.1)' : undefined,
                        border: sortBy === 'smart' && i === 0 ? '1px solid #3b82f6' : undefined 
                    }}
                    >
                        <div 
                            onClick={() => {
                                if (mapRef.current) {
                                    mapRef.current.panTo({ lat: station.location.latitude, lng: station.location.longitude });
                                    mapRef.current.setZoom(15); 
                                }
                                setSelectedStation(station);
                            }}
                            style={{display:'flex', alignItems:'center', gap:'12px', cursor:'pointer'}}
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
                                
                                <div style={{fontSize:'0.7rem', color:'#6b7280', marginTop:'4px', display:'flex', alignItems:'center', gap:'6px', flexWrap: 'wrap'}}>
                                    <span>Updated: {formatStationTime(station.last_updated)}</span>
                                    <span style={{
                                        background: `${station.reliability.color}20`, 
                                        color: station.reliability.color, 
                                        padding: '2px 6px', 
                                        borderRadius: '4px', 
                                        fontWeight: 'bold', 
                                        fontSize: '0.65rem',
                                        border: `1px solid ${station.reliability.color}40`,
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {station.reliability.text}
                                    </span>
                                </div>
                            </div>

                            <div style={{textAlign:'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end'}}>
                                {/* DYNAMIC ARROWS ON INDIVIDUAL PRICES */}
                                <div style={{display: 'flex', alignItems: 'center', fontSize:'1.1rem', fontWeight:'bold', color: station.color === 'green' ? '#4ade80' : 'white'}}>
                                    {fuelType === 'E10' ? station.prices.E10 : station.prices.B7}p
                                    {priceTrend && priceTrend.type === 'down' && <TrendingDown size={16} style={{color:'#34d399', marginLeft:'4px'}} />}
                                    {priceTrend && priceTrend.type === 'up' && <TrendingUp size={16} style={{color:'#f87171', marginLeft:'4px'}} />}
                                </div>
                                <div style={{fontSize:'0.75rem', color:'#666', marginBottom: '2px'}}>
                                    {fuelType === 'E10' ? 'Diesel' : 'Unleaded'}: {fuelType === 'E10' ? station.prices.B7 : station.prices.E10}p
                                </div>
                                
                                {sortBy === 'smart' && (
                                    <div style={{fontSize: '0.65rem', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', color: '#9ca3af', marginTop: '2px'}}>
                                        Score: {Math.round(station.smartScore)}/100
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            
                            <div style={{fontSize: '0.8rem', fontWeight: 'bold', color: openStatus ? openStatus.color : '#9ca3af'}}>
                                {openStatus ? openStatus.text : ""}
                            </div>

                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDirectionsOpenFor(directionsOpenFor === station.site_id ? null : station.site_id);
                                }}
                                style={{background: 'rgba(255,255,255,0.1)', border: 'none', color: '#9ca3af', padding: '6px 12px', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'}}
                            >
                                Directions {directionsOpenFor === station.site_id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                        </div>

                        {directionsOpenFor === station.site_id && (
                            <div style={{display: 'flex', gap: '8px', marginTop: '10px'}}>
                                <a 
                                    href={`https://www.google.com/maps/dir/?api=1&destination=${station.location.latitude},${station.location.longitude}`}
                                    target="_blank" rel="noreferrer"
                                    style={{flex: 1, textAlign: 'center', background: '#eaf3eb', color: '#1a73e8', textDecoration: 'none', padding: '8px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 'bold'}}
                                >
                                    Google Maps
                                </a>
                                <a 
                                    href={`http://maps.apple.com/?daddr=${station.location.latitude},${station.location.longitude}`}
                                    target="_blank" rel="noreferrer"
                                    style={{flex: 1, textAlign: 'center', background: '#f3f4f6', color: '#111827', textDecoration: 'none', padding: '8px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 'bold'}}
                                >
                                    Apple Maps
                                </a>
                                <a 
                                    href={`https://waze.com/ul?ll=${station.location.latitude},${station.location.longitude}&navigate=yes`}
                                    target="_blank" rel="noreferrer"
                                    style={{flex: 1, textAlign: 'center', background: '#e0f2fe', color: '#0369a1', textDecoration: 'none', padding: '8px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 'bold'}}
                                >
                                    Waze
                                </a>
                            </div>
                        )}
                    </div>
                 </div>
             );
           })}
         </div>
      </div>

    </div>
  );
}