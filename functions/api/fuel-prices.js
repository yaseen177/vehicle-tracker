/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Fix: Fetches ALL UK batches & cleans franchise brand names
*/

// GLOBAL CACHE
let cachedToken = null;
let tokenExpiry = 0;

export async function onRequest(context) {
    const { env } = context;
    const CLIENT_ID = env.FUEL_CLIENT_ID;
    const CLIENT_SECRET = env.FUEL_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Missing API credentials." }), { 
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    const cache = caches.default;
    // Cache bust to v13 for the new brand formatting
    const cacheKey = new Request("https://fuel-prices-gov-api-v13");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    // FIREWALL BYPASS HEADERS
    const COMMON_HEADERS = {
        "User-Agent": "VehicleTrackerAPIClient/1.0",
        "Accept": "application/json",
        "Connection": "keep-alive"
    };

    const API_DOMAIN = "https://api.fuelfinder.service.gov.uk";

    try {
        // 1. FETCH OAUTH TOKEN
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            const tokenBody = new URLSearchParams();
            tokenBody.append("grant_type", "client_credentials");
            tokenBody.append("client_id", CLIENT_ID);
            tokenBody.append("client_secret", CLIENT_SECRET);
            tokenBody.append("scope", "fuelfinder.read"); 

            const tokenPaths = [
                `${API_DOMAIN}/oauth2/token`,
                `${API_DOMAIN}/v1/oauth2/token`,
                `${API_DOMAIN}/api/v1/oauth2/token`,
                `${API_DOMAIN}/v1/token`
            ];

            let tokenRes = null;
            let lastErrorText = "";

            for (const path of tokenPaths) {
                tokenRes = await fetch(path, {
                    method: "POST",
                    headers: { ...COMMON_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
                    body: tokenBody
                });
                
                if (tokenRes.ok) break; 
                lastErrorText = await tokenRes.text();
            }

            if (!tokenRes || !tokenRes.ok) {
                throw new Error(`Auth Failed on API server. Last error (${tokenRes?.status}): ${lastErrorText}`);
            }

            const tokenData = await tokenRes.json();
            const token = tokenData.access_token;
            const expiresIn = tokenData.expires_in || 3600;

            if (!token) throw new Error("API returned success but no access_token found.");

            cachedToken = token;
            tokenExpiry = now + (expiresIn - 60) * 1000;
        }

        // 2. FETCH ALL UK DATA (Sequential to respect strict rate limits)
        const allLocations = [];
        const allPrices = {};
        
        // Loop up to 20 batches (covers ~10,000 stations). 
        // It will break early automatically when it hits the end of the UK stations.
        for (let batch = 1; batch <= 20; batch++) {
            const fetchOptions = {
                headers: { ...COMMON_HEADERS, "Authorization": `Bearer ${cachedToken}` }
            };

            const [pfsRes, pricesRes] = await Promise.all([
                fetch(`${API_DOMAIN}/v1/pfs?batch-number=${batch}`, fetchOptions),
                fetch(`${API_DOMAIN}/v1/pfs/fuel-prices?batch-number=${batch}`, fetchOptions)
            ]);

            let finalPfsRes = pfsRes;
            let finalPricesRes = pricesRes;

            // Handle API Gateway Pathing Differences
            if (pfsRes.status === 404) {
                const [retryPfs, retryPrices] = await Promise.all([
                    fetch(`${API_DOMAIN}/api/v1/pfs?batch-number=${batch}`, fetchOptions),
                    fetch(`${API_DOMAIN}/api/v1/pfs/fuel-prices?batch-number=${batch}`, fetchOptions)
                ]);
                finalPfsRes = retryPfs;
                finalPricesRes = retryPrices;
            }

            if (!finalPfsRes.ok || !finalPricesRes.ok) {
                console.warn(`Stopped fetching at batch ${batch} due to non-200 status.`);
                break;
            }

            const pfsData = await finalPfsRes.json();
            const pricesData = await finalPricesRes.json();

            const locs = Array.isArray(pfsData) ? pfsData : (pfsData.data || []);
            const prices = Array.isArray(pricesData) ? pricesData : (pricesData.data || []);

            // If we receive an empty array, we've pulled the entire country. Break the loop.
            if (locs.length === 0) break;

            allLocations.push(...locs);
            prices.forEach(p => {
                if (p.node_id) allPrices[p.node_id] = p.fuel_prices || [];
            });
        }

        // 3. BRAND CLEANING HELPER
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
            
            // If it's a small independent, just capitalise the first letters properly
            return rawName.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
        };

        // 4. FORMAT FOR FRONTEND
        const mappedStations = allLocations.map(station => {
            const sid = station.node_id || station.id;
            const stationPricesArray = allPrices[sid] || [];
            
            let e10 = null;
            let b7 = null;

            stationPricesArray.forEach(fp => {
                if (fp.fuel_type === 'E10' || fp.fuel_type === 'E10_STANDARD' || fp.fuel_type === 'E5') e10 = fp.price;
                if (fp.fuel_type === 'B7' || fp.fuel_type === 'B7_STANDARD') b7 = fp.price;
            });

            const lat = station.location?.latitude || station.location?.lat || station.latitude || 0;
            const lng = station.location?.longitude || station.location?.lng || station.longitude || 0;

            const rawBrand = station.trading_name || station.brand_name || "Unknown";

            return {
                site_id: sid || Math.random().toString(36).substr(2, 9),
                brand: cleanBrandName(rawBrand), // Cleaned Brand!
                address: station.address || "Unknown Address",
                postcode: station.postcode || "",
                location: { latitude: lat, longitude: lng },
                prices: { E10: e10, B7: b7 }
            };
        }).filter(s => (s.prices.E10 || s.prices.B7) && s.location.latitude !== 0);

        const uniqueStations = Array.from(new Map(mappedStations.map(s => [s.site_id, s])).values());

        // 5. SEND RESPONSE
        const json = JSON.stringify({ 
            updated: new Date().toISOString(),
            count: uniqueStations.length,
            stations: uniqueStations 
        });

        response = new Response(json, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*", 
                "Cache-Control": "public, max-age=1800"
            }
        });

        context.waitUntil(cache.put(cacheKey, response.clone()));
        return response;

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
    }
}