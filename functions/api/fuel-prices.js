/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Handles 'getAllPFSFuelPrices' schema & pagination limits
*/

// GLOBAL CACHE (Persists while the server is "warm")
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
    // Cache bust to v5 for the new data structure
    const cacheKey = new Request("https://fuel-prices-gov-api-v5");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    try {
        // 1. OAUTH TOKEN
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            
            const tokenBody = new URLSearchParams();
            tokenBody.append("grant_type", "client_credentials");
            tokenBody.append("client_id", CLIENT_ID);
            tokenBody.append("client_secret", CLIENT_SECRET);
            tokenBody.append("scope", "fuelfinder.read");

            let tokenRes = await fetch("https://api.fuelfinder.service.gov.uk/oauth2/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: tokenBody
            });

            if (!tokenRes.ok) {
                 tokenRes = await fetch("https://api.fuelfinder.service.gov.uk/v1/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: tokenBody
                });
            }

            if (!tokenRes.ok) {
                const errorText = await tokenRes.text();
                throw new Error(`Auth Error (${tokenRes.status}): ${errorText}`);
            }

            const tokenData = await tokenRes.json();
            cachedToken = tokenData.access_token;
            tokenExpiry = now + ((tokenData.expires_in || 3600) - 60) * 1000;
        }

        // 2. FETCH FUEL DATA (Handle Pagination)
        // The docs state max 500 per request. We fetch batches 1 through 5 in parallel (2,500 stations).
        const batchesToFetch = [1, 2, 3, 4, 5];
        
        const batchPromises = batchesToFetch.map(batchNumber => 
            fetch(`https://api.fuelfinder.service.gov.uk/v1/prices?batch-number=${batchNumber}`, {
                headers: {
                    "Authorization": `Bearer ${cachedToken}`,
                    "Accept": "application/json"
                }
            }).then(res => res.ok ? res.json() : null)
        );

        const batchResults = await Promise.all(batchPromises);
        let allRawStations = [];

        batchResults.forEach(data => {
            if (!data) return;
            // Handle variations in the API wrapper
            const stations = data.data || data.prices || data || [];
            allRawStations = allRawStations.concat(stations);
        });

        // 3. MAP DATA TO FRONTEND FORMAT (Using exact names from the docs)
        const mappedStations = allRawStations.map(station => {
            let e10 = null;
            let b7 = null;

            // The docs specify prices are in an array called "fuel_prices"
            if (Array.isArray(station.fuel_prices)) {
                station.fuel_prices.forEach(fp => {
                    if (fp.fuel_type === 'E10' || fp.fuel_type === 'E10_STANDARD' || fp.fuel_type === 'E5') e10 = fp.price;
                    if (fp.fuel_type === 'B7' || fp.fuel_type === 'B7_STANDARD') b7 = fp.price;
                });
            }

            // Fallback for location data structure
            const lat = station.location?.latitude || station.latitude || station.lat || 0;
            const lng = station.location?.longitude || station.longitude || station.lng || 0;

            return {
                // Using "node_id" and "trading_name" from the docs
                site_id: station.node_id || station.site_id || station.id || Math.random().toString(36).substr(2, 9),
                brand: station.trading_name || station.brand || station.operator || "Unknown",
                address: station.address || "Unknown Address",
                postcode: station.postcode || "",
                location: { latitude: lat, longitude: lng },
                prices: { E10: e10, B7: b7 }
            };
        }).filter(s => (s.prices.E10 || s.prices.B7) && s.location.latitude !== 0);

        // Remove any accidental duplicates across batches
        const uniqueStations = Array.from(new Map(mappedStations.map(s => [s.site_id, s])).values());

        // 4. CREATE RESPONSE
        const json = JSON.stringify({ 
            updated: new Date().toISOString(),
            count: uniqueStations.length,
            stations: uniqueStations 
        });

        response = new Response(json, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*", 
                "Cache-Control": "public, max-age=1800" // Cache for 30 mins
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