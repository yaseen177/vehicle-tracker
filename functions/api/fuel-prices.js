/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Uses OAuth 2.0 Client Credentials and Caching
*/

// GLOBAL CACHE (Persists while the server is "warm")
let cachedToken = null;
let tokenExpiry = 0;

export async function onRequest(context) {
    const { env } = context;
    const CLIENT_ID = env.FUEL_CLIENT_ID;
    const CLIENT_SECRET = env.FUEL_CLIENT_SECRET;

    // Safety check
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Missing Fuel Finder API credentials in Cloudflare." }), { 
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    // 1. Check Data Cache (Cache for 30 minutes to respect API rate limits)
    const cache = caches.default;
    const cacheKey = new Request("https://fuel-prices-gov-api-v1");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    try {
        // 2. FETCH OAUTH TOKEN
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            
            // Note: Standard Gov.uk identity token endpoint. 
            // If your developer dashboard gave you a different token URL, update it here.
            const TOKEN_URL = "https://identity.fuel-finder.service.gov.uk/oauth2/token"; 
            
            const tokenBody = new URLSearchParams({
                grant_type: "client_credentials",
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            });

            const tokenRes = await fetch(TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: tokenBody
            });

            if (!tokenRes.ok) throw new Error("Failed to authenticate with Fuel Finder API");

            const tokenData = await tokenRes.json();
            cachedToken = tokenData.access_token;
            // Cache token for slightly less than its expiry time to prevent sudden drops
            tokenExpiry = now + ((tokenData.expires_in || 3600) - 60) * 1000;
        }

        // 3. FETCH FUEL DATA
        // Note: Check your developer portal to confirm if it is /v1/forecourts or /v1/prices
        const API_URL = "https://api.fuelfinder.service.gov.uk/v1/forecourts";

        const apiRes = await fetch(API_URL, {
            headers: {
                "Authorization": `Bearer ${cachedToken}`,
                "Accept": "application/json"
            }
        });

        if (!apiRes.ok) throw new Error(`Gov API returned status: ${apiRes.status}`);

        const data = await apiRes.json();

        // 4. MAP DATA TO FRONTEND FORMAT
        // The frontend expects { site_id, brand, address, postcode, location: {latitude, longitude}, prices: {E10, B7} }
        const rawStations = data.forecourts || data.stations || data || [];
        
        const mappedStations = rawStations.map(station => ({
            site_id: station.site_id || station.id || Math.random().toString(36).substr(2, 9),
            brand: station.brand || station.operator || "Unknown",
            address: station.address || "Unknown Address",
            postcode: station.postcode || "",
            location: {
                latitude: station.location?.latitude || station.latitude || 0,
                longitude: station.location?.longitude || station.longitude || 0
            },
            prices: station.prices || {}
        }));

        // 5. CREATE RESPONSE
        const json = JSON.stringify({ 
            updated: new Date().toISOString(),
            count: mappedStations.length,
            stations: mappedStations 
        });

        response = new Response(json, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*", 
                "Cache-Control": "public, max-age=1800" // Cache for 30 mins (1800 seconds)
            }
        });

        // 6. SAVE TO CACHE
        context.waitUntil(cache.put(cacheKey, response.clone()));

        return response;

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
    }
}