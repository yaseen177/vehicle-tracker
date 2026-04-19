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
                const fetchOptions = { headers: { ...COMMON_HEADERS, "Authorization": `Bearer ${cachedToken}` } };
                const [pfsRes, pricesRes] = await Promise.all([
                    fetch(`https://www.fuel-finder.service.gov.uk/api/v1/pfs?batch-number=${batch}`, fetchOptions),
                    fetch(`https://www.fuel-finder.service.gov.uk/api/v1/pfs/fuel-prices?batch-number=${batch}`, fetchOptions)
                ]);

                if (!pfsRes.ok || !pricesRes.ok) return null;

                const pfsData = await pfsRes.json();
                const pricesData = await pricesRes.json();

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
                
                // ROBUST EXTRACTION: Catches Asda/Tesco schema variations
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
            const sid = station.node_id || station.id || station.site_id;
            const stationPricesArray = allPrices[sid] || [];
            
            let e10 = null, b7 = null;
            let stationTimestamp = ""; 

            // ROBUST EXTRACTION: Handles Array Schema
            if (Array.isArray(stationPricesArray)) {
                stationPricesArray.forEach(fp => {
                    const fType = (fp.fuel_type || fp.type || "").toUpperCase();
                    if (fType === 'E10' || fType === 'E10_STANDARD' || fType === 'E5' || fType === 'UNLEADED') e10 = formatPrice(fp.price);
                    if (fType === 'B7' || fType === 'B7_STANDARD' || fType === 'DIESEL') b7 = formatPrice(fp.price);

                    const fpTime = fp.price_change_effective_timestamp || fp.price_last_updated || fp.last_updated || "";
                    if (fpTime > stationTimestamp) stationTimestamp = fpTime;
                });
            } else if (typeof stationPricesArray === 'object' && stationPricesArray !== null) {
                // ROBUST EXTRACTION: Handles Object Schema
                e10 = formatPrice(stationPricesArray.E10 || stationPricesArray.E5 || stationPricesArray.Unleaded);
                b7 = formatPrice(stationPricesArray.B7 || stationPricesArray.Diesel);
                stationTimestamp = stationPricesArray.last_updated || "";
            }

            // ROBUST EXTRACTION: Fallback if prices are embedded directly in station object
            if (!e10 && !b7 && station.prices) {
                const sp = station.prices;
                if (Array.isArray(sp)) {
                    sp.forEach(fp => {
                        const ft = (fp.fuel_type || fp.type || "").toUpperCase();
                        if (ft === 'E10' || ft === 'E10_STANDARD' || ft === 'E5') e10 = formatPrice(fp.price);
                        if (ft === 'B7' || ft === 'B7_STANDARD') b7 = formatPrice(fp.price);
                    });
                } else if (typeof sp === 'object') {
                    e10 = formatPrice(sp.E10 || sp.E5 || sp.Unleaded);
                    b7 = formatPrice(sp.B7 || sp.Diesel);
                }
            }

            const lat = station.location?.latitude || station.location?.lat || station.latitude || 0;
            const lng = station.location?.longitude || station.location?.lng || station.longitude || 0;
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
        }).filter(s => (s.prices.E10 || s.prices.B7) && s.location.latitude !== 0);

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