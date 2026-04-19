/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Production Ready: Lightning Fast Timestamps + Address Hunter + Opening Hours + Dynamic Batching
*/

// GLOBAL CACHE
let cachedToken = null;
let tokenExpiry = 0;

export async function onRequest(context) {
    const { env } = context;
    const CLIENT_ID = env.FUEL_CLIENT_ID;
    const CLIENT_SECRET = env.FUEL_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Missing API credentials." }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    const cache = caches.default;
    
    const url = new URL(context.request.url);
    const batchParam = url.searchParams.get('batch');
    
    const cacheKeyString = `https://fuel-prices-gov-api-v26-${batchParam || 'all'}`;
    const cacheKey = new Request(cacheKeyString);
    let response = await cache.match(cacheKey);

    if (response) return response;

    const COMMON_HEADERS = {
        "User-Agent": "VehicleTrackerAPIClient/1.0",
        "Accept": "application/json",
        "Connection": "keep-alive"
    };

    try {
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            const formBody = new URLSearchParams();
            formBody.append("grant_type", "client_credentials");
            formBody.append("client_id", CLIENT_ID);
            formBody.append("client_secret", CLIENT_SECRET);
            formBody.append("scope", "fuelfinder.read"); 

            const jsonBody = JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials", scope: "fuelfinder.read" });

            const endpointsToTest = [
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/oauth/token", type: "form" },
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/token", type: "form" },
                { url: "https://www.fuel-finder.service.gov.uk/api/oauth2/token", type: "form" },
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token", type: "json" },
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_secret_token", type: "json" },
                { url: "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_secret_token", type: "form" },
                { url: "https://identity.fuel-finder.service.gov.uk/oauth2/token", type: "form" }
            ];

            let tokenRes = null;

            try {
                tokenRes = await Promise.any(endpointsToTest.map(async (ep) => {
                    const isForm = ep.type === "form";
                    const res = await fetch(ep.url, {
                        method: "POST",
                        headers: { ...COMMON_HEADERS, "Content-Type": isForm ? "application/x-www-form-urlencoded" : "application/json" },
                        body: isForm ? formBody : jsonBody
                    });
                    if (res.ok) return res;
                    throw new Error("Endpoint failed");
                }));
            } catch (aggregateError) {}

            if (!tokenRes || !tokenRes.ok) throw new Error("Auth Failed on all paths.");

            const tokenData = await tokenRes.json();
            const token = tokenData.access_token || tokenData.data?.access_token;
            const expiresIn = tokenData.expires_in || tokenData.data?.expires_in || 3600;

            if (!token) throw new Error("API returned success but no access_token found.");

            cachedToken = token;
            tokenExpiry = now + (expiresIn - 60) * 1000;
        }

        let batchesToFetch = [];
        if (batchParam) {
            batchesToFetch = [parseInt(batchParam, 10)];
        } else {
            batchesToFetch = Array.from({length: 20}, (_, i) => i + 1);
        }

        const allLocations = [];
        const allPrices = {};
        let hitEnd = false;
        
        const chunkSize = batchParam ? 1 : 5; 

        for (let i = 0; i < batchesToFetch.length; i += chunkSize) {
            const chunk = batchesToFetch.slice(i, i + chunkSize);
            
            const chunkPromises = chunk.map(async (batch) => {
                console.log(`[Backend] Fetching upstream Batch ${batch}...`); // NEW LOG
                const fetchOptions = { headers: { ...COMMON_HEADERS, "Authorization": `Bearer ${cachedToken}` } };
                
                const [pfsRes, pricesRes] = await Promise.all([
                    fetch(`https://www.fuel-finder.service.gov.uk/api/v1/pfs?batch-number=${batch}`, fetchOptions).catch(e => {
                        console.error(`[Backend] ❌ Network error on Locations Batch ${batch}:`, e.message);
                        return null;
                    }),
                    fetch(`https://www.fuel-finder.service.gov.uk/api/v1/pfs/fuel-prices?batch-number=${batch}`, fetchOptions).catch(e => {
                        console.error(`[Backend] ❌ Network error on Prices Batch ${batch}:`, e.message);
                        return null;
                    })
                ]);

                // NEW LOGGING: Check exact status codes from the Gov API
                console.log(`[Backend] Batch ${batch} Status -> Locations: ${pfsRes ? pfsRes.status : 'FAIL'}, Prices: ${pricesRes ? pricesRes.status : 'FAIL'}`);

                if (!pfsRes || !pfsRes.ok) return null;

                const pfsData = await pfsRes.json().catch(() => ({ data: [] }));
                let pricesData = { data: [] };
                
                if (pricesRes && pricesRes.ok) {
                    try { pricesData = await pricesRes.json(); } catch(e) {
                         console.error(`[Backend] ⚠️ JSON parse failed for prices Batch ${batch}`);
                    }
                }

                const locCount = Array.isArray(pfsData) ? pfsData.length : (pfsData.data?.length || 0);
                const priceCount = Array.isArray(pricesData) ? pricesData.length : (pricesData.data?.length || 0);
                
                console.log(`[Backend] Batch ${batch} Extracted -> ${locCount} Locations, ${priceCount} Prices`); // NEW LOG

                return {
                    locs: Array.isArray(pfsData) ? pfsData : (pfsData.data || []),
                    prices: Array.isArray(pricesData) ? pricesData : (pricesData.data || [])
                };
            });

            const results = await Promise.all(chunkPromises);

            for (const res of results) {
                if (!res) continue;
                if (res.locs.length === 0) hitEnd = true;
                allLocations.push(...res.locs);
                
                res.prices.forEach(p => { 
                    const pid = p.node_id || p.id || p.site_id;
                    if (pid) allPrices[pid] = p.fuel_prices || p.prices || []; 
                });
            }

            if (hitEnd) break;
        }

        const cleanBrandName = (rawName) => {
            if (!rawName) return "Unknown";
            const name = rawName.toUpperCase();
            if (name.includes("TESCO")) return "Tesco";
            if (name.includes("SAINSBURY")) return "Sainsburys";
            if (name.includes("ASDA")) return "Asda";
            if (name.includes("MORRISON")) return "Morrisons";
            if (name.includes("SHELL")) return "Shell";
            if (/\bBP\b/.test(name) || name.includes("B.P.")) return "BP";
            if (name.includes("ESSO")) return "Esso";
            if (name.includes("TEXACO")) return "Texaco";
            if (name.includes("JET")) return "Jet";
            if (name.includes("GULF")) return "Gulf";
            if (name.includes("APPLEGREEN") || name.includes("APPLE GREEN")) return "Applegreen";
            if (name.includes("COSTCO")) return "Costco";
            if (name.includes("MURCO")) return "Murco";
            if (name.includes("CO-OP") || name.includes("COOP")) return "Co-op";
            return rawName.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
        };

        const formatPrice = (rawPrice) => {
            if (!rawPrice || rawPrice <= 0) return null;
            let price = parseFloat(rawPrice);
            if (price < 10) price = price * 100;
            return parseFloat(price.toFixed(1));
        };

        const mappedStations = allLocations.map(station => {
            const sid = station.node_id || station.id || station.site_id || station.uuid;
            const stationPricesArray = allPrices[sid] || [];
            
            let e10 = null, b7 = null;
            let stationTimestamp = ""; 

            // 1. Check Array Format
            if (Array.isArray(stationPricesArray) && stationPricesArray.length > 0) {
                stationPricesArray.forEach(fp => {
                    const fType = (fp.fuel_type || fp.type || "").toUpperCase();
                    if (['E10', 'E10_STANDARD', 'E5', 'UNLEADED'].includes(fType)) e10 = formatPrice(fp.price);
                    if (['B7', 'B7_STANDARD', 'DIESEL'].includes(fType)) b7 = formatPrice(fp.price);
                    const fpTime = fp.price_change_effective_timestamp || fp.price_last_updated || fp.last_updated || "";
                    if (fpTime > stationTimestamp) stationTimestamp = fpTime;
                });
            } 
            // 2. Check Object Format
            else if (typeof stationPricesArray === 'object' && stationPricesArray !== null && !Array.isArray(stationPricesArray)) {
                e10 = formatPrice(stationPricesArray.E10 || stationPricesArray.e10 || stationPricesArray.E5 || stationPricesArray.Unleaded);
                b7 = formatPrice(stationPricesArray.B7 || stationPricesArray.b7 || stationPricesArray.Diesel);
                stationTimestamp = stationPricesArray.last_updated || "";
            }

            // 3. FIX: Check Root/Embedded Schema (Catches ASDA and other CMA anomalies)
            if (!e10 && !b7) {
                const sp = station.prices || station.fuel_prices || station.pricing || station;
                if (Array.isArray(sp)) {
                    sp.forEach(fp => {
                        const ft = (fp.fuel_type || fp.type || "").toUpperCase();
                        if (['E10', 'E10_STANDARD', 'E5', 'UNLEADED'].includes(ft)) e10 = formatPrice(fp.price);
                        if (['B7', 'B7_STANDARD', 'DIESEL'].includes(ft)) b7 = formatPrice(fp.price);
                    });
                } else if (typeof sp === 'object' && sp !== null) {
                    e10 = formatPrice(sp.E10 || sp.e10 || sp.E5 || sp.e5 || sp.Unleaded || sp.unleaded || sp.standard_unleaded);
                    b7 = formatPrice(sp.B7 || sp.b7 || sp.Diesel || sp.diesel || sp.standard_diesel);
                }
            }

            const lat = parseFloat(station.location?.latitude || station.location?.lat || station.latitude || 0);
            const lng = parseFloat(station.location?.longitude || station.location?.lng || station.longitude || 0);
            const rawBrand = station.brand_name || station.trading_name || "Unknown";

            let cleanAddress = "Unknown Address";
            if (typeof station.address === 'string' && station.address.trim() !== '') {
                cleanAddress = station.address;
            } else if (typeof station.address === 'object' && station.address !== null) {
                const addressParts = [
                    station.address.line_1 || station.address.address_line_1 || station.address.street,
                    station.address.town || station.address.post_town || station.address.city
                ].filter(Boolean);
                if (addressParts.length > 0) cleanAddress = addressParts.join(", ");
            } else if (station.address_line_1 || station.address_line1 || station.town || station.city) {
                const addressParts = [
                    station.address_line_1 || station.address_line1 || station.address_line_2,
                    station.town || station.post_town || station.city
                ].filter(Boolean);
                if (addressParts.length > 0) cleanAddress = addressParts.join(", ");
            } else if (station.location && typeof station.location === 'object') {
                if (typeof station.location.address === 'string' && station.location.address.trim() !== '') {
                    cleanAddress = station.location.address;
                } else if (station.location.address_line_1 || station.location.town || station.location.city) {
                    const addressParts = [
                        station.location.address_line_1 || station.location.street,
                        station.location.town || station.location.city
                    ].filter(Boolean);
                    if (addressParts.length > 0) cleanAddress = addressParts.join(", ");
                }
            }

            if (cleanAddress === "Unknown Address" && station.postcode) {
                cleanAddress = station.postcode;
            }

            return {
                site_id: sid || Math.random().toString(36).substr(2, 9),
                brand: cleanBrandName(rawBrand),
                address: cleanAddress,
                postcode: station.postcode || "",
                location: { latitude: lat, longitude: lng },
                prices: { E10: e10, B7: b7 },
                last_updated: stationTimestamp || null,
                opening_times: station.opening_times || null 
            };
        }).filter(s => (s.prices.E10 || s.prices.B7) && s.location.latitude !== 0 && !isNaN(s.location.latitude));

        const uniqueStations = Array.from(new Map(mappedStations.map(s => [s.site_id, s])).values());

        const json = JSON.stringify({ 
            updated: new Date().toISOString(), 
            count: uniqueStations.length, 
            stations: uniqueStations,
            hitEnd: hitEnd || uniqueStations.length === 0 
        });

        response = new Response(json, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=1800" } });
        context.waitUntil(cache.put(cacheKey, response.clone()));
        return response;

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
}